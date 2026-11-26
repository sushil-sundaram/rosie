//! Request guard: keeps other websites out of the household's data.
//!
//! Rosie has no sign-in, so the browser's same-origin rule is what protects it.
//! Three checks back that up:
//! - **Host**: only addresses and names that can't belong to an outside
//!   website are served. This stops DNS rebinding, where a site makes its own
//!   name point at this machine to become "same origin".
//! - **Origin**: a write from a page on another origin is refused.
//! - **Headers**: a content security policy, no framing, no MIME sniffing.

use axum::{
    extract::{ConnectInfo, Request},
    http::{header, HeaderValue, Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use std::net::{IpAddr, SocketAddr};
use std::sync::OnceLock;

/// Extra host names or suffixes (`.example.ts.net` / `*.example.ts.net`) to accept,
/// from `ALLOWED_HOSTS` (comma-separated).
fn extra_hosts() -> &'static [String] {
    static HOSTS: OnceLock<Vec<String>> = OnceLock::new();
    HOSTS.get_or_init(|| {
        std::env::var("ALLOWED_HOSTS")
            .unwrap_or_default()
            .split(',')
            .map(|h| h.trim().trim_start_matches('*').trim_end_matches('.').to_ascii_lowercase())
            .filter(|h| !h.is_empty() && h != ".")
            .collect()
    })
}

fn trust_proxy_env() -> bool {
    static TRUST: OnceLock<bool> = OnceLock::new();
    *TRUST.get_or_init(|| {
        std::env::var("TRUST_PROXY")
            .ok()
            .is_some_and(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
    })
}

/// "192.168.1.19:3000" -> "192.168.1.19", "[::1]:3000" -> "::1", "pc.local" -> "pc.local".
fn host_name(host: &str) -> &str {
    if let Some(rest) = host.strip_prefix('[') {
        let Some((addr, tail)) = rest.split_once(']') else {
            return "";
        };
        if tail.is_empty()
            || tail
                .strip_prefix(':')
                .is_some_and(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
        {
            return addr;
        }
        return "";
    }
    host.rsplit_once(':').map_or(host, |(h, port)| {
        if !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit()) {
            h
        } else {
            host
        }
    })
}

/// Names a public website can't own: IP addresses, localhost, single-label
/// names, home-network suffixes (mDNS .local, .lan, .home.arpa), and `ALLOWED_HOSTS`.
pub fn host_allowed(host: &str) -> bool {
    host_allowed_with(host, extra_hosts())
}

fn host_allowed_with(host: &str, extra: &[String]) -> bool {
    let name = host_name(host).trim_end_matches('.').to_ascii_lowercase();
    if name.is_empty() {
        return false;
    }
    if name.parse::<IpAddr>().is_ok() {
        return true;
    }
    if !name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'.') {
        return false;
    }
    name == "localhost"
        || !name.contains('.')
        || [".localhost", ".local", ".lan", ".home.arpa", ".internal"].iter().any(|s| name.ends_with(s))
        || extra.iter().any(|h| {
            if h.starts_with('.') {
                name.len() > h.len() && name.ends_with(h.as_str())
            } else {
                *h == name
            }
        })
}

/// The (scheme, authority) pair of an Origin or Referer URL.
fn origin_parts(url: &str) -> Option<(&str, &str)> {
    let (scheme, rest) = url.split_once("://")?;
    if !matches!(scheme.to_ascii_lowercase().as_str(), "http" | "https") {
        return None;
    }
    let auth = rest.split(['/', '?', '#']).next().unwrap_or(rest);
    if auth.is_empty() {
        return None;
    }
    Some((scheme, auth))
}

fn norm_authority<'a>(scheme: &str, auth: &'a str) -> &'a str {
    if scheme.eq_ignore_ascii_case("https") {
        auth.strip_suffix(":443").unwrap_or(auth)
    } else if scheme.eq_ignore_ascii_case("http") {
        auth.strip_suffix(":80").unwrap_or(auth)
    } else {
        auth
    }
}

pub fn is_https(req: &Request) -> bool {
    expected_scheme(req) == "https"
}

fn expected_scheme(req: &Request) -> &'static str {
    let from_loopback = req
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .is_some_and(|ci| ci.0.ip().is_loopback());
    if from_loopback || trust_proxy_env() {
        if let Some(proto) = req.headers().get("x-forwarded-proto").and_then(|v| v.to_str().ok()) {
            let first = proto.split(',').next().unwrap_or("").trim();
            if first.eq_ignore_ascii_case("https") {
                return "https";
            }
        }
    }
    "http"
}

const CSP: &str = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; \
                   connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

fn with_security_headers(mut res: Response) -> Response {
    let h = res.headers_mut();
    h.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static(CSP));
    h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    h.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    h.insert(header::REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    res
}

