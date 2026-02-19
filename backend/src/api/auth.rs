use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::api::server::AppState;

#[derive(Deserialize)]
pub struct AuthPayload {
    pub username: String,
    // Add password later
}

#[derive(Serialize)]
pub struct AuthResponse {
    pub token: String,
}

pub async fn register(
    State(_state): State<Arc<AppState>>,
    Json(payload): Json<AuthPayload>,
) -> impl IntoResponse {
    // Stub implementation
    (StatusCode::OK, Json(AuthResponse { token: "dummy_token".to_string() }))
}

pub async fn login(
    State(_state): State<Arc<AppState>>,
    Json(payload): Json<AuthPayload>,
) -> impl IntoResponse {
    // Stub implementation
    (StatusCode::OK, Json(AuthResponse { token: "dummy_token".to_string() }))
}
