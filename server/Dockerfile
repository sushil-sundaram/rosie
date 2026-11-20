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
    && mkdir -p /app/data

COPY --from=builder /usr/src/server/target/release/server /app/rosie-server
COPY web /app/web

ENV DATABASE_URL="sqlite:///app/data/rosie.db" \
    WEB_DIR="/app/web" \
    PORT="3000" \
    OLLAMA_BASE_URL="http://host.docker.internal:11434" \
    OLLAMA_VISION_MODEL="llama3.2-vision" \
    RUST_LOG="info"

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -fsS http://localhost:3000/api/health || exit 1

ENTRYPOINT ["/app/rosie-server"]
