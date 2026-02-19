pub mod api;
pub mod db;
pub mod engine;
pub mod matchmaking;

#[tokio::main]
async fn main() {
    println!("Starting Carioca Backend MVP...");
    
    // Use an in-memory SQLite DB for the initial phase/testing
    api::server::start_server("sqlite::memory:").await;
}
