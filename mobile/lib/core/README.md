# Core Infrastructure Package (`mobile/lib/core`)

**EGM Role**: Component Package Contract ("Peanuts")  
**Parent Contract**: [Mobile Blueprint](../../README.md)  

---

## Exposed Interfaces & Contracts

| Module | File | Responsibility & Interfaces |
|---|---|---|
| **Theme** | `theme/app_theme.dart` | Exports `AppTheme.darkTheme` conforming to Google Material Design 3. Exposes color tokens, tonal surfaces, text styling via GoogleFonts, and component themes. |
| **Navigation** | `navigation/app_router.dart` | Exports `routerProvider` (GoRouter). Configures ShellRoute with Material 3 `NavigationBar` for `/`, `/pantry`, `/meals`, `/chores`, `/expenses`. |
| **Networking** | `network/api_client.dart` | Exports `dioProvider` initialized with `BaseOptions` targeting the Tailscale home server node. |
| **Config** | `config/api_config.dart` | Stores `tailscaleServerIp`, `port`, and `baseUrl` configuration. |

---

## Invariants & Guarantees

1. `app_theme.dart` MUST maintain consistent Material 3 tokens without resorting to deprecated `background` or `MaterialStateProperty` properties.
2. `api_client.dart` network timeouts MUST fail gracefully within 5 seconds to preserve UI responsiveness.
3. All navigation paths MUST map to valid routes defined in `app_router.dart`.
