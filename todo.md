# Rosie Improvement Plan (`todo.md`)

Actionable checklist from the security, UX, and architecture audit covering both phone and laptop/desktop usage.

---

## P0 — Immediate Bug Fixes & Quick Wins

- [x] **Fix broken SQL parameters in `PUT /api/pantry/{id}`** (`server/src/routes.rs:76-85`)
  - `?1` currently binds `payload.name` instead of `expiry` (parameter 4), and `WHERE id = ?` binds `expiry` instead of `id` (parameter 5).
  - Switch to explicit numbered parameters or clean positional bindings, and add an integration test for `PUT /api/pantry/{id}`.
- [x] **Guard `from[8..]` against malformed dates in `apply_chore_update`** (`server/src/routes.rs:307-316`)
  - Ensure `valid_date(&from)` (or safe `.get(8..)`) is checked before slicing `from[8..]` so legacy/unexpected DB strings can never panic.
- [x] **Allow gallery/screenshot uploads on mobile** (`web/app.js:437`)
  - Remove `capture: "environment"` from the file `<input>` in `photoButton()` while keeping `accept="image/*"`, so iOS/Android users can choose *either* the camera or an existing photo/screenshot.
- [x] **Validate `category` and numeric bounds consistently on the backend** (`server/src/routes.rs`)
  - Constrain `put_budget` (`L456-480`), `add_expense` (`L688-721`), and `add_chore` (`L620-673`) categories (trim + validate against allowed categories or normalized set).
  - Clamp `add_pantry_batch` (`L918`) with `min(1e9, ...)` to match `adjust_pantry_item` (`L108`).
  - Trim `put_settings` (`L416-420`) values *before* length/character validation.
  - Normalize/clamp AI-returned `title` and `category` in `scan_receipt` (`L861-867`).
- [x] **Validate dropped calendar payload IDs on the client** (`web/app.js:178-180, 253-261`)
  - Verify `Number.isInteger(Number(id))` and allowed `kind` before interpolating into `/chores/${id}` or `/meals/${id}`.

---

## P1 — Security & Transport Hardening

- [ ] **Put Rosie behind HTTPS + authentication** (`server/src/main.rs:59-63`, `docker-compose.yml`)
  - Bind Axum to `127.0.0.1:3000` by default instead of `0.0.0.0` when proxied.
  - Serve over HTTPS via **Tailscale Serve** (tailnet access) and/or **Caddy** (LAN HTTPS), unlocking browser Secure Context APIs (`crypto.randomUUID()`, Service Workers, PWA install, Screen Wake Lock, Web Share Target).
  - Add household authentication (passphrase/session cookie or trusted reverse-proxy identity header) so untrusted LAN devices/guests cannot read or delete household data.
- [x] **Tighten `guard.rs` request checks** (`server/src/guard.rs:35-96`)
  - Reject unsafe methods (`POST`, `PUT`, `PATCH`, `DELETE`) when *both* `Origin` and `Referer` are missing (or when `Sec-Fetch-Site` is `cross-site`), rather than passing requests with absent `Origin`.
  - Compare scheme as well as authority when behind TLS (`X-Forwarded-Proto`), and handle HTTP/2 `:authority` fallback when `header::HOST` is absent.
  - Tighten IPv6 `[...]` parsing in `host_name()` (`L35-38`) so characters after `]` are rejected.
  - Replace wildcard `.ts.net` (`L57`) with explicit tailnet/hostname entries via `ALLOWED_HOSTS`.
  - Apply security headers (`CSP`, `nosniff`, `X-Frame-Options`, `Referrer-Policy`) to early `421`/`403` guard responses too.
- [ ] **Isolate Docker container networking** (`docker-compose.yml:11`)
  - Replace `network_mode: host` with a bridge network + `127.0.0.1:3000:3000` port mapping and `extra_hosts: ["host.docker.internal:host-gateway"]` (if Ollama is exposed to the bridge), preventing container access to arbitrary host loopback services.
