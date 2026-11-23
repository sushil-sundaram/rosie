use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, patch, post},
    Json, Router,
};
use sqlx::SqlitePool;
use crate::models::{Budget, BudgetUpdate, PantryItem, Chore, ChoreUpdate, Expense, Meal, MealUpdate, ScanReceiptRequest};
use crate::recipes;
use serde_json::json;
use std::collections::HashMap;

pub fn app_router(pool: SqlitePool) -> Router {
    Router::new()
        .route("/health", get(health_check))
        .route("/pantry", get(get_pantry).post(add_pantry_item))
        .route("/pantry/{id}", delete(delete_pantry_item).put(update_pantry_item))
        .route("/pantry/batch", post(add_pantry_batch))
        .route("/pantry/{id}/adjust", post(adjust_pantry_item))
        .route("/pantry/scan-photo", post(scan_pantry_photo).layer(photo_limit()))
        .route("/recipes", get(recipes::get_recipes).post(recipes::add_recipe))
        .route("/recipes/import", post(recipes::import_recipe).layer(photo_limit()))
        .route("/recipes/{id}", axum::routing::put(recipes::update_recipe).delete(recipes::delete_recipe))
        .route("/meals", get(get_meals).post(add_meal))
        .route("/meals/{id}", patch(update_meal).delete(delete_meal))
        .route("/chores", get(get_chores).post(add_chore))
        .route("/chores/{id}", patch(update_chore).delete(delete_chore))
        .route("/expenses", get(get_expenses).post(add_expense))
        .route("/expenses/{id}", delete(delete_expense))
        .route("/expenses/scan-receipt", post(scan_receipt).layer(photo_limit()))
        .route("/settings", get(get_settings).put(put_settings))
        .route("/budgets", get(get_budgets))
        .route("/budgets/{category}", axum::routing::put(put_budget))
        .with_state(pool)
}

/// Photos arrive as base64 JSON. The web app downsizes them first; this is headroom.
fn photo_limit() -> axum::extract::DefaultBodyLimit {
    axum::extract::DefaultBodyLimit::max(20 * 1024 * 1024)
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
    if !valid_text(&payload.name) || !valid_amount(payload.quantity) {
        return bad_request("an item needs a name and a quantity of 0 or more");
    }
    let expiry = payload.expires_on.as_deref().map(str::trim);
    if expiry.is_some_and(|d| !d.is_empty() && !valid_date(d)) {
        return bad_request("expires_on must be a real date (YYYY-MM-DD)");
    }
    // Missing expires_on keeps the current one; "" clears it.
    match sqlx::query(
        "UPDATE pantry_items SET name = ?, quantity = ?, unit = ?, \
         expires_on = CASE WHEN ?1 IS NULL THEN expires_on WHEN ?1 = '' THEN NULL ELSE ?1 END WHERE id = ?",
    )
        .bind(payload.name.trim())
        .bind(payload.quantity)
        .bind(payload.unit.trim())
        .bind(expiry)
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
    if !payload.delta.is_finite() || payload.delta.abs() > 1e9 {
        return bad_request("delta must be a number");
    }
    match sqlx::query("UPDATE pantry_items SET quantity = min(1e9, max(0, quantity + ?)) WHERE id = ?")
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
    if !valid_date(&payload.date) {
        return bad_request("date must be a real date (YYYY-MM-DD)");
    }
    if !matches!(payload.slot.as_str(), "breakfast" | "lunch" | "dinner") {
        return bad_request("slot must be breakfast, lunch or dinner");
    }
    if !valid_text(&payload.title) {
        return bad_request("a meal needs a title");
    }
    match sqlx::query("INSERT INTO meal_plan (date, slot, title, recipe_id) VALUES (?, ?, ?, ?)")
        .bind(&payload.date)
        .bind(&payload.slot)
        .bind(payload.title.trim())
        .bind(payload.recipe_id)
        .execute(&pool)
        .await
    {
        Ok(r) => (StatusCode::CREATED, Json(json!({"status": "created", "id": r.last_insert_rowid()}))),
        Err(sqlx::Error::Database(e)) if e.is_foreign_key_violation() => bad_request("that recipe no longer exists"),
        Err(e) => {
            tracing::error!("insert meal: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to insert meal"})))
        }
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

/// A real calendar date in YYYY-MM-DD form (rejects 2026-02-30 and 2026-13-01).
pub(crate) fn valid_date(d: &str) -> bool {
    let b = d.as_bytes();
    if !(b.len() == 10 && b[4] == b'-' && b[7] == b'-'
        && b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit()))
    {
        return false;
    }
    let (y, m, day): (u32, u32, u32) = (d[..4].parse().unwrap_or(0), d[5..7].parse().unwrap_or(0), d[8..].parse().unwrap_or(0));
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let days = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    y >= 1900 && (1..=days).contains(&day)
}

