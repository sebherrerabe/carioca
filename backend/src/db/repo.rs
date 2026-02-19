use sqlx::SqlitePool;
use crate::db::models::User;

pub async fn create_user_table(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn get_user(pool: &SqlitePool, username: &str) -> Option<User> {
    sqlx::query_as::<_, User>("SELECT * FROM users WHERE username = ?")
        .bind(username)
        .fetch_optional(pool)
        .await
        .unwrap_or(None)
}

pub async fn insert_user(pool: &SqlitePool, user: &User) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO users (id, username, password_hash, created_at)
        VALUES (?, ?, ?, ?)
        "#,
    )
    .bind(&user.id)
    .bind(&user.username)
    .bind(&user.password_hash)
    .bind(user.created_at)
    .execute(pool)
    .await?;

    Ok(())
}
