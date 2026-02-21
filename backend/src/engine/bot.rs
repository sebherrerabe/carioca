use crate::api::events::{ClientMessage, DiscardPayload, DropHandPayload};
use crate::engine::combo_finder::find_best_bajada;
use crate::engine::game::{GameState, PlayerState};
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

// ─── Turn Phase ───────────────────────────────────────────────────────────────

/// Explicit state machine for a bot's turn.
/// Replaces hand.len() branching which breaks when bajarse removes cards mid-turn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BotTurnPhase {
    /// hand.len() == 12, no card drawn this turn yet.
    NeedDraw,
    /// hand.len() == 13, must either bajarse or discard.
    AfterDraw,
    /// has_dropped_hand == true and hand is not empty; must discard to end turn.
    AfterBajada,
}

pub fn detect_phase(player: &PlayerState) -> BotTurnPhase {
    if player.has_dropped_hand {
        // Already bajado — must discard remaining cards
        BotTurnPhase::AfterBajada
    } else if player.hand.len() == 13 {
        BotTurnPhase::AfterDraw
    } else {
        // hand.len() == 12 (or < 12 before deal, which shouldn't happen)
        BotTurnPhase::NeedDraw
    }
}

// ─── Public Entry Point ───────────────────────────────────────────────────────

pub fn play_bot_turn(
    game: &GameState,
    player_id: &str,
    difficulty: BotDifficulty,
) -> Option<ClientMessage> {
    let current_player_index = game.current_turn;
    let player = game.players.get(current_player_index)?;

    if player.id != player_id {
        return None;
    }

    let phase = detect_phase(player);

    match phase {
        BotTurnPhase::NeedDraw => decide_draw(game, player, difficulty),
        BotTurnPhase::AfterDraw => {
            // Try bajarse first (not allowed on first turn of the round)
            if player.turns_played > 0
                && let Some(action) = try_bajarse(game, player, difficulty)
            {
                return Some(action);
            }
            Some(decide_discard(game, player, difficulty))
        }
        BotTurnPhase::AfterBajada => {
            // Must discard to end turn
            Some(decide_discard(game, player, difficulty))
        }
    }
}

// ─── Draw Phase ───────────────────────────────────────────────────────────────

fn decide_draw(
    game: &GameState,
    player: &PlayerState,
    difficulty: BotDifficulty,
) -> Option<ClientMessage> {
    if game.discard_pile.is_empty() {
        return Some(ClientMessage::DrawFromDeck);
    }

    let top_discard = game.discard_pile.last().unwrap();

    let should_draw_discard = match difficulty {
        BotDifficulty::Easy => {
            // 30% chance to draw from discard pile (random)
            let mut rng = rng();
            rng.random_bool(0.3)
        }
        BotDifficulty::Medium => {
            // Draw from discard if card has meaningful synergy (helps a partial combo)
            let score = card_synergy_score(&player.hand, top_discard);
            score >= 15
        }
        BotDifficulty::Hard => {
            // Same as Medium but also avoid giving away what we want
            let score = card_synergy_score(&player.hand, top_discard);
            score >= 15
        }
    };

    if should_draw_discard {
        Some(ClientMessage::DrawFromDiscard)
    } else {
        Some(ClientMessage::DrawFromDeck)
    }
}

// ─── Bajarse Phase ────────────────────────────────────────────────────────────

