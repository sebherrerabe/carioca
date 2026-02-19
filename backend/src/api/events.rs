use serde::{Deserialize, Serialize};

use crate::engine::card::Card;
use crate::engine::game::PlayerState;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum ClientMessage {
    DrawFromDeck,
    DrawFromDiscard,
    Discard { card_index: usize },
    DropHand { combinations: Vec<Vec<Card>> }, // "bajarse"
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
        // We send a sanitized state (hiding other players' hands)
        players: Vec<SanitizedPlayerState>,
        current_round_index: usize,
        current_turn_index: usize,
        discard_pile_top: Option<Card>,
        is_game_over: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SanitizedPlayerState {
    pub id: String,
    pub hand_count: usize, // Hide actual cards
    pub has_dropped_hand: bool,
    pub points: u32,
}

impl SanitizedPlayerState {
    pub fn from_player_state(state: &PlayerState) -> Self {
        Self {
            id: state.id.clone(),
            hand_count: state.hand.len(),
            has_dropped_hand: state.has_dropped_hand,
            points: state.points,
        }
    }
}
