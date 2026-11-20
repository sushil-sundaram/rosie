use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, patch, post},
    Json, Router,
};
use sqlx::SqlitePool;
use crate::models::{Budget, BudgetUpdate, PantryItem, Recipe, Chore, ChoreUpdate, Expense, Meal, MealUpdate, ScanReceiptRequest};
use serde_json::json;
use std::collections::HashMap;

pub fn app_router(pool: SqlitePool) -> Router {
    Router::new()
        .route("/health", get(health_check))
        .route("/pantry", get(get_pantry).post(add_pantry_item))
        .route("/pantry/{id}", delete(delete_pantry_item).put(update_pantry_item))
        .route("/pantry/batch", post(add_pantry_batch))
        .route("/pantry/{id}/adjust", post(adjust_pantry_item))
        .route("/pantry/scan-photo", post(scan_pantry_photo))
        .route("/recipes", get(get_recipes).post(add_recipe))
        .route("/recipes/{id}", delete(delete_recipe))
        .route("/meals", get(get_meals).post(add_meal))
        .route("/meals/{id}", patch(update_meal).delete(delete_meal))
        .route("/chores", get(get_chores).post(add_chore))
        .route("/chores/{id}", patch(update_chore).delete(delete_chore))
        .route("/expenses", get(get_expenses).post(add_expense))
        .route("/expenses/{id}", delete(delete_expense))
        .route("/expenses/scan-receipt", post(scan_receipt))
        .route("/settings", get(get_settings).put(put_settings))
        .route("/budgets", get(get_budgets))
        .route("/budgets/{category}", axum::routing::put(put_budget))
        .with_state(pool)
}

/// Delete a row by id from a fixed, compile-time table name.
async fn delete_by_id(pool: &SqlitePool, table: &'static str, id: i64) -> (StatusCode, Json<serde_json::Value>) {
    match sqlx::query(sqlx::AssertSqlSafe(format!("DELETE FROM {table} WHERE id = ?")))
        .bind(id)
        .execute(pool)
        .await
    {
        Ok(r) if r.rows_affected() == 0 => (StatusCode::NOT_FOUND, Json(json!({"error": "Already removed or changed by someone else"}))),
        Ok(_) => (StatusCode::OK, Json(json!({"status": "deleted"}))),
        Err(e) => {
            tracing::error!("delete from {table} failed: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Delete failed"})))
        }
    }
}

async fn delete_pantry_item(State(pool): State<SqlitePool>, Path(id): Path<i64>) -> impl IntoResponse {
    delete_by_id(&pool, "pantry_items", id).await
}

async fn update_pantry_item(
    State(pool): State<SqlitePool>,
    Path(id): Path<i64>,
    Json(payload): Json<PantryItem>,
) -> impl IntoResponse {
    match sqlx::query("UPDATE pantry_items SET name = ?, quantity = ?, unit = ?, expires_on = ? WHERE id = ?")
        .bind(&payload.name)
        .bind(payload.quantity)
        .bind(&payload.unit)
        .bind(payload.expires_on.as_deref().filter(|d| valid_date(d)))
        .bind(id)
        .execute(&pool)
        .await
    {
        Ok(r) if r.rows_affected() == 0 => (StatusCode::NOT_FOUND, Json(json!({"error": "Already removed or changed by someone else"}))),
        Ok(_) => (StatusCode::OK, Json(json!({"status": "updated"}))),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to update pantry item"}))),
    }
}

#[derive(serde::Deserialize)]
pub struct Adjust {
    pub delta: f64,
}

/// Relative +/- so two people tapping at once both count (no lost updates).
async fn adjust_pantry_item(
    State(pool): State<SqlitePool>,
    Path(id): Path<i64>,
    Json(payload): Json<Adjust>,
) -> impl IntoResponse {
    match sqlx::query("UPDATE pantry_items SET quantity = max(0, quantity + ?) WHERE id = ?")
        .bind(payload.delta)
        .bind(id)
        .execute(&pool)
        .await
    {
        Ok(r) if r.rows_affected() == 0 => (StatusCode::NOT_FOUND, Json(json!({"error": "That item was removed"}))),
        Ok(_) => (StatusCode::OK, Json(json!({"status": "updated"}))),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to update pantry item"}))),
    }
}

