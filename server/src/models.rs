use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct PantryItem {
    #[serde(default)]
    pub id: i64,
    pub name: String,
    pub quantity: f64,
    pub unit: String,
    #[serde(default)]
    pub expires_on: Option<String>,
    /// Expense this item was bought with, if any.
    #[serde(default)]
    pub expense_id: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct Recipe {
    #[serde(default)]
    pub id: i64,
    pub name: String,
    pub instructions: String,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct RecipeIngredient {
    pub id: i64,
    pub recipe_id: i64,
    pub name: String,
    pub quantity: f64,
    pub unit: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct Chore {
    #[serde(default)]
    pub id: i64,
    pub title: String,
    pub description: Option<String>,
    pub assigned_to: String,
    pub priority: String,
    pub status: String,
    pub points: i64,
    #[serde(default)]
    pub due_date: Option<String>,
    /// Set for bills: amount to pay and expense category.
    #[serde(default)]
    pub amount: Option<f64>,
    #[serde(default)]
    pub category: Option<String>,
    /// Expense logged when the bill was marked done.
    #[serde(default)]
    pub expense_id: Option<i64>,
    /// 'weekly' | 'monthly' | 'yearly' — completing it creates the next occurrence.
    #[serde(default)]
    pub repeat: Option<String>,
    #[serde(default)]
    pub repeat_day: Option<i64>,
    #[serde(default)]
    pub next_id: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct Expense {
    #[serde(default)]
    pub id: i64,
    pub title: String,
    pub amount: f64,
    pub category: String,
    pub date: String,
}

#[derive(Debug, Deserialize)]
pub struct ScanReceiptRequest {
    pub image_base64: String,
    pub model: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct Meal {
    #[serde(default)]
    pub id: i64,
    pub date: String,
    pub slot: String,
    pub title: String,
    pub recipe_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct ChoreUpdate {
    pub status: Option<String>,
    /// YYYY-MM-DD to schedule, "" to unschedule, absent to leave unchanged.
    pub due_date: Option<String>,
    /// "weekly" | "monthly" | "yearly", or "" to stop repeating.
    pub repeat: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MealUpdate {
    pub date: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct Budget {
    pub category: String,
    pub amount: f64,
}

#[derive(Debug, Deserialize)]
pub struct BudgetUpdate {
    pub amount: f64,
}
