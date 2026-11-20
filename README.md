# Rosie

A local-first household app — pantry, meals, chores and money — that runs on one machine in your home and keeps every byte off the public cloud. Named after Rosie the robot from *The Jetsons*.

[![Rust](https://img.shields.io/badge/server-Rust%20%C2%B7%20Axum%20%C2%B7%20SQLite-orange)](server/)
[![Web](https://img.shields.io/badge/web-vanilla%20JS%20%C2%B7%20Dracula-bd93f9)](web/)
[![Flutter](https://img.shields.io/badge/mobile-Flutter-blue)](mobile/)
[![AI](https://img.shields.io/badge/AI-Ollama%20(local)-white)](https://ollama.com)

---

## What it does

| Area | Highlights |
|---|---|
| **Home** | One month calendar combining meals, chores, bills and spending, with layer toggles and quick-add for any day. |
| **Chores** | Month calendar or kanban board. Drag to reschedule, click to cycle *to do → doing → done*, points per person. Repeat weekly or monthly. |
| **Meals** | Month planner with breakfast / lunch / dinner slots; pick from the recipe box or type a meal. |
| **Expenses** | Calendar of daily spend, monthly budgets per category with pace (“₹x left · ~₹y/day”), bills to pay, and **receipt scanning** with a local vision model. |
| **Bills** | Added from Expenses, they show up as chores on their due date. Paying one logs it as an expense; un-paying removes it. Repeat monthly or yearly — the next bill is created when you pay, and future ones preview on the calendar. |
| **Pantry** | Inventory with low-stock and expiry tags. **Add from photo** (fridge, shelf, grocery haul). Items from a scanned receipt link back to the expense they were bought with. |
| **Recipes** | A simple recipe box. |
| **Settings** | Household currency (₹ INR by default, shared); dark / light / system theme (per device, also on the header toggle). |

Everyone in the house sees the same data: changes appear **live** on every open screen, without clobbering what someone is typing.

---

## Run it

Requires Docker. Receipt and photo scanning also need [Ollama](https://ollama.com) on the same machine.

```bash
docker compose up -d --build
```

Open **http://localhost:3000**. Data lives in `./data/rosie.db` (SQLite, git-ignored).

For receipt and pantry-photo scanning:

```bash
ollama pull llama3.2-vision
```

### Use it from phones

The container listens on port 3000 of the host. Let other devices on your network in (Fedora/firewalld shown):

```bash
sudo firewall-cmd --permanent --add-port=3000/tcp && sudo firewall-cmd --reload
```

Then browse to `http://<this-machine's-LAN-IP>:3000`. Away from home, use the machine's [Tailscale](https://tailscale.com) address instead — nothing needs exposing to the internet.

### Configuration

Set in [`docker-compose.yml`](docker-compose.yml):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATABASE_URL` | `sqlite:///app/data/rosie.db` | SQLite file (mounted from `./data`) |
| `TZ` | `Asia/Kolkata` | Household timezone — decides “today” when a paid bill becomes an expense |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama endpoint (host networking makes the host's loopback reachable) |
| `OLLAMA_VISION_MODEL` | `llama3.2-vision` | Model used for receipts and pantry photos |

---

## How it's built

```
rosie/
├── web/              # The web app: index.html, app.js, app.css — no build step
├── server/           # Rust (Axum + SQLx/SQLite) API; also serves web/
│   ├── migrations/   # Applied automatically at startup
│   └── src/          # routes.rs (REST + Ollama), sync.rs (live updates), models.rs
├── mobile/           # Flutter client (earlier, Material 3; uses the same API)
├── docs/designs/     # System architecture spec
├── scripts/          # verify_all.sh, run_app.sh
└── docker-compose.yml
```

- **One process, one database.** The Rust server owns a single SQLite file (WAL mode). Every device talks to it, so there is nothing to merge.
- **Live sync.** Each successful write is announced on `GET /api/events` (Server-Sent Events). Open screens refresh; a screen where someone is mid-typing waits and shows an orange dot until they're done.
- **Safe under concurrency.** Pantry ± is relative (`quantity + delta`), and bill payment / recurrence run in write-locked transactions, so two people acting at once don't double-count or lose updates.
- **Local AI only.** Images go to Ollama on this machine and nowhere else; results are always shown for review before anything is saved.
- **Web UI.** Plain JavaScript with a tiny DOM helper, the [Dracula](https://draculatheme.com) palette in dark mode and Alucard in light mode.

API reference: [`server/README.md`](server/README.md).

---

## Develop

Run the server natively (serves `../web` and uses `../data/rosie.db`):

```bash
cd server && cargo run
```

Edit files in `web/` and reload the browser. For the Docker build, rebuild after changes:

```bash
docker compose up -d --build
```

Full check (Flutter analyze + tests, `cargo check`):

```bash
./scripts/verify_all.sh
```
