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
    #[serde(default)]
    pub low_threshold: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct Recipe {
    #[serde(default)]
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub instructions: String,
    #[serde(default)]
    pub servings: Option<String>,
    #[serde(default)]
    pub time_minutes: Option<i64>,
    #[serde(default)]
    pub source_url: Option<String>,
    #[serde(default)]
    pub image_url: Option<String>,
    #[sqlx(skip)]
    #[serde(default)]
    pub ingredients: Vec<RecipeIngredient>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, FromRow)]
pub struct RecipeIngredient {
    #[serde(skip)]
    pub recipe_id: i64,
    /// The line as written, e.g. "1½ cups basmati rice, rinsed".
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub name: String,
    /// 0 when the line has no amount ("salt to taste").
    #[serde(default)]
    pub quantity: f64,
    #[serde(default)]
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

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub struct ChoreUpdate {
    pub status: Option<String>,
    /// YYYY-MM-DD to schedule, "" to unschedule, absent to leave unchanged.
    pub due_date: Option<String>,
    /// "weekly" | "monthly" | "yearly", or "" to stop repeating.
    pub repeat: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub assigned_to: Option<String>,
    pub priority: Option<String>,
    pub points: Option<i64>,
    /// > 0 sets/updates bill amount; 0 clears bill status.
    pub amount: Option<f64>,
    pub category: Option<String>,
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