pub async fn guard(req: Request, next: Next) -> Response {
    let host = req
        .headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .or_else(|| req.uri().authority().map(|a| a.as_str()))
        .unwrap_or("")
        .to_string();
    if !host_allowed(&host) {
        tracing::warn!("refused request for unknown host {host:?}");
        return with_security_headers(
            (StatusCode::MISDIRECTED_REQUEST, "Unknown host. Add it to ALLOWED_HOSTS if it's yours.").into_response(),
        );
    }

    let safe = matches!(*req.method(), Method::GET | Method::HEAD | Method::OPTIONS);
    if !safe {
        if let Some(sfs) = req.headers().get("sec-fetch-site").and_then(|v| v.to_str().ok()) {
            if sfs.trim().eq_ignore_ascii_case("cross-site") {
                tracing::warn!("refused cross-site {} (Sec-Fetch-Site: {sfs:?})", req.method());
                return with_security_headers((StatusCode::FORBIDDEN, "Cross-site requests are not allowed").into_response());
            }
        }

        let scheme = expected_scheme(&req);
        let expected_auth = norm_authority(scheme, &host);
        let source = req
            .headers()
            .get(header::ORIGIN)
            .and_then(|v| v.to_str().ok())
            .map(|v| ("Origin", v))
            .or_else(|| {
                req.headers()
                    .get(header::REFERER)
                    .and_then(|v| v.to_str().ok())
                    .map(|v| ("Referer", v))
            });

        let Some((hdr, val)) = source else {
            tracing::warn!("refused {} without Origin or Referer", req.method());
            return with_security_headers((StatusCode::FORBIDDEN, "Cross-site requests are not allowed").into_response());
        };
        let valid = origin_parts(val).is_some_and(|(s, a)| {
            s.eq_ignore_ascii_case(scheme) && norm_authority(s, a).eq_ignore_ascii_case(expected_auth)
        });
        if !valid {
            tracing::warn!("refused cross-origin {} from {hdr} {val:?} (expected {scheme}://{expected_auth})", req.method());
            return with_security_headers((StatusCode::FORBIDDEN, "Cross-site requests are not allowed").into_response());
        }
    }

    with_security_headers(next.run(req).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, routing::post, Router};
    use tower::Service;

    #[test]
    fn hosts() {
        for ok in ["localhost:3000", "127.0.0.1:3000", "192.168.1.19:3000", "[::1]:3000", "fedora:3000",
                   "fedora.local:3000", "100.85.187.0:3000", "router.home.arpa"] {
            assert!(host_allowed_with(ok, &[]), "{ok}");
        }
        for bad in [
            "", "evil.example", "evil.example:3000", "127.0.0.1.nip.io:3000", "local.evil.com",
            "a b", "[::1]evil", "[::1]:", "192.168.1.1:", "attacker.tail999.ts.net",
        ] {
            assert!(!host_allowed_with(bad, &[]), "{bad}");
        }
        let extra = vec![".tail1234.ts.net".to_string(), "rosie.example.com".to_string()];
        assert!(host_allowed_with("pc.tail1234.ts.net", &extra));
        assert!(host_allowed_with("rosie.example.com:3000", &extra));
        assert!(!host_allowed_with("tail1234.ts.net", &extra));
        assert!(!host_allowed_with("other.tail999.ts.net", &extra));
    }

    #[test]
    fn origins() {
        assert_eq!(origin_parts("http://192.168.1.19:3000"), Some(("http", "192.168.1.19:3000")));
        assert_eq!(origin_parts("https://pc.local/app"), Some(("https", "pc.local")));
        assert_eq!(origin_parts("null"), None);
        assert_eq!(origin_parts("javascript:alert(1)"), None);
    }

    async fn call(req: Request<Body>) -> Response {
        let mut app = Router::new()
            .route("/write", post(|| async { "ok" }))
            .layer(axum::middleware::from_fn(guard));
        std::future::poll_fn(|cx| Service::<Request<Body>>::poll_ready(&mut app, cx)).await.unwrap();
        Service::call(&mut app, req).await.unwrap()
    }

    #[tokio::test]
    async fn guard_blocks_missing_origin_scheme_mismatch_and_cross_site() {
        // Missing Origin and Referer on POST -> 403 with security headers.
        let res = call(
            Request::builder()
                .method(Method::POST)
                .uri("/write")
                .header(header::HOST, "192.168.1.19:3000")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(res.status(), StatusCode::FORBIDDEN);
        assert!(res.headers().contains_key(header::CONTENT_SECURITY_POLICY));

        // Scheme mismatch (https Origin to http server without trusted proxy) -> 403.
        let res = call(
            Request::builder()
                .method(Method::POST)
                .uri("/write")
                .header(header::HOST, "192.168.1.19:3000")
                .header(header::ORIGIN, "https://192.168.1.19:3000")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(res.status(), StatusCode::FORBIDDEN);

        // Sec-Fetch-Site: cross-site -> 403 even if Origin matches.
        let res = call(
            Request::builder()
                .method(Method::POST)
                .uri("/write")
                .header(header::HOST, "192.168.1.19:3000")
                .header(header::ORIGIN, "http://192.168.1.19:3000")
                .header("sec-fetch-site", "cross-site")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(res.status(), StatusCode::FORBIDDEN);

        // Valid same-origin POST -> 200.
        let res = call(
            Request::builder()
                .method(Method::POST)
                .uri("/write")
                .header(header::HOST, "192.168.1.19:3000")
                .header(header::ORIGIN, "http://192.168.1.19:3000")
                .header("sec-fetch-site", "same-origin")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(res.status(), StatusCode::OK);

        // HTTP/2 :authority without Host header works.
        let res = call(
            Request::builder()
                .method(Method::POST)
                .uri("http://localhost:3000/write")
                .header(header::ORIGIN, "http://localhost:3000")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(res.status(), StatusCode::OK);

        // Unknown host returns 421 with security headers.
        let res = call(
            Request::builder()
                .method(Method::POST)
                .uri("/write")
                .header(header::HOST, "evil.example")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(res.status(), StatusCode::MISDIRECTED_REQUEST);
        assert!(res.headers().contains_key(header::X_FRAME_OPTIONS));
    }
}
