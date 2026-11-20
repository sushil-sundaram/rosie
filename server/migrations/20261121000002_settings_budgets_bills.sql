CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
INSERT OR IGNORE INTO settings (key, value) VALUES ('currency', 'INR'), ('locale', 'en-IN');

-- Monthly budget per expense category; repeats every month.
CREATE TABLE IF NOT EXISTS budgets (
    category TEXT PRIMARY KEY,
    amount REAL NOT NULL
);

-- A chore with an amount is a bill. Marking it done logs an expense (expense_id).
ALTER TABLE chores ADD COLUMN amount REAL;
ALTER TABLE chores ADD COLUMN category TEXT;
ALTER TABLE chores ADD COLUMN expense_id INTEGER;