- [ ] **Eliminate third-party `image_url` tracking & redirect risk** (`server/src/recipes.rs:54-60`, `server/src/guard.rs:67`, `web/app.js:1080, 1114`)
  - Cache/proxy imported recipe images on the server under `/app/data/` (or gate remote loading), tighten CSP `img-src` to `'self' data:`, and return normalized `u.to_string()` from `web_link()`.
- [ ] **Harden recipe parsing & rate/resource limits**
  - Add per-IP or connection-age guardrails on `/api/events` SSE streams (`server/src/sync.rs:37`) and rate/concurrency protection on AI routes (`server/src/routes.rs:747`).
  - Use `to_ascii_lowercase()` instead of `to_lowercase()` before byte slicing in `parse_ingredient()` (`server/src/recipes.rs:346-353`).
  - Fix `fetch_page()` early-stop check (`server/src/recipes.rs:645-648`) so an inline `</html>` inside a `<script>` or comment doesn't truncate the page.
  - Strip or escape `<page>` / `</page>` and `<recipe>` / `</recipe>` sequences inside untrusted text before wrapping in prompt tags (`server/src/recipes.rs:1050-1058`).

---

## P2 — Architecture Upgrades (Cross-Device Performance & Reliability)

- [ ] **Decouple client data store from DOM rendering** (`web/app.js:567, 1139-1169`)
  - Cache fetched datasets in memory + `IndexedDB` (stale-while-revalidate) so switching selected days, toggling filters, or changing views renders immediately without firing 7 HTTP requests (`settings`, `pantry`, `chores`, `meals`, `expenses`, `recipes`, `budgets`) per tap.
- [ ] **Scope SSE refreshes by changed path** (`server/src/sync.rs:77`, `web/app.js:1228-1232`)
  - Use the `path` field already sent in `/api/events` payloads to refresh only the affected resource slice rather than re-fetching the entire database on every change.
- [ ] **Add query filtering / pagination on growing endpoints** (`server/src/routes.rs`)
  - Support date-window queries (e.g. `GET /api/expenses?month=YYYY-MM`, `GET /api/meals?from=...&to=...`) so mobile payloads stay small over years of household data.
- [ ] **Convert Ollama AI scans into async background jobs** (`server/src/routes.rs:772-785`, `web/app.js:449`)
  - Change `/expenses/scan-receipt`, `/pantry/scan-photo`, and `/recipes/import` (AI paths) to return `202 Accepted` with a `job_id`, execute Ollama in a background Tokio task, and emit job completion over `/api/events` (or `GET /api/jobs/{id}`).
  - Prevents lost results when a phone screen locks or the user switches tabs during 30–300 s local inference.
- [ ] **Make Rosie an installable PWA with offline reads** (`web/index.html`, new `manifest.webmanifest` + `sw.js`)
  - Add Web App Manifest (app icon, standalone display mode) and a lightweight Service Worker caching the app shell + read-only pantry/recipes for grocery store / poor-signal reliability.
  - Register **Web Share Target** in the manifest so mobile browsers can share a recipe link straight into Rosie.
- [ ] **Split `web/app.js` into native ES modules** (`web/app.js`, `web/index.html`)
  - Break the 1,240-line monolith into `<script type="module">` modules (`api.js`, `store.js`, `components/*`, `views/*`)—keeps zero build step and stays compatible with `script-src 'self'`.

---

## P3 — UX Improvements (Phone + Laptop/Desktop)

- [ ] **Responsive navigation & thumb-friendly touch targets** (`web/index.html`, `web/app.css`)
  - **Mobile (`<= 768px`)**: Move primary navigation to a fixed bottom tab bar (`Today`, `Pantry`, `Meals`, `Chores`, `Money`) with `>= 44×44 px` tap targets and safe-area padding; keep a slim top header for title, sync indicator, theme toggle, and Settings.
  - **Desktop (`> 960px`)**: Retain top nav (or sidebar rail) + keyboard shortcuts (`g h`, `g p`, `/` search, `n` new item, `Esc` dismiss).
