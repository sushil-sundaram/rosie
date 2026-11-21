mod models;
mod recipes;
mod routes;
mod sync;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;
use tower_http::{
    cors::CorsLayer,
    services::{ServeDir, ServeFile},
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt::init();

    // DATABASE_URL lets Docker point at the mounted volume; local runs keep ../data/rosie.db.
    let db_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://../data/rosie.db".to_string());
    if let Some(path) = db_url.strip_prefix("sqlite://") {
        if let Some(parent) = std::path::Path::new(path).parent() {
            std::fs::create_dir_all(parent)?;
        }
    }

    let connection_options = SqliteConnectOptions::from_str(&db_url)?
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(connection_options)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;

    // Web UI: static files from WEB_DIR (defaults to ../web for local runs).
    let web_dir = std::env::var("WEB_DIR").unwrap_or_else(|_| "../web".to_string());
    let index = std::path::Path::new(&web_dir).join("index.html");
    let static_files = ServeDir::new(&web_dir).not_found_service(ServeFile::new(index));

    let changes = sync::channel();
    let api = routes::app_router(pool)
        .merge(sync::router(changes.clone()))
        .layer(axum::middleware::from_fn_with_state(changes, sync::announce));
    let app = axum::Router::new()
        .nest("/api", api)
        .fallback_service(static_files)
        // Photos/receipts arrive as base64 JSON; the web app downsizes them, this is headroom.
        .layer(axum::extract::DefaultBodyLimit::max(20 * 1024 * 1024))
        .layer(CorsLayer::permissive());

    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".to_string());
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}")).await?;
    tracing::info!("listening on {}", listener.local_addr()?);
    axum::serve(listener, app).await?;

    Ok(())
}
