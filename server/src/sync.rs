//! Live sync: every successful write is announced on `/events` (Server-Sent
//! Events) so other open screens can refresh straight away.

use axum::{
    extract::{Request, State},
    http::Method,
    middleware::Next,
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::get,
    Router,
};
use serde_json::json;
use std::{convert::Infallible, time::Duration};
use tokio::sync::broadcast;
use tokio_stream::{wrappers::BroadcastStream, Stream, StreamExt};

pub type Changes = broadcast::Sender<String>;

pub fn channel() -> Changes {
    broadcast::channel(64).0
}

pub fn router(changes: Changes) -> Router {
    Router::new().route("/events", get(events)).with_state(changes)
}

async fn events(State(changes): State<Changes>) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    // A lagged receiver just means "something changed": still tell the client.
    let stream = BroadcastStream::new(changes.subscribe())
        .map(|msg| Ok(Event::default().data(msg.unwrap_or_else(|_| json!({}).to_string()))));
    Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(20)))
}

/// After a successful write (anything but GET, excluding the read-only AI scans),
/// broadcast which client made it so that client can ignore its own echo.
pub async fn announce(State(changes): State<Changes>, req: Request, next: Next) -> Response {
    let is_write = req.method() != Method::GET && req.method() != Method::OPTIONS && !req.uri().path().contains("scan")
        && !req.uri().path().ends_with("/import");
    let by = req
        .headers()
        .get("x-client-id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.chars().take(64).collect::<String>())
        .unwrap_or_default();
    let path = req.uri().path().to_string();
    let res = next.run(req).await;
    if is_write && res.status().is_success() {
        let _ = changes.send(json!({ "by": by, "path": path }).to_string());
    }
    res.into_response()
}
