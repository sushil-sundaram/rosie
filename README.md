# 🤖 Rosie: Local-First Smart Household Operating System

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![EGM Spec](https://img.shields.io/badge/EGM-Spec%20Driven-green)](docs/designs/rosie_system_architecture.md)
[![Rust](https://img.shields.io/badge/Rust-Axum%20%7C%20SQLx-orange)](server/)
[![Flutter](https://img.shields.io/badge/Flutter-M3%20%7C%20Riverpod-blue)](mobile/)
[![Networking](https://img.shields.io/badge/Networking-Tailscale%20Mesh-white)](https://tailscale.com)

Rosie is a **secure, local-first, privacy-respecting household operating system** inspired by Rosie the Robot from *The Jetsons*. Rosie orchestrates smart grocery replenishment, weekly meal schedules, chore assignments with Kanban progression, and equitable household expense segregation over an encrypted **Tailscale mesh VPN**.

---

## 🏛️ EGM Architecture Blueprint ("Hay")

Rosie's architecture and development follow Google's **Elephant-Goldfish Model (EGM)**:
* **The Elephant (Specification)**: [`docs/designs/rosie_system_architecture.md`](docs/designs/rosie_system_architecture.md) specifies system invariants, API contracts, domain entities, and M3 UI standards.
* **Component Packages ("Peanuts")**: Modular subtrees maintain bounded context and explicit interface contracts:
  * [`mobile/`](mobile/README.md): Material 3 Flutter client (Riverpod state management, GoRouter, Dio networking).
  * [`server/`](server/README.md): High-performance Rust backend (Axum async HTTP, SQLite WAL, SQLx migrations).
* **The Goldfish (Subagent Quality Gates)**: Bounded modules reviewed independently without cross-domain pollution.

```
rosie/
├── docs/designs/
│   └── rosie_system_architecture.md  # Formal EGM Design Specification
├── mobile/                           # Flutter Material Design 3 Client
│   ├── lib/core/                     # Theme, Router, Network contracts
│   └── lib/features/                 # Home, Pantry, Meals, Chores, Expenses
├── server/                           # Rust Axum Backend & Migrations
│   ├── migrations/                   # SQLite schema evolution scripts
│   └── src/                          # Route handlers and data models
└── scripts/                          # Automated verification and workflow tools
    ├── verify_all.sh                 # Unified EGM verification suite
    └── run_app.sh                    # Automated launch script
```

---

## 🎨 Google Material Design 3 (M3) System

The mobile application implements Google's modern **Material Design 3**:
* **Material You Surface Hierarchy**: Dynamic surface tokens (`surfaceContainerLowest` through `surfaceContainerHighest`) with tonal elevation.
* **M3 Navigation**: Bottom `NavigationBar` with `NavigationDestination` selection pills.
* **Clean Components**: 16dp rounded cards with subtle outline borders, M3 `FloatingActionButton`, and `SegmentedButton`.
* **Zero Analyzer Issues**: Fully updated to the latest Flutter SDK standards without deprecated APIs.

---

## ⚡ Quick Start & Verification

### Unified EGM Quality Gate
Run the all-in-one verification suite:
```bash
./scripts/verify_all.sh
```
This runs:
1. `flutter analyze` (Zero issues required)
2. `flutter test` (Widget & unit test suites)
3. `cargo check` (Rust server compilation check)

### Running the Web App (Docker)
The Rust server also serves a minimalist, Dracula-themed web UI from [`web/`](web/).
```bash
docker compose up -d --build
```
Then open http://localhost:3000. Data persists in `./data/rosie.db`. The REST API is available at both `/api/*` (web) and the bare paths (mobile).

> The container uses host networking so receipt scanning can reach Ollama at `127.0.0.1:11434`. Scanning needs a vision model: `ollama pull llama3.2-vision` (or set `OLLAMA_VISION_MODEL`).

### Running Rosie (native)
1. **Start the Backend Server**:
   ```bash
   cd server
   cargo run
   ```
2. **Start the Flutter Client**:
   ```bash
   cd mobile
   flutter run
   ```

---

## 🔒 Security & Privacy
Rosie routes all internal traffic over an encrypted Tailscale WireGuard mesh (`100.64.0.0/10`), keeping sensitive household inventory, financial splits, and chore schedules entirely local and off public cloud servers.
