# 🍱 MunchBox

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Rust](https://img.shields.io/badge/Rust-Axum%20%7C%20SQLx-orange)
![Flutter](https://img.shields.io/badge/Flutter-Riverpod%20%7C%20Dio-blue)
![Tailscale](https://img.shields.io/badge/Networking-Tailscale-white)

MunchBox is a **secure, cross-platform, local-first meal planner and pantry manager**. Designed with privacy in mind, MunchBox relies entirely on your private network via a **Tailscale mesh VPN**, ensuring your personal data never touches a public cloud, all without the hassle of port-forwarding or public DNS.

---

## 🏗️ How It Works (The Architecture)

MunchBox is built on a two-component architecture:

1. **Home Server (Rust)**
   - Powered by [Axum](https://github.com/tokio-rs/axum) and [SQLx](https://github.com/launchbadge/sqlx).
   - Uses a single-file SQLite database running in WAL (Write-Ahead Logging) mode, offering fantastic performance and concurrent reads for a self-hosted environment.
   - Listens on `0.0.0.0:3000` to capture traffic coming from your Tailnet.

2. **Mobile Client (Flutter)**
   - A modern mobile app for Android and iOS.
   - Built with [Riverpod](https://riverpod.dev/) for robust state management. It provides "optimistic UI" capabilities so the app feels instant, even if the connection to the home server temporarily drops.
   - Communicates securely using [Dio](https://pub.dev/packages/dio) to the Tailscale `100.x.x.x` CGNAT IP range.

### 🔒 Security Without the Headache
Because all traffic runs through WireGuard via Tailscale, the transport layer is fully encrypted. We configured the mobile clients (via Android's `network_security_config.xml` and iOS's `Info.plist`) to allow cleartext HTTP directly over the `100.64.0.0/10` subnet. This gives you the security of a VPN without the complexity of managing SSL certificates on a local Raspberry Pi or Mini PC!

---

## 💻 Code Snippets

### 🦀 Rust Server Entry
The Axum server spins up a connection pool to SQLite and binds to all interfaces, waiting for Tailscale traffic:

```rust
// server/src/main.rs
let connection_options = SqliteConnectOptions::from_str("sqlite://../data/munchbox.db")?
    .create_if_missing(true)
    .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);

let pool = SqlitePoolOptions::new()
    .max_connections(5)
    .connect_with(connection_options).await?;

sqlx::migrate!("./migrations").run(&pool).await?;

let app = routes::app_router(pool).layer(CorsLayer::permissive());
let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await?;

tracing::info!("listening on {}", listener.local_addr()?);
axum::serve(listener, app).await?;
```

### 📱 Flutter Network Configuration
The Dio client points directly to your Tailscale node's static IP or MagicDNS:

```dart
// mobile/lib/core/config/api_config.dart
class ApiConfig {
  // Replace with your actual Server's Tailscale IP
  static const String tailscaleServerIp = '100.64.0.0'; 
  static const int port = 3000;
  static String get baseUrl => 'http://$tailscaleServerIp:$port';
}

// mobile/lib/core/network/api_client.dart
final dioProvider = Provider<Dio>((ref) {
  return Dio(BaseOptions(
    baseUrl: ApiConfig.baseUrl,
    connectTimeout: const Duration(seconds: 5),
  ));
});
```

---

## 🚀 How to Run It

### Prerequisites
- [Rust & Cargo](https://rustup.rs/) (for the server)
- [Flutter SDK](https://docs.flutter.dev/get-started/install) (for the mobile app)
- [Tailscale](https://tailscale.com/) installed on both your server machine and your mobile device.

### 1. Start the Server (PC)

Run this on the machine acting as your "Home Server":

```bash
cd server

# The SQLite database is automatically generated in ../data/munchbox.db
cargo run
```
*Note: Make sure this machine is connected to your Tailscale network. You can find its IP by running `tailscale ip`.*

### 2. Configure & Run the Mobile App (Mobile/Emulator)

1. Open `mobile/lib/core/config/api_config.dart`.
2. Update the `tailscaleServerIp` variable to match the IP address of your Rust server.
3. Make sure the mobile device (or emulator) has the Tailscale app installed, active, and logged into the same Tailnet as your server.

```bash
cd mobile

# Fetch dependencies
flutter pub get

# Run on your connected device
flutter run
```

---

## 🛠️ Project Structure

```text
munchbox/
├── server/                    # Rust backend
│   ├── Cargo.toml
│   ├── migrations/            # SQLx schema migrations
│   └── src/
│       ├── main.rs            # Axum entry point
│       ├── models.rs          # PantryItem & Recipe structs
│       └── routes.rs          # API Handlers
└── mobile/                    # Flutter frontend
    ├── pubspec.yaml
    ├── android/               # Contains Android Tailscale network exceptions
    ├── ios/                   # Contains iOS ATS Tailscale exceptions
    └── lib/
        ├── core/              # Dio client and configurations
        └── features/          # Riverpod providers and UI screens
```