fn bad_request(msg: &str) -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": msg })))
}

/// An amount of money or stock: a finite number, not negative.
fn valid_amount(x: f64) -> bool {
    x.is_finite() && x >= 0.0 && x < 1e12
}

fn valid_text(s: &str) -> bool {
    !s.trim().is_empty() && s.len() <= 500
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
    // A new due date moves the series' anchor day with it (a monthly bill dragged
    // from the 30th to the 5th repeats on the 5th). A series without an anchor
    // takes its due date's day.
    let new_due = payload.due_date.as_deref().filter(|d| valid_date(d));
    sqlx::query(
        "UPDATE chores SET repeat_day = CAST(substr(due_date, 9, 2) AS INTEGER) \
         WHERE id = ? AND due_date IS NOT NULL AND (? OR repeat_day IS NULL)",
    )
    .bind(id)
    .bind(new_due.is_some())
    .execute(&mut *tx)
    .await?;
    // What the series looks like after this update.
    let repeat_now: Option<String> = match payload.repeat.as_deref() {
        Some(r) => Some(r.to_string()).filter(|r| valid_repeat(r)),
        None => chore.repeat.clone().filter(|r| valid_repeat(r)),
    };

    // Repeating chores: completing one schedules the next; undoing removes it
    // again as long as nobody has touched it.
    match payload.status.as_deref() {
        Some("done") if chore.status != "done" && chore.next_id.is_none() => {
            if let Some(repeat) = repeat_now.as_deref() {
                let today: String = sqlx::query_scalar("SELECT date('now', 'localtime')").fetch_one(&mut *tx).await?;
                let from = payload
                    .due_date
                    .clone()
                    .filter(|d| valid_date(d))
                    .or_else(|| chore.due_date.clone())
                    .unwrap_or(today);
                let anchor = match new_due {
                    Some(d) => d[8..].parse().unwrap_or(1),
                    None => chore.repeat_day.unwrap_or_else(|| from[8..].parse().unwrap_or(1)),
                };
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
                // "Untouched" includes its date: a next occurrence someone rescheduled is kept.
                let generated: Option<String> = match (chore.due_date.as_deref(), chore.repeat.as_deref().filter(|r| valid_repeat(r))) {
                    (Some(from), Some(repeat)) if valid_date(from) => {
                        let anchor = chore.repeat_day.unwrap_or_else(|| from[8..].parse().unwrap_or(1));
                        Some(next_due_date(&mut tx, from, repeat, anchor).await?)
                    }
                    _ => None,
                };
                let removed = sqlx::query(
                    "DELETE FROM chores WHERE id = ? AND status = 'todo' AND expense_id IS NULL AND next_id IS NULL \
                     AND (? IS NULL OR due_date = ?)",
                )
                .bind(next)
                .bind(&generated)
                .bind(&generated)
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
        let ok = match k.as_str() {
            "currency" => v.len() == 3 && v.bytes().all(|b| b.is_ascii_uppercase()),
            _ => (2..=20).contains(&v.len()) && v.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'),
        };
        if !ok {
            return (StatusCode::BAD_REQUEST, Json(json!({"error": format!("invalid value for '{k}'")})));
        }
    }
    // All or nothing: a bad locale must not leave a new currency half-applied.
    let saved: Result<(), sqlx::Error> = async {
        let mut tx = pool.begin().await?;
        for (k, v) in &payload {
            sqlx::query("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
                .bind(k)
                .bind(v.trim())
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await
    }
    .await;
    if let Err(e) = saved {
        tracing::error!("save settings failed: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to save settings"})));
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
    if !payload.amount.is_finite() || payload.amount >= 1e12 {
        return bad_request("amount must be a number");
    }
    if category.trim().is_empty() || category.len() > 50 {
        return bad_request("invalid category");
    }
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

/// Deletes a chore and clears the link from the occurrence before it, so that
/// one can be completed again later without pointing at nothing.
async fn delete_chore(State(pool): State<SqlitePool>, Path(id): Path<i64>) -> impl IntoResponse {
    let result: Result<u64, sqlx::Error> = async {
        let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
        sqlx::query("UPDATE chores SET next_id = NULL WHERE next_id = ?").bind(id).execute(&mut *tx).await?;
        let gone = sqlx::query("DELETE FROM chores WHERE id = ?").bind(id).execute(&mut *tx).await?.rows_affected();
        tx.commit().await?;
        Ok(gone)
    }
    .await;
    match result {
        Ok(0) => (StatusCode::NOT_FOUND, Json(json!({"error": "Already removed or changed by someone else"}))),
        Ok(_) => (StatusCode::OK, Json(json!({"status": "deleted"}))),
        Err(e) => {
            tracing::error!("delete chore {id}: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Delete failed"})))
        }
    }
}

