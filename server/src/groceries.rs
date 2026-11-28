//! Groceries list: what to buy.
//!
//! Items come from typing them in, from a recipe or the meal plan (the web app
//! sends only what the pantry doesn't already cover), or from low stock.
//! Adding an item that is already on the list merges with it instead of
//! duplicating it, and adding the same recipe twice doesn't double it.
//! Ticked items are in the cart; "to pantry" moves them into the pantry
//! (topping up existing stock) and takes them off the list.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{FromRow, SqliteConnection, SqlitePool};

use crate::routes::{bad_request, conflict, merge_into_pantry, valid_amount, valid_text, NewStock};

#[derive(Debug, Serialize, FromRow)]
pub struct GroceryItem {
    pub id: i64,
    pub name: String,
    /// 0 when no amount was given ("salt").
    pub quantity: f64,
    pub unit: String,
    /// Recipes that asked for it, "; "-separated.
    pub note: String,
    pub checked: bool,
    pub created_at: String,
    pub version: i64,
}

#[derive(Debug, Deserialize)]
pub struct GroceryInput {
    pub name: String,
    #[serde(default)]
    pub quantity: f64,
    #[serde(default)]
    pub unit: String,
    /// The recipe this is for, if any.
    #[serde(default)]
    pub source: Option<String>,
}

const MAX_ITEMS: usize = 200;
const NOTE_SEP: &str = "; ";

fn server_error(what: &str, e: sqlx::Error) -> (StatusCode, Json<Value>) {
    tracing::error!("{what}: {e}");
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": format!("Failed to {what}") })))
}

fn check_input(it: &GroceryInput) -> Result<(), &'static str> {
    if !valid_text(&it.name) || it.name.len() > 200 {
        return Err("an item needs a name");
    }
    if !valid_amount(it.quantity) || it.unit.trim().len() > 30 {
        return Err("quantity must be 0 or more");
    }
    if it.source.as_deref().is_some_and(|s| s.len() > 200) {
        return Err("source is too long");
    }
    Ok(())
}

/// What adding one item did.
#[derive(Debug, PartialEq)]
enum Added {
    New(i64),
    Merged(i64),
    /// Already on the list for this same recipe: left as it is.
    Already(i64),
}

/// Adds one item, merging with an unticked item of the same name:
/// - same unit (or either has no amount): quantities add up and the recipe is
///   noted, unless that recipe already put it there;
/// - different units (500 g vs 2 cups) can't be added, so it gets its own row.
async fn add_one(conn: &mut SqliteConnection, it: &GroceryInput) -> Result<Added, sqlx::Error> {
    let name = it.name.trim();
    let unit = it.unit.trim();
    let qty = (it.quantity.min(1e9) * 1000.0).round() / 1000.0;
    let source = it.source.as_deref().map(str::trim).filter(|s| !s.is_empty());

    let candidates: Vec<(i64, f64, String, String)> = sqlx::query_as(
        "SELECT id, quantity, unit, note FROM grocery_items \
         WHERE checked = 0 AND lower(trim(name)) = lower(?) ORDER BY id",
    )
    .bind(name)
    .fetch_all(&mut *conn)
    .await?;

    let compatible = candidates.into_iter().find(|(_, q, u, _)| u.eq_ignore_ascii_case(unit) || *q == 0.0 || qty == 0.0);
    let Some((id, have_qty, have_unit, note)) = compatible else {
        let id = sqlx::query("INSERT INTO grocery_items (name, quantity, unit, note) VALUES (?, ?, ?, ?)")
            .bind(name)
            .bind(qty)
            .bind(unit)
            .bind(source.unwrap_or(""))
            .execute(&mut *conn)
            .await?
            .last_insert_rowid();
        return Ok(Added::New(id));
    };

    let sources: Vec<&str> = note.split(NOTE_SEP).filter(|s| !s.is_empty()).collect();
    if source.is_some_and(|s| sources.iter().any(|n| n.eq_ignore_ascii_case(s))) {
        return Ok(Added::Already(id));
    }
    let new_note = match source {
        Some(s) if !note.is_empty() => format!("{note}{NOTE_SEP}{s}"),
        Some(s) => s.to_string(),
        None => note.clone(),
    };
    // An amount wins over "some"; same units add up.
    let (new_qty, new_unit) = if have_qty == 0.0 {
        (qty, if qty > 0.0 { unit.to_string() } else { have_unit })
    } else if qty == 0.0 {
        (have_qty, have_unit)
    } else {
        (((have_qty + qty).min(1e9) * 1000.0).round() / 1000.0, have_unit)
    };
    sqlx::query("UPDATE grocery_items SET quantity = ?, unit = ?, note = ?, version = version + 1 WHERE id = ?")
        .bind(new_qty)
        .bind(new_unit)
        .bind(clip(&new_note, 500))
        .bind(id)
        .execute(&mut *conn)
        .await?;
    Ok(Added::Merged(id))
}

