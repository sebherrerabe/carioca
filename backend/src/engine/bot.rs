use crate::api::events::ClientMessage;
use crate::engine::game::GameState;
use rand::RngExt;
use rand::prelude::IndexedRandom;
use rand::rng;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BotDifficulty {
    Easy,
    Medium,
    Hard,
}

pub fn play_bot_turn(
    game: &GameState,
    player_id: &str,
    difficulty: BotDifficulty,
) -> Option<ClientMessage> {
    // Only act if it's the bot's turn
    let current_player_index = game.current_turn;
    let turn_player = game.players.get(current_player_index)?;

    if turn_player.id != player_id {
        return None;
    }

    match difficulty {
        BotDifficulty::Easy => play_easy_bot(game, turn_player),
        BotDifficulty::Medium => play_medium_bot(game, turn_player),
        BotDifficulty::Hard => play_hard_bot(game, turn_player),
    }
}

// ======================================
// EASY BOT
// ======================================
// Acts randomly: Might draw from discarded pile if valid, otherwise draws from deck.
// Discards a random card from hand.
fn play_easy_bot(
    game: &GameState,
    turn_player: &crate::engine::game::PlayerState,
) -> Option<ClientMessage> {
    let mut rng = rng();

    // Have we already drawn? In our MVP, the turn structure is:
    // Client must send Draw action first, then Discard/DropHand action.
    // However, the Room actor receives individual messages.
    // For simplicity, let's assume the bot is asked what its whole turn is.
    // Wait, the WebSocket expects single actions.

    // In Carioca, you must draw a card FIRST, then discard.
    // If hand.len() == 12, the bot needs to Draw.
    // If hand.len() == 13, the bot needs to Discard.
    if turn_player.hand.len() == 12 {
        // Draw step
        let draw_discard = rng.random_bool(0.2); // 20% chance to draw from discard

        if draw_discard && !game.discard_pile.is_empty() && !turn_player.has_dropped_hand {
            // Cannot draw from discard if player has dropped hand.
            return Some(ClientMessage::DrawFromDiscard);
        } else {
            return Some(ClientMessage::DrawFromDeck);
        }
    } else if turn_player.hand.len() == 13 {
        // Discard step
        // Just discard a random card
        let random_index = (0..13)
            .collect::<Vec<usize>>()
            .choose(&mut rng)
            .copied()
            .unwrap_or(0);
        return Some(ClientMessage::Discard {
            payload: crate::api::events::DiscardPayload {
                card_index: random_index,
            },
        });
    }

    None
}

// ======================================
// Heuristics for Medium/Hard Bots
// ======================================
fn evaluate_card_usefulness(
    hand: &[crate::engine::card::Card],
    target: &crate::engine::card::Card,
) -> u32 {
    let mut score = 0;
    match target {
        crate::engine::card::Card::Joker => return 100, // Always keep jokers
        crate::engine::card::Card::Standard {
            suit: target_suit,
            value: target_value,
        } => {
            for c in hand {
                if let crate::engine::card::Card::Standard { suit, value } = c {
                    // Check for potential trio
                    if value == target_value {
                        score += 15;
                    }
                    // Check for potential escala (same suit, adjacent values)
                    if suit == target_suit {
                        let diff = (*value as i32) - (*target_value as i32);
                        if diff.abs() == 1 {
                            score += 10;
                        } else if diff.abs() == 2 {
                            score += 5;
                        }
                    }
                }
            }
        }
    }
    score
}

// ======================================
// MEDIUM BOT
// ======================================
// Evaluates basic useless cards to discard. Discards the one with the lowest usefulness score.
fn play_medium_bot(
    game: &GameState,
    turn_player: &crate::engine::game::PlayerState,
) -> Option<ClientMessage> {
    if turn_player.hand.len() == 12 {
        // Draw step: check discard pile top
        if let Some(top_discard) = game.discard_pile.last() {
            let score = evaluate_card_usefulness(&turn_player.hand, top_discard);
            // If it matches something, draw from discard
            if score >= 10 && !turn_player.has_dropped_hand {
                return Some(ClientMessage::DrawFromDiscard);
            }
        }
        return Some(ClientMessage::DrawFromDeck);
    } else if turn_player.hand.len() == 13 {
        // Discard step: find the card with the lowest usefulness score
        let mut min_score = u32::MAX;
        let mut best_index = 0;

        for (i, card) in turn_player.hand.iter().enumerate() {
            // Evaluates usefulness comparing to the REST of the hand
            let mut hand_without_card = turn_player.hand.clone();
            hand_without_card.remove(i);

            let score = evaluate_card_usefulness(&hand_without_card, card);
            if score < min_score {
                min_score = score;
                best_index = i;
            }
        }

        return Some(ClientMessage::Discard {
            payload: crate::api::events::DiscardPayload {
                card_index: best_index,
            },
        });
    }
    None
}

// ======================================
// HARD BOT
// ======================================
// Like Medium, but also accounts for the explicit point values of the cards (prioritizes discarding high point cards like Aces and Kings if useless)
fn play_hard_bot(
    game: &GameState,
    turn_player: &crate::engine::game::PlayerState,
) -> Option<ClientMessage> {
    if turn_player.hand.len() == 12 {
        if let Some(top_discard) = game.discard_pile.last() {
            let score = evaluate_card_usefulness(&turn_player.hand, top_discard);
            if score >= 10 && !turn_player.has_dropped_hand {
                return Some(ClientMessage::DrawFromDiscard);
            }
        }
        return Some(ClientMessage::DrawFromDeck);
    } else if turn_player.hand.len() == 13 {
        let mut min_score = f32::MAX;
        let mut best_index = 0;

        for (i, card) in turn_player.hand.iter().enumerate() {
            let mut hand_without_card = turn_player.hand.clone();
            hand_without_card.remove(i);

            let synergy_score = evaluate_card_usefulness(&hand_without_card, card) as f32;

            // Penalty for discarding high point cards is lower (so they get discarded earlier)
            let points = card.points() as f32;
            // Total score: Synergy minus a small fraction of points.
            // So if synergy is equal (e.g. 0), we discard the one with the highest points because it's score will be lower.
            let total_score = synergy_score - (points * 0.1);

            if total_score < min_score {
                min_score = total_score;
                best_index = i;
            }
        }

        return Some(ClientMessage::Discard {
            payload: crate::api::events::DiscardPayload {
                card_index: best_index,
            },
        });
    }
    None
}
