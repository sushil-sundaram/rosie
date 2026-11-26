CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date, id);
CREATE INDEX IF NOT EXISTS idx_meal_plan_date ON meal_plan(date, slot);
CREATE INDEX IF NOT EXISTS idx_chores_due_date ON chores(due_date);
