use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{delete, get, patch, post},
    Extension, Json, Router,
};
use sqlx::SqlitePool;
use crate::jobs::{self, JobContext};
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
        .route("/recipes/images/{file}", get(recipes::get_recipe_image))
        .route("/recipes/{id}", axum::routing::put(recipes::update_recipe).delete(recipes::delete_recipe))
        .route("/meals", get(get_meals).post(add_meal))
        .route("/meals/{id}", patch(update_meal).delete(delete_meal))
        .route("/chores", get(get_chores).post(add_chore))
        .route("/chores/{id}", patch(update_chore).delete(delete_chore))
        .route("/expenses", get(get_expenses).post(add_expense))
        .route("/expenses/{id}", axum::routing::put(update_expense).delete(delete_expense))
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
    if !valid_text(&payload.name) || !valid_amount(payload.quantity) || payload.unit.trim().len() > 30 {
        return bad_request("an item needs a name and a quantity of 0 or more");
    }
    if payload.low_threshold.is_some_and(|t| !valid_amount(t)) {
        return bad_request("low_threshold must be 0 or more");
    }
    let expiry = payload.expires_on.as_deref().map(str::trim);
    if expiry.is_some_and(|d| !d.is_empty() && !valid_date(d)) {
        return bad_request("expires_on must be a real date (YYYY-MM-DD)");
    }
    // Missing expires_on keeps the current one; "" clears it.
    // With a version, the edit only applies to the row as the editor saw it.
    match sqlx::query_scalar::<_, i64>(
        "UPDATE pantry_items SET name = ?1, quantity = ?2, unit = ?3, \
         expires_on = CASE WHEN ?4 IS NULL THEN expires_on WHEN ?4 = '' THEN NULL ELSE ?4 END, \
         low_threshold = ?5, version = version + 1 \
         WHERE id = ?6 AND (?7 IS NULL OR version = ?7) RETURNING version",
    )
        .bind(payload.name.trim())
        .bind(payload.quantity.min(1e9))
        .bind(payload.unit.trim())
        .bind(expiry)
        .bind(payload.low_threshold)
        .bind(id)
        .bind(payload.version)
        .fetch_optional(&pool)
        .await
    {
        Ok(Some(version)) => (StatusCode::OK, Json(json!({"status": "updated", "version": version}))),
        Ok(None) => match sqlx::query_as::<_, PantryItem>("SELECT * FROM pantry_items WHERE id = ?").bind(id).fetch_optional(&pool).await {
            Ok(Some(current)) => conflict(json!(current)),
            _ => (StatusCode::NOT_FOUND, Json(json!({"error": "Already removed by someone else"}))),
        },
        Err(e) => {
            tracing::error!("update pantry item {id}: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to update pantry item"})))
        }
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
    match sqlx::query("UPDATE pantry_items SET quantity = min(1e9, max(0, quantity + ?)), version = version + 1 WHERE id = ?")
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

#[derive(serde::Deserialize, Default)]
pub struct DateQuery {
    pub month: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

fn valid_month(m: &str) -> bool {
    let b = m.as_bytes();
    if !(b.len() == 7 && b[4] == b'-' && b.iter().enumerate().all(|(i, c)| i == 4 || c.is_ascii_digit())) {
        return false;
    }
    let y: u32 = m[..4].parse().unwrap_or(0);
    let mo: u32 = m[5..7].parse().unwrap_or(0);
    y >= 1900 && (1..=12).contains(&mo)
}

fn parse_date_query(q: &DateQuery) -> Result<(Option<String>, Option<String>, i64, i64), &'static str> {
    if q.month.is_some() && (q.from.is_some() || q.to.is_some()) {
        return Err("use either month or from/to, not both");
    }
    let (from, to) = if let Some(m) = q.month.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if !valid_month(m) {
            return Err("month must be YYYY-MM");
        }
        (Some(format!("{m}-01")), Some(format!("{m}-31")))
    } else {
        let f = q.from.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
        let t = q.to.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
        if f.as_deref().is_some_and(|d| !valid_date(d)) || t.as_deref().is_some_and(|d| !valid_date(d)) {
            return Err("from/to must be real dates (YYYY-MM-DD)");
        }
        if let (Some(fd), Some(td)) = (f.as_deref(), t.as_deref()) {
            if fd > td {
                return Err("from must not be after to");
            }
        }
        (f, t)
    };
    let offset = match q.offset {
        Some(o) if o < 0 => return Err("offset must be 0 or more"),
        Some(o) => o,
        None => 0,
    };
    let limit = match q.limit {
        Some(l) if !(1..=1000).contains(&l) => return Err("limit must be between 1 and 1000"),
        Some(l) => l,
        None if q.offset.is_some() => 500,
        None => -1,
    };
    Ok((from, to, limit, offset))
}

async fn get_meals(State(pool): State<SqlitePool>, Query(q): Query<DateQuery>) -> impl IntoResponse {
    let (from, to, limit, offset) = match parse_date_query(&q) {
        Ok(v) => v,
        Err(msg) => return bad_request(msg),
    };
    match sqlx::query_as::<_, Meal>(
        "SELECT * FROM meal_plan WHERE (?1 IS NULL OR date >= ?1) AND (?2 IS NULL OR date <= ?2) \
         ORDER BY date, slot LIMIT ?3 OFFSET ?4",
    )
    .bind(from)
    .bind(to)
    .bind(limit)
    .bind(offset)
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

fn day_of_date(d: &str) -> i64 {
    if valid_date(d) {
        d.get(8..).and_then(|s| s.parse().ok()).unwrap_or(1)
    } else {
        1
    }
}

/// 409 for an edit made from a stale screen: someone else changed the row since
/// it was loaded. The row as it is now comes back so the app can show it.
pub(crate) fn conflict(current: serde_json::Value) -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::CONFLICT, Json(json!({
        "error": "Someone else changed this while you were editing it.",
        "current": current,
    })))
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

const CATEGORIES: &[&str] = &[
    "Groceries",
    "Utilities",
    "Household",
    "Dining",
    "Entertainment",
    "Transportation",
    "Health",
    "Other",
];

fn canonical_category(raw: &str) -> Option<&'static str> {
    let t = raw.trim();
    CATEGORIES.iter().copied().find(|c| c.eq_ignore_ascii_case(t))
}

const CHORE_CATEGORIES: &[&str] = &[
    "Cleaning",
    "Kitchen",
    "Laundry",
    "Errands",
    "Maintenance",
    "Pets",
    "Garden",
    "Other",
];

fn canonical_chore_category(raw: &str) -> Option<&'static str> {
    let t = raw.trim();
    CHORE_CATEGORIES.iter().copied().find(|c| c.eq_ignore_ascii_case(t))
}

