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

    pub fn description(&self) -> &'static str {
        match self {
            RoundType::TwoTrios => "2 Tríos (6 cards)",
            RoundType::OneTrioOneEscala => "1 Trío, 1 Escala (7 cards)",
            RoundType::TwoEscalas => "2 Escalas (8 cards)",
            RoundType::ThreeTrios => "3 Tríos (9 cards)",
            RoundType::TwoTriosOneEscala => "2 Tríos, 1 Escala (10 cards)",
            RoundType::OneTrioTwoEscalas => "1 Trío, 2 Escalas (11 cards)",
            RoundType::ThreeEscalas => "3 Escalas (12 cards)",
            RoundType::FourTrios => "4 Tríos (12 cards)",
            RoundType::EscalaReal => "Escala Real (13 cards, same suit)",
        }
    }

    pub fn get_requirements(&self) -> (usize, usize) {
        // Returns (required_trios, required_escalas)
        match self {
            RoundType::TwoTrios => (2, 0),
            RoundType::OneTrioOneEscala => (1, 1),
            RoundType::TwoEscalas => (0, 2),
            RoundType::ThreeTrios => (3, 0),
            RoundType::TwoTriosOneEscala => (2, 1),
            RoundType::OneTrioTwoEscalas => (1, 2),
            RoundType::ThreeEscalas => (0, 3),
            RoundType::FourTrios => (4, 0),
            RoundType::EscalaReal => (0, 1), // Special case 13 cards
        }
    }
}

#[derive(Clone)]
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
    pub dropped_combinations: Vec<Vec<Card>>,
    pub turns_played: u32, // How many full turns (draw+discard) this player has completed this round
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
                dropped_combinations: Vec::new(),
                turns_played: 0,
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
            player.dropped_combinations.clear();
            player.turns_played = 0;
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

        // Increment turns played for this player
        self.players[idx].turns_played += 1;

        // Check if player won the round (no cards left)
        if hand_is_empty {
            self.end_round();
            return Ok(());
        }

        // Advance turn
        self.current_turn = (self.current_turn + 1) % self.players.len();
        Ok(())
    }

    pub fn reorder_hand(
        &mut self,
        player_id: &str,
        new_hand: Vec<Card>,
    ) -> Result<(), &'static str> {
        let player = self
            .players
            .iter_mut()
            .find(|p| p.id == player_id)
            .ok_or("Player not found")?;

        if player.hand.len() != new_hand.len() {
            return Err("New hand length does not match current hand length");
        }

        // Verify that the new_hand contains exactly the same cards as the current hand
        // A simple way is to check element by element. To handle duplicates (like two identical standard cards or two jokers),
        // we can count or remove them from a clone.
        let mut original_hand_copy = player.hand.clone();
        for card in &new_hand {
            let idx = original_hand_copy.iter().position(|c| c == card);
            if let Some(i) = idx {
                original_hand_copy.remove(i);
            } else {
                return Err("New hand contains an unknown card or extra duplicate");
            }
        }

        // If we reach here, new_hand has exact same elements as hand, just reordered
        player.hand = new_hand;
        Ok(())
    }

    pub fn drop_hand(
        &mut self,
        player_id: &str,
        combinations: Vec<Vec<Card>>,
    ) -> Result<(), &'static str> {
        if self.is_game_over {
            return Err("Game is over");
        }

        let idx = self.current_turn;
        let player = self.players.get_mut(idx).ok_or("Invalid turn")?;

        if player.id != player_id {
            return Err("Not your turn");
        }

        if player.has_dropped_hand {
            return Err("Hand already dropped");
        }

        // Verify that the player actually has all these cards in their hand
        let mut original_hand_copy = player.hand.clone();
        for combo in &combinations {
            for card in combo {
                if let Some(i) = original_hand_copy.iter().position(|c| c == card) {
                    original_hand_copy.remove(i);
                } else {
                    return Err("Combinations contain cards not in player's hand");
                }
            }
        }

        // Now mathematically validate the combinations against the round requirements.
        let (req_trios, req_escalas) = self.current_round.get_requirements();

        let mut found_trios = 0;
        let mut found_escalas = 0;

        for combo in &combinations {
            if is_valid_trio(combo) {
                found_trios += 1;
            } else if is_valid_escala(combo) {
                found_escalas += 1;
            } else {
                return Err("Invalid combination format submitted");
            }
        }

        if found_trios != req_trios || found_escalas != req_escalas {
            return Err("Combinations do not match the current round requirements");
        }

        // Success! Remove the evaluated cards from the real hand and store the bajada
        player.hand = original_hand_copy;
        player.has_dropped_hand = true;
        player.dropped_combinations = combinations;

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

