# Rosie server

Rust (edition 2024) · Axum · SQLx/SQLite (WAL) · Ollama for vision.
Serves the REST API and the web app in [`../web`](../web). See the [project README](../README.md) for running it.

```
server/
├── Dockerfile        # Multi-stage build; build context is the repo root
├── migrations/       # Run automatically at startup (sqlx::migrate!)
└── src/
    ├── main.rs       # Config, SQLite pool, static files, /api nesting
    ├── routes.rs     # REST handlers, bill & recurrence logic, Ollama calls
    ├── recipes.rs    # Recipes, ingredient parsing, import (link, photo, text)
    ├── sync.rs       # Live-update feed (Server-Sent Events)
    ├── guard.rs      # Host/Origin checks and security headers
    └── models.rs     # Serde / FromRow types
```

## Configuration

| Env | Default (native) | Notes |
|---|---|---|
| `DATABASE_URL` | `sqlite://../data/rosie.db` | Created if missing |
| `WEB_DIR` | `../web` | Static web app; unknown paths fall back to `index.html` |
| `PORT` | `3000` | |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | |
| `OLLAMA_VISION_MODEL` | `llama3.2-vision` | Requests can't choose another model |
| `OLLAMA_TEXT_MODEL` | `OLLAMA_VISION_MODEL` | Reads pasted recipes and pages without recipe data |
| `ALLOWED_HOSTS` | | Extra host names to serve (see guard.rs) |
| `BIND_ADDR` | `0.0.0.0` | Listen address |
| `TZ` | system | Used for “today” when logging a paid bill |

## API

All routes are served under `/api` (for example `GET /api/pantry`). Request and response bodies are JSON. Writes send an optional `X-Client-Id` header so live-sync can skip the sender's own echo.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | `{"status":"ok","version"}` after checking the database; 503 if it's unavailable. Used by the container health check |
| `GET` | `/events` | Server-Sent Events: one `{"by","path"}` message per successful write, or `{"type":"job","job_id","kind","status","by"}` when a background AI scan completes |
| `GET` | `/jobs/{id}` | Poll an async AI job (`{job_id, kind, status, result?, error?}`) |
| `GET` · `PUT` | `/settings` | `{"currency":"INR","locale":"en-IN"}`; PUT accepts only known keys |
| **Pantry** | | |
| `GET` · `POST` | `/pantry` | List / add `{name, quantity, unit, expires_on?}` |
| `PUT` · `DELETE` | `/pantry/{id}` | Replace / remove an item. Send the item's `version`; a newer one in the database gives 409 |
| `POST` | `/pantry/{id}/adjust` | `{delta}` — relative change, never below 0 |
| `POST` | `/pantry/batch` | `{items:[…], expense_id?}` — tops up items with the same name+unit, otherwise inserts; links to an expense |
| `POST` | `/pantry/scan-photo` | `{image_base64}` → `202 {job_id, kind, status}`; job result is `{items:[{name, quantity, unit}]}` |
| **Recipes & meals** | | |
| `GET` · `POST` | `/recipes` | `{name, instructions, servings?, time_minutes?, source_url?, image_url?, ingredients: ["1 cup toor dal", …]}`; POST returns `{id}`. GET returns each ingredient as `{text, name, quantity, unit}` |
| `PUT` · `DELETE` | `/recipes/{id}` | Replace a recipe and its ingredients (send its `version`; 409 if newer) / remove it (also unlinks it from planned meals) |
| `POST` | `/recipes/import` | One of `{url}`, `{text}` or `{image_base64}` → `200` draft directly for structured recipe links, or `202 {job_id, kind, status}` for AI extraction (`{name, servings, time_minutes, source_url, image_url, ingredients, instructions, method}`) |
| `GET` · `POST` | `/meals` | `{date, slot, title, recipe_id?}` — slot is breakfast, lunch or dinner. GET accepts optional `?month=YYYY-MM` or `?from=YYYY-MM-DD&to=YYYY-MM-DD` and `?limit=&offset=` |
| `PATCH` · `DELETE` | `/meals/{id}` | PATCH `{date}` to reschedule |
| **Chores & bills** | | |
| `GET` · `POST` | `/chores` | `{title, assigned_to, priority, status, points, due_date?, repeat?, amount?, category?}` — an `amount` makes it a bill |
| `PATCH` · `DELETE` | `/chores/{id}` | PATCH any of `{status, due_date, repeat}` (`""` clears a date or stops repeating) |
| **Expenses & budgets** | | |
| `GET` · `POST` | `/expenses` | `{title, amount, category, date}`; POST returns `{id}`. GET accepts optional `?month=YYYY-MM` or `?from=YYYY-MM-DD&to=YYYY-MM-DD` and `?limit=&offset=` |
| `PUT` · `DELETE` | `/expenses/{id}` | Edit (send `version`; 409 if newer) / delete: unlinks pantry items bought with it, 409 if it is a paid bill's expense (un-pay the bill instead) |
| `POST` | `/expenses/scan-receipt` | `{image_base64}` → `202 {job_id, kind, status}`; job result is `{title, amount, category, date, items}` |
| `GET` | `/budgets` | `[{category, amount}]` — monthly, repeats every month |
| `PUT` | `/budgets/{category}` | `{amount}`; 0 removes the budget |

