# Rosie Mobile Client (`mobile`)

**Framework**: Flutter (Dart 3.x)  
**UI Standard**: Google Material Design 3 (M3)  
**Parent Contract**: [Rosie Root Architecture Blueprint](../README.md)  
**EGM Specification**: [docs/designs/rosie_system_architecture.md](../docs/designs/rosie_system_architecture.md)

---

## Architecture Overview

The mobile client is built on a modular, feature-oriented architecture adhering to Google's Elephant-Goldfish Model (EGM) standards.

```
mobile/lib/
├── core/                   # [Peanuts] Cross-cutting infrastructure
│   ├── config/             # Environment & Tailscale endpoint config
│   ├── navigation/         # GoRouter with Material 3 NavigationBar
│   ├── network/            # Dio HTTP client configured for local mesh
│   └── theme/              # Material 3 dark color scheme & typography
│
└── features/               # [Hay] Domain feature modules
    ├── home/               # Central Hearth Hub & daily summary
    ├── pantry/             # Smart Grocery List & inventory tracking
    ├── meals/              # Weekly Meal Planner & schedule
    ├── chores/             # Chore Kanban Board & habit tracker
    ├── expenses/           # Cost segregation & AI Receipt Scanner (Camera)
    └── recipes/            # Recipe Box & step-by-step cooking guide
```

---

## Camera Access & Local AI Receipt Scanner

* **Hardware Access**: Integrated via `image_picker` with native permissions:
  * Android: `android.permission.CAMERA`, `READ_MEDIA_IMAGES`
  * iOS: `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`
* **Workflow**:
  1. Open `/expenses` and tap **Scan Receipt**.
  2. Take a photo or choose from gallery.
  3. Image is securely sent to `/expenses/scan-receipt` on the Rosie backend.
  4. Local AI (Ollama) parses the merchant, amount, category, and date.
  5. An M3 Confirmation Dialog lets you review and adjust before saving.

---

## Verification & Test Commands

* **Linting / Static Analysis**:
  ```bash
  flutter analyze
  ```
* **Automated Tests**:
  ```bash
  flutter test
  ```
