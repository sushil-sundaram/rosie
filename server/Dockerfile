# Build context: repository root (see docker-compose.yml).

# ---------- build ----------
FROM rust:1-slim-bookworm AS builder
WORKDIR /usr/src/server

# Cache dependencies with a dummy main
COPY server/Cargo.toml server/Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && \
    cargo build --release && \
    rm -rf src

COPY server/src ./src
COPY server/migrations ./migrations
RUN touch src/main.rs && cargo build --release

# ---------- runtime ----------
FROM debian:bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 1000 --user-group --no-create-home --shell /usr/sbin/nologin rosie \
    && mkdir -p /app/data && chown rosie:rosie /app/data

COPY --from=builder /usr/src/server/target/release/server /app/rosie-server
COPY --chown=rosie:rosie web /app/web
RUN chmod -R u=rwX,go=rX /app/web

ENV DATABASE_URL="sqlite:///app/data/rosie.db" \
    WEB_DIR="/app/web" \
    PORT="3000" \
    OLLAMA_BASE_URL="http://127.0.0.1:11434" \
    OLLAMA_VISION_MODEL="llama3.2-vision" \
    TZ="Asia/Kolkata" \
    RUST_LOG="info"

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -fsS "http://localhost:${PORT}/api/health" || exit 1

# Not root: a bug in the server can't become root on a host-networked container.
USER rosie

ENTRYPOINT ["/app/rosie-server"]