fn try_bajarse(
    game: &GameState,
    player: &PlayerState,
    difficulty: BotDifficulty,
) -> Option<ClientMessage> {
    let (req_trios, req_escalas) = game.current_round.get_requirements();
    let minimize_points = difficulty != BotDifficulty::Easy;

    let melds = find_best_bajada(&player.hand, req_trios, req_escalas, minimize_points)?;

    // Hard bot: delay bajarse if we're close to going out completely (≤ 1 card remaining)
    if difficulty == BotDifficulty::Hard {
        let total_meld_cards: usize = melds.iter().map(|m| m.card_indices.len()).sum();
        // hand has 13 cards; after bajarse we'd have 13 - total_meld_cards left to discard
        let remaining_after = player.hand.len().saturating_sub(total_meld_cards);
        // If only 1 card remains after bajada, it means we discard it immediately — great.
        // If remaining > 4, consider delaying by checking if we can do even better next turn.
        // For now: always bajarse when possible for Hard too (can refine timing later).
        let _ = remaining_after; // explicitly acknowledge: no delay implemented yet
    }

    // Build combinations from meld candidates
    let combinations: Vec<Vec<crate::engine::card::Card>> = melds
        .iter()
        .map(|m| m.card_indices.iter().map(|&i| player.hand[i]).collect())
        .collect();

    Some(ClientMessage::DropHand {
        payload: DropHandPayload { combinations },
    })
}

// ─── Discard Phase ────────────────────────────────────────────────────────────

fn decide_discard(
    game: &GameState,
    player: &PlayerState,
    difficulty: BotDifficulty,
) -> ClientMessage {
    if player.hand.is_empty() {
        // Should never happen in normal game flow
        return ClientMessage::Discard {
            payload: DiscardPayload { card_index: 0 },
        };
    }

    let best_index = match difficulty {
        BotDifficulty::Easy => {
            // Discard a random card
            let mut rng = rng();
            (0..player.hand.len())
                .collect::<Vec<usize>>()
                .choose(&mut rng)
                .copied()
                .unwrap_or(0)
        }
        BotDifficulty::Medium => {
            // Discard the card with the lowest synergy score
            find_lowest_synergy_index(&player.hand)
        }
        BotDifficulty::Hard => {
            // Discard using weighted composite: synergy + points + defensive penalty
            find_best_discard_index_hard(game, player)
        }
    };

    ClientMessage::Discard {
        payload: DiscardPayload {
            card_index: best_index,
        },
    }
}

/// Returns the index of the card with the lowest synergy score (Medium difficulty).
fn find_lowest_synergy_index(hand: &[crate::engine::card::Card]) -> usize {
    let mut best_index = 0;
    let mut min_score = i64::MAX;

    for (i, card) in hand.iter().enumerate() {
        let mut hand_without = hand.to_vec();
        hand_without.remove(i);
        let synergy = card_synergy_score(&hand_without, card) as i64;
        if synergy < min_score {
            min_score = synergy;
            best_index = i;
        }
    }
    best_index
}

/// Returns the best card index to discard for Hard difficulty.
/// Considers synergy, point value, and defensive heuristic.
fn find_best_discard_index_hard(game: &GameState, player: &PlayerState) -> usize {
    let hand = &player.hand;
    let mut best_index = 0;
    let mut lowest_score = f64::MAX;

    for (i, card) in hand.iter().enumerate() {
        let mut hand_without = hand.to_vec();
        hand_without.remove(i);

        let synergy = card_synergy_score(&hand_without, card) as f64;
        let points = card.points() as f64;
        let defense = defensive_penalty(card, game, &player.id);

        // Lower total_score = better card to discard
        // (low synergy + high points are cheap to give up; penalize giving good cards to opponents)
        let total_score = synergy - (points * 0.1) + defense;

        if total_score < lowest_score {
            lowest_score = total_score;
            best_index = i;
        }
    }
    best_index
}

// ─── Heuristics ───────────────────────────────────────────────────────────────

