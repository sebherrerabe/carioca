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
    #[allow(dead_code)]
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

    // Create an mpsc channel to receive ServerMessages from the Room Actor (and other places)
    // to forward down the WebSocket to the client.
    let (client_tx, mut client_rx) = tokio::sync::mpsc::channel::<crate::api::events::ServerMessage>(100);

    // Spawn a task to handle outbound messages to the client
    let mut send_task = tokio::spawn(async move {
        while let Some(msg) = client_rx.recv().await {
            if let Ok(text) = serde_json::to_string(&msg)
                && sender.send(Message::Text(text.into())).await.is_err() {
                    break;
                }
        }
    });

    println!("User {} connecting to Lobby...", user_id);
    let matched_players = state.lobby.join(user_id.clone()).await;

    let mut current_room_id: Option<String> = None;

    if let Some(players) = matched_players {
        println!("Match found! Players: {:?}", players);
        
        let room_id = uuid::Uuid::new_v4().to_string();
        
        let (tx, rx) = tokio::sync::mpsc::channel(100);
        let room = crate::matchmaking::room::Room::new(room_id.clone(), players.clone(), rx, tx.clone());
        
        tokio::spawn(async move {
            room.run().await;
        });

        state.active_rooms.lock().await.insert(room_id.clone(), tx.clone());
        
        // Notify the client that a match was found securely
        let _ = client_tx.send(crate::api::events::ServerMessage::MatchFound {
            room_id: room_id.clone(),
            players: players.clone(),
        }).await;
        
        // Now crucially, register this player's channel with the new room so it receives GameStateUpdates!
        let _ = tx.send(crate::matchmaking::room::RoomEvent::PlayerJoined(user_id.clone(), client_tx.clone())).await;

        current_room_id = Some(room_id);
    }

    // Spawn a task to handle inbound messages from the client
    let inbound_user_id = user_id.clone();
    let inbound_state = state.clone();
    let inbound_room_id = current_room_id.clone();
    
    let mut recv_task = tokio::spawn(async move {
        while let Some(msg) = receiver.next().await {
            if let Ok(Message::Text(text)) = msg {
                if let Ok(action) = serde_json::from_str::<crate::api::events::ClientMessage>(&text)
                    && let Some(room_id) = &inbound_room_id
                        && let Some(room_tx) = inbound_state.active_rooms.lock().await.get(room_id) {
                            let _ = room_tx.send(crate::matchmaking::room::RoomEvent::PlayerAction(inbound_user_id.clone(), action)).await;
                        }
            } else {
                break; // Connection lost or non-text message
            }
        }
    });

    // Run until either task ends
    tokio::select! {
        _ = (&mut send_task) => recv_task.abort(),
        _ = (&mut recv_task) => send_task.abort(),
    };

    println!("User {} disconnected.", user_id);
    state.lobby.leave(&user_id).await;
    
    if let Some(room_id) = current_room_id
        && let Some(room_tx) = state.active_rooms.lock().await.get(&room_id) {
            let _ = room_tx.send(crate::matchmaking::room::RoomEvent::PlayerLeft(user_id.clone())).await;
        }
}