/// Removes an expense and unlinks pantry items bought with it. An expense that
/// records a paid bill can't be deleted on its own: un-paying the bill removes it,
/// which keeps "a paid bill has exactly one expense" true.
async fn delete_expense(State(pool): State<SqlitePool>, Path(id): Path<i64>) -> impl IntoResponse {
    let result: Result<Option<String>, sqlx::Error> = async {
        let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
        let bill: Option<String> = sqlx::query_scalar("SELECT title FROM chores WHERE expense_id = ? LIMIT 1")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;
        if let Some(title) = bill {
            return Ok(Some(title));
        }
        sqlx::query("UPDATE pantry_items SET expense_id = NULL WHERE expense_id = ?").bind(id).execute(&mut *tx).await?;
        let gone = sqlx::query("DELETE FROM expenses WHERE id = ?").bind(id).execute(&mut *tx).await?.rows_affected();
        tx.commit().await?;
        Ok((gone == 0).then(String::new))
    }
    .await;
    match result {
        Ok(None) => (StatusCode::OK, Json(json!({"status": "deleted"}))),
        Ok(Some(t)) if t.is_empty() => (StatusCode::NOT_FOUND, Json(json!({"error": "Already removed or changed by someone else"}))),
        Ok(Some(t)) => (StatusCode::CONFLICT, Json(json!({
            "error": format!("This is the payment for the bill \"{t}\". Mark the bill as not done to remove it.")
        }))),
        Err(e) => {
            tracing::error!("delete expense {id}: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Delete failed"})))
        }
    }
}

async fn health_check(State(pool): State<SqlitePool>) -> impl IntoResponse {
    match sqlx::query_scalar::<_, i64>("SELECT 1").fetch_one(&pool).await {
        Ok(_) => (StatusCode::OK, Json(json!({"status": "ok", "version": env!("CARGO_PKG_VERSION")}))),
        Err(e) => {
            tracing::error!("health check: database unavailable: {e}");
            (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"status": "error", "error": "database unavailable"})))
        }
    }
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
    if !valid_text(&payload.name) || !valid_amount(payload.quantity) || payload.unit.len() > 30 {
        return bad_request("an item needs a name and a quantity of 0 or more");
    }
    if payload.expires_on.as_deref().is_some_and(|d| !d.is_empty() && !valid_date(d)) {
        return bad_request("expires_on must be a real date (YYYY-MM-DD)");
    }
    let result = sqlx::query(
        "INSERT INTO pantry_items (name, quantity, unit, expires_on) VALUES (?, ?, ?, ?)"
    )
    .bind(payload.name.trim())
    .bind(payload.quantity)
    .bind(payload.unit.trim())
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
    if !valid_text(&payload.title) || payload.assigned_to.len() > 100 {
        return bad_request("a chore needs a title");
    }
    if !matches!(payload.status.as_str(), "todo" | "in_progress" | "done") {
        return bad_request("status must be todo, in_progress or done");
    }
    if !matches!(payload.priority.as_str(), "low" | "medium" | "high") {
        return bad_request("priority must be low, medium or high");
    }
    if !(0..=1000).contains(&payload.points) {
        return bad_request("points must be between 0 and 1000");
    }
    if payload.due_date.as_deref().is_some_and(|d| !d.is_empty() && !valid_date(d)) {
        return bad_request("due_date must be a real date (YYYY-MM-DD)");
    }
    if payload.repeat.as_deref().is_some_and(|r| !r.is_empty() && !valid_repeat(r)) {
        return bad_request("repeat must be weekly, monthly or yearly");
    }
    if payload.amount.is_some_and(|a| !valid_amount(a)) || payload.category.as_deref().is_some_and(|c| c.len() > 50) {
        return bad_request("amount must be 0 or more");
    }
    if payload.amount.is_some_and(|a| a > 0.0) && payload.status == "done" {
        // Paying is what records the expense; a bill can't start out paid.
        return bad_request("add the bill first, then mark it paid");
    }
    let result = sqlx::query(
        "INSERT INTO chores (title, description, assigned_to, priority, status, points, due_date, amount, category, repeat, repeat_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(payload.title.trim())
    .bind(payload.description.as_deref().map(|d| d.chars().take(2000).collect::<String>()))
    .bind(payload.assigned_to.trim())
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
        Ok(r) => (StatusCode::CREATED, Json(json!({"status": "created", "id": r.last_insert_rowid()}))),
        Err(e) => {
            tracing::error!("insert chore: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to insert chore"})))
        }
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
    if !valid_text(&payload.title) {
        return bad_request("an expense needs a title");
    }
    if !valid_amount(payload.amount) || payload.amount == 0.0 {
        return bad_request("amount must be more than 0");
    }
    if !valid_date(&payload.date) {
        return bad_request("date must be a real date (YYYY-MM-DD)");
    }
    if payload.category.trim().is_empty() || payload.category.len() > 50 {
        return bad_request("an expense needs a category");
    }
    let result = sqlx::query(
        "INSERT INTO expenses (title, amount, category, date) VALUES (?, ?, ?, ?)"
    )
    .bind(payload.title.trim())
    .bind(payload.amount)
    .bind(payload.category.trim())
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
    prompt: &str,
) -> Result<serde_json::Value, (StatusCode, Json<serde_json::Value>)> {
    let model = std::env::var("OLLAMA_VISION_MODEL").unwrap_or_else(|_| "llama3.2-vision".to_string());
    ollama_json(prompt, Some(image_base64), model).await
}

