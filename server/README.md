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
    └── models.rs     # Serde / FromRow types
```

## Configuration

| Env | Default (native) | Notes |
|---|---|---|
| `DATABASE_URL` | `sqlite://../data/rosie.db` | Created if missing |
| `WEB_DIR` | `../web` | Static web app; unknown paths fall back to `index.html` |
| `PORT` | `3000` | |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | |
| `OLLAMA_VISION_MODEL` | `llama3.2-vision` | Per-request override: `model` in the scan body |
| `OLLAMA_TEXT_MODEL` | `OLLAMA_VISION_MODEL` | Reads pasted recipes and pages without recipe data |
| `TZ` | system | Used for “today” when logging a paid bill |

## API

All routes are served under `/api` (for example `GET /api/pantry`). Request and response bodies are JSON. Writes send an optional `X-Client-Id` header so live-sync can skip the sender's own echo.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | `{"status":"ok"}`; used by the container health check |
| `GET` | `/events` | Server-Sent Events: one `{"by","path"}` message per successful write |
| `GET` · `PUT` | `/settings` | `{"currency":"INR","locale":"en-IN"}`; PUT accepts only known keys |
| **Pantry** | | |
| `GET` · `POST` | `/pantry` | List / add `{name, quantity, unit, expires_on?}` |
| `PUT` · `DELETE` | `/pantry/{id}` | Replace / remove an item |
| `POST` | `/pantry/{id}/adjust` | `{delta}` — relative change, never below 0 |
| `POST` | `/pantry/batch` | `{items:[…], expense_id?}` — tops up items with the same name+unit, otherwise inserts; links to an expense |
| `POST` | `/pantry/scan-photo` | `{image_base64}` → `{items:[{name, quantity, unit}]}` |
| **Recipes & meals** | | |
| `GET` · `POST` | `/recipes` | `{name, instructions, servings?, time_minutes?, source_url?, image_url?, ingredients: ["1 cup toor dal", …]}`; POST returns `{id}`. GET returns each ingredient as `{text, name, quantity, unit}` |
| `PUT` · `DELETE` | `/recipes/{id}` | Replace a recipe and its ingredients / remove it (also unlinks it from planned meals) |
| `POST` | `/recipes/import` | One of `{url}`, `{text}` or `{image_base64}` → an unsaved draft `{name, servings, time_minutes, source_url, image_url, ingredients, instructions, method}`; `method` is `structured` or `ai` |
| `GET` · `POST` | `/meals` | `{date, slot, title, recipe_id?}` — slot is breakfast, lunch or dinner |
| `PATCH` · `DELETE` | `/meals/{id}` | PATCH `{date}` to reschedule |
| **Chores & bills** | | |
| `GET` · `POST` | `/chores` | `{title, assigned_to, priority, status, points, due_date?, repeat?, amount?, category?}` — an `amount` makes it a bill |
| `PATCH` · `DELETE` | `/chores/{id}` | PATCH any of `{status, due_date, repeat}` (`""` clears a date or stops repeating) |
| **Expenses & budgets** | | |
| `GET` · `POST` | `/expenses` | `{title, amount, category, date}`; POST returns `{id}` |
| `DELETE` | `/expenses/{id}` | Unlinks pantry items bought with it |
| `POST` | `/expenses/scan-receipt` | `{image_base64}` → `{title, amount, category, date, items}` |
| `GET` | `/budgets` | `[{category, amount}]` — monthly, repeats every month |
| `PUT` | `/budgets/{category}` | `{amount}`; 0 removes the budget |

### Rules worth knowing

- **Bills.** Setting a bill's status to `done` inserts an expense dated today and stores its `expense_id`; moving it out of `done` deletes that expense. Repeated `done` calls never log twice.
- **Recurrence.** Completing a repeating chore/bill creates the next one (`next_id`). Monthly/yearly keep the original day of month (`repeat_day`), clamped to the month's end: 31 Jan → 28 Feb → 31 Mar. Undoing removes the next occurrence only if nobody has touched it.
- **Concurrency.** Bill/recurrence updates, pantry batches and recipe saves run in `BEGIN IMMEDIATE` transactions.
- **Recipe import.** A link is read from the page's schema.org `Recipe` JSON-LD when present; otherwise the page text goes to the local model. Links to `localhost`, private and Tailscale addresses are refused, including after redirects. Pages are limited to 5 MB and 20 s.
- **Ingredients.** Each line is kept as written and parsed into `name`, `quantity` and `unit` (`1½ cups basmati rice, rinsed` → `basmati rice`, 1.5, `cup`). Lines without an amount get quantity 0.
- **Links.** Only `http(s)` URLs are stored for `source_url` and `image_url`.

## Commands

```bash
cargo run      # serves ../web on :3000 using ../data/rosie.db
cargo check
cargo test     # ingredient parsing, recipe extraction, link safety
```