#[derive(Debug)]
enum ChoreUpdateError {
    BadRequest(&'static str),
    Db(sqlx::Error),
}

impl From<sqlx::Error> for ChoreUpdateError {
    fn from(e: sqlx::Error) -> Self {
        Self::Db(e)
    }
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
    if payload.title.as_deref().is_some_and(|t| !valid_text(t)) {
        return bad_request("a chore needs a title");
    }
    if payload.assigned_to.as_deref().is_some_and(|a| a.trim().len() > 100) {
        return bad_request("assigned_to must be 100 characters or less");
    }
    if payload.priority.as_deref().is_some_and(|p| !matches!(p, "low" | "medium" | "high")) {
        return bad_request("priority must be low, medium or high");
    }
    if payload.points.is_some_and(|pts| !(0..=1000).contains(&pts)) {
        return bad_request("points must be between 0 and 1000");
    }
    if payload.amount.is_some_and(|a| !valid_amount(a)) {
        return bad_request("amount must be 0 or more");
    }
    if payload
        .category
        .as_deref()
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .is_some_and(|c| canonical_category(c).is_none() && canonical_chore_category(c).is_none())
    {
        return bad_request("invalid category");
    }
    match apply_chore_update(&pool, id, &payload).await {
        Ok(true) => (StatusCode::OK, Json(json!({"status": "updated"}))),
        Ok(false) => (StatusCode::NOT_FOUND, Json(json!({"error": "Not found"}))),
        Err(ChoreUpdateError::BadRequest(msg)) => bad_request(msg),
        Err(ChoreUpdateError::Db(e)) => {
            tracing::error!("update chore {id} failed: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to update chore"})))
        }
    }
}

