use crate::api::events::{ClientMessage, PlayerScore, SanitizedPlayerState, ServerMessage};
use crate::engine::game::GameState;
use tokio::sync::mpsc;

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
    pub sender: mpsc::Sender<RoomEvent>,
}

impl Room {
    pub fn new(
        id: String,
        players: Vec<String>,
        receiver: mpsc::Receiver<RoomEvent>,
        sender: mpsc::Sender<RoomEvent>,
    ) -> Self {
        let mut game_state = GameState::new(players.clone());
        game_state.start_round();

        Self {
            id,
            game_state,
            players,
            player_channels: HashMap::new(),
            receiver,
            sender,
        }
    }

    pub async fn run(mut self) {
        println!("Room {} started with players {:?}", self.id, self.players);

        let mut bot_action_pending = false;

        // Trigger bot turn if the first player happens to be a bot
        self.check_bot_turn(&mut bot_action_pending);

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
                    if user_id.starts_with("bot_") {
                        bot_action_pending = false;
                    }
                    let round_result = self.handle_action(user_id, action).await;
                    if let Some(result) = round_result {
                        self.broadcast_round_ended(&result).await;
                    }
                    self.broadcast_state().await;
                }
            }

            // Check if it's a bot's turn to play
            self.check_bot_turn(&mut bot_action_pending);
        }

        println!("Room {} loop ended", self.id);
    }

    fn check_bot_turn(&self, bot_action_pending: &mut bool) {
        if *bot_action_pending {
            return;
        }

        let current_player_index = self.game_state.current_turn;
        if let Some(user_id) = self.players.get(current_player_index)
            && user_id.starts_with("bot_")
        {
            *bot_action_pending = true;

            let diff = if user_id.contains("hard") {
                crate::engine::bot::BotDifficulty::Hard
            } else if user_id.contains("medium") {
                crate::engine::bot::BotDifficulty::Medium
            } else {
                crate::engine::bot::BotDifficulty::Easy
            };

            let sender = self.sender.clone();
            let uid = user_id.clone();
            let gs = self.game_state.clone();

            tokio::spawn(async move {
                // Slight human-like delay
                tokio::time::sleep(tokio::time::Duration::from_millis(1500)).await;
                if let Some(action) = crate::engine::bot::play_bot_turn(&gs, &uid, diff) {
                    let _ = sender.send(RoomEvent::PlayerAction(uid, action)).await;
                }
            });
        }
    }

    async fn handle_action(
        &mut self,
        user_id: String,
        action: ClientMessage,
    ) -> Option<crate::engine::game::RoundEndResult> {
        // Enforce turn:
        let current_player_index = self.game_state.current_turn;
        if self.players.get(current_player_index) != Some(&user_id) {
            self.send_error(&user_id, "Not your turn").await;
            return None;
        }

        match action {
            ClientMessage::DrawFromDeck => {
                if let Err(e) = self.game_state.draw_from_deck() {
                    self.send_error(&user_id, e).await;
                }
                None
            }
            ClientMessage::DrawFromDiscard => {
                if let Err(e) = self.game_state.draw_from_discard() {
                    self.send_error(&user_id, e).await;
                }
                None
            }
            ClientMessage::Discard { payload } => {
                match self.game_state.discard(payload.card_index) {
                    Ok(round_result) => round_result,
                    Err(e) => {
                        self.send_error(&user_id, e).await;
                        None
                    }
                }
            }
            ClientMessage::DropHand { payload } => {
                if let Err(e) = self.game_state.drop_hand(&user_id, payload.combinations) {
                    self.send_error(&user_id, e).await;
                }
                None
            }
            ClientMessage::ShedCard { payload } => {
                match self.game_state.shed_card(
                    &user_id,
                    payload.hand_card_index,
                    &payload.target_player_id,
                    payload.target_combo_idx,
                ) {
                    Ok(round_result) => round_result,
                    Err(e) => {
                        self.send_error(&user_id, e).await;
                        None
                    }
                }
            }
            ClientMessage::ReorderHand { payload } => {
                if let Err(e) = self.game_state.reorder_hand(&user_id, payload.hand) {
                    println!(
                        "[Room {}] Rejected reorder from {}: {}",
                        self.id, user_id, e
                    );
                    self.send_error(&user_id, e).await;
                    // Forcefully resync the offending client with the source of truth
                    self.send_state_to_user(&user_id).await;
                }
                None
            }
        }
    }

    async fn send_error(&self, user_id: &str, msg: &str) {
        if let Some(sender) = self.player_channels.get(user_id) {
            let _ = sender
                .send(ServerMessage::Error {
                    message: msg.to_string(),
                })
                .await;
        }
    }

    async fn send_state_to_user(&self, user_id: &str) {
        if let Some((_, msg)) = self.build_state_message_for_user(user_id)
            && let Some(sender) = self.player_channels.get(user_id)
        {
            let _ = sender.send(msg).await;
        }
    }

    fn build_state_message_for_user(
        &self,
        target_user_id: &str,
    ) -> Option<(String, ServerMessage)> {
        let sanitized_players: Vec<SanitizedPlayerState> = self
            .game_state
            .players
            .iter()
            .map(SanitizedPlayerState::from_player_state)
            .collect();

        let top_discard = self.game_state.discard_pile.last().cloned();

        let my_hand = self
            .game_state
            .players
            .iter()
            .find(|p| p.id == target_user_id)
            .map(|p| p.hand.clone())
            .unwrap_or_default();

        let msg = ServerMessage::GameStateUpdate {
            my_hand,
            players: sanitized_players,
            current_round_index: self.game_state.round_index,
            current_round_rules: self.game_state.current_round.description().to_string(),
            current_turn_index: self.game_state.current_turn,
            discard_pile_top: top_discard,
            is_game_over: self.game_state.is_game_over,
            required_trios: self.game_state.current_round.get_requirements().0,
            required_escalas: self.game_state.current_round.get_requirements().1,
        };

        Some((target_user_id.to_string(), msg))
    }

    async fn broadcast_round_ended(&self, result: &crate::engine::game::RoundEndResult) {
        let msg = ServerMessage::RoundEnded {
            round_index: result.finished_round_index,
            round_name: result.finished_round_name.clone(),
            winner_id: result.winner_id.clone(),
            player_scores: result
                .player_scores
                .iter()
                .map(|(id, rp, tp)| PlayerScore {
                    id: id.clone(),
                    round_points: *rp,
                    total_points: *tp,
                })
                .collect(),
            next_round_index: result.next_round_index,
            next_round_name: result.next_round_name.clone(),
            is_game_over: result.is_game_over,
        };

        for sender in self.player_channels.values() {
            let _ = sender.send(msg.clone()).await;
        }
    }

    async fn broadcast_state(&self) {
        for user_id in self.player_channels.keys() {
            self.send_state_to_user(user_id).await;
        }
    }
}
