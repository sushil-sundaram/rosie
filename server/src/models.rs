use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct PantryItem {
    pub id: i64,
    pub name: String,
    pub quantity: f64,
    pub unit: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct Recipe {
    pub id: i64,
    pub name: String,
    pub instructions: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct RecipeIngredient {
    pub id: i64,
    pub recipe_id: i64,
    pub name: String,
    pub quantity: f64,
    pub unit: String,
}
