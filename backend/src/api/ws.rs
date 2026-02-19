use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
};
use std::sync::Arc;

use crate::api::server::AppState;

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(mut socket: WebSocket, _state: Arc<AppState>) {
    // Stub: echo messages back
    while let Some(msg) = socket.recv().await {
        if let Ok(msg) = msg {
            // Echo text messages
            if let Message::Text(text) = msg {
                if socket.send(Message::Text(text.into())).await.is_err() {
                    break;
                }
            }
        } else {
            break;
        }
    }
}