async fn add_recipe(State(pool): State<SqlitePool>, Json(payload): Json<Recipe>) -> impl IntoResponse {
    match sqlx::query("INSERT INTO recipes (name, instructions) VALUES (?, ?)")
        .bind(&payload.name)
        .bind(&payload.instructions)
        .execute(&pool)
        .await
    {
        Ok(_) => (StatusCode::CREATED, Json(json!({"status": "created"}))),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to insert recipe"}))),
    }
}

async fn delete_recipe(State(pool): State<SqlitePool>, Path(id): Path<i64>) -> impl IntoResponse {
    let _ = sqlx::query("DELETE FROM recipe_ingredients WHERE recipe_id = ?").bind(id).execute(&pool).await;
    let _ = sqlx::query("UPDATE meal_plan SET recipe_id = NULL WHERE recipe_id = ?").bind(id).execute(&pool).await;
    delete_by_id(&pool, "recipes", id).await
}

async fn get_meals(State(pool): State<SqlitePool>) -> impl IntoResponse {
    match sqlx::query_as::<_, Meal>("SELECT * FROM meal_plan ORDER BY date, slot")
        .fetch_all(&pool)
        .await
    {
        Ok(meals) => (StatusCode::OK, Json(json!(meals))),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to fetch meals"}))),
    }
}

async fn add_meal(State(pool): State<SqlitePool>, Json(payload): Json<Meal>) -> impl IntoResponse {
    match sqlx::query("INSERT INTO meal_plan (date, slot, title, recipe_id) VALUES (?, ?, ?, ?)")
        .bind(&payload.date)
        .bind(&payload.slot)
        .bind(&payload.title)
        .bind(payload.recipe_id)
        .execute(&pool)
        .await
    {
        Ok(_) => (StatusCode::CREATED, Json(json!({"status": "created"}))),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to insert meal"}))),
    }
}

async fn delete_meal(State(pool): State<SqlitePool>, Path(id): Path<i64>) -> impl IntoResponse {
    delete_by_id(&pool, "meal_plan", id).await
}

fn valid_repeat(r: &str) -> bool {
    matches!(r, "weekly" | "monthly" | "yearly")
}

/// Next due date for a repeating chore, via SQLite date maths. Monthly/yearly
/// land on `anchor_day`, clamped to the month's last day (31 Jan -> 28 Feb -> 31 Mar).
async fn next_due_date(
    tx: &mut sqlx::SqliteConnection,
    from: &str,
    repeat: &str,
    anchor_day: i64,
) -> Result<String, sqlx::Error> {
    if repeat == "weekly" {
        return sqlx::query_scalar("SELECT date(?, '+7 days')").bind(from).fetch_one(tx).await;
    }
    let months = if repeat == "yearly" { 12 } else { 1 };
    sqlx::query_scalar(
        "WITH m AS (SELECT date(?1, 'start of month', '+' || ?2 || ' months') AS start) \
         SELECT date(start, '+' || (min(?3, CAST(strftime('%d', date(start, '+1 month', '-1 day')) AS INTEGER)) - 1) || ' days') FROM m",
    )
    .bind(from)
    .bind(months)
    .bind(anchor_day)
    .fetch_one(tx)
    .await
}

