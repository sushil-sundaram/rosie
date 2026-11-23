//! Live sync: every successful write is announced on `/events` (Server-Sent
//! Events) so other open screens can refresh straight away.

use axum::{
    extract::{Request, State},
    http::{Method, StatusCode},
    middleware::Next,
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::get,
    Router,
};
use serde_json::json;
use std::{
    convert::Infallible,
    sync::atomic::{AtomicUsize, Ordering},
    time::Duration,
};
use tokio::sync::broadcast;
use tokio_stream::{wrappers::BroadcastStream, StreamExt};

pub type Changes = broadcast::Sender<String>;

pub fn channel() -> Changes {
    broadcast::channel(64).0
}

pub fn router(changes: Changes) -> Router {
    Router::new().route("/events", get(events)).with_state(changes)
}

/// Open live-update streams. A household needs a handful; the cap stops a
/// misbehaving client from holding unlimited connections.
static STREAMS: AtomicUsize = AtomicUsize::new(0);
const MAX_STREAMS: usize = 32;

/// Decrements the stream count when the client disconnects and the stream is dropped.
struct StreamSlot;

impl Drop for StreamSlot {
    fn drop(&mut self) {
        STREAMS.fetch_sub(1, Ordering::Relaxed);
    }
}

async fn events(State(changes): State<Changes>) -> Response {
    if STREAMS.fetch_add(1, Ordering::Relaxed) >= MAX_STREAMS {
        STREAMS.fetch_sub(1, Ordering::Relaxed);
        return (StatusCode::SERVICE_UNAVAILABLE, "too many live connections").into_response();
    }
    let slot = StreamSlot;
    // A lagged receiver just means "something changed": still tell the client.
    let stream = BroadcastStream::new(changes.subscribe()).map(move |msg| {
        let _held = &slot;
        Ok::<_, Infallible>(Event::default().data(msg.unwrap_or_else(|_| json!({}).to_string())))
    });
    Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(20))).into_response()
}

/// After a successful write (anything but GET, excluding the read-only AI scans),
/// broadcast which client made it so that client can ignore its own echo.
pub async fn announce(State(changes): State<Changes>, req: Request, next: Next) -> Response {
    let path = req.uri().path();
    let read_only = ["/scan-photo", "/scan-receipt", "/import"].iter().any(|s| path.ends_with(s));
    let is_write = req.method() != Method::GET && req.method() != Method::OPTIONS && !read_only;
    let by = req
        .headers()
        .get("x-client-id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.chars().take(64).collect::<String>())
        .unwrap_or_default();
    let path = path.to_string();
    let res = next.run(req).await;
    if is_write && res.status().is_success() {
        let _ = changes.send(json!({ "by": by, "path": path }).to_string());
    }
    res.into_response()
}