// ---------------------------------------------
// Validation Logic
// ---------------------------------------------

fn is_valid_trio(combo: &[Card]) -> bool {
    if combo.len() < 3 {
        return false;
    }

    let mut target_value = None;

    for card in combo {
        if let Card::Standard { value, .. } = card {
            if let Some(tv) = target_value {
                if *value != tv {
                    return false; // Mismatched value in Trio
                }
            } else {
                target_value = Some(*value);
            }
        }
    }

    // Jokers are always valid. If the combo was entirely jokers (target_value == None), that's technically valid too.
    true
}

fn is_valid_escala(combo: &[Card]) -> bool {
    if combo.len() < 4 {
        return false;
    }

    let mut target_suit = None;

    // First pass: identify the target suit
    for card in combo {
        if let Card::Standard { suit, .. } = card {
            if let Some(ts) = target_suit {
                if *suit != ts {
                    return false; // Mismatched suit in Escala
                }
            } else {
                target_suit = Some(*suit);
            }
        }
    }

    // Second pass: verify sequential ascending order.
    // We expect values to increment by 1 each step.
    let mut expected_value_int = None;

    for card in combo {
        match card {
            Card::Standard { value, .. } => {
                let val_int = *value as i32;
                if let Some(exp) = expected_value_int
                    && val_int != exp
                {
                    return false; // Out of sequence
                }
                expected_value_int = Some(val_int + 1);
            }
            Card::Joker => {
                // The joker takes the place of whatever the expected standard card was
                if let Some(exp) = expected_value_int {
                    expected_value_int = Some(exp + 1);
                } else {
                    // First card is a joker. We can't immediately deduce the sequence start.
                    // This creates a small gap in simple validation where a leading joker isn't strongly bound
                    // until we hit a standard card, which is computationally tricky.
                    // For MVP simplicity, let's just accept leading jokers that bump the sequence implicitly when we find it.
                    // Wait, if we just defer setting expected_value_int, how do we know if it was correct?
                    // Let's implement a rigid backward inference:
                    // Find the first Standard card, trace back to define what the first card MUST be.
                }
            }
        }
    }

    // Rigid check for Escala:
    // 1. Find the first Standard card to anchor the sequence.
    let first_std_idx = combo.iter().position(|c| !c.is_joker());

    if let Some(idx) = first_std_idx
        && let Card::Standard { value, .. } = &combo[idx]
    {
        let anchor_val = *value as i32;
        let mut expected_val = anchor_val - (idx as i32);

        for card in combo {
            match card {
                Card::Standard { value: cv, .. } => {
                    if (*cv as i32) != expected_val {
                        return false;
                    }
                }
                Card::Joker => {
                    // Takes the place of expected_val natively
                }
            }
            expected_val += 1;

            // If sequence exceeds Ace (14), it's invalid unless bridging K-A-2 (which we ignore logic-wise for MVP)
            if expected_val > 15 {
                return false;
            }
        }
    }

    true
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

    #[test]
    fn test_4_player_initialization() {
        let players = vec![
            "p1".to_string(),
            "p2".to_string(),
            "p3".to_string(),
            "p4".to_string(),
        ];
        let mut game = GameState::new(players);
        game.start_round();

        assert_eq!(game.players.len(), 4);

        // Each player gets 12 cards -> 48 cards dealt
        for i in 0..4 {
            assert_eq!(game.players[i].hand.len(), 12);
        }

        // 1 card in discard pile
        assert_eq!(game.discard_pile.len(), 1);

        // Deck should have 108 - (12 * 4) - 1 = 59 cards remaining
        assert_eq!(game.deck.remaining(), 59);

        // Turn progression wraps after 4
        assert_eq!(game.current_turn, 0);
        assert!(game.draw_from_deck().is_ok());
        assert!(game.discard(0).is_ok());
        assert_eq!(game.current_turn, 1);
    }
}
