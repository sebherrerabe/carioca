use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2
};
use jsonwebtoken::{encode, Header, EncodingKey};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

use crate::api::server::AppState;
use crate::db::models::User;
use crate::db::repo;

#[derive(Deserialize)]
pub struct AuthPayload {
    pub username: String,
    pub password: Option<String>,
}

#[derive(Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub user_id: String,
}

#[derive(Serialize, Deserialize)]
struct Claims {
    sub: String,
    exp: usize,
}

// In a real app, load this from ENV
const JWT_SECRET: &[u8] = b"super_secret_carioca_key_mvp";

pub async fn register(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<AuthPayload>,
) -> impl IntoResponse {
    let password = match payload.password {
        Some(p) => p,
        None => return (StatusCode::BAD_REQUEST, "Missing password").into_response(),
    };

    if payload.username.is_empty() {
        return (StatusCode::BAD_REQUEST, "Missing username").into_response();
    }

    // Check if user exists
    if repo::get_user(&state.db, &payload.username).await.is_some() {
        return (StatusCode::CONFLICT, "Username already exists").into_response();
    }

    // Hash password
    let salt = SaltString::generate(&mut argon2::password_hash::rand_core::OsRng);
    let argon2 = Argon2::default();
    let password_hash = match argon2.hash_password(password.as_bytes(), &salt) {
        Ok(hash) => hash.to_string(),
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to hash password").into_response(),
    };

    let user = User {
        id: Uuid::new_v4().to_string(),
        username: payload.username.clone(),
        password_hash,
        created_at: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64,
    };

    if repo::insert_user(&state.db, &user).await.is_err() {
        return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create user").into_response();
    }

    let token = create_jwt(&user.id);

    (StatusCode::CREATED, Json(AuthResponse { token, user_id: user.id })).into_response()
}

pub async fn login(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<AuthPayload>,
) -> impl IntoResponse {
    let password = match payload.password {
        Some(p) => p,
        None => return (StatusCode::BAD_REQUEST, "Missing password").into_response(),
    };

    let user = match repo::get_user(&state.db, &payload.username).await {
        Some(u) => u,
        None => return (StatusCode::UNAUTHORIZED, "Invalid credentials").into_response(),
    };

    // Verify password
    let parsed_hash = match PasswordHash::new(&user.password_hash) {
        Ok(hash) => hash,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Invalid db hash").into_response(),
    };

    if Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_err()
    {
        return (StatusCode::UNAUTHORIZED, "Invalid credentials").into_response();
    }

    let token = create_jwt(&user.id);

    (StatusCode::OK, Json(AuthResponse { token, user_id: user.id })).into_response()
}

fn create_jwt(user_id: &str) -> String {
    let expiration = SystemTime::now()
        .checked_add(std::time::Duration::from_secs(60 * 60 * 24)) // 24 hours
        .expect("valid timestamp")
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as usize;

    let claims = Claims {
        sub: user_id.to_string(),
        exp: expiration,
    };

    encode(&Header::default(), &claims, &EncodingKey::from_secret(JWT_SECRET)).unwrap()
}
