//! Remembered corrections for scanned items.
//!
//! Scans can't be retrained, but they can be corrected the same way twice
//! automatically. When an item's name or unit is changed in a scan review,
//! the text the scan read is saved with the household's version. Each later
//! scan looks every item up by what it read and applies the saved version.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{FromRow, SqlitePool};

use crate::routes::bad_request;

/// "Sabudana - Medium (Popular Essentials)" -> "sabudana medium popular essentials":
/// case, punctuation and spacing don't stop a match.
pub fn key(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_alphanumeric() { c.to_lowercase().next().unwrap_or(c) } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[derive(Debug, Serialize, FromRow)]
pub struct Correction {
    pub id: i64,
    pub source_text: String,
    pub name: String,
    pub unit: Option<String>,
    pub uses: i64,
    pub updated_at: String,
}

/// Applies remembered corrections to scanned items (`[{name, unit, source?}]`)
/// in place. Each item is looked up by what the scan read (`source`), then by
/// its suggested name. A corrected item is marked `"remembered": true`.
pub async fn apply(pool: &SqlitePool, items: &mut [Value]) {
    for item in items.iter_mut() {
        let candidates: Vec<String> = [item["source"].as_str(), item["name"].as_str()]
            .into_iter()
            .flatten()
            .map(key)
            .filter(|k| !k.is_empty())
            .collect();
        for k in candidates {
            let found: Option<(i64, String, Option<String>)> =
                match sqlx::query_as("SELECT id, name, unit FROM item_corrections WHERE source = ?").bind(&k).fetch_optional(pool).await {
                    Ok(f) => f,
                    Err(e) => {
                        tracing::warn!("looking up a scan correction: {e}");
                        return;
                    }
                };
            if let Some((id, name, unit)) = found {
                item["name"] = json!(name);
                if let Some(u) = unit.filter(|u| !u.is_empty()) {
                    item["unit"] = json!(u);
                }
                item["remembered"] = json!(true);
                let _ = sqlx::query("UPDATE item_corrections SET uses = uses + 1 WHERE id = ?").bind(id).execute(pool).await;
                break;
            }
        }
    }
}

#[derive(Deserialize)]
pub struct CorrectionInput {
    /// What the scan read.
    pub source: String,
    /// What it should be.
    pub name: String,
    #[serde(default)]
    pub unit: Option<String>,
}

#[derive(Deserialize)]
pub struct Batch {
    pub items: Vec<CorrectionInput>,
}

/// Saves corrections (new ones, or a newer version of one already kept).
pub async fn save(State(pool): State<SqlitePool>, Json(batch): Json<Batch>) -> impl IntoResponse {
    if batch.items.len() > 200 {
        return bad_request("too many corrections at once");
    }
    let mut saved = 0;
    for c in &batch.items {
        let source = key(&c.source);
        let name = c.name.trim();
        if source.is_empty() || name.is_empty() || name.len() > 200 || c.source.len() > 500 {
            continue;
        }
        // Correcting something to exactly what was read teaches nothing.
        let unit = c.unit.as_deref().map(str::trim).filter(|u| !u.is_empty() && u.len() <= 30);
        if key(name) == source && unit.is_none() {
            continue;
        }
        let res = sqlx::query(
            "INSERT INTO item_corrections (source, source_text, name, unit) VALUES (?, ?, ?, ?) \
             ON CONFLICT(source) DO UPDATE SET name = excluded.name, unit = excluded.unit, updated_at = datetime('now')",
        )
        .bind(&source)
        .bind(c.source.trim())
        .bind(name)
        .bind(unit)
        .execute(&pool)
        .await;
        match res {
            Ok(_) => saved += 1,
            Err(e) => {
                tracing::error!("saving a scan correction: {e}");
                return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Failed to remember corrections" })));
            }
        }
    }
    (StatusCode::OK, Json(json!({ "saved": saved })))
}

pub async fn list(State(pool): State<SqlitePool>) -> impl IntoResponse {
    match sqlx::query_as::<_, Correction>(
        "SELECT id, source_text, name, unit, uses, updated_at FROM item_corrections ORDER BY updated_at DESC, id DESC",
    )
    .fetch_all(&pool)
    .await
    {
        Ok(rows) => (StatusCode::OK, Json(json!(rows))),
        Err(e) => {
            tracing::error!("listing scan corrections: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Failed to load corrections" })))
        }
    }
}

pub async fn remove(State(pool): State<SqlitePool>, Path(id): Path<i64>) -> impl IntoResponse {
    match sqlx::query("DELETE FROM item_corrections WHERE id = ?").bind(id).execute(&pool).await {
        Ok(r) if r.rows_affected() > 0 => (StatusCode::OK, Json(json!({ "status": "deleted" }))),
        Ok(_) => (StatusCode::NOT_FOUND, Json(json!({ "error": "Already removed" }))),
        Err(e) => {
            tracing::error!("removing a scan correction: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Failed to remove correction" })))
        }
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

    #[test]
    fn keys_ignore_case_and_punctuation() {
        assert_eq!(key("Sabudana - Medium (Popular Essentials)"), "sabudana medium popular essentials");
        assert_eq!(key("  ONION  (Eerulli) "), "onion eerulli");
    }

    #[tokio::test]
    async fn corrections_apply_to_later_scans() {
        let pool = pool().await;
        let batch = Batch {
            items: vec![
                CorrectionInput { source: "Popular Essentials Sabudana - Medium".into(), name: "Sabudana".into(), unit: Some("pack".into()) },
                CorrectionInput { source: "Onion".into(), name: "onion".into(), unit: None }, // same as read: ignored
            ],
        };
        let res = save(State(pool.clone()), Json(batch)).await.into_response();
        assert_eq!(res.status(), StatusCode::OK);

        let mut items = vec![
            json!({"name": "Sabudana - Medium", "quantity": 3.0, "unit": "pcs", "source": "Popular Essentials  Sabudana - medium"}),
            json!({"name": "Onion", "quantity": 1.0, "unit": "pcs", "source": "Onion (Eerulli)"}),
        ];
        apply(&pool, &mut items).await;
        assert_eq!(items[0]["name"], "Sabudana");
        assert_eq!(items[0]["unit"], "pack");
        assert_eq!(items[0]["quantity"], 3.0);
        assert_eq!(items[0]["remembered"], true);
        assert!(items[1].get("remembered").is_none());

        let uses: i64 = sqlx::query_scalar("SELECT uses FROM item_corrections").fetch_one(&pool).await.unwrap();
        assert_eq!(uses, 1);
    }
}
