use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State, Query
    },
    response::IntoResponse,
};
use serde::Deserialize;
use std::sync::Arc;
use futures_util::{sink::SinkExt, stream::StreamExt};
use jsonwebtoken::{decode, DecodingKey, Validation};

use crate::api::server::AppState;

#[derive(Deserialize)]
pub struct WsQuery {
    pub token: String,
}

#[derive(Deserialize)]
struct Claims {
    sub: String,
    exp: usize,
}

const JWT_SECRET: &[u8] = b"super_secret_carioca_key_mvp";

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(query): Query<WsQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    // Basic JWT Validation here for WS
    let validation = Validation::default();
    let token_data = match decode::<Claims>(&query.token, &DecodingKey::from_secret(JWT_SECRET), &validation) {
        Ok(c) => c,
        Err(_) => return axum::http::StatusCode::UNAUTHORIZED.into_response(),
    };

    let user_id = token_data.claims.sub.clone();

    ws.on_upgrade(move |socket| handle_socket(socket, state, user_id))
}

async fn handle_socket(socket: WebSocket, state: Arc<AppState>, user_id: String) {
    let (mut sender, mut receiver) = socket.split();

    // 1. Join Lobby
    println!("User {} connecting to Lobby...", user_id);
    let matched_players = state.lobby.join(user_id.clone()).await;

    // Default room_id if we don't start one
    let mut current_room_id: Option<String> = None;

    if let Some(players) = matched_players {
        println!("Match found! Players: {:?}", players);
        
        // Match found! Let's instantiate a Room
        let room_id = uuid::Uuid::new_v4().to_string();
        
        let (tx, rx) = tokio::sync::mpsc::channel(100);
        let room = crate::matchmaking::room::Room::new(room_id.clone(), players.clone(), rx);
        
        // Spawn the room actor
        tokio::spawn(async move {
            room.run().await;
        });

        // Register room in AppState
        state.active_rooms.lock().await.insert(room_id.clone(), tx.clone());
        
        // Note: For MVP we should probably broadcast to ALL players in the room, 
        // but right now we only have the WebSocket sender for the *current* user who triggered the match.
        // A complete implementation would store player WS senders in the Lobby or a central registry.
        // For now, let's just tell this user.
        let _ = sender.send(Message::Text(format!("Match found! Room: {}", room_id).into())).await;
        current_room_id = Some(room_id);
    } else {
        let _ = sender.send(Message::Text("Waiting for match...".into())).await;
    }

    // 2. Listen for messages
    while let Some(msg) = receiver.next().await {
        if let Ok(msg) = msg {
            if let Message::Text(text) = msg {
                // Try parse as ClientMessage
                if let Ok(action) = serde_json::from_str::<crate::api::events::ClientMessage>(&text) {
                    if let Some(room_id) = &current_room_id {
                        if let Some(room_tx) = state.active_rooms.lock().await.get(room_id) {
                            let _ = room_tx.send(crate::matchmaking::room::RoomEvent::PlayerAction(user_id.clone(), action)).await;
                        }
                    }
                }
            }
        } else {
            break;
        }
    }

    // 3. User disconnected
    println!("User {} disconnected.", user_id);
    state.lobby.leave(&user_id).await;
    
    // Also leave room if in one
    if let Some(room_id) = current_room_id {
        if let Some(room_tx) = state.active_rooms.lock().await.get(&room_id) {
            let _ = room_tx.send(crate::matchmaking::room::RoomEvent::PlayerLeft(user_id.clone())).await;
        }
    }
}
