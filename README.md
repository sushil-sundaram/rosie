# Rosie

Rosie is a self-hosted household management application for planning meals, tracking the pantry, sharing chores and managing household spending. It runs as a single container on a machine in the home; all data, including images processed by the optional local AI features, stays on that machine.

[![Server](https://img.shields.io/badge/server-Rust%20%C2%B7%20Axum%20%C2%B7%20SQLite-orange)](server/)
[![Web](https://img.shields.io/badge/web-HTML%20%C2%B7%20CSS%20%C2%B7%20JavaScript-bd93f9)](web/)
[![AI](https://img.shields.io/badge/AI-Ollama%20(local)-lightgrey)](https://ollama.com)

## Contents

- [Features](#features)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Access from other devices](#access-from-other-devices)
- [Security](#security)
- [Backups](#backups)
- [Architecture](#architecture)
- [Development](#development)
- [Project structure](#project-structure)

## Features

| Module | Capabilities |
|---|---|
| **Overview** | Combined month calendar of meals, chores, bills and spending, with per-layer filters, monthly summary figures and quick entry for any day. |
| **Chores** | Month calendar and Kanban board views; drag-and-drop rescheduling; *to do → in progress → done* workflow; points per household member; weekly or monthly recurrence. |
| **Meals** | Monthly meal planner with breakfast, lunch and dinner slots, linked to the recipe collection. |
| **Expenses** | Daily spend calendar, monthly budgets per category with remaining-budget pacing, bills payable, and receipt scanning. |
| **Bills** | Bills are scheduled as chores on their due date. Marking a bill paid records it as an expense; reversing the payment removes that expense. Monthly and yearly bills generate the next occurrence on payment and show upcoming occurrences on the calendar. |
| **Pantry** | Inventory with low-stock and expiry indicators, item entry from a photograph, and links from purchased items to the originating expense. |
| **Recipes** | Recipe collection with ingredients, steps, servings, time and photo. Import from a recipe website link, a photo of a cookbook page or handwritten card, or pasted text; every import is shown for review before it is saved. |
| **Settings** | Household currency (shared across devices; Indian rupee by default) and per-device dark, light or system theme. |

**Multi-user by default.** All devices read and write the same database. Changes are pushed to every open session in real time, and simultaneous changes such as stock adjustments and bill payments are applied safely (see [Architecture](#architecture)). Edits to the same recipe or pantry item are last-write-wins.

**Local AI.** Receipt, pantry-photo and recipe recognition use a model served by [Ollama](https://ollama.com) on the host. Results are always presented for review before they are saved.

**Recipe import.** Most recipe websites publish their recipes as structured data ([schema.org Recipe](https://schema.org/Recipe)). Rosie reads that directly, which is exact and immediate; the local model is used only for pages without it, for photos and for pasted text. Some sites block automated requests; for those, paste the recipe text or upload a screenshot.

## Getting started

### Prerequisites

- Docker with Docker Compose
- Optional, for receipt and photo recognition: Ollama running on the same host

### Run

```bash
docker compose up -d --build
```

The application is available at **http://localhost:3000**. Data is stored in `./data/rosie.db` and persists across container rebuilds.

To enable receipt, photo and recipe recognition, install the vision model on the host:

```bash
ollama pull llama3.2-vision
```

### Update

After pulling new changes, rebuild and restart the container:

```bash
docker compose up -d --build
```

Database migrations are applied automatically on startup.

## Configuration

Environment variables are set in [`docker-compose.yml`](docker-compose.yml).

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port. |
| `DATABASE_URL` | `sqlite:///app/data/rosie.db` | SQLite database location (mounted from `./data`). |
| `TZ` | `Asia/Kolkata` | Household time zone; determines the date recorded when a bill is paid. |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama endpoint. The container uses host networking so that it can reach an Ollama instance bound to the host's loopback interface. |
| `OLLAMA_VISION_MODEL` | `llama3.2-vision` | Vision model used for receipts, pantry photos and recipe photos. |
| `OLLAMA_TEXT_MODEL` | value of `OLLAMA_VISION_MODEL` | Optional. Model used to read recipe text and web pages without recipe data. A smaller text model, such as `qwen2.5:7b`, is faster. |
| `ALLOWED_HOSTS` | *(none)* | Optional, comma-separated. Extra host names or `*.suffix` entries Rosie will answer to (e.g. `*.your-tailnet.ts.net`). IP addresses, `localhost`, single-word names, `*.local`, `*.lan` and `*.home.arpa` always work. |
| `TRUST_PROXY` | *(unset)* | Set to `1` when behind a non-loopback TLS reverse proxy so `X-Forwarded-Proto` is honored (loopback proxies are trusted automatically). |
| `BIND_ADDR` | `0.0.0.0` | Interface to listen on, e.g. a single LAN address. |

## Access from other devices

The service listens on port 3000 of the host. To allow access from other devices on the local network, open the port in the host firewall. For example, with firewalld:

```bash
sudo firewall-cmd --permanent --add-port=3000/tcp && sudo firewall-cmd --reload
```

Devices on the same network can then use `http://<host-ip>:3000`. For access away from home, a private overlay network such as [Tailscale](https://tailscale.com) is recommended over exposing the port to the internet.

If you reach Rosie by a custom domain name, add it to `ALLOWED_HOSTS`; other names are refused (HTTP 421).

## Security

Rosie has no sign-in: anyone who can reach the port can use it, so keep it on the home network or Tailscale. Within that, it protects the household's data from other websites:

- **No cross-site access.** The API sends no CORS headers, so pages on other sites can't read it, and writes carrying another site's `Origin` are refused.
- **DNS rebinding blocked.** Requests are only served for IP addresses, `localhost` and home-network names (plus `ALLOWED_HOSTS`).
- **Recipe links can't reach the home network.** Every address a link resolves to, including after redirects, must be public.
- **Headers.** A content security policy (no inline scripts, no framing), `nosniff` and `no-referrer`.
- **Container.** Runs as an unprivileged user with a read-only filesystem, no Linux capabilities and `no-new-privileges`. `./data` must be owned by uid 1000.
- **Input.** Dates, amounts, names and option values are validated; requests are limited to 1 MB (20 MB for photos).

## Backups

The whole household's data is the file `data/rosie.db`. Back it up while Rosie is stopped (`docker compose stop`, copy the file, `docker compose start`), or online with `sqlite3 data/rosie.db ".backup data/backups/rosie-$(date +%F).db"`. Copying the file while Rosie is running can produce an inconsistent copy.

## Architecture

```
 Browser (any device) ──HTTP/JSON + SSE──► Rust server (Axum) ──► SQLite (WAL)
                                                  │
                                                  └──HTTP──► Ollama (host, optional)
```

- **Single server, single database.** One Axum process owns one SQLite database. Every client works against the same data, so no client-side synchronisation or conflict resolution is required.
- **Real-time updates.** Each successful write is published on `GET /api/events` using Server-Sent Events. Clients refresh on notification; a client with unsaved form input defers the refresh and indicates that updates are pending.
- **Concurrency safety.** Quantity changes are applied as relative deltas, and bill payment and recurrence run inside write-locked transactions, preventing lost updates and duplicate records under concurrent use.
- **Web client.** A dependency-free single-page application (HTML, CSS and JavaScript, no build step) served by the same process. Styling follows the [Dracula](https://draculatheme.com) palette in dark mode and its Alucard counterpart in light mode.

Further detail: [server reference](server/README.md) and [design specification](docs/designs/rosie_system_architecture.md).

## Development

Run the server natively; it serves `../web` and uses `../data/rosie.db`:

```bash
cd server && cargo run
```

Changes to files in `web/` take effect on browser reload. Changes to the server require a restart, or a container rebuild when running under Docker.

Run the quality checks (server compiles without warnings; web client parses):

```bash
./scripts/verify_all.sh
```

## Project structure

```
rosie/
├── web/                  Web client (index.html, app.js, app.css)
├── server/               Rust API server; also serves web/
│   ├── migrations/       SQLite schema migrations, applied at startup
│   └── src/              Routes, models, real-time event stream
├── docs/designs/         Design specification
├── scripts/verify_all.sh Quality checks
└── docker-compose.yml    Container configuration
```
