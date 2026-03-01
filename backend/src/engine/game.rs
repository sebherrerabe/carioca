use crate::engine::card::Card;
use crate::engine::deck::Deck;
use serde::{Deserialize, Serialize};

/// Tracks the most recent action taken by any player, broadcast to all clients.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastAction {
    pub player_id: String,
    pub action_type: String,
    pub card: Option<Card>,
}

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

#[derive(Debug, Clone)]
pub struct RoundEndResult {
    pub finished_round_index: usize,
    pub finished_round_name: String,
    pub winner_id: String,
    pub player_scores: Vec<(String, u32, u32)>,
    pub next_round_index: usize,
    pub next_round_name: String,
    pub is_game_over: bool,
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
    pub is_waiting_for_next_round: bool,
    pub last_action: Option<LastAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerState {
    pub id: String,
    pub hand: Vec<Card>,
    pub points: u32,
    pub has_dropped_hand: bool, // "bajado"
    pub dropped_combinations: Vec<Vec<Card>>,
    pub turns_played: u32, // How many full turns (draw+discard) this player has completed this round
    pub has_drawn_this_turn: bool,
    pub dropped_hand_this_turn: bool,
    pub is_ready_for_next_round: bool,
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
                has_drawn_this_turn: false,
                dropped_hand_this_turn: false,
                is_ready_for_next_round: false,
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
            is_waiting_for_next_round: false,
            last_action: None,
        }
    }

    pub fn start_round(&mut self) {
        self.deck = Deck::new();
        self.deck.shuffle();
        self.discard_pile.clear();
        self.last_action = None;

        for player in &mut self.players {
            player.hand.clear();
            player.has_dropped_hand = false;
            player.dropped_combinations.clear();
            player.turns_played = 0;
            player.has_drawn_this_turn = false;
            player.dropped_hand_this_turn = false;
            player.is_ready_for_next_round = false;
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
        if self.is_waiting_for_next_round {
            return Err("Waiting for other players to be ready for the next round");
        }

        let card = self.deck.draw().ok_or("Deck is empty")?;
        let player = self.current_player().ok_or("Invalid turn")?;
        if player.has_drawn_this_turn {
            return Err("You have already drawn a card this turn");
        }

        let pid = player.id.clone();
        player.hand.push(card);
        player.has_drawn_this_turn = true;
        self.last_action = Some(LastAction {
            player_id: pid,
            action_type: "drew_from_deck".to_string(),
            card: None,
        });
        Ok(())
    }

    pub fn draw_from_discard(&mut self) -> Result<(), &'static str> {
        if self.is_game_over {
            return Err("Game is over");
        }
        if self.is_waiting_for_next_round {
            return Err("Waiting for other players to be ready for the next round");
        }

        let idx = self.current_turn;

        let player = self.players.get_mut(idx).ok_or("Invalid turn")?;
        if player.has_drawn_this_turn {
            return Err("You have already drawn a card this turn");
        }

        // Rule: "Si un jugador se baja no puede recoger desde el mazo de descarte"
        if player.has_dropped_hand {
            return Err("Cannot draw from discard after dropping hand");
        }

        let card = self.discard_pile.pop().ok_or("Discard pile is empty")?;

        // Re-borrow mutably after the discard pile borrow is done
        let pid = self.players[idx].id.clone();
        self.players[idx].hand.push(card);
        self.players[idx].has_drawn_this_turn = true;
        self.last_action = Some(LastAction {
            player_id: pid,
            action_type: "drew_from_pozo".to_string(),
            card: Some(card),
        });
        Ok(())
    }

    pub fn discard(&mut self, card_index: usize) -> Result<Option<RoundEndResult>, &'static str> {
        if self.is_game_over {
            return Err("Game is over");
        }
        if self.is_waiting_for_next_round {
            return Err("Waiting for other players to be ready for the next round");
        }

        let idx = self.current_turn;

        let player = self.players.get_mut(idx).ok_or("Invalid turn")?;

        if !player.has_drawn_this_turn {
            return Err("You must draw a card before discarding");
        }

        if card_index >= player.hand.len() {
            return Err("Card index out of bounds");
        }

        let card = player.hand.remove(card_index);
        let hand_is_empty = player.hand.is_empty();
        let pid = player.id.clone();

        self.discard_pile.push(card);
        self.last_action = Some(LastAction {
            player_id: pid,
            action_type: "discarded".to_string(),
            card: Some(card),
        });

        self.players[idx].turns_played += 1;
        self.players[idx].has_drawn_this_turn = false;
        self.players[idx].dropped_hand_this_turn = false;

        // Check if player won the round (no cards left)
        if hand_is_empty {
            let result = self.end_round();
            return Ok(Some(result));
        }

        // Advance turn
        self.current_turn = (self.current_turn + 1) % self.players.len();
        self.players[self.current_turn].has_drawn_this_turn = false;
        self.players[self.current_turn].dropped_hand_this_turn = false;
        Ok(None)
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
        if self.is_waiting_for_next_round {
            return Err("Waiting for other players to be ready for the next round");
        }

        let idx = self.current_turn;
        let player = self.players.get_mut(idx).ok_or("Invalid turn")?;

        if player.id != player_id {
            return Err("Not your turn");
        }

        if !player.has_drawn_this_turn {
            return Err("You must draw a card before trying to drop your hand");
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
            // Strict size enforcement: trios must be at least 3 cards,
            // escalas at least 4 cards during initial bajada.
            if combo.len() >= 3 && crate::engine::rules::is_valid_trio(combo) {
                found_trios += 1;
            } else if combo.len() >= 4 && crate::engine::rules::is_valid_escala(combo) {
                found_escalas += 1;
            } else {
                return Err(
                    "Invalid combination: trios must be at least 3 cards, escalas at least 4",
                );
            }
        }

        if found_trios != req_trios || found_escalas != req_escalas {
            return Err("Combinations do not match the current round requirements");
        }

        // Success! Remove the evaluated cards from the real hand and store the bajada
        player.hand = original_hand_copy;
        player.has_dropped_hand = true;
        player.dropped_hand_this_turn = true;
        let pid = player.id.clone();
        player.dropped_combinations = combinations;
        self.last_action = Some(LastAction {
            player_id: pid,
            action_type: "bajó".to_string(),
            card: None,
        });

        Ok(())
    }

    /// Shed a single card from the current player's hand onto any dropped combo on the table.
    ///
    /// Rules enforced:
    /// 1. It's this player's turn.
    /// 2. The player has already dropped their hand (`has_dropped_hand == true`).
    /// 3. The player must have completed at least one full turn since dropping
    ///    (i.e. this is NOT the same turn as the bajada).
    /// 4. The target player exists and has `has_dropped_hand == true`.
    /// 5. The card is valid to shed onto the target combo (via `can_shed()`).
    pub fn shed_card(
        &mut self,
        player_id: &str,
        hand_card_index: usize,
        target_player_id: &str,
        target_combo_idx: usize,
    ) -> Result<Option<RoundEndResult>, &'static str> {
        if self.is_game_over {
            return Err("Game is over");
        }
        if self.is_waiting_for_next_round {
            return Err("Waiting for other players to be ready for the next round");
        }

        let current_idx = self.current_turn;
        let player = self.players.get(current_idx).ok_or("Invalid turn")?;

        if player.id != player_id {
            return Err("Not your turn");
        }
        if !player.has_dropped_hand {
            return Err("You must drop your hand before shedding cards");
        }
        if player.dropped_hand_this_turn {
            return Err("You cannot shed cards on the same turn you drop your hand");
        }

        if !player.has_drawn_this_turn {
            return Err("You must draw a card before shedding cards");
        }

        // The card to shed
        if hand_card_index >= player.hand.len() {
            return Err("Card index out of bounds");
        }
        let card = player.hand[hand_card_index];

        // Find target player and validate their combo
        let target_player_pos = self
            .players
            .iter()
            .position(|p| p.id == target_player_id)
            .ok_or("Target player not found")?;

        let target_player = &self.players[target_player_pos];
        if !target_player.has_dropped_hand {
            return Err("Target player has not dropped their hand yet");
        }
        if target_combo_idx >= target_player.dropped_combinations.len() {
            return Err("Target combo index out of bounds");
        }

        // Validate the card can be shed onto this combo
        let combo = target_player.dropped_combinations[target_combo_idx].clone();
        let position = crate::engine::combo_finder::can_shed(&card, &combo)
            .ok_or("This card cannot be shed onto that combo")?;

        // Apply the shed: remove card from hand, insert into the target combo
        let pid = self.players[current_idx].id.clone();
        self.players[current_idx].hand.remove(hand_card_index);
        self.last_action = Some(LastAction {
            player_id: pid,
            action_type: "shed".to_string(),
            card: Some(card),
        });

        match position {
            crate::engine::combo_finder::ShedPosition::ExtendLeft => {
                self.players[target_player_pos].dropped_combinations[target_combo_idx]
                    .insert(0, card);
            }
            crate::engine::combo_finder::ShedPosition::ExtendRight
            | crate::engine::combo_finder::ShedPosition::TrioExtension => {
                self.players[target_player_pos].dropped_combinations[target_combo_idx].push(card);
            }
        }

        // Check if the current player won by emptying their hand (shed their last card)
        if self.players[current_idx].hand.is_empty() {
            let result = self.end_round();
            return Ok(Some(result));
        }

        Ok(None)
    }

    pub fn end_round(&mut self) -> RoundEndResult {
        let finished_round_index = self.round_index;
        let finished_round_name = self.current_round.description().to_string();
        let winner_id = self.players[self.current_turn].id.clone();

        // Calculate points for this round (before adding to totals)
        let round_points: Vec<u32> = self
            .players
            .iter()
            .map(|p| crate::engine::points::calculate_hand_points(&p.hand))
            .collect();

        // Add round points to totals
        for (i, player) in self.players.iter_mut().enumerate() {
            player.points += round_points[i];
        }

        // Build per-player scores
        let player_scores: Vec<(String, u32, u32)> = self
            .players
            .iter()
            .enumerate()
            .map(|(i, p)| (p.id.clone(), round_points[i], p.points))
            .collect();

        // Advance round
        self.round_index += 1;
        let rounds = RoundType::all_rounds();
        let is_game_over;
        let next_round_index;
        let next_round_name;

        if self.round_index < rounds.len() {
            self.current_round = rounds[self.round_index];
            self.current_turn = self.round_index % self.players.len();
            next_round_index = self.round_index;
            next_round_name = self.current_round.description().to_string();
            is_game_over = false;

            // Do not start round immediately. Wait for players to be ready.
            self.is_waiting_for_next_round = true;
            for player in &mut self.players {
                player.is_ready_for_next_round = player.id.starts_with("bot_");
            }
        } else {
            self.is_game_over = true;
            is_game_over = true;
            next_round_index = self.round_index;
            next_round_name = "Game Over".to_string();
        }

        RoundEndResult {
            finished_round_index,
            finished_round_name,
            winner_id,
            player_scores,
            next_round_index,
            next_round_name,
            is_game_over,
        }
    }

    pub fn mark_player_ready(&mut self, player_id: &str) -> Result<(), &'static str> {
        if !self.is_waiting_for_next_round {
            return Err("Game is not waiting for next round");
        }

        let player = self
            .players
            .iter_mut()
            .find(|p| p.id == player_id)
            .ok_or("Player not found")?;

        player.is_ready_for_next_round = true;

        let all_ready = self.players.iter().all(|p| p.is_ready_for_next_round);
        if all_ready {
            self.is_waiting_for_next_round = false;
            self.start_round();
        }

        Ok(())
    }
}