fn valid_date(d: &str) -> bool {
    let b = d.as_bytes();
    b.len() == 10 && b[4] == b'-' && b[7] == b'-'
        && b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

async fn update_chore(
    State(pool): State<SqlitePool>,
    Path(id): Path<i64>,
    Json(payload): Json<ChoreUpdate>,
) -> impl IntoResponse {
    if let Some(s) = &payload.status {
        if !matches!(s.as_str(), "todo" | "in_progress" | "done") {
            return (StatusCode::BAD_REQUEST, Json(json!({"error": "status must be todo, in_progress or done"})));
        }
    }
    if let Some(d) = &payload.due_date {
        if !d.is_empty() && !valid_date(d) {
            return (StatusCode::BAD_REQUEST, Json(json!({"error": "due_date must be YYYY-MM-DD"})));
        }
    }
    if let Some(r) = &payload.repeat {
        if !r.is_empty() && !valid_repeat(r) {
            return (StatusCode::BAD_REQUEST, Json(json!({"error": "repeat must be weekly, monthly or yearly"})));
        }
    }
    match apply_chore_update(&pool, id, &payload).await {
        Ok(true) => (StatusCode::OK, Json(json!({"status": "updated"}))),
        Ok(false) => (StatusCode::NOT_FOUND, Json(json!({"error": "Not found"}))),
        Err(e) => {
            tracing::error!("update chore {id} failed: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to update chore"})))
        }
    }
}

/// Updates status/due date. For bills, marking done logs an expense and
/// moving it out of done removes that expense, so a bill is counted once.
async fn apply_chore_update(pool: &SqlitePool, id: i64, payload: &ChoreUpdate) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let Some(chore) = sqlx::query_as::<_, Chore>("SELECT * FROM chores WHERE id = ?")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
    else {
        return Ok(false);
    };

    sqlx::query(
        "UPDATE chores SET status = COALESCE(?, status), \
         due_date = CASE WHEN ? IS NULL THEN due_date WHEN ? = '' THEN NULL ELSE ? END \
         WHERE id = ?",
    )
    .bind(&payload.status)
    .bind(&payload.due_date)
    .bind(&payload.due_date)
    .bind(&payload.due_date)
    .bind(id)
    .execute(&mut *tx)
    .await?;

    if let Some(r) = &payload.repeat {
        sqlx::query("UPDATE chores SET repeat = NULLIF(?, '') WHERE id = ?")
            .bind(r)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }

    // Repeating chores: completing one schedules the next; undoing removes it
    // again as long as nobody has touched it.
    match payload.status.as_deref() {
        Some("done") if chore.status != "done" && chore.next_id.is_none() => {
            if let Some(repeat) = chore.repeat.as_deref().filter(|r| valid_repeat(r)) {
                let today: String = sqlx::query_scalar("SELECT date('now', 'localtime')").fetch_one(&mut *tx).await?;
                let from = payload
                    .due_date
                    .clone()
                    .filter(|d| valid_date(d))
                    .or_else(|| chore.due_date.clone())
                    .unwrap_or(today);
                let anchor = chore.repeat_day.unwrap_or_else(|| from[8..].parse().unwrap_or(1));
                let next = next_due_date(&mut tx, &from, repeat, anchor).await?;
                let res = sqlx::query(
                    "INSERT INTO chores (title, description, assigned_to, priority, status, points, due_date, amount, category, repeat, repeat_day) \
                     VALUES (?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?)",
                )
                .bind(&chore.title)
                .bind(&chore.description)
                .bind(&chore.assigned_to)
                .bind(&chore.priority)
                .bind(chore.points)
                .bind(&next)
                .bind(chore.amount)
                .bind(&chore.category)
                .bind(repeat)
                .bind(anchor)
                .execute(&mut *tx)
                .await?;
                sqlx::query("UPDATE chores SET next_id = ? WHERE id = ?")
                    .bind(res.last_insert_rowid())
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
            }
        }
        Some(s) if s != "done" && chore.status == "done" => {
            if let Some(next) = chore.next_id {
                let removed = sqlx::query(
                    "DELETE FROM chores WHERE id = ? AND status = 'todo' AND expense_id IS NULL AND next_id IS NULL",
                )
                .bind(next)
                .execute(&mut *tx)
                .await?
                .rows_affected();
                // Keep the link if the next one was already worked on, so re-completing can't duplicate it.
                let gone: bool = removed > 0
                    || sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM chores WHERE id = ?").bind(next).fetch_one(&mut *tx).await? == 0;
                if gone {
                    sqlx::query("UPDATE chores SET next_id = NULL WHERE id = ?").bind(id).execute(&mut *tx).await?;
                }
            }
        }
        _ => {}
    }

    if let (Some(amount), Some(status)) = (chore.amount, payload.status.as_deref()) {
        if status == "done" && chore.expense_id.is_none() {
            let res = sqlx::query("INSERT INTO expenses (title, amount, category, date) VALUES (?, ?, ?, date('now', 'localtime'))")
                .bind(&chore.title)
                .bind(amount)
                .bind(chore.category.as_deref().unwrap_or("Utilities"))
                .execute(&mut *tx)
                .await?;
            sqlx::query("UPDATE chores SET expense_id = ? WHERE id = ?")
                .bind(res.last_insert_rowid())
                .bind(id)
                .execute(&mut *tx)
                .await?;
        } else if status != "done" {
            if let Some(eid) = chore.expense_id {
                sqlx::query("DELETE FROM expenses WHERE id = ?").bind(eid).execute(&mut *tx).await?;
                sqlx::query("UPDATE chores SET expense_id = NULL WHERE id = ?").bind(id).execute(&mut *tx).await?;
            }
        }
    }

    tx.commit().await?;
    Ok(true)
}