fn clip(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_string()
}

pub async fn list(State(pool): State<SqlitePool>) -> impl IntoResponse {
    match sqlx::query_as::<_, GroceryItem>("SELECT * FROM grocery_items ORDER BY checked, id").fetch_all(&pool).await {
        Ok(items) => (StatusCode::OK, Json(json!(items))),
        Err(e) => server_error("load the groceries list", e),
    }
}

pub async fn add(State(pool): State<SqlitePool>, Json(it): Json<GroceryInput>) -> impl IntoResponse {
    if let Err(msg) = check_input(&it) {
        return bad_request(msg);
    }
    let result: Result<Added, sqlx::Error> = async {
        let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
        let added = add_one(&mut tx, &it).await?;
        tx.commit().await?;
        Ok(added)
    }
    .await;
    match result {
        Ok(Added::New(id)) => (StatusCode::CREATED, Json(json!({ "status": "created", "id": id }))),
        Ok(Added::Merged(id)) => (StatusCode::OK, Json(json!({ "status": "merged", "id": id }))),
        Ok(Added::Already(id)) => (StatusCode::OK, Json(json!({ "status": "already", "id": id }))),
        Err(e) => server_error("add to the groceries list", e),
    }
}

#[derive(Deserialize)]
pub struct Batch {
    pub items: Vec<GroceryInput>,
}

/// Several items at once (a recipe's or the week's missing ingredients).
/// Invalid entries are skipped. Returns how many were added, merged into
/// existing rows, or already listed for the same recipe.
pub async fn add_batch(State(pool): State<SqlitePool>, Json(batch): Json<Batch>) -> impl IntoResponse {
    if batch.items.len() > MAX_ITEMS {
        return bad_request("too many items at once");
    }
    let result: Result<(usize, usize, usize), sqlx::Error> = async {
        let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
        let (mut added, mut merged, mut already) = (0, 0, 0);
        for it in batch.items.iter().filter(|i| check_input(i).is_ok()) {
            match add_one(&mut tx, it).await? {
                Added::New(_) => added += 1,
                Added::Merged(_) => merged += 1,
                Added::Already(_) => already += 1,
            }
        }
        tx.commit().await?;
        Ok((added, merged, already))
    }
    .await;
    match result {
        Ok((added, merged, already)) => (StatusCode::OK, Json(json!({ "added": added, "merged": merged, "already": already }))),
        Err(e) => server_error("add to the groceries list", e),
    }
}

#[derive(Deserialize)]
pub struct GroceryUpdate {
    #[serde(default)]
    pub checked: Option<bool>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub quantity: Option<f64>,
    #[serde(default)]
    pub unit: Option<String>,
    /// For edits of name/amount: the version the editor started from.
    #[serde(default)]
    pub version: Option<i64>,
}

/// Tick/untick, or edit name and amount. Ticking is always safe to repeat;
/// edits sent with a stale version get 409 like other edits.
pub async fn update(State(pool): State<SqlitePool>, Path(id): Path<i64>, Json(u): Json<GroceryUpdate>) -> impl IntoResponse {
    if u.name.as_deref().is_some_and(|n| !valid_text(n) || n.len() > 200) {
        return bad_request("an item needs a name");
    }
    if u.quantity.is_some_and(|q| !valid_amount(q)) || u.unit.as_deref().is_some_and(|x| x.trim().len() > 30) {
        return bad_request("quantity must be 0 or more");
    }
    let edits = u.name.is_some() || u.quantity.is_some() || u.unit.is_some();
    let res = sqlx::query_scalar::<_, i64>(
        "UPDATE grocery_items SET \
           checked = COALESCE(?1, checked), \
           name = COALESCE(trim(?2), name), \
           quantity = COALESCE(?3, quantity), \
           unit = COALESCE(trim(?4), unit), \
           version = version + 1 \
         WHERE id = ?5 AND (?6 IS NULL OR NOT ?7 OR version = ?6) RETURNING version",
    )
    .bind(u.checked)
    .bind(u.name.as_deref())
    .bind(u.quantity.map(|q| (q.min(1e9) * 1000.0).round() / 1000.0))
    .bind(u.unit.as_deref())
    .bind(id)
    .bind(u.version)
    .bind(edits)
    .fetch_optional(&pool)
    .await;
    match res {
        Ok(Some(version)) => (StatusCode::OK, Json(json!({ "status": "updated", "version": version }))),
        Ok(None) => match sqlx::query_as::<_, GroceryItem>("SELECT * FROM grocery_items WHERE id = ?").bind(id).fetch_optional(&pool).await {
            Ok(Some(current)) => conflict(json!(current)),
            _ => (StatusCode::NOT_FOUND, Json(json!({ "error": "Already removed by someone else" }))),
        },
        Err(e) => server_error("update the groceries list", e),
    }
}

