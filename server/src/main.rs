mod models;
mod routes;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;
use tower_http::cors::CorsLayer;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt::init();

    // Configure SQLite in WAL mode
    let db_url = "sqlite://../data/munchbox.db";
    // Create the data directory if it doesn't exist
    std::fs::create_dir_all("../data").unwrap_or_default();

    // Create DB file if it doesn't exist
    if !std::path::Path::new("../data/munchbox.db").exists() {
        std::fs::File::create("../data/munchbox.db")?;
    }

    let connection_options = SqliteConnectOptions::from_str(db_url)?
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(connection_options)
        .await?;

    // Run migrations
    sqlx::migrate!("./migrations").run(&pool).await?;

    // CORS configuration for local/VPN development
    let cors = CorsLayer::permissive();

    let app = routes::app_router(pool).layer(cors);

    // Bind to all interfaces on port 3000 to listen to Tailscale
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await?;
    tracing::info!("listening on {}", listener.local_addr()?);
    axum::serve(listener, app).await?;

    Ok(())
}
