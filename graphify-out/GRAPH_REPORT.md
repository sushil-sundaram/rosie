# Graph Report - munchbox  (2026-09-12)

## Corpus Check
- 9 files · ~772 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 53 nodes · 67 edges · 8 communities (7 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- pantry_screen.dart
- api_config.dart
- api_client.dart
- routes.rs
- main.dart
- main
- models.rs
- server

## God Nodes (most connected - your core abstractions)
1. `add_pantry_item()` - 6 edges
2. `get_pantry()` - 5 edges
3. `get_recipes()` - 5 edges
4. `main()` - 4 edges
5. `PantryScreen` - 3 edges
6. `pantryItemsProvider` - 3 edges
7. `PantryItem` - 3 edges
8. `app_router()` - 3 edges
9. `health_check()` - 3 edges
10. `build` - 2 edges

## Surprising Connections (you probably didn't know these)
- `add_pantry_item()` --references--> `PantryItem`  [EXTRACTED]
  server/src/routes.rs → server/src/models.rs

## Import Cycles
- None detected.

## Communities (8 total, 1 thin omitted)

### Community 0 - "pantry_screen.dart"
Cohesion: 0.28
Nodes (8): ConsumerWidget, ../../core/network/api_client.dart, build, dio, pantryItemsProvider, PantryScreen, response, package:flutter_riverpod/flutter_riverpod.dart

### Community 1 - "api_config.dart"
Cohesion: 0.25
Nodes (7): ApiConfig, baseUrl, port, tailscaleServerIp, static const int, static const String, static String get

### Community 2 - "api_client.dart"
Cohesion: 0.29
Nodes (6): ../config/api_config.dart, Dio, dio, dioProvider, package:dio/dio.dart, return

### Community 3 - "routes.rs"
Cohesion: 0.42
Nodes (10): IntoResponse, Json, Router, add_pantry_item(), app_router(), get_pantry(), get_recipes(), health_check() (+2 more)

### Community 4 - "main.dart"
Cohesion: 0.29
Nodes (6): features/pantry/presentation/pantry_screen.dart, build, main, MunchBoxApp, package:flutter/material.dart, StatelessWidget

### Community 5 - "main"
Cohesion: 0.40
Nodes (4): Box, Error, Result, main()

### Community 6 - "models.rs"
Cohesion: 0.60
Nodes (4): PantryItem, Recipe, RecipeIngredient, String

## Knowledge Gaps
- **11 isolated node(s):** `ApiConfig`, `tailscaleServerIp`, `port`, `baseUrl`, `dioProvider` (+6 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `add_pantry_item()` connect `routes.rs` to `models.rs`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **What connects `ApiConfig`, `tailscaleServerIp`, `port` to the rest of the system?**
  _11 weakly-connected nodes found - possible documentation gaps or missing edges._