pub async fn remove(State(pool): State<SqlitePool>, Path(id): Path<i64>) -> impl IntoResponse {
    match sqlx::query("DELETE FROM grocery_items WHERE id = ?").bind(id).execute(&pool).await {
        Ok(r) if r.rows_affected() > 0 => (StatusCode::OK, Json(json!({ "status": "deleted" }))),
        Ok(_) => (StatusCode::NOT_FOUND, Json(json!({ "error": "Already removed by someone else" }))),
        Err(e) => server_error("remove from the groceries list", e),
    }
}

pub async fn clear_checked(State(pool): State<SqlitePool>) -> impl IntoResponse {
    match sqlx::query("DELETE FROM grocery_items WHERE checked = 1").execute(&pool).await {
        Ok(r) => (StatusCode::OK, Json(json!({ "removed": r.rows_affected() }))),
        Err(e) => server_error("clear the groceries list", e),
    }
}

#[derive(Deserialize, Default)]
pub struct ToPantry {
    /// Which items; all ticked items when left out.
    #[serde(default)]
    pub ids: Option<Vec<i64>>,
    /// Link the new stock to the expense it was bought with.
    #[serde(default)]
    pub expense_id: Option<i64>,
}

/// Bought: moves items into the pantry (topping up stock with the same name
/// and unit) and takes them off the list, in one transaction. An item without
/// an amount goes in as 1.
pub async fn to_pantry(State(pool): State<SqlitePool>, body: Option<Json<ToPantry>>) -> impl IntoResponse {
    let req = body.map(|Json(b)| b).unwrap_or_default();
    if req.ids.as_ref().is_some_and(|ids| ids.len() > MAX_ITEMS) {
        return bad_request("too many items at once");
    }
    let result: Result<(usize, usize, usize), sqlx::Error> = async {
        let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
        let items: Vec<GroceryItem> = match &req.ids {
            Some(ids) => {
                let mut v = Vec::new();
                for id in ids {
                    if let Some(it) = sqlx::query_as("SELECT * FROM grocery_items WHERE id = ?").bind(id).fetch_optional(&mut *tx).await? {
                        v.push(it);
                    }
                }
                v
            }
            None => sqlx::query_as("SELECT * FROM grocery_items WHERE checked = 1 ORDER BY id").fetch_all(&mut *tx).await?,
        };
        let expense_id: Option<i64> = match req.expense_id {
            Some(eid) => sqlx::query_scalar("SELECT id FROM expenses WHERE id = ?").bind(eid).fetch_optional(&mut *tx).await?,
            None => None,
        };
        let stock: Vec<NewStock> = items
            .iter()
            .map(|g| NewStock {
                name: g.name.clone(),
                quantity: if g.quantity > 0.0 { g.quantity } else { 1.0 },
                unit: if g.quantity > 0.0 || !g.unit.is_empty() { g.unit.clone() } else { "pcs".to_string() },
                expires_on: None,
            })
            .collect();
        let (added, topped) = merge_into_pantry(&mut tx, &stock, expense_id).await?;
        for g in &items {
            sqlx::query("DELETE FROM grocery_items WHERE id = ?").bind(g.id).execute(&mut *tx).await?;
        }
        tx.commit().await?;
        Ok((items.len(), added, topped))
    }
    .await;
    match result {
        Ok((moved, added, topped)) => (StatusCode::OK, Json(json!({ "moved": moved, "added": added, "topped_up": topped }))),
        Err(e) => server_error("move groceries into the pantry", e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn pool() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    fn item(name: &str, quantity: f64, unit: &str, source: Option<&str>) -> GroceryInput {
        GroceryInput { name: name.into(), quantity, unit: unit.into(), source: source.map(Into::into) }
    }

    async fn rows(pool: &SqlitePool) -> Vec<(String, f64, String, String)> {
        sqlx::query_as("SELECT name, quantity, unit, note FROM grocery_items ORDER BY id").fetch_all(pool).await.unwrap()
    }

    #[tokio::test]
    async fn merging_rules() {
        let pool = pool().await;
        let mut c = pool.acquire().await.unwrap();
        // Two recipes need onions: one row, amounts added, both noted.
        assert!(matches!(add_one(&mut c, &item("Onion", 2.0, "pcs", Some("Dal"))).await.unwrap(), Added::New(_)));
        assert!(matches!(add_one(&mut c, &item("onion ", 1.0, "PCS", Some("Poha"))).await.unwrap(), Added::Merged(_)));
        // The same recipe again changes nothing.
        assert!(matches!(add_one(&mut c, &item("Onion", 2.0, "pcs", Some("Dal"))).await.unwrap(), Added::Already(_)));
        // An amount replaces "some"; different units get their own row.
        add_one(&mut c, &item("Salt", 0.0, "", Some("Dal"))).await.unwrap();
        add_one(&mut c, &item("Salt", 1.0, "kg", None)).await.unwrap();
        add_one(&mut c, &item("Rice", 500.0, "g", None)).await.unwrap();
        add_one(&mut c, &item("Rice", 2.0, "cup", None)).await.unwrap();
        drop(c);
        assert_eq!(rows(&pool).await, vec![
            ("Onion".into(), 3.0, "pcs".into(), "Dal; Poha".into()),
            ("Salt".into(), 1.0, "kg".into(), "Dal".into()),
            ("Rice".into(), 500.0, "g".into(), "".into()),
            ("Rice".into(), 2.0, "cup".into(), "".into()),
        ]);
    }

    #[tokio::test]
    async fn bought_items_top_up_the_pantry() {
        let pool = pool().await;
        sqlx::query("INSERT INTO pantry_items (name, quantity, unit) VALUES ('Rice', 1, 'kg')").execute(&pool).await.unwrap();
        let mut c = pool.acquire().await.unwrap();
        let rice = match add_one(&mut c, &item("rice", 2.0, "kg", None)).await.unwrap() { Added::New(id) => id, other => panic!("{other:?}") };
        let salt = match add_one(&mut c, &item("Salt", 0.0, "", None)).await.unwrap() { Added::New(id) => id, other => panic!("{other:?}") };
        add_one(&mut c, &item("Milk", 1.0, "L", None)).await.unwrap(); // not ticked: stays
        drop(c);
        for id in [rice, salt] {
            let _ = update(State(pool.clone()), Path(id), Json(GroceryUpdate { checked: Some(true), name: None, quantity: None, unit: None, version: None })).await;
        }
        let res = to_pantry(State(pool.clone()), None).await.into_response();
        assert_eq!(res.status(), StatusCode::OK);

        let pantry: Vec<(String, f64, String)> =
            sqlx::query_as("SELECT name, quantity, unit FROM pantry_items ORDER BY id").fetch_all(&pool).await.unwrap();
        assert_eq!(pantry, vec![("Rice".into(), 3.0, "kg".into()), ("Salt".into(), 1.0, "pcs".into())]);
        let left: Vec<String> = sqlx::query_scalar("SELECT name FROM grocery_items").fetch_all(&pool).await.unwrap();
        assert_eq!(left, vec!["Milk".to_string()]);
    }

    #[tokio::test]
    async fn stale_edit_is_refused_but_ticking_is_not() {
        let pool = pool().await;
        let id = sqlx::query("INSERT INTO grocery_items (name, quantity, unit) VALUES ('Eggs', 6, 'pcs')").execute(&pool).await.unwrap().last_insert_rowid();
        let edit = |q, v| GroceryUpdate { checked: None, name: None, quantity: Some(q), unit: None, version: v };
        assert_eq!(update(State(pool.clone()), Path(id), Json(edit(12.0, Some(1)))).await.into_response().status(), StatusCode::OK);
        assert_eq!(update(State(pool.clone()), Path(id), Json(edit(18.0, Some(1)))).await.into_response().status(), StatusCode::CONFLICT);
        let tick = GroceryUpdate { checked: Some(true), name: None, quantity: None, unit: None, version: Some(1) };
        assert_eq!(update(State(pool.clone()), Path(id), Json(tick)).await.into_response().status(), StatusCode::OK);
        let qty: f64 = sqlx::query_scalar("SELECT quantity FROM grocery_items").fetch_one(&pool).await.unwrap();
        assert_eq!(qty, 12.0);
    }
}
