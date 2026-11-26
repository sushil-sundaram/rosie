//! Background job runner for long-running local AI scans (receipts, pantry
//! photos, and non-structured recipe imports) so mobile screen locks or tab
//! switches never drop an in-flight Ollama request.

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use ring::rand::{SecureRandom, SystemRandom};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    future::Future,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use crate::sync::Changes;

const MAX_JOBS: usize = 64;
const JOB_TTL: Duration = Duration::from_secs(30 * 60);

/// Caps concurrent + queued AI jobs so requests don't pile up unboundedly.
pub static AI_QUEUE: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(4);

#[derive(Clone)]
pub struct JobContext {
    pub store: Arc<JobStore>,
    pub changes: Changes,
}

impl JobContext {
    pub fn new(changes: Changes) -> Self {
        Self {
            store: Arc::new(JobStore::default()),
            changes,
        }
    }

    pub fn spawn<F>(&self, kind: &'static str, client_id: String, fut: F) -> Response
    where
        F: Future<Output = Result<Value, (StatusCode, Json<Value>)>> + Send + 'static,
    {
        let Ok(permit) = AI_QUEUE.try_acquire() else {
            return (
                StatusCode::TOO_MANY_REQUESTS,
                Json(json!({ "error": "Too many AI scans queued. Try again in a moment." })),
            )
                .into_response();
        };

        let id = self.store.insert_pending(kind);
        let job_id = id.clone();
        let store = self.store.clone();
        let changes = self.changes.clone();

        tokio::spawn(async move {
            let _permit = permit;
            let outcome = match fut.await {
                Ok(v) => Ok(v),
                Err((_, Json(err_val))) => {
                    let msg = err_val["error"]
                        .as_str()
                        .unwrap_or("The local AI returned an error. Try again.")
                        .to_string();
                    Err(msg)
                }
            };
            let status = if outcome.is_ok() { "done" } else { "error" };
            store.finish(&job_id, outcome);
            let _ = changes.send(
                json!({
                    "type": "job",
                    "job_id": job_id,
                    "kind": kind,
                    "status": status,
                    "by": client_id,
                })
                .to_string(),
            );
        });

        (
            StatusCode::ACCEPTED,
            Json(json!({
                "job_id": id,
                "kind": kind,
                "status": "pending",
            })),
        )
            .into_response()
    }
}

#[derive(Clone)]
struct JobRecord {
    kind: &'static str,
    status: &'static str,
    result: Option<Value>,
    error: Option<String>,
    created_at: Instant,
    finished_at: Option<Instant>,
}

#[derive(Default)]
pub struct JobStore {
    jobs: Mutex<HashMap<String, JobRecord>>,
}

impl JobStore {
    fn insert_pending(&self, kind: &'static str) -> String {
        let id = random_job_id();
        if let Ok(mut map) = self.jobs.lock() {
            prune_old(&mut map);
            map.insert(
                id.clone(),
                JobRecord {
                    kind,
                    status: "pending",
                    result: None,
                    error: None,
                    created_at: Instant::now(),
                    finished_at: None,
                },
            );
        }
        id
    }

    fn finish(&self, id: &str, outcome: Result<Value, String>) {
        if let Ok(mut map) = self.jobs.lock() {
            if let Some(rec) = map.get_mut(id) {
                rec.finished_at = Some(Instant::now());
                match outcome {
                    Ok(v) => {
                        rec.status = "done";
                        rec.result = Some(v);
                    }
                    Err(msg) => {
                        rec.status = "error";
                        rec.error = Some(msg);
                    }
                }
            }
        }
    }

    fn get(&self, id: &str) -> Option<Value> {
        let map = self.jobs.lock().ok()?;
        let rec = map.get(id)?;
        Some(json!({
            "job_id": id,
            "kind": rec.kind,
            "status": rec.status,
            "result": rec.result,
            "error": rec.error,
        }))
    }
}

fn prune_old(map: &mut HashMap<String, JobRecord>) {
    let now = Instant::now();
    map.retain(|_, r| match r.finished_at {
        Some(t) => now.duration_since(t) < JOB_TTL,
        None => now.duration_since(r.created_at) < JOB_TTL,
    });
    while map.len() >= MAX_JOBS {
        let oldest = map
            .iter()
            .filter(|(_, r)| r.finished_at.is_some())
            .min_by_key(|(_, r)| r.created_at)
            .or_else(|| map.iter().min_by_key(|(_, r)| r.created_at))
            .map(|(k, _)| k.clone());
        match oldest {
            Some(k) => {
                map.remove(&k);
            }
            None => break,
        }
    }
}

fn random_job_id() -> String {
    let mut bytes = [0u8; 16];
    let rng = SystemRandom::new();
    let _ = rng.fill(&mut bytes);
    hex::encode(bytes)
}

pub fn client_id_from(headers: &HeaderMap) -> String {
    headers
        .get("x-client-id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.chars().take(64).collect())
        .unwrap_or_default()
}

pub fn router(store: Arc<JobStore>) -> Router {
    Router::new().route("/jobs/{id}", get(get_job)).with_state(store)
}

async fn get_job(State(store): State<Arc<JobStore>>, Path(id): Path<String>) -> Response {
    match store.get(&id) {
        Some(v) => (StatusCode::OK, Json(v)).into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Scan job not found or expired" })),
        )
            .into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn job_lifecycle_records_completion_and_error() {
        let tx = crate::sync::channel();
        let mut rx = tx.subscribe();
        let ctx = JobContext::new(tx);

        let res = ctx.spawn("receipt", "tab-1".into(), async { Ok(json!({ "title": "Store" })) });
        assert_eq!(res.status(), StatusCode::ACCEPTED);
        let body = axum::body::to_bytes(res.into_body(), 4096).await.unwrap();
        let v: Value = serde_json::from_slice(&body).unwrap();
        let id = v["job_id"].as_str().unwrap().to_string();

        // Wait for SSE event
        let msg = rx.recv().await.unwrap();
        let ev: Value = serde_json::from_str(&msg).unwrap();
        assert_eq!(ev["type"], "job");
        assert_eq!(ev["job_id"], id);
        assert_eq!(ev["status"], "done");
        assert_eq!(ev["by"], "tab-1");

        let stored = ctx.store.get(&id).unwrap();
        assert_eq!(stored["status"], "done");
        assert_eq!(stored["result"]["title"], "Store");

        // Error case
        let err_res = ctx.spawn("pantry", "tab-1".into(), async {
            Err((StatusCode::BAD_GATEWAY, Json(json!({ "error": "AI failed" }))))
        });
        assert_eq!(err_res.status(), StatusCode::ACCEPTED);
        let body = axum::body::to_bytes(err_res.into_body(), 4096).await.unwrap();
        let err_id = serde_json::from_slice::<Value>(&body).unwrap()["job_id"].as_str().unwrap().to_string();
        let _ = rx.recv().await.unwrap();
        let stored_err = ctx.store.get(&err_id).unwrap();
        assert_eq!(stored_err["status"], "error");
        assert_eq!(stored_err["error"], "AI failed");
    }
}
