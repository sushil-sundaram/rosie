-- Groceries list: things to buy. Filled by hand, from a recipe or the week's
-- meal plan (only what the pantry doesn't already cover), or from low stock.
-- Ticked items are "in the cart"; putting them in the pantry removes them here.
CREATE TABLE grocery_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL CHECK (length(trim(name)) > 0),
    -- 0 means "some" (no amount given, e.g. "salt").
    quantity   REAL    NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    unit       TEXT    NOT NULL DEFAULT '',
    -- Which recipes asked for it, "; "-separated, e.g. "Dal tadka; Poha".
    note       TEXT    NOT NULL DEFAULT '',
    checked    INTEGER NOT NULL DEFAULT 0 CHECK (checked IN (0, 1)),
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    version    INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE INDEX idx_grocery_items_checked ON grocery_items(checked, id);
