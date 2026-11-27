-- no-transaction
-- (Foreign keys must be switched off while linked tables are rebuilt, and that
-- can't be done inside a transaction, so this migration manages its own.)
--
-- Schema v2: the database enforces the household's rules itself, not only the
-- server code.
--   * STRICT tables: a quantity is always a number, a title always text.
--   * CHECK constraints: real calendar dates, amounts and quantities not
--     negative, status / priority / slot / repeat from their fixed sets,
--     names not blank.
--   * Real links between rows: deleting a recipe deletes its ingredients;
--     deleting an expense or a chore clears links that pointed at it.
--   * `version` on pantry items, recipes and expenses, bumped on every change,
--     so an edit made from a stale screen is detected instead of silently
--     overwriting someone else's change.
-- Values that would break a rule are repaired while copying (an unknown status
-- becomes 'todo', a link to a missing row becomes empty), never dropped.
-- Category names are not constrained: the app owns those lists.

PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

-- Keep AUTOINCREMENT counters so ids of deleted rows are never handed out again.
CREATE TEMP TABLE old_seq AS SELECT name, seq FROM sqlite_sequence;

CREATE TABLE new_expenses (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    title    TEXT    NOT NULL CHECK (length(trim(title)) > 0),
    amount   REAL    NOT NULL CHECK (amount > 0),
    category TEXT    NOT NULL CHECK (length(trim(category)) > 0),
    date     TEXT    NOT NULL CHECK (date(date) IS date),
    version  INTEGER NOT NULL DEFAULT 1
) STRICT;
INSERT INTO new_expenses (id, title, amount, category, date)
SELECT id,
       CASE WHEN length(trim(title)) > 0 THEN title ELSE 'Expense' END,
       CASE WHEN CAST(amount AS REAL) > 0 THEN CAST(amount AS REAL) ELSE 0.01 END,
       CASE WHEN length(trim(category)) > 0 THEN category ELSE 'Other' END,
       CASE WHEN date(date) IS date THEN date ELSE date('now', 'localtime') END
FROM expenses;

CREATE TABLE new_recipes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL CHECK (length(trim(name)) > 0),
    instructions TEXT    NOT NULL DEFAULT '',
    servings     TEXT,
    time_minutes INTEGER CHECK (time_minutes IS NULL OR time_minutes >= 0),
    source_url   TEXT,
    image_url    TEXT,
    version      INTEGER NOT NULL DEFAULT 1
) STRICT;
INSERT INTO new_recipes (id, name, instructions, servings, time_minutes, source_url, image_url)
SELECT id,
       CASE WHEN length(trim(name)) > 0 THEN name ELSE 'Recipe' END,
       coalesce(instructions, ''),
       CAST(servings AS TEXT),
       CASE WHEN CAST(time_minutes AS INTEGER) >= 0 THEN CAST(time_minutes AS INTEGER) END,
       source_url, image_url
FROM recipes;

CREATE TABLE new_recipe_ingredients (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    text      TEXT    NOT NULL DEFAULT '',
    name      TEXT    NOT NULL,
    quantity  REAL    NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    unit      TEXT    NOT NULL DEFAULT '',
    position  INTEGER NOT NULL DEFAULT 0
) STRICT;
INSERT INTO new_recipe_ingredients (id, recipe_id, text, name, quantity, unit, position)
SELECT id, recipe_id, text, name, max(0, CAST(quantity AS REAL)), unit, position
FROM recipe_ingredients
WHERE recipe_id IN (SELECT id FROM recipes);

CREATE TABLE new_pantry_items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL CHECK (length(trim(name)) > 0),
    quantity      REAL    NOT NULL CHECK (quantity >= 0),
    unit          TEXT    NOT NULL DEFAULT '',
    expires_on    TEXT    CHECK (expires_on IS NULL OR date(expires_on) IS expires_on),
    expense_id    INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
    low_threshold REAL    CHECK (low_threshold IS NULL OR low_threshold >= 0),
    version       INTEGER NOT NULL DEFAULT 1
) STRICT;
INSERT INTO new_pantry_items (id, name, quantity, unit, expires_on, expense_id, low_threshold)
SELECT id,
       CASE WHEN length(trim(name)) > 0 THEN name ELSE 'Item' END,
       max(0, CAST(quantity AS REAL)),
       unit,
       CASE WHEN date(expires_on) IS expires_on THEN expires_on END,
       CASE WHEN expense_id IN (SELECT id FROM expenses) THEN expense_id END,
       CASE WHEN CAST(low_threshold AS REAL) >= 0 THEN CAST(low_threshold AS REAL) END
FROM pantry_items;

