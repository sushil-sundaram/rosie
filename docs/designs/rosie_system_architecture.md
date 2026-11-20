# EGM Design Specification: Rosie Autonomous Home Management System

**Status**: Approved & Active  
**Framework**: Elephant-Goldfish Model (EGM)  
**System**: Rosie (Household Automation & Coordination Assistant)  
**Version**: 1.1.0  

---

## 1. System Vision & Context

Inspired by Rosie the Robot from *The Jetsons*, **Rosie** is a unified household operating system and personal companion designed to eliminate friction in daily household management. Rosie balances chores, coordinates weekly meals and groceries, monitors pantry inventory, and segregates shared living expenses into clear, equitable splits with local AI assistance.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Rosie Client (Flutter M3)                       │
├─────────────┬─────────────┬──────────────┬──────────────┬──────────────┤
│  Home Hub   │   Pantry    │ Meal Planner │ Chores Board │   Expenses   │
│ (Overview)  │  (Grocery)  │ (Recipe Box) │   (Kanban)   │ (AI Scanner) │
└─────────────┴─────────────┴──────────────┴──────────────┴──────────────┘
                               │ HTTP / JSON (Dio)
                               ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        Rosie Backend (Rust Axum)                       │
├────────────────────────────────────────────────────────────────────────┤
│ REST Endpoints: /health, /pantry, /recipes, /chores, /expenses        │
│ Vision Pipeline: POST /expenses/scan-receipt                           │
│ Database: SQLite (SQLx Migrations) in persistent /app/data volume      │
└────────────────────────────────────────────────────────────────────────┘
                               │ HTTP / JSON
                               ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     Local Ollama Vision (Host GPU)                     │
│ Models: llama3.2-vision, minicpm-v, llava (zero cloud exposure)       │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Architectural Pillars

### 2.1 The Elephant (Persistent Domain Contracts)
Rosie maintains long-horizon context of:
- **Household Members**: Equitably distributed chores, assigned tasks, and spending balances.
- **Pantry & Grocery State**: Inventory quantities, threshold-triggered replenishment, and aisle-categorized shopping lists.
- **Meal Planning & Recipes**: Weekly scheduling, nutritional balances, missing ingredient detection.
- **Budget & Cost Segregation**: Recurring overhead vs. grocery vs. utility splits across members.
- **Local AI Context**: Schema extraction prompts for receipt parsing without external API leaks.

### 2.2 The Goldfish (Isolated Reviewable Units)
Every feature module (`home`, `pantry`, `meals`, `chores`, `expenses`, `recipes`) operates within bounded subcontexts with strict contracts, allowing zero-context validation, individual testing, and clean refactoring without cross-module regressions.

---

## 3. Subsystem Specifications

### 3.1 Central Hearth Hub (`/`)
- **Purpose**: At-a-glance household vitals, Rosie companion recommendations ("Rosie Hearth Whisper"), urgent chores due, tonight's dinner suggestion, and month-to-date spending.
- **Design Invariant**: The Hub does not store primary state; it reads aggregated projections from Chores, Meals, Pantry, and Expenses.

### 3.2 Smart Grocery & Pantry (`/pantry`)
- **Endpoints**: `GET /pantry`, `POST /pantry`
- **Model**: `id`, `name`, `quantity`, `unit`
- **UI Contract**: Material 3 elevated card list with category badges, stock indicators, and quick-add replenishment.

### 3.3 Recipe Box & Weekly Meal Planner (`/meals`)
- **Endpoints**: `GET /recipes`
- **Model**: `id`, `title`, `description`, `prep_time_minutes`, `cook_time_minutes`
- **UI Contract**: Segmented tabs (`Weekly Plan`, `Recipe Box`, `Smart Grocery`), preparation timers, macro breakdown, and instant ingredient export to pantry/grocery list.

### 3.4 Chore Kanban Board & Habit Tracker (`/chores`)
- **Endpoints**: `GET /chores`, `POST /chores`
- **Model**: `id`, `title`, `assigned_to`, `status`, `points`, `due_date`
- **Workflow State Machine**:
  `[To Do]` ──(claim/start)──► `[In Progress]` ──(verify/complete)──► `[Done]`
- **UI Contract**: Hearth Harmony sync indicator, point rewards, assignee chips, and priority tags.

### 3.5 Cost Segregation & Household Expenses (`/expenses`)
- **Endpoints**: `GET /expenses`, `POST /expenses`, `POST /expenses/scan-receipt`
- **Model**: `id`, `title`, `amount`, `category`, `date`
- **UI Contract**: Monthly burn rate, category segregation breakdown, camera receipt scanning, confirmation modal, and settle-up ledger.

---

## 4. Local AI Receipt Vision Architecture

Rosie utilizes a local-first Vision-Language Model pipeline running completely on-premise/host:
1. **Camera / Gallery Capture**: Mobile client captures receipt via `image_picker` (scaled to max 1600px, 85% quality).
2. **Payload Transmission**: Base64 encoded payload sent to `POST /expenses/scan-receipt`.
3. **Local VLM Inference**:
   - Backend calls host Ollama (`http://localhost:11434/api/generate` or `http://host.docker.internal:11434/api/generate`).
   - Uses `llama3.2-vision` (or configured `OLLAMA_VISION_MODEL`).
   - Strict JSON Schema enforcing `{ title, amount, category, date }`.
4. **User Confirmation**: The extracted data is returned to the Flutter app and pre-fills an M3 Confirmation Dialog, allowing the user to audit and adjust before saving.
5. **Zero Cloud Telemetry**: Raw receipt images never leave the local network mesh.

---

## 5. Containerization & Deployment

Rosie provides enterprise-ready Docker containerization:
* **Multi-Stage Dockerfile**: Builds in `rust:1.80-slim-bookworm` and produces a clean, minimal runtime in `debian:bookworm-slim`.
* **Docker Compose**: Orchestrates `rosie-server` with:
  - Persistent volume `./data:/app/data` for SQLite.
  - Port `3000:3000` exposed for Tailscale or local traffic.
  - `extra_hosts: ["host.docker.internal:host-gateway"]` to route Ollama calls directly to the host GPU.

---

## 6. Verification & Quality Gates

In accordance with EGM verification standards:
* **Mobile Linter**: `flutter analyze` must report **0 issues**.
* **Mobile Unit Tests**: `flutter test` must pass all test suites.
* **Backend Build**: `cargo check` must build with zero warnings.
* **Unified Verification Command**: `./scripts/verify_all.sh` executes the full quality gate.
