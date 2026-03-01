use serde::{Deserialize, Serialize};

use crate::engine::card::Card;
use crate::engine::game::PlayerState;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ClientMessage {
    DrawFromDeck,
    DrawFromDiscard,
    Discard { payload: DiscardPayload },
    DropHand { payload: DropHandPayload },
    ShedCard { payload: ShedCardPayload },
    ReorderHand { payload: ReorderHandPayload },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscardPayload {
    pub card_index: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DropHandPayload {
    pub combinations: Vec<Vec<Card>>,
}

/// Shed a single card from hand onto an existing table combo.
/// The position (left/right/trio-ext) is derived server-side by `can_shed()`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShedCardPayload {
    /// Index into the current player's hand
    pub hand_card_index: usize,
    /// ID of the player whose bajada we are extending
    pub target_player_id: String,
    /// Index into that player's `dropped_combinations`
    pub target_combo_idx: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReorderHandPayload {
    pub hand: Vec<Card>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerScore {
    pub id: String,
    pub round_points: u32,
    pub total_points: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum ServerMessage {
    Error {
        message: String,
    },
    MatchFound {
        room_id: String,
        players: Vec<String>,
    },
    GameStateUpdate {
        // The array of cards belonging to the player receiving this message
        my_hand: Vec<Card>,
        // We send a sanitized state (hiding other players' hands)
        players: Vec<SanitizedPlayerState>,
        current_round_index: usize,
        current_round_rules: String,
        current_turn_index: usize,
        discard_pile_top: Option<Card>,
        is_game_over: bool,
        // Structured round requirements for frontend combo validation
        required_trios: usize,
        required_escalas: usize,
    },
    RoundEnded {
        round_index: usize,
        round_name: String,
        winner_id: String,
        player_scores: Vec<PlayerScore>,
        next_round_index: usize,
        next_round_name: String,
        is_game_over: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SanitizedPlayerState {
    pub id: String,
    pub hand_count: usize, // Hide actual cards
    pub has_dropped_hand: bool,
    pub points: u32,
    pub dropped_combinations: Vec<Vec<Card>>,
    pub turns_played: u32,
    pub has_drawn_this_turn: bool,
    pub dropped_hand_this_turn: bool,
}

impl SanitizedPlayerState {
    pub fn from_player_state(state: &PlayerState) -> Self {
        Self {
            id: state.id.clone(),
            hand_count: state.hand.len(),
            has_dropped_hand: state.has_dropped_hand,
            points: state.points,
            dropped_combinations: state.dropped_combinations.clone(),
            turns_played: state.turns_played,
            has_drawn_this_turn: state.has_drawn_this_turn,
            dropped_hand_this_turn: state.dropped_hand_this_turn,
        }
    }
}
