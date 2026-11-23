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
    extract::Request,
    http::{header, HeaderValue, Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use std::net::IpAddr;
use std::sync::OnceLock;

/// Extra host names to accept, from `ALLOWED_HOSTS` (comma-separated), e.g. a
/// router-assigned name or a custom domain on the home network.
fn extra_hosts() -> &'static [String] {
    static HOSTS: OnceLock<Vec<String>> = OnceLock::new();
    HOSTS.get_or_init(|| {
        std::env::var("ALLOWED_HOSTS")
            .unwrap_or_default()
            .split(',')
            .map(|h| h.trim().trim_end_matches('.').to_ascii_lowercase())
            .filter(|h| !h.is_empty())
            .collect()
    })
}

/// "192.168.1.19:3000" -> "192.168.1.19", "[::1]:3000" -> "::1", "pc.local" -> "pc.local".
fn host_name(host: &str) -> &str {
    if let Some(rest) = host.strip_prefix('[') {
        return rest.split(']').next().unwrap_or("");
    }
    host.rsplit_once(':').map_or(host, |(h, port)| if port.bytes().all(|b| b.is_ascii_digit()) { h } else { host })
}

/// Names a public website can't own: IP addresses, localhost, single-label
/// names and home-network suffixes (mDNS .local, .lan, .home.arpa, Tailscale).
pub fn host_allowed(host: &str) -> bool {
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
        || [".localhost", ".local", ".lan", ".home.arpa", ".internal", ".ts.net"].iter().any(|s| name.ends_with(s))
        || extra_hosts().iter().any(|h| *h == name)
}

/// The host:port part of an Origin header ("http://pc.local:3000" -> "pc.local:3000").
fn origin_authority(origin: &str) -> Option<&str> {
    let rest = origin.split_once("://")?.1;
    Some(rest.split('/').next().unwrap_or(rest))
}

const CSP: &str = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; \
                   connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

pub async fn guard(req: Request, next: Next) -> Response {
    let host = req.headers().get(header::HOST).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    if !host_allowed(&host) {
        tracing::warn!("refused request for unknown host {host:?}");
        return (StatusCode::MISDIRECTED_REQUEST, "Unknown host. Add it to ALLOWED_HOSTS if it's yours.").into_response();
    }

    let safe = matches!(*req.method(), Method::GET | Method::HEAD | Method::OPTIONS);
    if !safe {
        // Browsers send Origin on every cross-origin write; a mismatch (or the
        // opaque "null" origin) means the request came from another page.
        if let Some(origin) = req.headers().get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
            if origin_authority(origin).is_none_or(|a| !a.eq_ignore_ascii_case(&host)) {
                tracing::warn!("refused cross-origin {} from {origin:?}", req.method());
                return (StatusCode::FORBIDDEN, "Cross-site requests are not allowed").into_response();
            }
        }
    }

    let mut res = next.run(req).await;
    let h = res.headers_mut();
    h.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static(CSP));
    h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    h.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    h.insert(header::REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    res
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hosts() {
        for ok in ["localhost:3000", "127.0.0.1:3000", "192.168.1.19:3000", "[::1]:3000", "fedora:3000",
                   "fedora.local:3000", "pc.tail1234.ts.net", "100.85.187.0:3000", "router.home.arpa"] {
            assert!(host_allowed(ok), "{ok}");
        }
        for bad in ["", "evil.example", "evil.example:3000", "127.0.0.1.nip.io:3000", "local.evil.com", "a b"] {
            assert!(!host_allowed(bad), "{bad}");
        }
    }

    #[test]
    fn origins() {
        assert_eq!(origin_authority("http://192.168.1.19:3000"), Some("192.168.1.19:3000"));
        assert_eq!(origin_authority("null"), None);
    }
}
