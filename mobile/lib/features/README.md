# Features Domain Package (`mobile/lib/features`)

**EGM Role**: Intermediate Subtree Rollup ("Hay")  
**Parent Contract**: [Mobile Blueprint](../README.md)  

---

## Domain Modules & Contracts

Each feature module is encapsulated with its own presentation, state, and domain boundaries:

```
features/
├── home/
│   └── presentation/home_screen.dart        # Central Hearth Hub view
├── pantry/
│   └── presentation/pantry_screen.dart      # Smart Grocery & Pantry inventory
├── meals/
│   └── presentation/meal_planner_screen.dart# Weekly meal planning schedule
├── chores/
│   └── presentation/chores_screen.dart      # Chore Kanban board & habit tracker
├── expenses/
│   └── presentation/expenses_screen.dart    # Cost segregation & budget tracker
└── recipes/
    └── presentation/recipe_box_screen.dart  # Recipe catalog & preparation guides
```

---

## Subsystem Contracts & Invariants

1. **Isolation**: Modules must not import private widgets or internal states across feature boundaries; shared contracts belong in `core/`.
2. **Material 3 UI Cleanliness**:
   - Surface elevations must use `AppTheme.surfaceContainer*` tonal levels.
   - Text colors must use `AppTheme.textPrimary`, `AppTheme.textSecondary`, or `AppTheme.textMuted`.
   - Card radii must conform to standard 16dp rounded corners with subtle borders.
3. **Data Fetching**: All remote requests must resolve via Riverpod providers watching `dioProvider`.
