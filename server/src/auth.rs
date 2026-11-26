//! Optional passphrase authentication using signed HttpOnly session cookies.
//!
//! Disabled by default so local-network setups work immediately; set
//! `ROSIE_PASSWORD` to require sign-in before reading or mutating `/api/*`.

use axum::{
    extract::{ConnectInfo, Request, State},
    http::{header, HeaderValue, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use ring::{
    digest, hmac,
    rand::{SecureRandom, SystemRandom},
};
use subtle::ConstantTimeEq;
use serde::Deserialize;
use serde_json::json;
use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    path::Path,
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use crate::guard;

const COOKIE_NAME: &str = "rosie_session";
const SESSION_TTL_SECS: u64 = 30 * 24 * 60 * 60;
const MAX_FAILURES: u32 = 5;
const LOCKOUT_SECS: u64 = 15 * 60;

pub struct AuthState {
    password_hash: Option<[u8; 32]>,
    hmac_key: hmac::Key,
    failures: Mutex<HashMap<IpAddr, (u32, Instant)>>,
}

impl AuthState {
    pub fn from_env(data_dir: Option<&Path>) -> Arc<Self> {
        let password = std::env::var("ROSIE_PASSWORD")
            .ok()
            .filter(|s| !s.is_empty());
        let secret_path = data_dir.map(|d| d.join(".session_secret"));
        Self::new(password, secret_path.as_deref())
    }

    pub fn new(password: Option<String>, secret_path: Option<&Path>) -> Arc<Self> {
        let password_hash = password.filter(|s| !s.is_empty()).map(|p| sha256_bytes(p.as_bytes()));
        let key_bytes = load_or_create_secret(secret_path);
        Arc::new(Self {
            password_hash,
            hmac_key: hmac::Key::new(hmac::HMAC_SHA256, &key_bytes),
            failures: Mutex::new(HashMap::new()),
        })
    }

    pub fn is_required(&self) -> bool {
        self.password_hash.is_some()
    }

    pub fn verify_password(&self, candidate: &str) -> bool {
        let Some(expected) = &self.password_hash else {
            return true;
        };
        let got = sha256_bytes(candidate.as_bytes());
        bool::from(expected.ct_eq(&got))
    }

    fn sign_session(&self, exp: u64) -> String {
        let exp_str = exp.to_string();
        let tag = hmac::sign(&self.hmac_key, exp_str.as_bytes());
        format!("{exp_str}.{}", hex::encode(tag.as_ref()))
    }

    fn verify_session(&self, token: &str, now: u64) -> bool {
        let Some((exp_str, tag_hex)) = token.split_once('.') else {
            return false;
        };
        let Ok(exp) = exp_str.parse::<u64>() else {
            return false;
        };
        if exp <= now {
            return false;
        }
        let Ok(tag) = hex::decode(tag_hex) else {
            return false;
        };
        hmac::verify(&self.hmac_key, exp_str.as_bytes(), &tag).is_ok()
    }

    fn is_authenticated(&self, req: &Request) -> bool {
        if !self.is_required() {
            return true;
        }
        let Some(cookie_hdr) = req.headers().get(header::COOKIE).and_then(|v| v.to_str().ok()) else {
            return false;
        };
        let now = unix_now();
        cookie_hdr.split(';').any(|part| {
            part.trim()
                .split_once('=')
                .is_some_and(|(k, v)| k.trim() == COOKIE_NAME && self.verify_session(v.trim(), now))
        })
    }

    fn is_locked(&self, ip: Option<IpAddr>) -> bool {
        let Some(ip) = ip else {
            return false;
        };
        let Ok(mut map) = self.failures.lock() else {
            return false;
        };
        if let Some(&(count, last)) = map.get(&ip) {
            if last.elapsed() > Duration::from_secs(LOCKOUT_SECS) {
                map.remove(&ip);
                return false;
            }
            return count >= MAX_FAILURES;
        }
        false
    }

    fn record_failure(&self, ip: Option<IpAddr>) {
        let Some(ip) = ip else {
            return;
        };
        if let Ok(mut map) = self.failures.lock() {
            let entry = map.entry(ip).or_insert((0, Instant::now()));
            if entry.1.elapsed() > Duration::from_secs(LOCKOUT_SECS) {
                *entry = (1, Instant::now());
            } else {
                entry.0 = entry.0.saturating_add(1);
                entry.1 = Instant::now();
            }
        }
    }

    fn clear_failures(&self, ip: Option<IpAddr>) {
        if let Some(ip) = ip {
            if let Ok(mut map) = self.failures.lock() {
                map.remove(&ip);
            }
        }
    }
}

fn sha256_bytes(data: &[u8]) -> [u8; 32] {
    let d = digest::digest(&digest::SHA256, data);
    let mut out = [0u8; 32];
    out.copy_from_slice(d.as_ref());
    out
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn load_or_create_secret(secret_path: Option<&Path>) -> [u8; 32] {
    if let Ok(env_secret) = std::env::var("ROSIE_SESSION_SECRET") {
        if !env_secret.is_empty() {
            return sha256_bytes(env_secret.as_bytes());
        }
    }
    if let Some(path) = secret_path {
        if let Ok(existing) = std::fs::read_to_string(path) {
            if let Ok(bytes) = hex::decode(existing.trim()) {
                if bytes.len() == 32 {
                    let mut out = [0u8; 32];
                    out.copy_from_slice(&bytes);
                    return out;
                }
            }
        }
    }
    let mut out = [0u8; 32];
    let rng = SystemRandom::new();
    let _ = rng.fill(&mut out);
    if let Some(path) = secret_path {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        #[cfg(unix)]
        {
            use std::io::Write;
            use std::os::unix::fs::OpenOptionsExt;
            if let Ok(mut f) = std::fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .mode(0o600)
                .open(path)
            {
                let _ = f.write_all(hex::encode(out).as_bytes());
            }
        }
        #[cfg(not(unix))]
        {
            let _ = std::fs::write(path, hex::encode(out));
        }
    }
    out
}

pub fn router(state: Arc<AuthState>) -> Router {
    Router::new()
        .route("/auth", get(status))
        .route("/auth/login", post(login))
        .route("/auth/logout", post(logout))
        .with_state(state)
}

async fn status(State(auth): State<Arc<AuthState>>, req: Request) -> impl IntoResponse {
    Json(json!({
        "required": auth.is_required(),
        "authenticated": auth.is_authenticated(&req),
    }))
}

#[derive(Deserialize)]
struct LoginRequest {
    password: String,
}

async fn login(State(auth): State<Arc<AuthState>>, req: Request) -> Response {
    let ip = req.extensions().get::<ConnectInfo<SocketAddr>>().map(|c| c.0.ip());
    let secure = guard::is_https(&req);
    if auth.is_locked(ip) {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({ "error": "Too many failed attempts. Wait a few minutes." })),
        )
            .into_response();
    }

    let Ok(bytes) = axum::body::to_bytes(req.into_body(), 16 * 1024).await else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid request" }))).into_response();
    };
    let Ok(payload) = serde_json::from_slice::<LoginRequest>(&bytes) else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Enter a passphrase" }))).into_response();
    };

    if !auth.verify_password(&payload.password) {
        auth.record_failure(ip);
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Incorrect passphrase" })),
        )
            .into_response();
    }

    auth.clear_failures(ip);
    let token = auth.sign_session(unix_now() + SESSION_TTL_SECS);
    let cookie = format!(
        "{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={SESSION_TTL_SECS}{}",
        if secure { "; Secure" } else { "" }
    );
    let mut res = (StatusCode::OK, Json(json!({ "authenticated": true }))).into_response();
    if let Ok(val) = HeaderValue::from_str(&cookie) {
        res.headers_mut().insert(header::SET_COOKIE, val);
    }
    res
}