/// Updates status, due date, or editable fields. For bills, marking done logs
/// an expense, editing syncs it, and moving out of done removes it.
async fn apply_chore_update(pool: &SqlitePool, id: i64, payload: &ChoreUpdate) -> Result<bool, ChoreUpdateError> {
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let Some(chore) = sqlx::query_as::<_, Chore>("SELECT * FROM chores WHERE id = ?")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
    else {
        return Ok(false);
    };

    let title = payload
        .title
        .as_deref()
        .map(str::trim)
        .map(str::to_string)
        .unwrap_or_else(|| chore.title.clone());
    let description = match &payload.description {
        Some(d) if d.trim().is_empty() => None,
        Some(d) => Some(d.chars().take(2000).collect()),
        None => chore.description.clone(),
    };
    let assigned_to = match payload.assigned_to.as_deref().map(str::trim) {
        Some("") => "Anyone".to_string(),
        Some(a) => a.to_string(),
        None => chore.assigned_to.clone(),
    };
    let priority = payload.priority.clone().unwrap_or_else(|| chore.priority.clone());
    let points = payload.points.unwrap_or(chore.points);
    let amount = match payload.amount {
        Some(a) if a > 0.0 => Some(a),
        Some(_) => None,
        None => chore.amount,
    };
    let category = if amount.is_some() {
        match payload.category.as_deref().map(str::trim) {
            Some("") => Some("Utilities".to_string()),
            Some(c) => Some(
                canonical_category(c)
                    .ok_or(ChoreUpdateError::BadRequest("invalid bill category"))?
                    .to_string(),
            ),
            None => Some(chore.category.clone().filter(|c| canonical_category(c).is_some()).unwrap_or_else(|| "Utilities".to_string())),
        }
    } else {
        match payload.category.as_deref().map(str::trim) {
            Some("") => None,
            Some(c) => Some(
                canonical_chore_category(c)
                    .ok_or(ChoreUpdateError::BadRequest("invalid chore category"))?
                    .to_string(),
            ),
            None => chore.category.clone().and_then(|c| canonical_chore_category(&c).map(str::to_string)),
        }
    };

    sqlx::query(
        "UPDATE chores SET title = ?, description = ?, assigned_to = ?, priority = ?, points = ?, amount = ?, category = ?, \
         status = COALESCE(?, status), \
         due_date = CASE WHEN ? IS NULL THEN due_date WHEN ? = '' THEN NULL ELSE ? END \
         WHERE id = ?",
    )
    .bind(&title)
    .bind(&description)
    .bind(&assigned_to)
    .bind(&priority)
    .bind(points)
    .bind(amount)
    .bind(&category)
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
         WHERE id = ? AND due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND (? OR repeat_day IS NULL)",
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
                    .or_else(|| chore.due_date.clone().filter(|d| valid_date(d)))
                    .unwrap_or(today);
                let anchor = match new_due {
                    Some(d) => day_of_date(d),
                    None => chore.repeat_day.filter(|d| (1..=31).contains(d)).unwrap_or_else(|| day_of_date(&from)),
                };
                let next = next_due_date(&mut tx, &from, repeat, anchor).await?;
                let res = sqlx::query(
                    "INSERT INTO chores (title, description, assigned_to, priority, status, points, due_date, amount, category, repeat, repeat_day) \
                     VALUES (?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?)",
                )
                .bind(&title)
                .bind(&description)
                .bind(&assigned_to)
                .bind(&priority)
                .bind(points)
                .bind(&next)
                .bind(amount)
                .bind(&category)
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
                        let anchor = chore.repeat_day.filter(|d| (1..=31).contains(d)).unwrap_or_else(|| day_of_date(from));
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

    let status_now = payload.status.as_deref().unwrap_or(&chore.status);
    if let Some(amt) = amount {
        if status_now == "done" {
            if let Some(eid) = chore.expense_id {
                sqlx::query("UPDATE expenses SET title = ?, amount = ?, category = ?, version = version + 1 WHERE id = ?")
                    .bind(&title)
                    .bind(amt)
                    .bind(category.as_deref().unwrap_or("Utilities"))
                    .bind(eid)
                    .execute(&mut *tx)
                    .await?;
            } else {
                let res = sqlx::query("INSERT INTO expenses (title, amount, category, date) VALUES (?, ?, ?, date('now', 'localtime'))")
                    .bind(&title)
                    .bind(amt)
                    .bind(category.as_deref().unwrap_or("Utilities"))
                    .execute(&mut *tx)
                    .await?;
                sqlx::query("UPDATE chores SET expense_id = ? WHERE id = ?")
                    .bind(res.last_insert_rowid())
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
            }
        } else if let Some(eid) = chore.expense_id {
            sqlx::query("DELETE FROM expenses WHERE id = ?").bind(eid).execute(&mut *tx).await?;
            sqlx::query("UPDATE chores SET expense_id = NULL WHERE id = ?").bind(id).execute(&mut *tx).await?;
        }
    } else if let Some(eid) = chore.expense_id {
        sqlx::query("DELETE FROM expenses WHERE id = ?").bind(eid).execute(&mut *tx).await?;
        sqlx::query("UPDATE chores SET expense_id = NULL WHERE id = ?").bind(id).execute(&mut *tx).await?;
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
        let v = v.trim();
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

/// Sets a category's monthly budget; an amount of 0 removes it.
async fn put_budget(
    State(pool): State<SqlitePool>,
    Path(category): Path<String>,
    Json(payload): Json<BudgetUpdate>,
) -> impl IntoResponse {
    if !valid_amount(payload.amount) {
        return bad_request("amount must be a number of 0 or more");
    }
    let Some(category) = canonical_category(&category) else {
        return bad_request("invalid category");
    };
    let res = if payload.amount > 0.0 {
        sqlx::query("INSERT INTO budgets (category, amount) VALUES (?, ?) ON CONFLICT(category) DO UPDATE SET amount = excluded.amount")
            .bind(category)
            .bind(payload.amount)
            .execute(&pool)
            .await
    } else {
        sqlx::query("DELETE FROM budgets WHERE category = ?").bind(category).execute(&pool).await
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
    if !valid_text(&payload.name) || !valid_amount(payload.quantity) || payload.unit.trim().len() > 30 {
        return bad_request("an item needs a name and a quantity of 0 or more");
    }
    if payload.low_threshold.is_some_and(|t| !valid_amount(t)) {
        return bad_request("low_threshold must be 0 or more");
    }
    if payload.expires_on.as_deref().is_some_and(|d| !d.is_empty() && !valid_date(d)) {
        return bad_request("expires_on must be a real date (YYYY-MM-DD)");
    }
    let result = sqlx::query(
        "INSERT INTO pantry_items (name, quantity, unit, expires_on, low_threshold) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(payload.name.trim())
    .bind(payload.quantity.min(1e9))
    .bind(payload.unit.trim())
    .bind(payload.expires_on.as_deref().filter(|d| valid_date(d)))
    .bind(payload.low_threshold)
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
    if payload.amount.is_some_and(|a| !valid_amount(a)) {
        return bad_request("amount must be 0 or more");
    }
    let is_bill = payload.amount.is_some_and(|a| a > 0.0);
    let category = match payload.category.as_deref().map(str::trim).filter(|c| !c.is_empty()) {
        Some(c) => {
            let canon = if is_bill { canonical_category(c) } else { canonical_chore_category(c) };
            match canon {
                Some(v) => Some(v),
                None => return bad_request("invalid category"),
            }
        }
        None => is_bill.then_some("Utilities"),
    };
    if is_bill && payload.status == "done" {
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
    .bind(category)
    .bind(payload.repeat.as_deref().filter(|r| valid_repeat(r)))
    .bind(payload.due_date.as_deref().filter(|d| valid_date(d)).map(day_of_date))
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

async fn get_expenses(State(pool): State<SqlitePool>, Query(q): Query<DateQuery>) -> impl IntoResponse {
    let (from, to, limit, offset) = match parse_date_query(&q) {
        Ok(v) => v,
        Err(msg) => return bad_request(msg),
    };
    match sqlx::query_as::<_, Expense>(
        "SELECT * FROM expenses WHERE (?1 IS NULL OR date >= ?1) AND (?2 IS NULL OR date <= ?2) \
         ORDER BY date DESC, id DESC LIMIT ?3 OFFSET ?4",
    )
    .bind(from)
    .bind(to)
    .bind(limit)
    .bind(offset)
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
    let Some(category) = canonical_category(&payload.category) else {
        return bad_request("invalid expense category");
    };
    let result = sqlx::query(
        "INSERT INTO expenses (title, amount, category, date) VALUES (?, ?, ?, ?)"
    )
    .bind(payload.title.trim())
    .bind(payload.amount)
    .bind(category)
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

async fn update_expense(
    State(pool): State<SqlitePool>,
    Path(id): Path<i64>,
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
    let Some(category) = canonical_category(&payload.category) else {
        return bad_request("invalid expense category");
    };
    let title = payload.title.trim();
    let result: Result<Option<i64>, sqlx::Error> = async {
        let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
        let changed: Option<i64> = sqlx::query_scalar(
            "UPDATE expenses SET title = ?1, amount = ?2, category = ?3, date = ?4, version = version + 1 \
             WHERE id = ?5 AND (?6 IS NULL OR version = ?6) RETURNING version",
        )
        .bind(title)
        .bind(payload.amount)
        .bind(category)
        .bind(&payload.date)
        .bind(id)
        .bind(payload.version)
        .fetch_optional(&mut *tx)
        .await?;
        if changed.is_some() {
            sqlx::query("UPDATE chores SET title = ?, amount = ?, category = ? WHERE expense_id = ?")
                .bind(title)
                .bind(payload.amount)
                .bind(category)
                .bind(id)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(changed)
    }
    .await;
    match result {
        Ok(Some(version)) => (StatusCode::OK, Json(json!({"status": "updated", "version": version}))),
        Ok(None) => match sqlx::query_as::<_, Expense>("SELECT * FROM expenses WHERE id = ?").bind(id).fetch_optional(&pool).await {
            Ok(Some(current)) => conflict(json!(current)),
            _ => (StatusCode::NOT_FOUND, Json(json!({"error": "Already removed by someone else"}))),
        },
        Err(e) => {
            tracing::error!("update expense {id}: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to update expense"})))
        }
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

pub(crate) fn validate_image_base64(raw: &str) -> Result<&str, (StatusCode, Json<serde_json::Value>)> {
    let trimmed = raw.trim();
    let payload = if let Some(rest) = trimmed.strip_prefix("data:") {
        let Some((meta, data)) = rest.split_once(',') else {
            return Err(ai_error(StatusCode::BAD_REQUEST, "invalid image data"));
        };
        let meta_lower = meta.to_ascii_lowercase();
        if !meta_lower.starts_with("image/") || !meta_lower.ends_with(";base64") {
            return Err(ai_error(StatusCode::BAD_REQUEST, "image must be a base64-encoded image"));
        }
        data.trim()
    } else {
        trimmed
    };
    if payload.is_empty()
        || payload.len() > 16 * 1024 * 1024
        || !payload
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'=' | b'\n' | b'\r'))
    {
        return Err(ai_error(StatusCode::BAD_REQUEST, "invalid image data"));
    }
    Ok(payload)
}

/// Sends a prompt (and optionally one image) to Ollama in JSON mode and parses the reply.
/// Only the server-configured models are used; requests can't pick one.
pub(crate) async fn ollama_json(
    prompt: &str,
    image_base64: Option<&str>,
    model: String,
) -> Result<serde_json::Value, (StatusCode, Json<serde_json::Value>)> {
    let base = std::env::var("OLLAMA_BASE_URL").unwrap_or_else(|_| "http://localhost:11434".to_string());
    let image = match image_base64 {
        Some(img) => Some(validate_image_base64(img)?),
        None => None,
    };
    let mut body = json!({
        "model": model, "prompt": prompt, "stream": false, "format": "json",
        // Room for a full recipe page plus the reply; Ollama's default context is
        // smaller. The reply itself is capped so a confused model stops in time.
        "options": { "num_ctx": 8192, "num_predict": 2048 },
    });
    if let Some(image) = image {
        body["images"] = json!([image]);
    }

    let _slot = tokio::time::timeout(std::time::Duration::from_secs(600), AI_SLOT.acquire())
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
                    let name: String = it["name"].as_str()?.trim().chars().take(200).collect();
                    if name.is_empty() {
                        return None;
                    }
                    let quantity = it["quantity"].as_f64()
                        .or_else(|| it["quantity"].as_str().and_then(|q| q.trim().parse().ok()))
                        .filter(|q| q.is_finite() && *q > 0.0 && *q <= 1e9)
                        .unwrap_or(1.0);
                    let unit: String = it["unit"]
                        .as_str()
                        .map(str::trim)
                        .filter(|u| !u.is_empty())
                        .unwrap_or("pcs")
                        .chars()
                        .take(30)
                        .collect();
                    Some(json!({ "name": name, "quantity": quantity, "unit": unit }))
                })
                .take(60)
                .collect()
        })
        .unwrap_or_default()
}

fn normalize_receipt(v: &serde_json::Value) -> serde_json::Value {
    let title: String = v["title"]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("Scanned receipt")
        .chars()
        .take(200)
        .collect();
    let category = v["category"].as_str().and_then(canonical_category).unwrap_or("Other");
    let date = v["date"].as_str().map(str::trim).filter(|d| valid_date(d)).unwrap_or("");
    json!({
        "title": title,
        "amount": parse_amount(&v["amount"]),
        "category": category,
        "date": date,
        "items": parse_items(&v["items"]),
    })
}

async fn scan_receipt(
    Extension(ctx): Extension<JobContext>,
    headers: HeaderMap,
    Json(payload): Json<ScanReceiptRequest>,
) -> axum::response::Response {
    if let Err(e) = validate_image_base64(&payload.image_base64) {
        return e.into_response();
    }
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
    let image = payload.image_base64;
    ctx.spawn("receipt", jobs::client_id_from(&headers), async move {
        let v = ollama_vision_json(&image, prompt).await?;
        Ok(normalize_receipt(&v))
    })
}

/// Photo of groceries / a shelf / the fridge -> list of pantry items to review.
async fn scan_pantry_photo(
    Extension(ctx): Extension<JobContext>,
    headers: HeaderMap,
    Json(payload): Json<ScanReceiptRequest>,
) -> axum::response::Response {
    if let Err(e) = validate_image_base64(&payload.image_base64) {
        return e.into_response();
    }
    let prompt = "List the food, grocery and household products visible in this photo, as they would be \
                  tracked in a home pantry. Use short plain product names (e.g. 'Basmati rice', 'Milk', 'Eggs'). \
                  Estimate a count or amount for each, with a unit such as pcs, pack, kg, g, L or ml. \
                  Respond ONLY with a valid JSON object: {\"items\": [{\"name\": \"Eggs\", \"quantity\": 12, \"unit\": \"pcs\"}]}";
    let image = payload.image_base64;
    ctx.spawn("pantry", jobs::client_id_from(&headers), async move {
        let v = ollama_vision_json(&image, prompt).await?;
        Ok(json!({ "items": parse_items(&v["items"]) }))
    })
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
        for it in payload.items.iter().filter(|i| valid_text(&i.name) && valid_amount(i.quantity) && i.unit.trim().len() <= 30) {
            let qty = it.quantity.min(1e9);
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
                sqlx::query("UPDATE pantry_items SET quantity = min(1e9, quantity + ?), expense_id = COALESCE(?, expense_id), expires_on = COALESCE(?, expires_on), version = version + 1 WHERE id = ?")
                    .bind(qty)
                    .bind(expense_id)
                    .bind(expiry)
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
                topped += 1;
            } else {
                sqlx::query("INSERT INTO pantry_items (name, quantity, unit, expires_on, expense_id) VALUES (?, ?, ?, ?, ?)")
                    .bind(it.name.trim())
                    .bind(qty)
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

    async fn test_pool() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("in-memory sqlite");
        sqlx::migrate!("./migrations").run(&pool).await.expect("migrations");
        pool
    }

    #[tokio::test]
    async fn update_pantry_item_updates_fields_and_expiry() {
        let pool = test_pool().await;
        let id = sqlx::query("INSERT INTO pantry_items (name, quantity, unit, expires_on) VALUES ('Milk', 2.0, 'L', '2026-12-01')")
            .execute(&pool)
            .await
            .unwrap()
            .last_insert_rowid();

        // Missing expires_on keeps existing expiry date.
        let res = update_pantry_item(
            State(pool.clone()),
            Path(id),
            Json(PantryItem {
                id: 0,
                name: " Whole Milk ".into(),
                quantity: 3.0,
                unit: " L ".into(),
                expires_on: None,
                expense_id: None,
                low_threshold: None,
                version: None,
            }),
        )
        .await
        .into_response();
        assert_eq!(res.status(), StatusCode::OK);
        let row: PantryItem = sqlx::query_as("SELECT * FROM pantry_items WHERE id = ?").bind(id).fetch_one(&pool).await.unwrap();
        assert_eq!(row.name, "Whole Milk");
        assert_eq!(row.quantity, 3.0);
        assert_eq!(row.unit, "L");
        assert_eq!(row.expires_on.as_deref(), Some("2026-12-01"));

        // Setting a new expiry date updates it.
        let res = update_pantry_item(
            State(pool.clone()),
            Path(id),
            Json(PantryItem {
                id: 0,
                name: "Whole Milk".into(),
                quantity: 1.5,
                unit: "L".into(),
                expires_on: Some("2026-12-10".into()),
                expense_id: None,
                low_threshold: None,
                version: None,
            }),
        )
        .await
        .into_response();
        assert_eq!(res.status(), StatusCode::OK);
        let row: PantryItem = sqlx::query_as("SELECT * FROM pantry_items WHERE id = ?").bind(id).fetch_one(&pool).await.unwrap();
        assert_eq!(row.expires_on.as_deref(), Some("2026-12-10"));

        // Empty string clears expires_on.
        let res = update_pantry_item(
            State(pool.clone()),
            Path(id),
            Json(PantryItem {
                id: 0,
                name: "Whole Milk".into(),
                quantity: 1.5,
                unit: "L".into(),
                expires_on: Some("".into()),
                expense_id: None,
                low_threshold: None,
                version: None,
            }),
        )
        .await
        .into_response();
        assert_eq!(res.status(), StatusCode::OK);
        let row: PantryItem = sqlx::query_as("SELECT * FROM pantry_items WHERE id = ?").bind(id).fetch_one(&pool).await.unwrap();
        assert_eq!(row.expires_on, None);

        // Missing id returns 404.
        let res = update_pantry_item(
            State(pool),
            Path(9999),
            Json(PantryItem {
                id: 0,
                name: "Missing".into(),
                quantity: 1.0,
                unit: "pcs".into(),
                expires_on: None,
                expense_id: None,
                low_threshold: None,
                version: None,
            }),
        )
        .await
        .into_response();
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn database_rejects_malformed_due_date() {
        // Before schema v2 a malformed date could be stored and had to be
        // handled at runtime; now the database refuses it outright.
        let pool = test_pool().await;
        let err = sqlx::query(
            "INSERT INTO chores (title, assigned_to, priority, status, points, due_date, repeat) \
             VALUES ('Water plants', 'anyone', 'medium', 'todo', 1, 'bad', 'monthly')",
        )
        .execute(&pool)
        .await
        .expect_err("malformed due_date must be rejected");
        assert!(err.to_string().contains("CHECK constraint failed"), "{err}");
    }

    #[tokio::test]
    async fn schema_enforces_rules_and_links() {
        let pool = test_pool().await;
        for bad in [
            "INSERT INTO chores (title, priority, status) VALUES ('x', 'urgent', 'todo')",
            "INSERT INTO chores (title, priority, status, points) VALUES ('x', 'low', 'todo', -1)",
            "INSERT INTO chores (title, priority, status, repeat) VALUES ('x', 'low', 'todo', 'daily')",
            "INSERT INTO chores (title, priority, status) VALUES ('  ', 'low', 'todo')",
            "INSERT INTO expenses (title, amount, category, date) VALUES ('x', 5, 'Other', '2026-02-30')",
            "INSERT INTO expenses (title, amount, category, date) VALUES ('x', -5, 'Other', '2026-02-03')",
            "INSERT INTO pantry_items (name, quantity) VALUES ('x', -1)",
            "INSERT INTO pantry_items (name, quantity) VALUES ('x', 'lots')",
            "INSERT INTO meal_plan (date, slot, title) VALUES ('2026-11-27', 'brunch', 'x')",
            "INSERT INTO recipe_ingredients (recipe_id, name) VALUES (9999, 'x')",
            "INSERT INTO budgets (category, amount) VALUES ('Dining', 0)",
        ] {
            assert!(sqlx::query(bad).execute(&pool).await.is_err(), "accepted: {bad}");
        }

        // Deleting a recipe removes its ingredients and unlinks planned meals.
        let rid = sqlx::query("INSERT INTO recipes (name) VALUES ('Dal')").execute(&pool).await.unwrap().last_insert_rowid();
        sqlx::query("INSERT INTO recipe_ingredients (recipe_id, name, text) VALUES (?, 'toor dal', '1 cup toor dal')")
            .bind(rid).execute(&pool).await.unwrap();
        let mid = sqlx::query("INSERT INTO meal_plan (date, slot, title, recipe_id) VALUES ('2026-11-27', 'dinner', 'Dal', ?)")
            .bind(rid).execute(&pool).await.unwrap().last_insert_rowid();
        sqlx::query("DELETE FROM recipes WHERE id = ?").bind(rid).execute(&pool).await.unwrap();
        let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM recipe_ingredients").fetch_one(&pool).await.unwrap();
        let link: Option<i64> = sqlx::query_scalar("SELECT recipe_id FROM meal_plan WHERE id = ?").bind(mid).fetch_one(&pool).await.unwrap();
        assert_eq!((left, link), (0, None));

        // Deleting an expense or a chore clears links that pointed at it.
        let eid = sqlx::query("INSERT INTO expenses (title, amount, category, date) VALUES ('Shop', 10, 'Groceries', '2026-11-27')")
            .execute(&pool).await.unwrap().last_insert_rowid();
        let pid = sqlx::query("INSERT INTO pantry_items (name, quantity, expense_id) VALUES ('Rice', 1, ?)")
            .bind(eid).execute(&pool).await.unwrap().last_insert_rowid();
        let next = sqlx::query("INSERT INTO chores (title, priority, status) VALUES ('Bins', 'low', 'todo')")
            .execute(&pool).await.unwrap().last_insert_rowid();
        let prev = sqlx::query("INSERT INTO chores (title, priority, status, next_id) VALUES ('Bins', 'low', 'done', ?)")
            .bind(next).execute(&pool).await.unwrap().last_insert_rowid();
        sqlx::query("DELETE FROM expenses WHERE id = ?").bind(eid).execute(&pool).await.unwrap();
        sqlx::query("DELETE FROM chores WHERE id = ?").bind(next).execute(&pool).await.unwrap();
        let pe: Option<i64> = sqlx::query_scalar("SELECT expense_id FROM pantry_items WHERE id = ?").bind(pid).fetch_one(&pool).await.unwrap();
        let pn: Option<i64> = sqlx::query_scalar("SELECT next_id FROM chores WHERE id = ?").bind(prev).fetch_one(&pool).await.unwrap();
        assert_eq!((pe, pn), (None, None));
    }

    /// Schema v2 rebuilds every table. Data written under the old schema,
    /// including values that break the new rules, must come through: valid rows
    /// unchanged, invalid values repaired, no row lost, ids never reused.
    #[tokio::test]
    async fn schema_v2_migration_keeps_and_repairs_old_data() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        let all = sqlx::migrate!("./migrations");
        let v2 = 20261128000000;
        let mut old = sqlx::migrate!("./migrations");
        old.migrations = std::borrow::Cow::Owned(all.migrations.iter().filter(|m| m.version < v2).cloned().collect());
        old.run(&pool).await.unwrap();

        for q in [
            "INSERT INTO expenses (id, title, amount, category, date) VALUES (7, 'Rent', 15000, 'Utilities', '2026-11-01')",
            "INSERT INTO expenses (id, title, amount, category, date) VALUES (8, 'Odd', 20, 'Other', 'yesterday')",
            "INSERT INTO recipes (id, name, instructions) VALUES (3, 'Poha', 'Rinse.')",
            "INSERT INTO recipe_ingredients (recipe_id, name, quantity, unit, text) VALUES (3, 'poha', 2, 'cup', '2 cups poha')",
            // Only possible in a database written with foreign keys off.
            "PRAGMA foreign_keys = OFF",
            "INSERT INTO recipe_ingredients (recipe_id, name, quantity, unit) VALUES (99, 'orphan', 1, 'g')",
            "PRAGMA foreign_keys = ON",
            "INSERT INTO meal_plan (date, slot, title, recipe_id) VALUES ('2026-11-27', 'breakfast', 'Poha', 3)",
            "INSERT INTO pantry_items (name, quantity, unit, expires_on, expense_id) VALUES ('Milk', -2, 'L', '2026-02-30', 42)",
            "INSERT INTO chores (id, title, assigned_to, priority, status, points, due_date, repeat, repeat_day, next_id, amount, expense_id) \
             VALUES (5, 'Rent', 'Sushil', 'urgent', 'paid', 5000, '2026-11-01', 'monthly', 1, 77, 15000, 7)",
            "DELETE FROM expenses WHERE id = 8",
            "INSERT INTO expenses (id, title, amount, category, date) VALUES (9, 'Odd', 20, 'Other', 'yesterday')",
            "DELETE FROM expenses WHERE id = 9",
        ] {
            sqlx::query(q).execute(&pool).await.unwrap();
        }

        all.run(&pool).await.unwrap();

        let fk: Vec<(String,)> = sqlx::query_as("SELECT \"table\" FROM pragma_foreign_key_check").fetch_all(&pool).await.unwrap();
        assert!(fk.is_empty(), "{fk:?}");
        let on: i64 = sqlx::query_scalar("PRAGMA foreign_keys").fetch_one(&pool).await.unwrap();
        assert_eq!(on, 1);

        let rent: Expense = sqlx::query_as("SELECT * FROM expenses WHERE id = 7").fetch_one(&pool).await.unwrap();
        assert_eq!((rent.amount, rent.date.as_str(), rent.version), (15000.0, "2026-11-01", Some(1)));
        let meal_recipe: Option<i64> = sqlx::query_scalar("SELECT recipe_id FROM meal_plan").fetch_one(&pool).await.unwrap();
        assert_eq!(meal_recipe, Some(3));
        let ingredients: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM recipe_ingredients").fetch_one(&pool).await.unwrap();
        assert_eq!(ingredients, 1, "orphan ingredient dropped, the real one kept");

        let milk: PantryItem = sqlx::query_as("SELECT * FROM pantry_items").fetch_one(&pool).await.unwrap();
        assert_eq!((milk.quantity, milk.expires_on, milk.expense_id), (0.0, None, None));
        let rent_bill: Chore = sqlx::query_as("SELECT * FROM chores WHERE id = 5").fetch_one(&pool).await.unwrap();
        assert_eq!(
            (rent_bill.priority.as_str(), rent_bill.status.as_str(), rent_bill.points, rent_bill.next_id, rent_bill.expense_id),
            ("medium", "todo", 1000, None, Some(7))
        );

        // Expense 9 was deleted before the migration: its id is never handed out again.
        let new_id = sqlx::query("INSERT INTO expenses (title, amount, category, date) VALUES ('New', 1, 'Other', '2026-11-27')")
            .execute(&pool).await.unwrap().last_insert_rowid();
        assert_eq!(new_id, 10);
    }

    /// Status and JSON body of a handler's response.
    async fn parts(r: impl IntoResponse) -> (StatusCode, Json<serde_json::Value>) {
        let res = r.into_response();
        let status = res.status();
        let bytes = axum::body::to_bytes(res.into_body(), 1 << 20).await.unwrap();
        (status, Json(serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null)))
    }

    #[tokio::test]
    async fn stale_edits_get_409_with_the_current_row() {
        let pool = test_pool().await;
        let id = sqlx::query("INSERT INTO pantry_items (name, quantity, unit) VALUES ('Rice', 2, 'kg')")
            .execute(&pool).await.unwrap().last_insert_rowid();
        let item = |name: &str, version: Option<i64>| PantryItem {
            id: 0, name: name.into(), quantity: 2.0, unit: "kg".into(), expires_on: None,
            expense_id: None, low_threshold: None, version,
        };

        // A edits from version 1 and wins; B, also on version 1, gets a conflict.
        let (status, Json(body)) = parts(update_pantry_item(State(pool.clone()), Path(id), Json(item("Basmati rice", Some(1)))).await).await;
        assert_eq!((status, body["version"].as_i64()), (StatusCode::OK, Some(2)));
        let (status, Json(body)) = parts(update_pantry_item(State(pool.clone()), Path(id), Json(item("Brown rice", Some(1)))).await).await;
        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!((body["current"]["name"].as_str(), body["current"]["version"].as_i64()), (Some("Basmati rice"), Some(2)));

        // A +1 tap also counts as a change.
        let _ = adjust_pantry_item(State(pool.clone()), Path(id), Json(Adjust { delta: 1.0 })).await;
        let (status, _) = parts(update_pantry_item(State(pool.clone()), Path(id), Json(item("Basmati", Some(2)))).await).await;
        assert_eq!(status, StatusCode::CONFLICT);

        // Without a version (older clients, scripts) the edit still applies.
        let (status, _) = parts(update_pantry_item(State(pool.clone()), Path(id), Json(item("Basmati", None))).await).await;
        assert_eq!(status, StatusCode::OK);

        // Expenses work the same way.
        let eid = sqlx::query("INSERT INTO expenses (title, amount, category, date) VALUES ('Shop', 10, 'Groceries', '2026-11-27')")
            .execute(&pool).await.unwrap().last_insert_rowid();
        let exp = |title: &str, version| Expense { id: 0, title: title.into(), amount: 10.0, category: "Groceries".into(), date: "2026-11-27".into(), version };
        let (status, _) = parts(update_expense(State(pool.clone()), Path(eid), Json(exp("Big shop", Some(1)))).await).await;
        assert_eq!(status, StatusCode::OK);
        let (status, Json(body)) = parts(update_expense(State(pool.clone()), Path(eid), Json(exp("Small shop", Some(1)))).await).await;
        assert_eq!((status, body["current"]["title"].as_str()), (StatusCode::CONFLICT, Some("Big shop")));

        // Missing rows are still 404, not 409.
        let (status, _) = parts(update_pantry_item(State(pool.clone()), Path(9999), Json(item("x", Some(1)))).await).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn validates_categories_settings_and_bounds() {
        let pool = test_pool().await;

        // Invalid budget category & negative amount rejected; valid normalized.
        let res = put_budget(State(pool.clone()), Path("Bogus".into()), Json(BudgetUpdate { amount: 100.0 }))
            .await
            .into_response();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
        let res = put_budget(State(pool.clone()), Path("Groceries".into()), Json(BudgetUpdate { amount: -1.0 }))
            .await
            .into_response();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
        let res = put_budget(State(pool.clone()), Path(" groceries ".into()), Json(BudgetUpdate { amount: 500.0 }))
            .await
            .into_response();
        assert_eq!(res.status(), StatusCode::OK);
        let cat: String = sqlx::query_scalar("SELECT category FROM budgets").fetch_one(&pool).await.unwrap();
        assert_eq!(cat, "Groceries");

        // Invalid expense/chore categories rejected.
        let res = add_expense(
            State(pool.clone()),
            Json(Expense { id: 0, title: "Coffee".into(), amount: 50.0, category: "Unknown".into(), date: "2026-11-26".into(), version: None }),
        )
        .await
        .into_response();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);

        let res = add_chore(
            State(pool.clone()),
            Json(Chore {
                id: 0,
                title: "Power bill".into(),
                description: None,
                assigned_to: "Sushil".into(),
                priority: "high".into(),
                status: "todo".into(),
                points: 1,
                due_date: Some("2026-11-26".into()),
                amount: Some(500.0),
                category: Some("InvalidCat".into()),
                expense_id: None,
                repeat: None,
                repeat_day: None,
                next_id: None,
            }),
        )
        .await
        .into_response();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);

        // put_settings trims before checking length/chars.
        let mut s = HashMap::new();
        s.insert("currency".into(), " USD ".into());
        let res = put_settings(State(pool.clone()), Json(s)).await.into_response();
        assert_eq!(res.status(), StatusCode::OK);
        let cur: String = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'currency'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(cur, "USD");

        // Pantry batch clamps topped-up quantity at 1e9.
        let res = add_pantry_batch(
            State(pool.clone()),
            Json(PantryBatch {
                expense_id: None,
                items: vec![
                    PantryItem { id: 0, name: "Sugar".into(), quantity: 9e8, unit: "g".into(), expires_on: None, expense_id: None, low_threshold: None, version: None },
                    PantryItem { id: 0, name: "Sugar".into(), quantity: 5e8, unit: "g".into(), expires_on: None, expense_id: None, low_threshold: None, version: None },
                ],
            }),
        )
        .await
        .into_response();
        assert_eq!(res.status(), StatusCode::OK);
        let qty: f64 = sqlx::query_scalar("SELECT quantity FROM pantry_items WHERE name = 'Sugar'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(qty, 1e9);

        // Receipt normalization enforces known category and caps title length.
        let long_title = "A".repeat(250);
        let receipt = normalize_receipt(&json!({
            "title": long_title,
            "amount": "₹120.50",
            "category": "WeirdCategory",
            "date": "2026-11-26",
            "items": [{ "name": "Milk", "quantity": 2, "unit": "L" }],
        }));
        assert_eq!(receipt["title"].as_str().unwrap().len(), 200);
        assert_eq!(receipt["category"], "Other");

        // AI image validation accepts raw or image/* data URLs and rejects invalid/non-image data.
        assert_eq!(validate_image_base64("data:image/jpeg;base64,/9j/4AAQ").unwrap(), "/9j/4AAQ");
        assert!(validate_image_base64("data:text/html;base64,PGh0bWw+").is_err());
        assert!(validate_image_base64("not valid base64!!").is_err());
    }

    #[tokio::test]
    async fn meals_and_expenses_support_date_window_and_pagination() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO expenses (title, amount, category, date) VALUES ('Oct', 10.0, 'Other', '2026-10-31'), ('Nov1', 20.0, 'Groceries', '2026-11-05'), ('Nov2', 30.0, 'Groceries', '2026-11-20'), ('Dec', 40.0, 'Other', '2026-12-01')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO meal_plan (date, slot, title) VALUES ('2026-10-31', 'dinner', 'Pasta'), ('2026-11-10', 'lunch', 'Dal'), ('2026-12-02', 'breakfast', 'Poha')")
            .execute(&pool)
            .await
            .unwrap();

        // Month filter on expenses
        let res = get_expenses(State(pool.clone()), Query(DateQuery { month: Some("2026-11".into()), ..Default::default() }))
            .await
            .into_response();
        assert_eq!(res.status(), StatusCode::OK);
        let body = axum::body::to_bytes(res.into_body(), 1024 * 1024).await.unwrap();
        let rows: Vec<Expense> = serde_json::from_slice(&body).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].title, "Nov2");

        // Pagination
        let res = get_expenses(State(pool.clone()), Query(DateQuery { limit: Some(1), offset: Some(1), ..Default::default() }))
            .await
            .into_response();
        let body = axum::body::to_bytes(res.into_body(), 1024 * 1024).await.unwrap();
        let rows: Vec<Expense> = serde_json::from_slice(&body).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].title, "Nov2");

        // Range filter on meals
        let res = get_meals(State(pool.clone()), Query(DateQuery { from: Some("2026-11-01".into()), to: Some("2026-11-30".into()), ..Default::default() }))
            .await
            .into_response();
        assert_eq!(res.status(), StatusCode::OK);
        let body = axum::body::to_bytes(res.into_body(), 1024 * 1024).await.unwrap();
        let meals: Vec<Meal> = serde_json::from_slice(&body).unwrap();
        assert_eq!(meals.len(), 1);
        assert_eq!(meals[0].title, "Dal");

        // Invalid month rejected
        let res = get_expenses(State(pool), Query(DateQuery { month: Some("2026-13".into()), ..Default::default() }))
            .await
            .into_response();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn edit_chore_bill_and_expense_sync() {
        let pool = test_pool().await;

        let bill_id = sqlx::query(
            "INSERT INTO chores (title, assigned_to, priority, status, points, due_date, amount, category) \
             VALUES ('Water', 'Sam', 'high', 'todo', 1, '2026-11-10', 40.0, 'Utilities')",
        )
        .execute(&pool)
        .await
        .unwrap()
        .last_insert_rowid();

        // Mark paid so an expense is created.
        assert!(apply_chore_update(&pool, bill_id, &ChoreUpdate { status: Some("done".into()), ..Default::default() }).await.unwrap());
        let expense_id: Option<i64> = sqlx::query_scalar("SELECT expense_id FROM chores WHERE id = ?").bind(bill_id).fetch_one(&pool).await.unwrap();
        let expense_id = expense_id.expect("paid bill creates expense");

        // Editing bill updates linked expense.
        let res = update_chore(
            State(pool.clone()),
            Path(bill_id),
            Json(ChoreUpdate {
                title: Some("City Water".into()),
                amount: Some(55.5),
                category: Some("household".into()),
                ..Default::default()
            }),
        )
        .await
        .into_response();
        assert_eq!(res.status(), StatusCode::OK);
        let exp: Expense = sqlx::query_as("SELECT * FROM expenses WHERE id = ?").bind(expense_id).fetch_one(&pool).await.unwrap();
        assert_eq!(exp.title, "City Water");
        assert!((exp.amount - 55.5).abs() < 1e-6);
        assert_eq!(exp.category, "Household");

        // Editing the expense via PUT /api/expenses/{id} syncs back to the bill.
        let res = update_expense(
            State(pool.clone()),
            Path(expense_id),
            Json(Expense { id: 0, title: "City Water Corrected".into(), amount: 60.0, category: "utilities".into(), date: "2026-11-12".into(), version: None }),
        )
        .await
        .into_response();
        assert_eq!(res.status(), StatusCode::OK);
        let bill: Chore = sqlx::query_as("SELECT * FROM chores WHERE id = ?").bind(bill_id).fetch_one(&pool).await.unwrap();
        assert_eq!(bill.title, "City Water Corrected");
        assert!((bill.amount.unwrap() - 60.0).abs() < 1e-6);
        assert_eq!(bill.category.as_deref(), Some("Utilities"));

        // Pantry low_threshold persisted & validated across create and edit.
        let bad = add_pantry_item(
            State(pool.clone()),
            Json(PantryItem {
                id: 0,
                name: "Flour".into(),
                quantity: 500.0,
                unit: "g".into(),
                expires_on: None,
                expense_id: None,
                low_threshold: Some(-5.0),
                version: None,
            }),
        )
        .await
        .into_response();
        assert_eq!(bad.status(), StatusCode::BAD_REQUEST);

        let ok = add_pantry_item(
            State(pool.clone()),
            Json(PantryItem {
                id: 0,
                name: "Flour".into(),
                quantity: 500.0,
                unit: "g".into(),
                expires_on: None,
                expense_id: None,
                low_threshold: Some(250.0),
                version: None,
            }),
        )
        .await
        .into_response();
        assert_eq!(ok.status(), StatusCode::CREATED);
        let items: Vec<PantryItem> = sqlx::query_as("SELECT * FROM pantry_items WHERE name = 'Flour'").fetch_all(&pool).await.unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].low_threshold, Some(250.0));
    }

    #[tokio::test]
    async fn put_budget_pantry_router_and_chore_repeat_edge_cases() {
        use axum::body::Body;
        use tower::Service;

        let pool = test_pool().await;

        // End-to-end Router PUT /api/pantry/{id} with validation & persistence.
        let pid = sqlx::query("INSERT INTO pantry_items (name, quantity, unit) VALUES ('Oats', 2.0, 'kg')")
            .execute(&pool)
            .await
            .unwrap()
            .last_insert_rowid();
        let mut app = app_router(pool.clone());
        let req = axum::http::Request::builder()
            .method(axum::http::Method::PUT)
            .uri(format!("/pantry/{pid}"))
            .header(axum::http::header::CONTENT_TYPE, "application/json")
            .body(Body::from(r#"{"name":"Rolled Oats","quantity":1.5,"unit":"kg","expires_on":"2026-12-31","low_threshold":0.5}"#))
            .unwrap();
        std::future::poll_fn(|cx| Service::<axum::http::Request<Body>>::poll_ready(&mut app, cx)).await.unwrap();
        let res = Service::call(&mut app, req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let oat: PantryItem = sqlx::query_as("SELECT * FROM pantry_items WHERE id = ?").bind(pid).fetch_one(&pool).await.unwrap();
        assert_eq!(oat.name, "Rolled Oats");
        assert_eq!(oat.low_threshold, Some(0.5));

        // put_budget removes budget when set to 0 and rejects non-finite values.
        assert_eq!(put_budget(State(pool.clone()), Path("Groceries".into()), Json(BudgetUpdate { amount: 250.0 })).await.into_response().status(), StatusCode::OK);
        assert_eq!(put_budget(State(pool.clone()), Path("Groceries".into()), Json(BudgetUpdate { amount: 0.0 })).await.into_response().status(), StatusCode::OK);
        let cnt: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM budgets WHERE category = 'Groceries'").fetch_one(&pool).await.unwrap();
        assert_eq!(cnt, 0);
        assert_eq!(put_budget(State(pool.clone()), Path("Groceries".into()), Json(BudgetUpdate { amount: f64::NAN })).await.into_response().status(), StatusCode::BAD_REQUEST);

        // Missing chore id returns Ok(false).
        assert!(!apply_chore_update(&pool, 99999, &ChoreUpdate { status: Some("done".into()), ..Default::default() }).await.unwrap());

        // Monthly repeat from Jan 31 clamps next occurrence to Feb 28 (non-leap year 2026) and keeps repeat_day = 31.
        let bid = sqlx::query(
            "INSERT INTO chores (title, assigned_to, priority, status, points, due_date, amount, category, repeat, repeat_day) \
             VALUES ('Rent', 'Sushil', 'high', 'todo', 1, '2026-01-31', 1200.0, 'Household', 'monthly', 31)",
        )
        .execute(&pool)
        .await
        .unwrap()
        .last_insert_rowid();

        assert!(apply_chore_update(&pool, bid, &ChoreUpdate { status: Some("done".into()), ..Default::default() }).await.unwrap());
        let parent: Chore = sqlx::query_as("SELECT * FROM chores WHERE id = ?").bind(bid).fetch_one(&pool).await.unwrap();
        let next_id = parent.next_id.expect("next repeat created");
        let next: Chore = sqlx::query_as("SELECT * FROM chores WHERE id = ?").bind(next_id).fetch_one(&pool).await.unwrap();
        assert_eq!(next.due_date.as_deref(), Some("2026-02-28"));
        assert_eq!(next.repeat_day, Some(31));
        assert!(parent.expense_id.is_some());

        // Undoing while untouched deletes both generated occurrence and linked expense.
        assert!(apply_chore_update(&pool, bid, &ChoreUpdate { status: Some("todo".into()), ..Default::default() }).await.unwrap());
        let next_exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM chores WHERE id = ?").bind(next_id).fetch_one(&pool).await.unwrap();
        assert_eq!(next_exists, 0);
        let parent: Chore = sqlx::query_as("SELECT * FROM chores WHERE id = ?").bind(bid).fetch_one(&pool).await.unwrap();
        assert_eq!(parent.expense_id, None);
        assert_eq!(parent.next_id, None);

        // Completing again, then rescheduling next occurrence -> undoing parent preserves rescheduled next occurrence.
        assert!(apply_chore_update(&pool, bid, &ChoreUpdate { status: Some("done".into()), ..Default::default() }).await.unwrap());
        let next_id2: i64 = sqlx::query_scalar("SELECT next_id FROM chores WHERE id = ?").bind(bid).fetch_one(&pool).await.unwrap();
        assert!(apply_chore_update(&pool, next_id2, &ChoreUpdate { due_date: Some("2026-03-01".into()), ..Default::default() }).await.unwrap());
        assert!(apply_chore_update(&pool, bid, &ChoreUpdate { status: Some("todo".into()), ..Default::default() }).await.unwrap());
        let kept: Option<String> = sqlx::query_scalar("SELECT due_date FROM chores WHERE id = ?").bind(next_id2).fetch_optional(&pool).await.unwrap();
        assert_eq!(kept.as_deref(), Some("2026-03-01"));

        // Chores can omit points in JSON and store/update canonical chore categories.
        let req = axum::http::Request::builder()
            .method(axum::http::Method::POST)
            .uri("/chores")
            .header(axum::http::header::CONTENT_TYPE, "application/json")
            .body(Body::from(r#"{"title":"Mop floor","assigned_to":"Alex","priority":"medium","status":"todo","category":"cleaning"}"#))
            .unwrap();
        std::future::poll_fn(|cx| Service::<axum::http::Request<Body>>::poll_ready(&mut app, cx)).await.unwrap();
        let res = Service::call(&mut app, req).await.unwrap();
        assert_eq!(res.status(), StatusCode::CREATED);
        let chore_cat: Option<String> = sqlx::query_scalar("SELECT category FROM chores WHERE title = 'Mop floor'").fetch_one(&pool).await.unwrap();
        assert_eq!(chore_cat.as_deref(), Some("Cleaning"));

        let bad_req = axum::http::Request::builder()
            .method(axum::http::Method::POST)
            .uri("/chores")
            .header(axum::http::header::CONTENT_TYPE, "application/json")
            .body(Body::from(r#"{"title":"Bad cat","assigned_to":"Alex","priority":"medium","status":"todo","category":"NotACategory"}"#))
            .unwrap();
        std::future::poll_fn(|cx| Service::<axum::http::Request<Body>>::poll_ready(&mut app, cx)).await.unwrap();
        let bad_res = Service::call(&mut app, bad_req).await.unwrap();
        assert_eq!(bad_res.status(), StatusCode::BAD_REQUEST);
    }
}
