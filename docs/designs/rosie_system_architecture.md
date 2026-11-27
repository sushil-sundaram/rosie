# EGM Design Specification: Rosie Household Management System

**Status**: Approved & Active
**Framework**: Elephant-Goldfish Model (EGM)
**System**: Rosie (household coordination)
**Version**: 2.0.0 — web client, single-container deployment

---

## 1. System Vision & Context

Rosie is a self-hosted household management system covering meals, pantry, chores, bills and spending. It runs on a single machine in the home, serves every household device from one database, and keeps all data, including images used for local AI recognition, on that machine.

```
┌────────────────────────────────────────────────────────────────────────┐
│                    Rosie Web Client (HTML / CSS / JS)                  │
├────────────┬─────────┬─────────┬─────────┬──────────┬─────────┬────────┤
│  Overview  │ Pantry  │  Meals  │ Recipes │  Chores  │ Expenses│Settings│
│ (calendar) │ (list)  │ (cal.)  │ (list)  │(cal/board)│ (cal.) │        │
└────────────┴─────────┴─────────┴─────────┴──────────┴─────────┴────────┘
                     │ HTTP/JSON (/api)     ▲ Server-Sent Events (/api/events)
                     ▼                      │
┌────────────────────────────────────────────────────────────────────────┐
│                       Rosie Server (Rust, Axum)                        │
├────────────────────────────────────────────────────────────────────────┤
│ REST API under /api · static web client · change notifications         │
│ Database: SQLite (WAL), SQLx migrations applied at startup              │
└────────────────────────────────────────────────────────────────────────┘
                                  │ HTTP/JSON
                                  ▼
┌────────────────────────────────────────────────────────────────────────┐
│                  Local Ollama Vision (host, optional)                  │
│ Default model: llama3.2-vision · no cloud services                     │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Architectural Pillars

### 2.1 The Elephant (Persistent Domain Contracts)
Rosie maintains long-horizon state for:
- **Household members**: chore assignment, points and bill responsibility.
- **Pantry**: quantities, units, expiry dates and the purchase each item came from.
- **Meals & recipes**: a dated meal plan by slot, linked to the recipe collection.
- **Budget & spending**: expenses by category, monthly category budgets, and bills payable.
- **Recurrence**: weekly, monthly and yearly series for chores and bills.
- **Settings**: household currency and locale.

### 2.2 The Goldfish (Isolated Reviewable Units)
Each module (`overview`, `pantry`, `meals`, `recipes`, `chores`, `expenses`, `settings`) is a self-contained view over the shared API with explicit contracts, so it can be reviewed, tested and changed without regressions in other modules.

---

## 3. Subsystem Specifications

All endpoints below are served under `/api`. The full reference is in [`server/README.md`](../../server/README.md).

### 3.1 Overview
- **Purpose**: one month calendar combining meals, chores, bills and spending, with monthly summary figures and quick entry for the selected day.
- **Design invariant**: the overview stores no state of its own; it is a projection over the other modules.

### 3.2 Pantry
- **Endpoints**: `GET/POST /pantry`, `PUT/DELETE /pantry/{id}`, `POST /pantry/{id}/adjust`, `POST /pantry/batch`, `POST /pantry/scan-photo`
- **Model**: `id`, `name`, `quantity`, `unit`, `expires_on?`, `expense_id?`
- **Invariants**: quantity changes are relative and never negative; batch additions merge items with the same name and unit. Enforced in the schema as well as the API (STRICT tables, CHECK constraints, foreign keys; schema v2).

### 3.3 Meals & Recipes
- **Endpoints**: `GET/POST /meals`, `PATCH/DELETE /meals/{id}`, `GET/POST /recipes`, `PUT/DELETE /recipes/{id}`, `POST /recipes/import`
- **Model**: meal `id`, `date`, `slot` (breakfast, lunch, dinner), `title`, `recipe_id?`; recipe `id`, `name`, `instructions` (one step per line), `servings?`, `time_minutes?`, `source_url?`, `image_url?`, `ingredients[]` (`text`, `name`, `quantity`, `unit`)
- **Invariants**: ingredient lines are stored as written and parsed on save; imports return drafts and never write.

### 3.4 Chores & Bills
- **Endpoints**: `GET/POST /chores`, `PATCH/DELETE /chores/{id}`
- **Model**: `id`, `title`, `assigned_to`, `priority`, `status`, `points`, `due_date?`, `repeat?`, `repeat_day?`, `next_id?`, `amount?`, `category?`, `expense_id?`
- **Workflow**: `[To Do]` ──► `[In Progress]` ──► `[Done]`
- **Bills**: a chore with an `amount`. Entering `Done` records exactly one expense; leaving `Done` removes it.
- **Recurrence**: entering `Done` creates the next occurrence once. Monthly and yearly series keep their anchor day, clamped to the month's end.

### 3.5 Expenses & Budgets
- **Endpoints**: `GET/POST /expenses`, `DELETE /expenses/{id}`, `POST /expenses/scan-receipt`, `GET /budgets`, `PUT /budgets/{category}`
- **Model**: expense `id`, `title`, `amount`, `category`, `date`; budget `category`, `amount` (monthly)

### 3.6 Settings
- **Endpoints**: `GET/PUT /settings` (`currency`, `locale`)
- Theme is a per-device preference held by the client, not server state.

---

## 4. Local AI Vision Pipeline

1. **Capture**: the web client reads a camera or gallery image and downscales it to at most 1600 px (JPEG, 85% quality).
2. **Transmission**: the image is sent as base64 to `POST /expenses/scan-receipt` or `POST /pantry/scan-photo`.
3. **Inference**: the server calls Ollama's `/api/generate` with `format: "json"` and a fixed schema prompt — receipts return `{ title, amount, category, date, items }`; pantry photos return `{ items }`.
4. **Confirmation**: results pre-fill a form or review list; nothing is saved until the user confirms. Receipt items can then be added to the pantry, linked to the new expense.
5. **No cloud telemetry**: images are processed on the host and never leave the local network.

---

### 4.1 Recipe import

1. **Link**: the server fetches the page (public hosts only, 5 MB, 20 s) and reads the schema.org `Recipe` JSON-LD block. No model is involved.
2. **Fallback**: pages without recipe data are reduced to their main text (navigation, scripts and footers removed, 12,000 characters) and sent to the text model (`OLLAMA_TEXT_MODEL`, default the vision model).
3. **Photo / text**: cookbook pages, handwritten cards and screenshots go to the vision model; pasted text to the text model.
4. **Review**: the draft opens in an editor; nothing is stored until it is saved.

## 5. Real-Time Synchronisation

- Every successful write is announced on `GET /api/events` (Server-Sent Events) with the originating client ID.
- Clients ignore their own announcements and refresh on others. A client with unsaved form input defers the refresh and shows that updates are pending.
- Write paths that read before writing (bill payment, recurrence, pantry batches) use `BEGIN IMMEDIATE` transactions.
- Pantry items, recipes and expenses carry a `version`. Edits send the version they started from; a mismatch returns 409 with the current row, and the client offers "keep mine" (resend against the new version) or "use theirs". Nothing is overwritten silently.

---

## 6. Containerisation & Deployment

- **Dockerfile** (`server/Dockerfile`, build context at the repository root): multi-stage build on `rust:1-slim-bookworm`, runtime on `debian:bookworm-slim`, includes the web client and `tzdata`.
- **Docker Compose**:
  - host networking, so the container can reach Ollama on the host's loopback interface;
  - persistent volume `./data:/app/data` for SQLite;
  - `TZ` sets the household time zone;
  - health check on `GET /api/health`.

---

## 7. Verification & Quality Gates

- **Server**: `cargo check` must build with zero warnings; `cargo test` covers ingredient parsing, recipe extraction and link safety.
- **Web client**: `node --check web/app.js` must pass.
- **Unified command**: `./scripts/verify_all.sh` runs `cargo check` (warnings as errors), `cargo test` and `node --check`.
