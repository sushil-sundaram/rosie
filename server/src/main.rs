mod auth;
mod guard;
mod models;
mod recipes;
mod routes;
mod sync;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;
use tower_http::{
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
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

    let data_dir = db_url
        .strip_prefix("sqlite://")
        .and_then(|p| std::path::Path::new(p).parent())
        .map(std::path::Path::to_path_buf)
        .unwrap_or_else(|| std::path::PathBuf::from("../data"));

    let image_dir = std::env::var("IMAGE_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| data_dir.join("images"));
    recipes::init_image_dir(image_dir);
    let auth_state = auth::AuthState::from_env(Some(&data_dir));

    let connection_options = SqliteConnectOptions::from_str(&db_url)?
        .create_if_missing(true)
        // Relied on for meal_plan.recipe_id and recipe_ingredients; stated, not assumed.
        .foreign_keys(true)
        .busy_timeout(std::time::Duration::from_secs(10))
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(connection_options)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;

    let migrate_pool = pool.clone();
    tokio::spawn(async move {
        recipes::migrate_external_images(&migrate_pool).await;
    });

    // Web UI: static files from WEB_DIR (defaults to ../web for local runs).
    let web_dir = std::env::var("WEB_DIR").unwrap_or_else(|_| "../web".to_string());
    let index = std::path::Path::new(&web_dir).join("index.html");
    let static_files = ServeDir::new(&web_dir).not_found_service(ServeFile::new(index));

    let changes = sync::channel();
    let api = routes::app_router(pool)
        .merge(sync::router(changes.clone()))
        .layer(axum::middleware::from_fn_with_state(changes, sync::announce))
        .merge(auth::router(auth_state.clone()))
        .layer(axum::middleware::from_fn_with_state(auth_state, auth::require_auth));
    let app = axum::Router::new()
        .nest("/api", api)
        .fallback_service(static_files)
        // Ordinary requests are small; the photo routes raise this for themselves.
        .layer(axum::extract::DefaultBodyLimit::max(1024 * 1024))
        // No CORS layer: the web app is served from this same origin, so the
        // browser's same-origin rule keeps other websites out of the API.
        .layer(axum::middleware::from_fn(guard::guard))
        .layer(TraceLayer::new_for_http());

    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".to_string());
    let bind = std::env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0".to_string());
    let listener = tokio::net::TcpListener::bind(format!("{bind}:{port}")).await?;
    tracing::info!("listening on {}", listener.local_addr()?);
    axum::serve(listener, app.into_make_service_with_connect_info::<std::net::SocketAddr>()).await?;

    Ok(())
}
