use sqlx::SqlitePool;
use crate::db::models::User;

pub async fn get_user(_pool: &SqlitePool, _username: &str) -> Option<User> {
    None
}