### Rules worth knowing

- **Bills.** Setting a bill's status to `done` inserts an expense dated today and stores its `expense_id`; moving it out of `done` deletes that expense. Repeated `done` calls never log twice. A bill can't be created already `done`, and its expense can't be deleted on its own.
- **Recurrence.** Completing a repeating chore/bill creates the next one (`next_id`). Monthly/yearly keep the anchor day (`repeat_day`), clamped to the month's end: 31 Jan → 28 Feb → 31 Mar. Moving a chore to a new date moves its anchor day. Undoing removes the next occurrence only if nobody has touched it (status, payment or date). Deleting an occurrence clears the link to it.
- **Concurrency.** Bill/recurrence updates, pantry batches and recipe saves run in `BEGIN IMMEDIATE` transactions.
- **Recipe import.** A link is read from the page's schema.org `Recipe` JSON-LD when present; otherwise the page text goes to the local model. Links to `localhost`, private and Tailscale addresses are refused, including after redirects. Pages are limited to 5 MB and 20 s.
- **Ingredients.** Each line is kept as written and parsed into `name`, `quantity` and `unit` (`1½ cups basmati rice, rinsed` → `basmati rice`, 1.5, `cup`). Lines without an amount get quantity 0.
- **Links.** Only public `http(s)` URLs are stored for `source_url` and `image_url` (no `javascript:`, no home-network addresses).
- **Edit conflicts.** Pantry items, recipes and expenses have a `version` that every change increments (including `+`/`−` adjustments and batch top-ups). A `PUT` that sends `version` only applies if it still matches; otherwise the response is `409 {"error", "current"}` with the row as it is now, and nothing is written. Omitting `version` keeps last-write-wins for scripts. Successful updates return the new `version`.
- **Schema rules.** All tables are `STRICT` and carry `CHECK` constraints and foreign keys (migration `20261128000000`): real dates (`date(x) IS x`), amounts > 0 for expenses and budgets, quantities ≥ 0, points 0–1000, `repeat_day` 1–31, fixed sets for status, priority, slot and repeat, non-blank names. `recipe_ingredients` cascade with their recipe; `pantry_items.expense_id`, `chores.expense_id` and `chores.next_id` are set to NULL when the row they point at is deleted. Category names are not constrained in the database.
- **Validation.** Dates must be real calendar dates; amounts and quantities finite and not negative; `status`, `priority`, `slot` and `repeat` from their fixed sets; names non-empty and bounded. Errors are `400 {"error"}`.
- **Request guard** (`guard.rs`). Unknown `Host` → 421; a write whose `Origin` doesn't match the host → 403. CSP, `nosniff`, `DENY` framing and `no-referrer` on every response. Bodies are limited to 1 MB, 20 MB on the photo routes.
- **Local AI.** One request at a time (others wait up to 2 min, then 503); 5 min timeout (504); replies are capped at 2,048 tokens. An unreadable reply is a 502, never a blank result.
- **Live sync.** At most 32 open `/events` streams.

## Commands

```bash
cargo run      # serves ../web on :3000 using ../data/rosie.db
cargo check
cargo test     # dates, amounts, ingredient parsing, recipe extraction, link and host safety
```