CREATE TABLE new_chores (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL CHECK (length(trim(title)) > 0),
    description TEXT,
    assigned_to TEXT    NOT NULL DEFAULT '',
    priority    TEXT    NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
    status      TEXT    NOT NULL CHECK (status IN ('todo', 'in_progress', 'done')),
    points      INTEGER NOT NULL DEFAULT 0 CHECK (points BETWEEN 0 AND 1000),
    due_date    TEXT    CHECK (due_date IS NULL OR date(due_date) IS due_date),
    amount      REAL    CHECK (amount IS NULL OR amount >= 0),
    category    TEXT,
    expense_id  INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
    repeat      TEXT    CHECK (repeat IS NULL OR repeat IN ('weekly', 'monthly', 'yearly')),
    repeat_day  INTEGER CHECK (repeat_day IS NULL OR repeat_day BETWEEN 1 AND 31),
    next_id     INTEGER REFERENCES chores(id) ON DELETE SET NULL
) STRICT;
INSERT INTO new_chores (id, title, description, assigned_to, priority, status, points, due_date,
                        amount, category, expense_id, repeat, repeat_day, next_id)
SELECT id,
       CASE WHEN length(trim(title)) > 0 THEN title ELSE 'Chore' END,
       description,
       coalesce(assigned_to, ''),
       CASE WHEN priority IN ('low', 'medium', 'high') THEN priority ELSE 'medium' END,
       CASE WHEN status IN ('todo', 'in_progress', 'done') THEN status ELSE 'todo' END,
       min(1000, max(0, CAST(points AS INTEGER))),
       CASE WHEN date(due_date) IS due_date THEN due_date END,
       CASE WHEN CAST(amount AS REAL) >= 0 THEN CAST(amount AS REAL) END,
       category,
       CASE WHEN expense_id IN (SELECT id FROM expenses) THEN expense_id END,
       CASE WHEN repeat IN ('weekly', 'monthly', 'yearly') THEN repeat END,
       CASE WHEN CAST(repeat_day AS INTEGER) BETWEEN 1 AND 31 THEN CAST(repeat_day AS INTEGER) END,
       CASE WHEN next_id IN (SELECT id FROM chores) THEN next_id END
FROM chores;

CREATE TABLE new_meal_plan (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    date      TEXT    NOT NULL CHECK (date(date) IS date),
    slot      TEXT    NOT NULL CHECK (slot IN ('breakfast', 'lunch', 'dinner')),
    title     TEXT    NOT NULL CHECK (length(trim(title)) > 0),
    recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL
) STRICT;
INSERT INTO new_meal_plan (id, date, slot, title, recipe_id)
SELECT id,
       CASE WHEN date(date) IS date THEN date ELSE date('now', 'localtime') END,
       CASE WHEN slot IN ('breakfast', 'lunch', 'dinner') THEN slot ELSE 'dinner' END,
       CASE WHEN length(trim(title)) > 0 THEN title ELSE 'Meal' END,
       CASE WHEN recipe_id IN (SELECT id FROM recipes) THEN recipe_id END
FROM meal_plan;

CREATE TABLE new_budgets (
    category TEXT PRIMARY KEY CHECK (length(trim(category)) > 0),
    amount   REAL NOT NULL CHECK (amount > 0)
) STRICT;
INSERT INTO new_budgets (category, amount)
SELECT category, CAST(amount AS REAL) FROM budgets
WHERE length(trim(category)) > 0 AND CAST(amount AS REAL) > 0;

CREATE TABLE new_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
) STRICT;
INSERT INTO new_settings (key, value) SELECT key, CAST(value AS TEXT) FROM settings;

DROP TABLE meal_plan;
DROP TABLE recipe_ingredients;
DROP TABLE pantry_items;
DROP TABLE chores;
DROP TABLE recipes;
DROP TABLE expenses;
DROP TABLE budgets;
DROP TABLE settings;

ALTER TABLE new_expenses RENAME TO expenses;
ALTER TABLE new_recipes RENAME TO recipes;
ALTER TABLE new_recipe_ingredients RENAME TO recipe_ingredients;
ALTER TABLE new_pantry_items RENAME TO pantry_items;
ALTER TABLE new_chores RENAME TO chores;
ALTER TABLE new_meal_plan RENAME TO meal_plan;
ALTER TABLE new_budgets RENAME TO budgets;
ALTER TABLE new_settings RENAME TO settings;

UPDATE sqlite_sequence
SET seq = max(seq, coalesce((SELECT o.seq FROM old_seq o WHERE o.name = sqlite_sequence.name), 0));
INSERT INTO sqlite_sequence (name, seq)
SELECT o.name, o.seq FROM old_seq o
WHERE o.name IN ('expenses', 'recipes', 'recipe_ingredients', 'pantry_items', 'chores', 'meal_plan')
  AND o.name NOT IN (SELECT name FROM sqlite_sequence);
DROP TABLE old_seq;

CREATE INDEX idx_recipe_ingredients_recipe ON recipe_ingredients(recipe_id, position);
CREATE INDEX idx_expenses_date ON expenses(date, id);
CREATE INDEX idx_meal_plan_date ON meal_plan(date, slot);
CREATE INDEX idx_chores_due_date ON chores(due_date);
CREATE INDEX idx_chores_expense ON chores(expense_id);
CREATE INDEX idx_chores_next ON chores(next_id);
CREATE INDEX idx_pantry_expense ON pantry_items(expense_id);
CREATE INDEX idx_meal_plan_recipe ON meal_plan(recipe_id);

COMMIT;
PRAGMA foreign_keys = ON;