async fn get_settings(State(pool): State<SqlitePool>) -> impl IntoResponse {
    match sqlx::query_as::<_, (String, String)>("SELECT key, value FROM settings")
        .fetch_all(&pool)
        .await
    {
        Ok(rows) => (StatusCode::OK, Json(json!(rows.into_iter().collect::<HashMap<_, _>>()))),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to fetch settings"}))),
    }
}

const SETTING_KEYS: &[&str] = &["currency", "locale"];

async fn put_settings(
    State(pool): State<SqlitePool>,
    Json(payload): Json<HashMap<String, String>>,
) -> impl IntoResponse {
    if let Some(k) = payload.keys().find(|k| !SETTING_KEYS.contains(&k.as_str())) {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": format!("unknown setting '{k}'")})));
    }
    for (k, v) in &payload {
        if v.trim().is_empty() || v.len() > 32 {
            return (StatusCode::BAD_REQUEST, Json(json!({"error": format!("invalid value for '{k}'")})));
        }
        if let Err(e) = sqlx::query("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
            .bind(k)
            .bind(v.trim())
            .execute(&pool)
            .await
        {
            tracing::error!("save setting {k} failed: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to save settings"})));
        }
    }
    (StatusCode::OK, Json(json!({"status": "updated"})))
}

async fn get_budgets(State(pool): State<SqlitePool>) -> impl IntoResponse {
    match sqlx::query_as::<_, Budget>("SELECT * FROM budgets ORDER BY category")
        .fetch_all(&pool)
        .await
    {
        Ok(b) => (StatusCode::OK, Json(json!(b))),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to fetch budgets"}))),
    }
}

/// Sets a category's monthly budget; an amount of 0 or less removes it.
async fn put_budget(
    State(pool): State<SqlitePool>,
    Path(category): Path<String>,
    Json(payload): Json<BudgetUpdate>,
) -> impl IntoResponse {
    let res = if payload.amount > 0.0 {
        sqlx::query("INSERT INTO budgets (category, amount) VALUES (?, ?) ON CONFLICT(category) DO UPDATE SET amount = excluded.amount")
            .bind(&category)
            .bind(payload.amount)
            .execute(&pool)
            .await
    } else {
        sqlx::query("DELETE FROM budgets WHERE category = ?").bind(&category).execute(&pool).await
    };
    match res {
        Ok(_) => (StatusCode::OK, Json(json!({"status": "updated"}))),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to save budget"}))),
    }
}

async fn update_meal(
    State(pool): State<SqlitePool>,
    Path(id): Path<i64>,
    Json(payload): Json<MealUpdate>,
) -> impl IntoResponse {
    if !valid_date(&payload.date) {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "date must be YYYY-MM-DD"})));
    }
    match sqlx::query("UPDATE meal_plan SET date = ? WHERE id = ?")
        .bind(&payload.date)
        .bind(id)
        .execute(&pool)
        .await
    {
        Ok(r) if r.rows_affected() == 0 => (StatusCode::NOT_FOUND, Json(json!({"error": "Already removed or changed by someone else"}))),
        Ok(_) => (StatusCode::OK, Json(json!({"status": "updated"}))),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to update meal"}))),
    }
}

