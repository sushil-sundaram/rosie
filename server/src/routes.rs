use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use sqlx::SqlitePool;
use crate::models::{PantryItem, Recipe};
use serde_json::json;

pub fn app_router(pool: SqlitePool) -> Router {
    Router::new()
        .route("/health", get(health_check))
        .route("/pantry", get(get_pantry).post(add_pantry_item))
        .route("/recipes", get(get_recipes))
        .with_state(pool)
}

async fn health_check() -> impl IntoResponse {
    (StatusCode::OK, Json(json!({"status": "ok"})))
}

async fn get_pantry(State(pool): State<SqlitePool>) -> impl IntoResponse {
    match sqlx::query_as::<_, PantryItem>("SELECT * FROM pantry_items")
        .fetch_all(&pool)
        .await
    {
        Ok(items) => (StatusCode::OK, Json(json!(items))),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to fetch pantry items"})),
        ),
    }
}

async fn add_pantry_item(
    State(pool): State<SqlitePool>,
    Json(payload): Json<PantryItem>,
) -> impl IntoResponse {
    let result = sqlx::query(
        "INSERT INTO pantry_items (name, quantity, unit) VALUES (?, ?, ?)"
    )
    .bind(&payload.name)
    .bind(payload.quantity)
    .bind(&payload.unit)
    .execute(&pool)
    .await;

    match result {
        Ok(_) => (StatusCode::CREATED, Json(json!({"status": "created"}))),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to insert pantry item"})),
        ),
    }
}

async fn get_recipes(State(pool): State<SqlitePool>) -> impl IntoResponse {
    match sqlx::query_as::<_, Recipe>("SELECT * FROM recipes")
        .fetch_all(&pool)
        .await
    {
        Ok(recipes) => (StatusCode::OK, Json(json!(recipes))),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to fetch recipes"})),
        ),
    }
}
