use crate::engine::card::Card;
use crate::engine::deck::Deck;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RoundType {
    TwoTrios,          // 2 tríos (6 cartas)
    OneTrioOneEscala,  // 1 trío y 1 escala (7 cartas)
    TwoEscalas,        // 2 escalas (8 cartas)
    ThreeTrios,        // 3 tríos (9 cartas)
    TwoTriosOneEscala, // 2 tríos y 1 escala (10 cartas)
    OneTrioTwoEscalas, // 1 trío y 2 escalas(11 cartas)
    ThreeEscalas,      // 3 escalas (12 cartas)
    FourTrios,         // 4 tríos (12 cartas)
    EscalaReal,        // Escala completa (12/13 cartas depending on variation)
}

impl RoundType {
    pub fn all_rounds() -> Vec<RoundType> {
        vec![
            RoundType::TwoTrios,
            RoundType::OneTrioOneEscala,
            RoundType::TwoEscalas,
            RoundType::ThreeTrios,
            RoundType::TwoTriosOneEscala,
            RoundType::OneTrioTwoEscalas,
            RoundType::ThreeEscalas,
            RoundType::FourTrios,
            RoundType::EscalaReal,
        ]
    }
}

pub struct GameState {
    pub players: Vec<PlayerState>,
    pub current_round: RoundType,
    pub round_index: usize,
    pub current_turn: usize, // Index in the players array
    pub deck: Deck,
    pub discard_pile: Vec<Card>,
    pub is_game_over: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerState {
    pub id: String,
    pub hand: Vec<Card>,
    pub points: u32,
    pub has_dropped_hand: bool, // "bajado"
}

impl GameState {
    pub fn new(player_ids: Vec<String>) -> Self {
        let players = player_ids
            .into_iter()
            .map(|id| PlayerState {
                id,
                hand: Vec::new(),
                points: 0,
                has_dropped_hand: false,
            })
            .collect();

        Self {
            players,
            current_round: RoundType::TwoTrios,
            round_index: 0,
            current_turn: 0,
            deck: Deck::new(),
            discard_pile: Vec::new(),
            is_game_over: false,
        }
    }

    pub fn start_round(&mut self) {
        self.deck = Deck::new();
        self.deck.shuffle();
        self.discard_pile.clear();

        for player in &mut self.players {
            player.hand.clear();
            player.has_dropped_hand = false;
            // Deal 12 cards to each player
            for _ in 0..12 {
                if let Some(card) = self.deck.draw() {
                    player.hand.push(card);
                }
            }
        }

        // Top card to discard pile
        if let Some(card) = self.deck.draw() {
            self.discard_pile.push(card);
        }
    }

    pub fn current_player(&mut self) -> Option<&mut PlayerState> {
        let idx = self.current_turn;
        self.players.get_mut(idx)
    }

    pub fn draw_from_deck(&mut self) -> Result<(), &'static str> {
        if self.is_game_over {
            return Err("Game is over");
        }

        let card = self.deck.draw().ok_or("Deck is empty")?;
        let player = self.current_player().ok_or("Invalid turn")?;
        player.hand.push(card);
        Ok(())
    }

    pub fn draw_from_discard(&mut self) -> Result<(), &'static str> {
        if self.is_game_over {
            return Err("Game is over");
        }

        let idx = self.current_turn;

        // Rule: "Si un jugador se baja no puede recoger desde el mazo de descarte"
        let has_dropped = self
            .players
            .get(idx)
            .ok_or("Invalid turn")?
            .has_dropped_hand;
        if has_dropped {
            return Err("Cannot draw from discard after dropping hand");
        }

        let card = self.discard_pile.pop().ok_or("Discard pile is empty")?;

        // Re-borrow mutably after the discard pile borrow is done
        self.players[idx].hand.push(card);
        Ok(())
    }

    pub fn discard(&mut self, card_index: usize) -> Result<(), &'static str> {
        if self.is_game_over {
            return Err("Game is over");
        }

        let idx = self.current_turn;

        let player = self.players.get_mut(idx).ok_or("Invalid turn")?;

        if card_index >= player.hand.len() {
            return Err("Card index out of bounds");
        }

        let card = player.hand.remove(card_index);
        let hand_is_empty = player.hand.is_empty();

        self.discard_pile.push(card);

        // Check if player won the round (no cards left)
        if hand_is_empty {
            self.end_round();
            return Ok(());
        }

        // Advance turn
        self.current_turn = (self.current_turn + 1) % self.players.len();
        Ok(())
    }

    pub fn end_round(&mut self) {
        // Calculate points
        for player in &mut self.players {
            player.points += crate::engine::points::calculate_hand_points(&player.hand);
        }

        // Advance round
        self.round_index += 1;
        let rounds = RoundType::all_rounds();
        if self.round_index < rounds.len() {
            self.current_round = rounds[self.round_index];
            // Next round starts with the player next to the one who started this round
            // For MVP, just reset to player 0 or keep rotating. Let's keep simple for now.
            self.current_turn = self.round_index % self.players.len();
            self.start_round();
        } else {
            self.is_game_over = true;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_game_initialization() {
        let players = vec!["alice".to_string(), "bob".to_string()];
        let mut game = GameState::new(players);

        assert_eq!(game.players.len(), 2);
        assert_eq!(game.current_round, RoundType::TwoTrios);
        assert_eq!(game.round_index, 0);

        game.start_round();

        // After start_round, players should have 12 cards each
        assert_eq!(game.players[0].hand.len(), 12);
        assert_eq!(game.players[1].hand.len(), 12);

        // Discard pile should have 1 card
        assert_eq!(game.discard_pile.len(), 1);

        // Deck should have 108 - (12 * 2) - 1 = 83 cards
        assert_eq!(game.deck.remaining(), 83);
    }

    #[test]
    fn test_valid_turn_progression() {
        let players = vec!["alice".to_string(), "bob".to_string()];
        let mut game = GameState::new(players);
        game.start_round();

        assert_eq!(game.current_turn, 0); // Alice's turn

        // Alice draws
        assert!(game.draw_from_deck().is_ok());
        assert_eq!(game.players[0].hand.len(), 13);

        // Alice discards
        assert!(game.discard(0).is_ok());
        assert_eq!(game.players[0].hand.len(), 12);

        // Now it's Bob's turn
        assert_eq!(game.current_turn, 1);
    }
}