async fn delete_chore(State(pool): State<SqlitePool>, Path(id): Path<i64>) -> impl IntoResponse {
    delete_by_id(&pool, "chores", id).await
}

async fn delete_expense(State(pool): State<SqlitePool>, Path(id): Path<i64>) -> impl IntoResponse {
    let _ = sqlx::query("UPDATE pantry_items SET expense_id = NULL WHERE expense_id = ?").bind(id).execute(&pool).await;
    delete_by_id(&pool, "expenses", id).await
}

async fn health_check() -> impl IntoResponse {
    (StatusCode::OK, Json(json!({"status": "ok"})))
}

async fn get_pantry(State(pool): State<SqlitePool>) -> impl IntoResponse {
    match sqlx::query_as::<_, PantryItem>("SELECT * FROM pantry_items ORDER BY name COLLATE NOCASE")
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
        "INSERT INTO pantry_items (name, quantity, unit, expires_on) VALUES (?, ?, ?, ?)"
    )
    .bind(&payload.name)
    .bind(payload.quantity)
    .bind(&payload.unit)
    .bind(payload.expires_on.as_deref().filter(|d| valid_date(d)))
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
    match sqlx::query_as::<_, Recipe>("SELECT * FROM recipes ORDER BY name COLLATE NOCASE")
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

async fn get_chores(State(pool): State<SqlitePool>) -> impl IntoResponse {
    match sqlx::query_as::<_, Chore>("SELECT * FROM chores")
        .fetch_all(&pool)
        .await
    {
        Ok(chores) => (StatusCode::OK, Json(json!(chores))),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to fetch chores"})),
        ),
    }
}

async fn add_chore(
    State(pool): State<SqlitePool>,
    Json(payload): Json<Chore>,
) -> impl IntoResponse {
    let result = sqlx::query(
        "INSERT INTO chores (title, description, assigned_to, priority, status, points, due_date, amount, category, repeat, repeat_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&payload.title)
    .bind(&payload.description)
    .bind(&payload.assigned_to)
    .bind(&payload.priority)
    .bind(&payload.status)
    .bind(payload.points)
    .bind(payload.due_date.as_deref().filter(|d| valid_date(d)))
    .bind(payload.amount.filter(|a| *a > 0.0))
    .bind(payload.amount.filter(|a| *a > 0.0).map(|_| payload.category.clone().unwrap_or_else(|| "Utilities".into())))
    .bind(payload.repeat.as_deref().filter(|r| valid_repeat(r)))
    .bind(payload.due_date.as_deref().filter(|d| valid_date(d)).and_then(|d| d[8..].parse::<i64>().ok()))
    .execute(&pool)
    .await;

    match result {
        Ok(_) => (StatusCode::CREATED, Json(json!({"status": "created"}))),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to insert chore"})),
        ),
    }
}

async fn get_expenses(State(pool): State<SqlitePool>) -> impl IntoResponse {
    match sqlx::query_as::<_, Expense>("SELECT * FROM expenses ORDER BY date DESC, id DESC")
        .fetch_all(&pool)
        .await
    {
        Ok(expenses) => (StatusCode::OK, Json(json!(expenses))),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to fetch expenses"})),
        ),
    }
}

async fn add_expense(
    State(pool): State<SqlitePool>,
    Json(payload): Json<Expense>,
) -> impl IntoResponse {
    let result = sqlx::query(
        "INSERT INTO expenses (title, amount, category, date) VALUES (?, ?, ?, ?)"
    )
    .bind(&payload.title)
    .bind(payload.amount)
    .bind(&payload.category)
    .bind(&payload.date)
    .execute(&pool)
    .await;

    match result {
        Ok(r) => (StatusCode::CREATED, Json(json!({"status": "created", "id": r.last_insert_rowid()}))),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to insert expense"})),
        ),
    }
}

