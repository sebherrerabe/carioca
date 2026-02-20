use axum::{
    routing::{get, post},
    Router,
};
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use std::sync::Arc;
use std::collections::HashMap;
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

use crate::api::auth;
use crate::api::ws;

use crate::matchmaking::lobby::Lobby;
use crate::matchmaking::room::RoomEvent;
use tokio::sync::mpsc;

#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub lobby: Lobby,
    // Active rooms mapped by Room ID, storing the Sender channel to communicate with the Room Actor
    pub active_rooms: Arc<Mutex<HashMap<String, mpsc::Sender<RoomEvent>>>>,
}

pub async fn start_server(db_url: &str) {
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(db_url)
        .await
        .expect("Failed to connect to SQLite");

    // Run migrations/table creation
    crate::db::repo::create_user_table(&pool).await.expect("Failed to create user table");

    let state = Arc::new(AppState {
        db: pool,
        lobby: Lobby::new(),
        active_rooms: Arc::new(Mutex::new(HashMap::new())),
    });

    let cors = CorsLayer::permissive();

    let app = Router::new()
        .route("/health", get(|| async { "OK" }))
        .route("/api/auth/register", post(auth::register))
        .route("/api/auth/login", post(auth::login))
        .route("/ws", get(ws::ws_handler))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state);

    let listener = TcpListener::bind("0.0.0.0:3000")
        .await
        .expect("Failed to bind to port 3000");

    println!("Server running on http://0.0.0.0:3000");

    axum::serve(listener, app)
        .await
        .expect("Server failed");
}
