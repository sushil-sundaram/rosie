-- Richer recipes: servings, time, where it came from, and a picture.
ALTER TABLE recipes ADD COLUMN servings TEXT;
ALTER TABLE recipes ADD COLUMN time_minutes INTEGER;
ALTER TABLE recipes ADD COLUMN source_url TEXT;
ALTER TABLE recipes ADD COLUMN image_url TEXT;

-- Ingredients keep the line as written ("1½ cups basmati rice, rinsed")
-- next to the parsed name / quantity / unit used for pantry matching.
ALTER TABLE recipe_ingredients ADD COLUMN text TEXT NOT NULL DEFAULT '';
ALTER TABLE recipe_ingredients ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe ON recipe_ingredients(recipe_id, position);