/// Sends one image + prompt to the local Ollama vision model and parses its JSON reply.
async fn ollama_vision_json(
    image_base64: &str,
    model: Option<String>,
    prompt: &str,
) -> Result<(serde_json::Value, String), (StatusCode, Json<serde_json::Value>)> {
    let base = std::env::var("OLLAMA_BASE_URL").unwrap_or_else(|_| "http://localhost:11434".to_string());
    let model = model
        .or_else(|| std::env::var("OLLAMA_VISION_MODEL").ok())
        .unwrap_or_else(|| "llama3.2-vision".to_string());
    let image = image_base64
        .find("base64,")
        .map(|i| &image_base64[i + 7..])
        .unwrap_or(image_base64);

    tracing::info!("Sending image to Ollama model '{}' at {}", model, base);
    let res = reqwest::Client::new()
        .post(format!("{base}/api/generate"))
        .json(&json!({ "model": model, "prompt": prompt, "images": [image], "stream": false, "format": "json" }))
        .send()
        .await
        .map_err(|e| {
            tracing::error!("Failed to connect to Ollama: {e}");
            (StatusCode::BAD_GATEWAY, Json(json!({
                "error": format!("Could not connect to Ollama at {base}: {e}"),
                "suggested_fix": format!("Ensure Ollama is running (`ollama serve`) and the model is pulled (`ollama pull {model}`)")
            })))
        })?;
    if !res.status().is_success() {
        let err = res.text().await.unwrap_or_default();
        tracing::error!("Ollama returned error: {err}");
        return Err((StatusCode::BAD_GATEWAY, Json(json!({
            "error": format!("Ollama error (model '{model}'): {err}"),
            "suggested_fix": format!("Run `ollama pull {model}` on the host machine")
        }))));
    }
    let body: serde_json::Value = res.json().await.map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": format!("Failed to parse Ollama response: {e}")})))
    })?;
    let text = body["response"].as_str().unwrap_or("").trim().to_string();
    let parsed = serde_json::from_str(&text).unwrap_or_else(|e| {
        tracing::warn!("AI reply was not valid JSON: {e}. Raw: {text}");
        json!({})
    });
    Ok((parsed, text))
}

/// Normalises an AI "items" array into [{name, quantity, unit}].
fn parse_items(v: &serde_json::Value) -> Vec<serde_json::Value> {
    v.as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|it| {
                    let name = it["name"].as_str()?.trim();
                    if name.is_empty() {
                        return None;
                    }
                    let quantity = it["quantity"].as_f64()
                        .or_else(|| it["quantity"].as_str().and_then(|q| q.trim().parse().ok()))
                        .filter(|q| *q > 0.0)
                        .unwrap_or(1.0);
                    let unit = it["unit"].as_str().map(str::trim).filter(|u| !u.is_empty()).unwrap_or("pcs");
                    Some(json!({ "name": name, "quantity": quantity, "unit": unit }))
                })
                .take(60)
                .collect()
        })
        .unwrap_or_default()
}

