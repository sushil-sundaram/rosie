# Graph Report - munchbox  (2026-08-15)

## Corpus Check
- 16 files · ~7,377 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 95 nodes · 202 edges · 13 communities (10 shown, 3 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- backend/src/main.rs
- icons.rs
- sync_groceries_with_backend
- AppState
- storage.rs
- Recipe
- GroceryItem
- grocery.rs
- load_recipes
- shared
- rules/graphify.md
- workflows/graphify.md

## God Nodes (most connected - your core abstractions)
1. `Recipe` - 13 edges
2. `AppState` - 11 edges
3. `scrape_recipe_handler()` - 11 edges
4. `scrape_web_recipe()` - 10 edges
5. `scrape_youtube_recipe()` - 9 edges
6. `get_recipes_handler()` - 7 edges
7. `sync_recipes_handler()` - 7 edges
8. `delete_recipe_handler()` - 7 edges
9. `parse_ingredient_line()` - 7 edges
10. `get_groceries_handler()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `get_recipes_handler()` --references--> `Recipe`  [EXTRACTED]
  backend/src/main.rs → shared/src/lib.rs
- `sync_recipes_handler()` --references--> `Recipe`  [EXTRACTED]
  backend/src/main.rs → shared/src/lib.rs
- `scrape_recipe_handler()` --references--> `Recipe`  [EXTRACTED]
  backend/src/main.rs → shared/src/lib.rs
- `scrape_youtube_recipe()` --references--> `Recipe`  [EXTRACTED]
  backend/src/main.rs → shared/src/lib.rs
- `scrape_web_recipe()` --references--> `Recipe`  [EXTRACTED]
  backend/src/main.rs → shared/src/lib.rs

## Import Cycles
- None detected.

## Communities (13 total, 3 thin omitted)

### Community 0 - "backend/src/main.rs"
Cohesion: 0.24
Nodes (18): check_pantry_staple(), collect_recipe_objects(), delete_recipe_handler(), extract_instructions_from_json(), extract_youtube_video_id(), parse_ingredient_line(), parse_qty(), Result (+10 more)

### Community 1 - "icons.rs"
Cohesion: 0.20
Nodes (13): icon_book(), icon_broom(), icon_calendar(), icon_cart(), icon_chef_hat(), icon_globe(), icon_plus(), icon_sync() (+5 more)

### Community 2 - "sync_groceries_with_backend"
Cohesion: 0.28
Nodes (11): delete_recipe_from_backend(), get_backend_url(), Result, String, Vec, scrape_recipe_from_url(), sync_groceries_with_backend(), IngredientDraft (+3 more)

### Community 3 - "AppState"
Cohesion: 0.44
Nodes (12): AppState, get_groceries_handler(), get_meal_plans_handler(), get_recipes_handler(), Vec, sync_groceries_handler(), sync_meal_plans_handler(), sync_recipes_handler() (+4 more)

### Community 4 - "storage.rs"
Cohesion: 0.43
Nodes (5): meal_planner(), Html, load_meal_plans(), save_meal_plans(), MealPlanEntry

### Community 5 - "Recipe"
Cohesion: 0.38
Nodes (5): save_recipes(), IngredientItem, Recipe, String, Vec

### Community 6 - "GroceryItem"
Cohesion: 0.50
Nodes (5): grocery_list(), Html, load_groceries(), save_groceries(), GroceryItem

### Community 8 - "load_recipes"
Cohesion: 1.00
Nodes (3): default_recipes(), load_recipes(), Vec

### Community 9 - "shared"
Cohesion: 0.67
Nodes (3): backend, frontend, shared

## Knowledge Gaps
- **4 isolated node(s):** `backend`, `frontend`, `graphify`, `Workflow: graphify`
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Recipe` connect `Recipe` to `backend/src/main.rs`, `load_recipes`, `sync_groceries_with_backend`, `AppState`?**
  _High betweenness centrality (0.195) - this node is a cross-community bridge._
- **Why does `GroceryItem` connect `GroceryItem` to `sync_groceries_with_backend`, `AppState`, `Recipe`?**
  _High betweenness centrality (0.068) - this node is a cross-community bridge._
- **Why does `scrape_recipe_handler()` connect `backend/src/main.rs` to `AppState`, `Recipe`?**
  _High betweenness centrality (0.068) - this node is a cross-community bridge._
- **What connects `backend`, `frontend`, `graphify` to the rest of the system?**
  _4 weakly-connected nodes found - possible documentation gaps or missing edges._