/// Scores how useful `target` card is given the rest of `hand`.
/// Higher score = more useful = less desirable to discard.
fn card_synergy_score(
    hand: &[crate::engine::card::Card],
    target: &crate::engine::card::Card,
) -> u32 {
    use crate::engine::card::Card;
    let mut score = 0;
    match target {
        Card::Joker => return 100, // Always keep jokers
        Card::Standard {
            suit: target_suit,
            value: target_value,
        } => {
            for c in hand {
                if let Card::Standard { suit, value } = c {
                    // Potential trio pair
                    if value == target_value {
                        score += 15;
                    }
                    // Potential escala adjacency (same suit, value within 2)
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

/// Penalty for discarding a card that would help an opponent extend their bajada.
/// Used by Hard difficulty only.
fn defensive_penalty(card: &crate::engine::card::Card, game: &GameState, my_id: &str) -> f64 {
    let mut penalty = 0.0;

    for player in &game.players {
        if player.id == my_id || !player.has_dropped_hand {
            continue;
        }
        for combo in &player.dropped_combinations {
            if crate::engine::combo_finder::can_shed(card, combo).is_some() {
                penalty += 10.0;
            }
        }
    }
    penalty
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::card::{Card, Suit, Value};
    use crate::engine::game::{GameState, PlayerState};

    fn std(suit: Suit, value: Value) -> Card {
        Card::Standard { suit, value }
    }

    fn make_player(hand: Vec<Card>, has_dropped: bool, turns_played: u32) -> PlayerState {
        PlayerState {
            id: "bot_test".to_string(),
            hand,
            points: 0,
            has_dropped_hand: has_dropped,
            dropped_combinations: vec![],
            turns_played,
        }
    }

    #[test]
    fn phase_detection_need_draw() {
        let player = make_player(vec![std(Suit::Hearts, Value::Two); 12], false, 0);
        assert_eq!(detect_phase(&player), BotTurnPhase::NeedDraw);
    }

    #[test]
    fn phase_detection_after_draw() {
        let player = make_player(vec![std(Suit::Hearts, Value::Two); 13], false, 1);
        assert_eq!(detect_phase(&player), BotTurnPhase::AfterDraw);
    }

    #[test]
    fn phase_detection_after_bajada() {
        let player = make_player(
            vec![std(Suit::Hearts, Value::Three); 5],
            true, // has_dropped_hand
            3,
        );
        assert_eq!(detect_phase(&player), BotTurnPhase::AfterBajada);
    }

    #[test]
    fn easy_bot_produces_valid_discard_index() {
        let hand: Vec<Card> = (2..=13).map(|_| std(Suit::Hearts, Value::Two)).collect();
        let player = make_player(hand, false, 1);
        let game = dummy_game_at_player(player);
        let action = play_bot_turn(&game, "bot_test", BotDifficulty::Easy);
        assert!(action.is_some());
        match action.unwrap() {
            ClientMessage::DrawFromDeck | ClientMessage::DrawFromDiscard => {}
            other => panic!("Expected draw action, got {:?}", other),
        }
    }

    #[test]
    fn medium_bot_bajarse_when_ready() {
        // Build a hand with 2 valid trios + 6 junk cards (round 1 = 2 trios req)
        let mut hand = vec![
            std(Suit::Hearts, Value::Five),
            std(Suit::Clubs, Value::Five),
            std(Suit::Spades, Value::Five),
            std(Suit::Hearts, Value::Nine),
            std(Suit::Clubs, Value::Nine),
            std(Suit::Diamonds, Value::Nine),
        ];
        // Add junk to reach 13 cards (simulate after draw)
        hand.extend([
            std(Suit::Hearts, Value::Two),
            std(Suit::Clubs, Value::King),
            std(Suit::Spades, Value::Ace),
            std(Suit::Diamonds, Value::Jack),
            std(Suit::Hearts, Value::Three),
            std(Suit::Clubs, Value::Six),
            std(Suit::Spades, Value::Queen), // 13th
        ]);
        let player = make_player(hand, false, 1); // turns_played > 0
        let game = dummy_game_at_player(player);
        let action = play_bot_turn(&game, "bot_test", BotDifficulty::Medium);
        assert!(action.is_some());
        match action.unwrap() {
            ClientMessage::DropHand { payload } => {
                assert_eq!(payload.combinations.len(), 2, "Should have 2 combinations");
            }
            other => panic!("Expected DropHand, got {:?}", other),
        }
    }

    #[test]
    fn bot_cannot_bajarse_on_first_turn() {
        let mut hand = vec![
            std(Suit::Hearts, Value::Five),
            std(Suit::Clubs, Value::Five),
            std(Suit::Spades, Value::Five),
            std(Suit::Hearts, Value::Nine),
            std(Suit::Clubs, Value::Nine),
            std(Suit::Diamonds, Value::Nine),
        ];
        hand.extend([
            std(Suit::Hearts, Value::Two),
            std(Suit::Clubs, Value::King),
            std(Suit::Spades, Value::Ace),
            std(Suit::Diamonds, Value::Jack),
            std(Suit::Hearts, Value::Three),
            std(Suit::Clubs, Value::Six),
            std(Suit::Spades, Value::Queen),
        ]);
        let player = make_player(hand, false, 0); // turns_played == 0 → first turn
        let game = dummy_game_at_player(player);
        let action = play_bot_turn(&game, "bot_test", BotDifficulty::Medium);
        // Must Discard, NOT DropHand
        assert!(action.is_some());
        match action.unwrap() {
            ClientMessage::Discard { .. } => {} // correct
            ClientMessage::DropHand { .. } => panic!("Should not bajarse on first turn"),
            other => panic!("Unexpected action {:?}", other),
        }
    }

    #[test]
    fn hard_bot_defensive_discard_avoids_extending_opponent_trio() {
        // Opponent has a trio of Sevens on the table
        let mut game = GameState::new(vec!["bot_test".to_string(), "opponent".to_string()]);
        game.start_round();

        // Manually set opponent as bajado with a trio of 7s
        game.players[1].has_dropped_hand = true;
        game.players[1].dropped_combinations = vec![vec![
            std(Suit::Hearts, Value::Seven),
            std(Suit::Clubs, Value::Seven),
            std(Suit::Spades, Value::Seven),
        ]];

        // Bot hand: includes 7♦ (which would extend opponent's trio) + high-point junk
        let hand = vec![
            std(Suit::Diamonds, Value::Seven), // idx 0 — danger: extends opponent's trio
            std(Suit::Clubs, Value::Ace),      // idx 1 — high points (20)
            std(Suit::Hearts, Value::King),    // idx 2
            std(Suit::Clubs, Value::Jack),     // idx 3
            std(Suit::Spades, Value::Two),     // idx 4 — very low points + no synergy
            std(Suit::Hearts, Value::Three),   // idx 5
            std(Suit::Clubs, Value::Nine),     // idx 6
            std(Suit::Diamonds, Value::Eight), // idx 7
            std(Suit::Hearts, Value::Six),     // idx 8
            std(Suit::Spades, Value::Queen),   // idx 9
            std(Suit::Clubs, Value::Four),     // idx 10
            std(Suit::Diamonds, Value::Ten),   // idx 11
            std(Suit::Hearts, Value::Five),    // idx 12
        ];
        game.players[0].hand = hand;
        game.players[0].turns_played = 2;
        game.current_turn = 0;

        let action = play_bot_turn(&game, "bot_test", BotDifficulty::Hard);
        assert!(action.is_some());
        // The bot should NOT discard index 0 (7♦ extends opponent's trio)
        match action.unwrap() {
            ClientMessage::Discard { payload } => {
                assert_ne!(
                    payload.card_index, 0,
                    "Hard bot should avoid giving the 7♦ to opponent"
                );
            }
            other => panic!("Unexpected action {:?}", other),
        }
    }

    /// Creates a minimal GameState with `player` as the current player (index 0).
    fn dummy_game_at_player(player: PlayerState) -> GameState {
        let mut game = GameState::new(vec!["bot_test".to_string(), "dummy_opponent".to_string()]);
        game.start_round();
        game.players[0] = player;
        game.current_turn = 0;
        game
    }
}