// ---------------------------------------------
// Validation Logic
// ---------------------------------------------
// Validation delegates to crate::engine::rules

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

    // ── Helper: build a minimal 2-player game with alice already bajado ──

    fn std(suit: crate::engine::card::Suit, value: crate::engine::card::Value) -> Card {
        Card::Standard { suit, value }
    }

    /// Sets up a 2-player game (alice=0, bob=1) where alice has already dropped
    /// a trio of Fives and is on her second turn (turns_played > 0).
    fn game_with_alice_bajado() -> GameState {
        use crate::engine::card::{Suit, Value};
        let mut game = GameState::new(vec!["alice".to_string(), "bob".to_string()]);
        game.start_round();

        // Give alice a known hand: 7♥ and a bunch of filler
        game.players[0].hand = vec![
            std(Suit::Hearts, Value::Seven), // idx 0 — will try to shed
            std(Suit::Clubs, Value::Two),    // idx 1
            std(Suit::Spades, Value::Three), // idx 2
        ];

        // Set alice as already bajado with a trio of Fives
        game.players[0].has_dropped_hand = true;
        game.players[0].dropped_combinations = vec![vec![
            std(Suit::Hearts, Value::Five),
            std(Suit::Clubs, Value::Five),
            std(Suit::Spades, Value::Five),
        ]];
        game.players[0].turns_played = 1; // She's already had turns since dropping

        // Give bob a bajado escala 3-4-5-6 ♦ so alice can shed onto it
        game.players[1].has_dropped_hand = true;
        game.players[1].dropped_combinations = vec![vec![
            std(Suit::Diamonds, Value::Three),
            std(Suit::Diamonds, Value::Four),
            std(Suit::Diamonds, Value::Five),
            std(Suit::Diamonds, Value::Six),
        ]];

        // It's alice's turn, and she has drawn a card so she can shed
        game.current_turn = 0;
        game.players[0].has_drawn_this_turn = true;
        game
    }

    #[test]
    fn shed_card_extends_own_trio() {
        use crate::engine::card::{Suit, Value};
        let mut game = game_with_alice_bajado();

        // Add 5♦ to alice's hand
        game.players[0].hand.push(std(Suit::Diamonds, Value::Five));
        let five_idx = game.players[0].hand.len() - 1;

        // Shed onto her own trio of Fives
        let result = game.shed_card("alice", five_idx, "alice", 0);
        assert!(result.is_ok(), "Should shed a matching Five onto town trio");

        // Trio should now have 4 cards
        assert_eq!(game.players[0].dropped_combinations[0].len(), 4);
        // Hand should shrink
        assert_eq!(game.players[0].hand.len(), 3); // was 4, now 3
    }

    #[test]
    fn shed_card_extends_opponent_escala_right() {
        use crate::engine::card::{Suit, Value};
        let mut game = game_with_alice_bajado();

        // 7♦ extends bob's 3-4-5-6♦ escala on the right
        // Give alice 2 cards so she doesn't empty hand and trigger end_round()
        game.players[0].hand = vec![
            std(Suit::Diamonds, Value::Seven),
            std(Suit::Clubs, Value::King),
        ];
        let result = game.shed_card("alice", 0, "bob", 0);
        assert!(result.is_ok(), "Should shed 7♦ onto bob's escala");
        assert_eq!(game.players[1].dropped_combinations[0].len(), 5);
        // Last card should be 7♦
        assert_eq!(
            game.players[1].dropped_combinations[0].last().unwrap(),
            &std(Suit::Diamonds, Value::Seven)
        );
    }

    #[test]
    fn shed_card_extends_opponent_escala_left() {
        use crate::engine::card::{Suit, Value};
        let mut game = game_with_alice_bajado();

        // 2♦ extends bob's 3-4-5-6♦ escala on the left
        // Give alice 2 cards so she doesn't empty hand and trigger end_round()
        game.players[0].hand = vec![
            std(Suit::Diamonds, Value::Two),
            std(Suit::Clubs, Value::King),
        ];
        let result = game.shed_card("alice", 0, "bob", 0);
        assert!(
            result.is_ok(),
            "Should shed 2♦ onto bob's escala on the left"
        );
        assert_eq!(game.players[1].dropped_combinations[0].len(), 5);
        // First card should be 2♦
        assert_eq!(
            game.players[1].dropped_combinations[0].first().unwrap(),
            &std(Suit::Diamonds, Value::Two)
        );
    }

    #[test]
    fn shed_ace_left_on_escala_starting_with_two() {
        use crate::engine::card::{Suit, Value};
        let mut game = game_with_alice_bajado();

        // bob's combo is 3-4-5-6. Let's make it 2-3-4-5 instead.
        game.players[1].dropped_combinations = vec![vec![
            std(Suit::Diamonds, Value::Two),
            std(Suit::Diamonds, Value::Three),
            std(Suit::Diamonds, Value::Four),
            std(Suit::Diamonds, Value::Five),
        ]];

        game.players[0].hand = vec![
            std(Suit::Diamonds, Value::Ace), // We want to shed this
            std(Suit::Clubs, Value::King),
        ];

        let result = game.shed_card("alice", 0, "bob", 0);
        assert!(
            result.is_ok(),
            "Should shed A♦ onto bob's 2-3-4-5♦ escala on the left"
        );
        assert_eq!(game.players[1].dropped_combinations[0].len(), 5);
        // First card should be A♦
        assert_eq!(
            game.players[1].dropped_combinations[0].first().unwrap(),
            &std(Suit::Diamonds, Value::Ace)
        );
    }

    #[test]
    fn shed_card_rejected_before_bajada() {
        use crate::engine::card::{Suit, Value};
        let mut game = GameState::new(vec!["alice".to_string(), "bob".to_string()]);
        game.start_round();
        game.players[0].hand = vec![std(Suit::Diamonds, Value::Seven)];
        game.players[0].has_dropped_hand = false; // NOT dropped yet
        game.current_turn = 0;

        // Bob must have bajado to be target
        game.players[1].has_dropped_hand = true;
        game.players[1].dropped_combinations = vec![vec![
            std(Suit::Diamonds, Value::Five),
            std(Suit::Diamonds, Value::Six),
            std(Suit::Diamonds, Value::Eight),
            std(Suit::Diamonds, Value::Nine),
        ]];

        let result = game.shed_card("alice", 0, "bob", 0);
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            "You must drop your hand before shedding cards"
        );
    }

    #[test]
    fn shed_card_rejected_for_invalid_card() {
        use crate::engine::card::{Suit, Value};
        let mut game = game_with_alice_bajado();

        // 7♥ cannot shed onto bob's 3-4-5-6♦ escala (wrong suit)
        game.players[0].hand = vec![std(Suit::Hearts, Value::Seven)];
        let result = game.shed_card("alice", 0, "bob", 0);
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            "This card cannot be shed onto that combo"
        );
    }
}