/// One HTTP client for Ollama, with timeouts so a stuck model can't hang a request forever.
fn ollama_client() -> &'static reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(5))
            .timeout(std::time::Duration::from_secs(300))
            .no_proxy()
            .build()
            .expect("HTTP client")
    })
}

/// The model runs one request at a time: a second scan waits its turn rather
/// than loading another copy of a large model alongside the first.
static AI_SLOT: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);

fn ai_error(status: StatusCode, msg: impl Into<String>) -> (StatusCode, Json<serde_json::Value>) {
    (status, Json(json!({ "error": msg.into() })))
}

/// Sends a prompt (and optionally one image) to Ollama in JSON mode and parses the reply.
/// Only the server-configured models are used; requests can't pick one.
pub(crate) async fn ollama_json(
    prompt: &str,
    image_base64: Option<&str>,
    model: String,
) -> Result<serde_json::Value, (StatusCode, Json<serde_json::Value>)> {
    let base = std::env::var("OLLAMA_BASE_URL").unwrap_or_else(|_| "http://localhost:11434".to_string());
    let image = image_base64.map(|img| img.find("base64,").map(|i| &img[i + 7..]).unwrap_or(img));
    let mut body = json!({
        "model": model, "prompt": prompt, "stream": false, "format": "json",
        // Room for a full recipe page plus the reply; Ollama's default context is
        // smaller. The reply itself is capped so a confused model stops in time.
        "options": { "num_ctx": 8192, "num_predict": 2048 },
    });
    if let Some(image) = image {
        body["images"] = json!([image]);
    }

    let _slot = tokio::time::timeout(std::time::Duration::from_secs(120), AI_SLOT.acquire())
        .await
        .map_err(|_| ai_error(StatusCode::SERVICE_UNAVAILABLE, "The local AI is busy with another request. Try again in a minute."))?
        .map_err(|_| ai_error(StatusCode::SERVICE_UNAVAILABLE, "The local AI is unavailable"))?;

    tracing::info!("asking Ollama model '{model}'");
    let res = ollama_client().post(format!("{base}/api/generate")).json(&body).send().await.map_err(|e| {
        tracing::error!("Ollama request failed: {e}");
        if e.is_timeout() {
            ai_error(StatusCode::GATEWAY_TIMEOUT, "The local AI took too long. Try again, or use a smaller or clearer photo.")
        } else {
            ai_error(StatusCode::BAD_GATEWAY, "The local AI (Ollama) isn't reachable. Check that Ollama is running on this computer.")
        }
    })?;
    if !res.status().is_success() {
        let status = res.status();
        let err = res.text().await.unwrap_or_default();
        tracing::error!("Ollama returned {status}: {}", err.chars().take(300).collect::<String>());
        let msg = if status == reqwest::StatusCode::NOT_FOUND {
            format!("The AI model '{model}' isn't installed. Run `ollama pull {model}` on this computer.")
        } else {
            "The local AI returned an error. Try again.".to_string()
        };
        return Err(ai_error(StatusCode::BAD_GATEWAY, msg));
    }
    let reply: serde_json::Value = res.json().await.map_err(|e| {
        tracing::error!("unreadable Ollama response: {e}");
        ai_error(StatusCode::BAD_GATEWAY, "The local AI's reply couldn't be read. Try again.")
    })?;
    let text = reply["response"].as_str().unwrap_or("").trim();
    match serde_json::from_str::<serde_json::Value>(text) {
        Ok(v) if v.is_object() => Ok(v),
        _ => {
            // Length only: the reply can hold receipt contents, which stay out of the logs.
            tracing::warn!("AI reply was not a JSON object ({} chars)", text.len());
            Err(ai_error(StatusCode::BAD_GATEWAY, "The local AI's reply couldn't be read. Try again, or use a clearer photo."))
        }
    }
}

