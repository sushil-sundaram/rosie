//! Live sync: every successful write is announced on `/events` (Server-Sent
//! Events) so other open screens can refresh straight away.

use axum::{
    extract::{ConnectInfo, Request, State},
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
    collections::HashMap,
    convert::Infallible,
    net::{IpAddr, SocketAddr},
    sync::{Mutex, OnceLock},
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

/// Open live-update streams. A household needs a handful; per-IP and total caps
/// stop one client from starving others.
const MAX_STREAMS: usize = 32;
const MAX_STREAMS_PER_IP: usize = 6;

#[derive(Default)]
struct StreamState {
    total: usize,
    per_ip: HashMap<IpAddr, usize>,
}

fn stream_state() -> &'static Mutex<StreamState> {
    static STATE: OnceLock<Mutex<StreamState>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(StreamState::default()))
}

struct StreamSlot {
    ip: Option<IpAddr>,
}

impl StreamSlot {
    fn acquire(ip: Option<IpAddr>) -> Option<Self> {
        let mut guard = stream_state().lock().ok()?;
        if guard.total >= MAX_STREAMS {
            return None;
        }
        if let Some(addr) = ip {
            let count = guard.per_ip.get(&addr).copied().unwrap_or(0);
            if count >= MAX_STREAMS_PER_IP {
                return None;
            }
            guard.per_ip.insert(addr, count + 1);
        }
        guard.total += 1;
        Some(Self { ip })
    }
}

impl Drop for StreamSlot {
    fn drop(&mut self) {
        if let Ok(mut guard) = stream_state().lock() {
            guard.total = guard.total.saturating_sub(1);
            if let Some(addr) = self.ip {
                if let Some(count) = guard.per_ip.get_mut(&addr) {
                    *count = count.saturating_sub(1);
                    if *count == 0 {
                        guard.per_ip.remove(&addr);
                    }
                }
            }
        }
    }
}

async fn events(State(changes): State<Changes>, req: Request) -> Response {
    let ip = req
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ci| ci.0.ip());
    let Some(slot) = StreamSlot::acquire(ip) else {
        return (StatusCode::SERVICE_UNAVAILABLE, "too many live connections").into_response();
    };
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    #[test]
    fn stream_slot_enforces_per_ip_limit() {
        let ip = IpAddr::V4(Ipv4Addr::new(192, 168, 1, 99));
        let mut slots = Vec::new();
        for _ in 0..MAX_STREAMS_PER_IP {
            slots.push(StreamSlot::acquire(Some(ip)).expect("within per-ip limit"));
        }
        assert!(StreamSlot::acquire(Some(ip)).is_none());
        let other = IpAddr::V4(Ipv4Addr::new(192, 168, 1, 100));
        let other_slot = StreamSlot::acquire(Some(other));
        assert!(other_slot.is_some());
        drop(other_slot);
        slots.pop();
        assert!(StreamSlot::acquire(Some(ip)).is_some());
    }
}