async fn scan_receipt(Json(payload): Json<ScanReceiptRequest>) -> impl IntoResponse {
    let prompt = "Analyze this receipt image. Extract:\n\
                  1. 'title': Store or merchant name\n\
                  2. 'amount': Total price / amount paid as a positive number (e.g. 15.75)\n\
                  3. 'category': One of ['Groceries', 'Utilities', 'Household', 'Dining', 'Entertainment', 'Transportation', 'Health', 'Other']\n\
                  4. 'date': Receipt date in YYYY-MM-DD format (or empty string if missing)\n\
                  5. 'items': the purchased products that could be kept at home (food, groceries, household supplies), \
                  each as {\"name\": short plain product name, \"quantity\": number, \"unit\": e.g. kg, g, L, ml, pcs, pack}. \
                  Use an empty list for restaurant bills, utilities or services.\n\
                  Respond ONLY with a valid JSON object matching:\n\
                  {\"title\": \"Merchant\", \"amount\": 15.75, \"category\": \"Groceries\", \"date\": \"2026-11-02\", \
                  \"items\": [{\"name\": \"Milk\", \"quantity\": 2, \"unit\": \"L\"}]}";

    match ollama_vision_json(&payload.image_base64, payload.model, prompt).await {
        Ok((v, raw)) => {
            let date = v["date"].as_str().filter(|d| valid_date(d)).unwrap_or("").to_string();
            (StatusCode::OK, Json(json!({
                "title": v["title"].as_str().unwrap_or("Scanned receipt"),
                "amount": v["amount"].as_f64().or_else(|| v["amount"].as_str().and_then(|a| a.replace(',', "").parse().ok())).unwrap_or(0.0),
                "category": v["category"].as_str().unwrap_or("Other"),
                "date": date,
                "items": parse_items(&v["items"]),
                "raw_ai_response": raw,
            })))
        }
        Err(e) => e,
    }
}

/// Photo of groceries / a shelf / the fridge -> list of pantry items to review.
async fn scan_pantry_photo(Json(payload): Json<ScanReceiptRequest>) -> impl IntoResponse {
    let prompt = "List the food, grocery and household products visible in this photo, as they would be \
                  tracked in a home pantry. Use short plain product names (e.g. 'Basmati rice', 'Milk', 'Eggs'). \
                  Estimate a count or amount for each, with a unit such as pcs, pack, kg, g, L or ml. \
                  Respond ONLY with a valid JSON object: {\"items\": [{\"name\": \"Eggs\", \"quantity\": 12, \"unit\": \"pcs\"}]}";
    match ollama_vision_json(&payload.image_base64, payload.model, prompt).await {
        Ok((v, raw)) => (StatusCode::OK, Json(json!({ "items": parse_items(&v["items"]), "raw_ai_response": raw }))),
        Err(e) => e,
    }
}

#[derive(serde::Deserialize)]
pub struct PantryBatch {
    pub items: Vec<PantryItem>,
    pub expense_id: Option<i64>,
}

/// Adds several items at once. An item whose name (and unit) already exists is
/// topped up instead of duplicated. `expense_id` links items to the purchase.
async fn add_pantry_batch(State(pool): State<SqlitePool>, Json(payload): Json<PantryBatch>) -> impl IntoResponse {
    let result: Result<(usize, usize), sqlx::Error> = async {
        let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
        let (mut added, mut topped) = (0, 0);
        for it in payload.items.iter().filter(|i| !i.name.trim().is_empty() && i.quantity >= 0.0) {
            let existing: Option<i64> = sqlx::query_scalar(
                "SELECT id FROM pantry_items WHERE lower(trim(name)) = lower(trim(?)) AND lower(unit) = lower(?) LIMIT 1",
            )
            .bind(&it.name)
            .bind(&it.unit)
            .fetch_optional(&mut *tx)
            .await?;
            if let Some(id) = existing {
                sqlx::query("UPDATE pantry_items SET quantity = quantity + ?, expense_id = COALESCE(?, expense_id) WHERE id = ?")
                    .bind(it.quantity)
                    .bind(payload.expense_id)
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
                topped += 1;
            } else {
                sqlx::query("INSERT INTO pantry_items (name, quantity, unit, expires_on, expense_id) VALUES (?, ?, ?, ?, ?)")
                    .bind(it.name.trim())
                    .bind(it.quantity)
                    .bind(it.unit.trim())
                    .bind(it.expires_on.as_deref().filter(|d| valid_date(d)))
                    .bind(payload.expense_id)
                    .execute(&mut *tx)
                    .await?;
                added += 1;
            }
        }
        tx.commit().await?;
        Ok((added, topped))
    }
    .await;
    match result {
        Ok((added, topped)) => (StatusCode::OK, Json(json!({"added": added, "topped_up": topped}))),
        Err(e) => {
            tracing::error!("pantry batch failed: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to add pantry items"})))
        }
    }
}