- [ ] **Today-first mobile Home & Agenda layout** (`web/app.js:598-621`, `web/app.css:190-241`)
  - **Mobile**: Lead with **Today's Agenda** (tonight's meals, due chores/bills, today's expenses) + a compact horizontal 7-day week strip above the fold instead of burying today's details underneath a month grid of unreadable 6×6 px dots.
  - **Desktop**: Keep the 2-column split month calendar + sticky right day inspector.
- [ ] **Universal quick capture (`+` FAB / bottom sheet)**
  - Add a persistent `+` action on mobile (and shortcut/button on desktop) to log an expense, scan a receipt, add a pantry item, or add a chore in 1–2 taps from any screen.
- [ ] **Touch-friendly rescheduling & visible affordances** (`web/app.js:133-140, 209, 670`)
  - Keep drag-and-drop as a desktop shortcut, and add a tap-friendly **Move / Reschedule** date picker/quick actions (`Today`, `Tomorrow`, `+1 week`) on chores, bills, and meals.
  - Replace hover-only `title` tooltips with visible labels/pills (sync waiting banner, repeat badge actions, budget save feedback, linked-expense info).
  - Replace blocking `confirm()` dialogs (`web/app.js:104, 318`) with inline confirmation or an Undo toast.
- [ ] **Add Edit UIs across all entities**
  - Wire up pantry item editing (already partially stubbed in `web/app.js:898` and `PUT /api/pantry/{id}`) to edit name, quantity, unit, and expiry date.
  - Add `PATCH`/`PUT` editing for chores, bills, and expenses (title, amount, category, date, assigned member, priority, points).
- [ ] **Connect Meals, Recipes, and Pantry end-to-end** (`web/app.js:365, 712`)
  - Make meals with `recipe_id` clickable to open the recipe directly from `Home` and `Meals`.
  - Add **Cook Mode** on recipes (large step typography, checkable ingredients/steps, Screen Wake Lock via `navigator.wakeLock`).
  - Surface **pantry matching** using already-parsed `recipe_ingredients` (`name`, `quantity`, `unit`): show available vs. missing ingredients and allow 1-tap pantry deduction when cooking.
  - Replace the hardcoded `quantity <= 1` low-stock check (`web/app.js:576, 952`) with a per-item low-stock threshold (or unit-aware default).
- [ ] **Improve Chores, Bills, and Search/Filtering**
  - Add search & filters across Pantry (`All`, `Low`, `Expiring`) and Recipes (by name or ingredient).
  - Separate **Bills** cleanly on the Chores Kanban board (`web/app.js:678-694`): show bill amount tags and require an explicit `Pay` action (not silent 3-state cycling) with undo feedback.
  - Offer quick-pick chips / autocomplete of existing household members in chore/bill forms to avoid name typos splitting points.
  - Expose date inline in `expenseForm` (`web/app.js:532`) instead of hiding it, especially after receipt scanning.
- [ ] **Fix dark-mode text contrast & remove dead CSS** (`web/app.css`)
  - Brighten `--muted` (`#6272a4` on `#282a36`, `L7`) and `.cell.out .dn` (`L218`) for comfortable legibility on mobile screens outdoors.
  - Remove unused `.week-nav`, `.day`, and `.meal` classes (`L151-156`) if superseded by the new mobile agenda/week views.

---

## P4 — Verification & Testing

- [ ] Expand `server` tests (`cargo test`) to cover `PUT /api/pantry/{id}`, `guard.rs` missing/`Origin`/scheme/HTTP2 cases, `put_budget` validation, and `apply_chore_update` edge cases.
- [ ] Add Playwright/end-to-end responsive viewport smoke tests (e.g. `390×844` mobile touch + `1280×800` desktop) alongside `./scripts/verify_all.sh`.
