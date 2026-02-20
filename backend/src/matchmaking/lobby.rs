use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::VecDeque;

#[derive(Clone)]
pub struct Lobby {
    // Queue of user IDs waiting for a match
    waiting_players: Arc<Mutex<VecDeque<String>>>,
}

impl Lobby {
    pub fn new() -> Self {
        Self {
            waiting_players: Arc::new(Mutex::new(VecDeque::new())),
        }
    }

    pub async fn join(&self, user_id: String) -> Option<Vec<String>> {
        let queue = self.waiting_players.lock().await;
        
        // Prevent duplicate joins
        if queue.contains(&user_id) {
            return None;
        }

        // MVP: Immediately match the player with 3 bots (Easy, Medium, Hard)
        // so we don't have to wait for 4 real players to test the game.
        let matched = vec![
            user_id.clone(),
            format!("bot_easy_{}", user_id),
            format!("bot_medium_{}", user_id),
            format!("bot_hard_{}", user_id),
        ];

        Some(matched)
    }

    pub async fn leave(&self, user_id: &str) {
        let mut queue = self.waiting_players.lock().await;
        queue.retain(|id| id != user_id);
    }
}