/// "₹1,234.50", "1234.5", 1234.5 -> 1234.5. Negative or unreadable amounts give 0.
fn parse_amount(v: &serde_json::Value) -> f64 {
    let n = v.as_f64().or_else(|| {
        let s: String = v.as_str()?.chars().filter(|c| c.is_ascii_digit() || *c == '.').collect();
        s.parse().ok()
    });
    n.filter(|a| a.is_finite() && *a > 0.0 && *a < 1e12).map(|a| (a * 100.0).round() / 100.0).unwrap_or(0.0)
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

    match ollama_vision_json(&payload.image_base64, prompt).await {
        Ok(v) => {
            let date = v["date"].as_str().filter(|d| valid_date(d)).unwrap_or("").to_string();
            (StatusCode::OK, Json(json!({
                "title": v["title"].as_str().unwrap_or("Scanned receipt"),
                "amount": parse_amount(&v["amount"]),
                "category": v["category"].as_str().unwrap_or("Other"),
                "date": date,
                "items": parse_items(&v["items"]),
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
    match ollama_vision_json(&payload.image_base64, prompt).await {
        Ok(v) => (StatusCode::OK, Json(json!({ "items": parse_items(&v["items"]) }))),
        Err(e) => e,
    }
}

#[derive(serde::Deserialize)]
pub struct PantryBatch {
    pub items: Vec<PantryItem>,
    pub expense_id: Option<i64>,
}

const MAX_BATCH: usize = 200;

/// Adds several items at once. An item whose name (and unit) already exists is
/// topped up instead of duplicated. `expense_id` links items to the purchase.
async fn add_pantry_batch(State(pool): State<SqlitePool>, Json(payload): Json<PantryBatch>) -> impl IntoResponse {
    if payload.items.len() > MAX_BATCH {
        return bad_request("too many items at once");
    }
    let result: Result<(usize, usize), sqlx::Error> = async {
        let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
        // An expense deleted meanwhile (stale review list) just isn't linked.
        let expense_id: Option<i64> = match payload.expense_id {
            Some(eid) => sqlx::query_scalar("SELECT id FROM expenses WHERE id = ?").bind(eid).fetch_optional(&mut *tx).await?,
            None => None,
        };
        let (mut added, mut topped) = (0, 0);
        for it in payload.items.iter().filter(|i| valid_text(&i.name) && valid_amount(i.quantity) && i.unit.len() <= 30) {
            let existing: Option<i64> = sqlx::query_scalar(
                "SELECT id FROM pantry_items WHERE lower(trim(name)) = lower(trim(?)) AND lower(trim(unit)) = lower(?) LIMIT 1",
            )
            .bind(&it.name)
            .bind(it.unit.trim())
            .fetch_optional(&mut *tx)
            .await?;
            let expiry = it.expires_on.as_deref().filter(|d| valid_date(d));
            if let Some(id) = existing {
                // New stock's expiry date replaces the old one when it is given.
                sqlx::query("UPDATE pantry_items SET quantity = quantity + ?, expense_id = COALESCE(?, expense_id), expires_on = COALESCE(?, expires_on) WHERE id = ?")
                    .bind(it.quantity)
                    .bind(expense_id)
                    .bind(expiry)
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
                topped += 1;
            } else {
                sqlx::query("INSERT INTO pantry_items (name, quantity, unit, expires_on, expense_id) VALUES (?, ?, ?, ?, ?)")
                    .bind(it.name.trim())
                    .bind(it.quantity)
                    .bind(it.unit.trim())
                    .bind(expiry)
                    .bind(expense_id)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates() {
        for ok in ["2026-01-31", "2028-02-29", "2000-02-29", "2026-12-01"] {
            assert!(valid_date(ok), "{ok}");
        }
        for bad in ["2026-02-29", "1900-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "2026-1-01", "not-a-date", ""] {
            assert!(!valid_date(bad), "{bad}");
        }
    }

    #[test]
    fn amounts() {
        assert_eq!(parse_amount(&json!("₹1,234.50")), 1234.5);
        assert_eq!(parse_amount(&json!(15.755)), 15.76);
        assert_eq!(parse_amount(&json!(-5)), 0.0);
        assert_eq!(parse_amount(&json!("free")), 0.0);
    }
}
