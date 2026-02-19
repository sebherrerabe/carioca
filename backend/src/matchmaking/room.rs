use tokio::sync::mpsc;
use crate::engine::game::GameState;
use crate::api::events::{ClientMessage, ServerMessage, SanitizedPlayerState};

#[derive(Debug, Clone)]
pub enum RoomEvent {
    PlayerJoined(String, mpsc::Sender<ServerMessage>), // Pass sender to the room
    PlayerLeft(String),
    PlayerAction(String, ClientMessage),
}

use std::collections::HashMap;

pub struct Room {
    pub id: String,
    pub game_state: GameState,
    pub players: Vec<String>,
    pub player_channels: HashMap<String, mpsc::Sender<ServerMessage>>,
    // Channel to receive events from player WebSocket connections
    pub receiver: mpsc::Receiver<RoomEvent>,
}

impl Room {
    pub fn new(id: String, players: Vec<String>, receiver: mpsc::Receiver<RoomEvent>) -> Self {
        let mut game_state = GameState::new(players.clone());
        game_state.start_round();
        
        Self {
            id,
            game_state,
            players,
            player_channels: HashMap::new(),
            receiver,
        }
    }

    pub async fn run(mut self) {
        println!("Room {} started with players {:?}", self.id, self.players);

        while let Some(event) = self.receiver.recv().await {
            match event {
                RoomEvent::PlayerJoined(user_id, sender) => {
                    println!("Player {} joined room {}", user_id, self.id);
                    self.player_channels.insert(user_id, sender);
                    self.broadcast_state().await;
                }
                RoomEvent::PlayerLeft(user_id) => {
                    println!("Player {} left room {}", user_id, self.id);
                    self.player_channels.remove(&user_id);
                    // For MVP maybe just end game or pause
                }
                RoomEvent::PlayerAction(user_id, action) => {
                    // TODO Handle individual action
                    self.handle_action(user_id, action).await;
                    self.broadcast_state().await;
                }
            }
        }

        println!("Room {} loop ended", self.id);
    }

    async fn handle_action(&mut self, user_id: String, action: ClientMessage) {
        // Enforce turn:
        let current_player_index = self.game_state.current_turn;
        if self.players.get(current_player_index) != Some(&user_id) {
            self.send_error(&user_id, "Not your turn").await;
            return;
        }

        match action {
            ClientMessage::DrawFromDeck => {
                if let Err(e) = self.game_state.draw_from_deck() {
                    self.send_error(&user_id, e).await;
                }
            }
            ClientMessage::DrawFromDiscard => {
                if let Err(e) = self.game_state.draw_from_discard() {
                    self.send_error(&user_id, e).await;
                }
            }
            ClientMessage::Discard { card_index } => {
                if let Err(e) = self.game_state.discard(card_index) {
                    self.send_error(&user_id, e).await;
                }
            }
            ClientMessage::DropHand { .. } => {
                // TODO MVP bajadas parsing validation
                self.send_error(&user_id, "Drop hand not fully implemented").await;
            }
        }
    }

    async fn send_error(&self, user_id: &str, msg: &str) {
        if let Some(sender) = self.player_channels.get(user_id) {
            let _ = sender.send(ServerMessage::Error { message: msg.to_string() }).await;
        }
    }

    async fn broadcast_state(&self) {
        let sanitized_players: Vec<SanitizedPlayerState> = self.game_state.players.iter()
            .map(|p| SanitizedPlayerState::from_player_state(p))
            .collect();

        let top_discard = self.game_state.discard_pile.last().cloned();

        let msg = ServerMessage::GameStateUpdate {
            players: sanitized_players,
            current_round_index: self.game_state.round_index,
            current_turn_index: self.game_state.current_turn,
            discard_pile_top: top_discard,
            is_game_over: self.game_state.is_game_over,
        };

        for sender in self.player_channels.values() {
            let _ = sender.send(msg.clone()).await;
        }
    }
}