async fn logout(req: Request) -> Response {
    let secure = guard::is_https(&req);
    let cookie = format!(
        "{COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0{}",
        if secure { "; Secure" } else { "" }
    );
    let mut res = (StatusCode::OK, Json(json!({ "authenticated": false }))).into_response();
    if let Ok(val) = HeaderValue::from_str(&cookie) {
        res.headers_mut().insert(header::SET_COOKIE, val);
    }
    res
}

pub async fn require_auth(State(auth): State<Arc<AuthState>>, req: Request, next: Next) -> Response {
    if !auth.is_required() {
        return next.run(req).await;
    }
    let path = req.uri().path();
    let public = matches!(path, "/health" | "/auth" | "/auth/login" | "/auth/logout");
    if public || auth.is_authenticated(&req) {
        return next.run(req).await;
    }
    (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Sign in required" }))).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Method};
    use tower::Service;

    #[test]
    fn password_and_session_tokens() {
        let dir = std::env::temp_dir().join(format!("rosie-auth-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let auth = AuthState::new(Some("correct-horse-battery".into()), Some(&dir.join(".secret")));
        assert!(auth.is_required());
        assert!(auth.verify_password("correct-horse-battery"));
        assert!(!auth.verify_password("wrong"));

        let now = unix_now();
        let token = auth.sign_session(now + 60);
        assert!(auth.verify_session(&token, now));
        assert!(!auth.verify_session(&token, now + 61));
        assert!(!auth.verify_session("9999999999.deadbeef", now));

        // Reloaded state reuses persisted secret.
        let auth2 = AuthState::new(Some("correct-horse-battery".into()), Some(&dir.join(".secret")));
        assert!(auth2.verify_session(&token, now));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn middleware_protects_nested_api_and_sets_cookie() {
        let auth = AuthState::new(Some("secret123".into()), None);
        let api = Router::new()
            .route("/health", get(|| async { "ok" }))
            .route("/pantry", get(|| async { "items" }))
            .merge(router(auth.clone()))
            .layer(axum::middleware::from_fn_with_state(auth, require_auth));
        let mut app = Router::new().nest("/api", api);

        // /api/health stays public
        let req = Request::builder().uri("/api/health").body(Body::empty()).unwrap();
        std::future::poll_fn(|cx| Service::<Request<Body>>::poll_ready(&mut app, cx)).await.unwrap();
        assert_eq!(Service::call(&mut app, req).await.unwrap().status(), StatusCode::OK);

        // /api/pantry blocked without cookie
        let req = Request::builder().uri("/api/pantry").body(Body::empty()).unwrap();
        std::future::poll_fn(|cx| Service::<Request<Body>>::poll_ready(&mut app, cx)).await.unwrap();
        assert_eq!(Service::call(&mut app, req).await.unwrap().status(), StatusCode::UNAUTHORIZED);

        // Login succeeds and returns HttpOnly SameSite=Strict cookie
        let req = Request::builder()
            .method(Method::POST)
            .uri("/api/auth/login")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(r#"{"password":"secret123"}"#))
            .unwrap();
        std::future::poll_fn(|cx| Service::<Request<Body>>::poll_ready(&mut app, cx)).await.unwrap();
        let res = Service::call(&mut app, req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let cookie = res
            .headers()
            .get(header::SET_COOKIE)
            .unwrap()
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_string();

        // /api/pantry succeeds with session cookie
        let req = Request::builder()
            .uri("/api/pantry")
            .header(header::COOKIE, cookie)
            .body(Body::empty())
            .unwrap();
        std::future::poll_fn(|cx| Service::<Request<Body>>::poll_ready(&mut app, cx)).await.unwrap();
        assert_eq!(Service::call(&mut app, req).await.unwrap().status(), StatusCode::OK);
    }
}
