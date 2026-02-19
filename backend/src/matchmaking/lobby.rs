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

    /// Adds a player to the queue. Returns a vector of matched players if a room can be formed.
    pub async fn join(&self, user_id: String) -> Option<Vec<String>> {
        let mut queue = self.waiting_players.lock().await;
        
        // Prevent duplicate joins
        if queue.contains(&user_id) {
            return None;
        }

        queue.push_back(user_id);

        // Carioca is usually 2-4 players. We will trigger matches at exactly 2 players for MVP.
        let players_needed = 2;

        if queue.len() >= players_needed {
            let mut matched = Vec::with_capacity(players_needed);
            for _ in 0..players_needed {
                if let Some(id) = queue.pop_front() {
                    matched.push(id);
                }
            }
            Some(matched)
        } else {
            None
        }
    }

    pub async fn leave(&self, user_id: &str) {
        let mut queue = self.waiting_players.lock().await;
        queue.retain(|id| id != user_id);
    }
}
