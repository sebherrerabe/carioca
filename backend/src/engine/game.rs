use crate::engine::card::Card;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RoundType {
    TwoTrios,             // 2 tríos (6 cartas)
    OneTrioOneEscala,     // 1 trío y 1 escala (7 cartas)
    TwoEscalas,           // 2 escalas (8 cartas)
    ThreeTrios,           // 3 tríos (9 cartas)
    TwoTriosOneEscala,    // 2 tríos y 1 escala (10 cartas)
    OneTrioTwoEscalas,    // 1 trío y 2 escalas(11 cartas)
    ThreeEscalas,         // 3 escalas (12 cartas)
    FourTrios,            // 4 tríos (12 cartas)
    EscalaReal,           // Escala completa (12/13 cartas depending on variation)
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerState {
    pub id: String,
    pub hand: Vec<Card>,
    pub points: u32,
    pub has_dropped_hand: bool, // "bajado"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameState {
    pub players: Vec<PlayerState>,
    pub current_round: RoundType,
    pub round_index: usize,
    pub current_turn: usize, // Index in the players array
    pub discard_pile: Vec<Card>,
    // Game is over when round_index >= 9
    pub is_game_over: bool,
}

impl GameState {
    pub fn new(player_ids: Vec<String>) -> Self {
        let players = player_ids.into_iter().map(|id| PlayerState {
            id,
            hand: Vec::new(),
            points: 0,
            has_dropped_hand: false,
        }).collect();

        Self {
            players,
            current_round: RoundType::TwoTrios,
            round_index: 0,
            current_turn: 0,
            discard_pile: Vec::new(),
            is_game_over: false,
        }
    }
}
