//! Recipes: storage with parsed ingredients, and importing from a web link,
//! a photo or pasted text.
//!
//! Importing a link first reads the schema.org `Recipe` data most recipe sites
//! publish (exact and instant). Only when a page has none does the text go to
//! the local Ollama model. Imports never save anything: they return a draft
//! for the household to review.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use reqwest::Url;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::net::IpAddr;

use crate::models::{Recipe, RecipeIngredient};
use crate::routes::ollama_json;

type ApiError = (StatusCode, Json<Value>);

fn err(status: StatusCode, msg: impl Into<String>) -> ApiError {
    (status, Json(json!({ "error": msg.into() })))
}

/* ================= storage ================= */

#[derive(Deserialize)]
pub struct RecipeInput {
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
    /// One ingredient per entry, as written; parsed on save.
    #[serde(default)]
    pub ingredients: Vec<String>,
}

/// Only plain web links are stored, so a saved link can never run script when clicked.
fn web_link(s: &Option<String>) -> Option<String> {
    let s = s.as_deref()?.trim();
    Url::parse(s).ok().filter(|u| matches!(u.scheme(), "http" | "https")).map(|_| s.to_string())
}

fn non_empty(s: &Option<String>) -> Option<String> {
    s.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

pub async fn get_recipes(State(pool): State<SqlitePool>) -> impl IntoResponse {
    let recipes = sqlx::query_as::<_, Recipe>(
        "SELECT id, name, instructions, servings, time_minutes, source_url, image_url FROM recipes ORDER BY name COLLATE NOCASE",
    )
    .fetch_all(&pool)
    .await;
    let ingredients = sqlx::query_as::<_, RecipeIngredient>(
        "SELECT recipe_id, text, name, quantity, unit FROM recipe_ingredients ORDER BY recipe_id, position, id",
    )
    .fetch_all(&pool)
    .await;
    match (recipes, ingredients) {
        (Ok(mut recipes), Ok(ingredients)) => {
            let mut by_recipe: HashMap<i64, Vec<RecipeIngredient>> = HashMap::new();
            for mut ing in ingredients {
                if ing.text.is_empty() {
                    // Rows from before ingredient lines were kept.
                    ing.text = format!("{} {} {}", fmt_qty(ing.quantity), ing.unit, ing.name).trim().to_string();
                }
                by_recipe.entry(ing.recipe_id).or_default().push(ing);
            }
            for r in &mut recipes {
                r.ingredients = by_recipe.remove(&r.id).unwrap_or_default();
            }
            (StatusCode::OK, Json(json!(recipes)))
        }
        _ => err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch recipes"),
    }
}

fn fmt_qty(q: f64) -> String {
    if q <= 0.0 {
        String::new()
    } else if q.fract() == 0.0 {
        format!("{q:.0}")
    } else {
        format!("{q:.2}").trim_end_matches('0').to_string()
    }
}

/// Inserts (id = None) or replaces a recipe and its ingredient list in one transaction.
async fn save_recipe(pool: &SqlitePool, id: Option<i64>, r: &RecipeInput) -> Result<Option<i64>, sqlx::Error> {
    let name = r.name.trim();
    let time = r.time_minutes.filter(|t| *t > 0);
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let id = match id {
        Some(id) => {
            let res = sqlx::query(
                "UPDATE recipes SET name = ?, instructions = ?, servings = ?, time_minutes = ?, source_url = ?, image_url = ? WHERE id = ?",
            )
            .bind(name).bind(r.instructions.trim()).bind(non_empty(&r.servings)).bind(time)
            .bind(web_link(&r.source_url)).bind(web_link(&r.image_url)).bind(id)
            .execute(&mut *tx)
            .await?;
            if res.rows_affected() == 0 {
                return Ok(None);
            }
            sqlx::query("DELETE FROM recipe_ingredients WHERE recipe_id = ?").bind(id).execute(&mut *tx).await?;
            id
        }
        None => sqlx::query(
            "INSERT INTO recipes (name, instructions, servings, time_minutes, source_url, image_url) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(name).bind(r.instructions.trim()).bind(non_empty(&r.servings)).bind(time)
        .bind(web_link(&r.source_url)).bind(web_link(&r.image_url))
        .execute(&mut *tx)
        .await?
        .last_insert_rowid(),
    };
    let lines = r.ingredients.iter().map(|l| clean_line(l)).filter(|l| !l.is_empty());
    for (pos, line) in lines.take(200).enumerate() {
        let (name, quantity, unit) = parse_ingredient(&line);
        sqlx::query("INSERT INTO recipe_ingredients (recipe_id, text, name, quantity, unit, position) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(id).bind(&line).bind(name).bind(quantity).bind(unit).bind(pos as i64)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(Some(id))
}

pub async fn add_recipe(State(pool): State<SqlitePool>, Json(payload): Json<RecipeInput>) -> impl IntoResponse {
    if payload.name.trim().is_empty() {
        return err(StatusCode::BAD_REQUEST, "A recipe needs a name");
    }
    match save_recipe(&pool, None, &payload).await {
        Ok(id) => (StatusCode::CREATED, Json(json!({ "status": "created", "id": id }))),
        Err(e) => {
            tracing::error!("insert recipe: {e}");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to insert recipe")
        }
    }
}

pub async fn update_recipe(
    State(pool): State<SqlitePool>,
    Path(id): Path<i64>,
    Json(payload): Json<RecipeInput>,
) -> impl IntoResponse {
    if payload.name.trim().is_empty() {
        return err(StatusCode::BAD_REQUEST, "A recipe needs a name");
    }
    match save_recipe(&pool, Some(id), &payload).await {
        Ok(Some(_)) => (StatusCode::OK, Json(json!({ "status": "updated", "id": id }))),
        Ok(None) => err(StatusCode::NOT_FOUND, "Recipe not found"),
        Err(e) => {
            tracing::error!("update recipe: {e}");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update recipe")
        }
    }
}

pub async fn delete_recipe(State(pool): State<SqlitePool>, Path(id): Path<i64>) -> impl IntoResponse {
    let _ = sqlx::query("DELETE FROM recipe_ingredients WHERE recipe_id = ?").bind(id).execute(&pool).await;
    let _ = sqlx::query("UPDATE meal_plan SET recipe_id = NULL WHERE recipe_id = ?").bind(id).execute(&pool).await;
    match sqlx::query("DELETE FROM recipes WHERE id = ?").bind(id).execute(&pool).await {
        Ok(r) if r.rows_affected() > 0 => (StatusCode::OK, Json(json!({ "status": "deleted" }))),
        Ok(_) => err(StatusCode::NOT_FOUND, "Recipe not found"),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to delete recipe"),
    }
}

/* ================= ingredient lines ================= */

/// Trims list bullets and checkbox glyphs that sites put before ingredient lines.
fn clean_line(s: &str) -> String {
    let s = collapse_ws(s);
    s.trim_start_matches(|c: char| matches!(c, '-' | '•' | '*' | '▢' | '□' | '☐' | '·' | '–') || c.is_whitespace())
        .trim()
        .to_string()
}

fn vulgar(c: char) -> Option<f64> {
    Some(match c {
        '½' => 0.5, '⅓' => 1.0 / 3.0, '⅔' => 2.0 / 3.0, '¼' => 0.25, '¾' => 0.75,
        '⅕' => 0.2, '⅖' => 0.4, '⅗' => 0.6, '⅘' => 0.8, '⅙' => 1.0 / 6.0, '⅚' => 5.0 / 6.0,
        '⅛' => 0.125, '⅜' => 0.375, '⅝' => 0.625, '⅞' => 0.875,
        _ => return None,
    })
}

/// Reads one number at the start: "2", "1.5", "1/2", "½", "1½", "1 1/2". Returns it and the rest.
fn read_number(s: &str) -> Option<(f64, &str)> {
    let s = s.trim_start();
    let digits_end = s.find(|c: char| !(c.is_ascii_digit() || c == '.')).unwrap_or(s.len());
    let mut value: Option<f64> = None;
    let mut rest = s;
    if digits_end > 0 {
        let whole: f64 = s[..digits_end].parse().ok()?;
        rest = &s[digits_end..];
        // "1/2"
        if let Some(r) = rest.strip_prefix('/').or_else(|| rest.strip_prefix('⁄')) {
            let d_end = r.find(|c: char| !c.is_ascii_digit()).unwrap_or(r.len());
            if d_end > 0 {
                let den: f64 = r[..d_end].parse().ok()?;
                if den > 0.0 {
                    return Some((whole / den, &r[d_end..]));
                }
            }
            return Some((whole, rest));
        }
        value = Some(whole);
    }
    // "½" or "1½" / "1 ½" / "1 1/2"
    let after = rest.trim_start();
    if let Some(c) = after.chars().next() {
        if let Some(f) = vulgar(c) {
            return Some((value.unwrap_or(0.0) + f, &after[c.len_utf8()..]));
        }
        if let Some(whole) = value {
            if c.is_ascii_digit() && after.len() < rest.len() {
                if let Some((f, r)) = read_number(after) {
                    if f < 1.0 {
                        return Some((whole + f, r));
                    }
                }
            }
        }
    }
    value.map(|v| (v, rest))
}

const UNITS: &[(&str, &[&str])] = &[
    ("cup", &["cup", "cups", "c"]),
    ("tbsp", &["tbsp", "tbsps", "tbs", "tbl", "tablespoon", "tablespoons", "tbspn"]),
    ("tsp", &["tsp", "tsps", "teaspoon", "teaspoons", "tspn"]),
    ("g", &["g", "gm", "gms", "gr", "gram", "grams", "gramme", "grammes"]),
    ("kg", &["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms"]),
    ("ml", &["ml", "mls", "millilitre", "millilitres", "milliliter", "milliliters"]),
    ("L", &["l", "litre", "litres", "liter", "liters", "ltr"]),
    ("oz", &["oz", "ounce", "ounces"]),
    ("fl oz", &["floz"]),
    ("lb", &["lb", "lbs", "pound", "pounds"]),
    ("pinch", &["pinch", "pinches"]),
    ("dash", &["dash", "dashes"]),
    ("clove", &["clove", "cloves"]),
    ("inch", &["inch", "inches", "in"]),
    ("cm", &["cm"]),
    ("pcs", &["piece", "pieces", "pc", "pcs", "no", "nos", "number", "numbers", "whole"]),
    ("can", &["can", "cans", "tin", "tins"]),
    ("pack", &["pack", "packs", "packet", "packets", "pkt", "package", "packages"]),
    ("bunch", &["bunch", "bunches"]),
    ("sprig", &["sprig", "sprigs"]),
    ("slice", &["slice", "slices"]),
    ("stick", &["stick", "sticks"]),
    ("handful", &["handful", "handfuls"]),
    ("pint", &["pint", "pints"]),
    ("quart", &["quart", "quarts"]),
];

fn unit_of(word: &str) -> Option<&'static str> {
    let w = word.trim_matches(|c: char| c == '.' || c == ',' || c == ')' || c == '(').to_lowercase();
    UNITS.iter().find(|(_, names)| names.contains(&w.as_str())).map(|(canon, _)| *canon)
}

/// "1½ cups basmati rice, rinsed" -> ("basmati rice", 1.5, "cup").
/// Lines without an amount ("salt to taste") get quantity 0 and no unit.
pub fn parse_ingredient(line: &str) -> (String, f64, String) {
    let mut s = line.trim();
    let mut qty = 0.0;
    if let Some((q, rest)) = read_number(s) {
        qty = q;
        s = rest;
        // Ranges like "2-3" or "2 to 3": keep the first amount.
        let t = s.trim_start();
        for sep in ["-", "–", "to "] {
            if let Some(r) = t.strip_prefix(sep) {
                if let Some((_, r2)) = read_number(r) {
                    s = r2;
                }
                break;
            }
        }
    } else {
        let lower = s.to_lowercase();
        for article in ["a ", "an "] {
            if lower.starts_with(article) && s[article.len()..].split_whitespace().next().and_then(unit_of).is_some() {
                qty = 1.0;
                s = &s[article.len()..];
                break;
            }
        }
    }

    let mut unit = String::new();
    let t = s.trim_start();
    // "200g", "1kg" leave the unit glued on: read the first word.
    let word_end = t.find(|c: char| c.is_whitespace() || c == ',' || c == '(').unwrap_or(t.len());
    let word = &t[..word_end];
    if qty > 0.0 {
        let two = t.split_whitespace().take(2).collect::<Vec<_>>().join("");
        if unit_of(&two) == Some("fl oz") {
            unit = "fl oz".into();
            s = t.splitn(3, char::is_whitespace).nth(2).unwrap_or("");
        } else if let Some(u) = unit_of(word) {
            unit = u.to_string();
            s = &t[word_end..];
        } else {
            unit = "pcs".into();
        }
    }

    let mut name = s.trim().trim_start_matches(|c: char| c == '.' || c == ',' || c.is_whitespace()).to_string();
    for prefix in ["of ", "Of "] {
        if let Some(r) = name.strip_prefix(prefix) {
            name = r.to_string();
        }
    }
    // "1 cup (200 grams) toor dal": skip a note right after the amount.
    while name.starts_with('(') {
        match name.find(')') {
            Some(i) => name = name[i + 1..].trim_start_matches(')').trim().to_string(),
            None => break,
        }
    }
    // Drop preparation notes: "onion, finely chopped" / "paneer (cubed)".
    if let Some(i) = name.find([',', '(']) {
        if i > 0 {
            name.truncate(i);
        }
    }
    let name = name.trim().trim_end_matches(['-', '–', ':']).trim().to_string();
    let name = if name.is_empty() { line.trim().to_string() } else { name };
    (name, (qty * 1000.0).round() / 1000.0, unit)
}

/* ================= import ================= */

#[derive(Deserialize)]
pub struct ImportRequest {
    pub url: Option<String>,
    pub text: Option<String>,
    pub image_base64: Option<String>,
}

/// A recipe ready for review. Nothing is saved until the household confirms.
#[derive(Default)]
struct Draft {
    name: String,
    servings: Option<String>,
    time_minutes: Option<i64>,
    source_url: Option<String>,
    image_url: Option<String>,
    ingredients: Vec<String>,
    instructions: Vec<String>,
}

impl Draft {
    fn into_json(self, method: &str) -> Value {
        json!({
            "name": self.name,
            "servings": self.servings,
            "time_minutes": self.time_minutes,
            "source_url": self.source_url,
            "image_url": self.image_url,
            "ingredients": self.ingredients,
            "instructions": self.instructions,
            "method": method,
        })
    }
    fn is_empty(&self) -> bool {
        self.ingredients.is_empty() && self.instructions.is_empty()
    }
}

pub async fn import_recipe(Json(req): Json<ImportRequest>) -> impl IntoResponse {
    let result = if let Some(url) = non_empty(&req.url) {
        import_url(&url).await
    } else if let Some(image) = non_empty(&req.image_base64) {
        import_ai(Source::Photo(&image)).await.map(|d| d.into_json("ai"))
    } else if let Some(text) = non_empty(&req.text) {
        import_ai(Source::Text(&text)).await.map(|d| d.into_json("ai"))
    } else {
        Err(err(StatusCode::BAD_REQUEST, "Send a url, text or image_base64"))
    };
    match result {
        Ok(v) => (StatusCode::OK, Json(v)),
        Err(e) => e,
    }
}

async fn import_url(raw: &str) -> Result<Value, ApiError> {
    let url = Url::parse(raw).map_err(|_| err(StatusCode::BAD_REQUEST, "That doesn't look like a web link"))?;
    let (final_url, html) = fetch_page(url).await?;
    let page_url = final_url.to_string();

    if let Some(mut d) = structured_recipe(&html) {
        if !d.is_empty() {
            d.source_url = Some(page_url);
            if d.image_url.is_none() {
                d.image_url = meta_content(&html, "og:image").filter(|u| u.starts_with("http"));
            }
            return Ok(d.into_json("structured"));
        }
    }

    // No recipe data on the page: let the local model read its text.
    let text = page_text(&html);
    if text.len() < 80 {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "That page has almost no text to read. Try pasting the recipe or a screenshot."));
    }
    let mut d = import_ai(Source::Page(&text)).await?;
    if d.name.is_empty() {
        d.name = page_title(&html);
    }
    d.source_url = Some(page_url);
    d.image_url = meta_content(&html, "og:image").filter(|u| u.starts_with("http"));
    Ok(d.into_json("ai"))
}

/// Links to this machine or the home network are refused, so the import box
/// can't be used to read the router or other devices.
fn is_private_host(url: &Url) -> bool {
    let Some(host) = url.host_str() else { return true };
    let host = host.trim_start_matches('[').trim_end_matches(']');
    if let Ok(ip) = host.parse::<IpAddr>() {
        return blocked_ip(ip);
    }
    let d = host.trim_end_matches('.').to_ascii_lowercase();
    d == "localhost" || d.ends_with(".localhost") || d.ends_with(".local") || d.ends_with(".lan")
        || d.ends_with(".internal") || d.ends_with(".ts.net") || !d.contains('.')
}

fn blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_loopback() || v4.is_private() || v4.is_link_local() || v4.is_unspecified()
            || v4.is_broadcast() || v4.octets()[0] == 100 && (64..128).contains(&v4.octets()[1]),
        IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified() || (v6.segments()[0] & 0xfe00) == 0xfc00
            || (v6.segments()[0] & 0xffc0) == 0xfe80
            || v6.to_ipv4_mapped().is_some_and(|v4| blocked_ip(IpAddr::V4(v4))),
    }
}

const MAX_PAGE_BYTES: usize = 5 * 1024 * 1024;

async fn fetch_page(url: Url) -> Result<(Url, String), ApiError> {
    if !matches!(url.scheme(), "http" | "https") || is_private_host(&url) {
        return Err(err(StatusCode::BAD_REQUEST, "Only public http(s) web links can be imported"));
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || is_private_host(attempt.url()) {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        // Many recipe sites turn away requests that don't look like a browser.
        .user_agent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")
        .build()
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let mut res = client
        .get(url)
        .header("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5")
        .header("Accept-Language", "en-IN,en;q=0.9")
        .send()
        .await
        .map_err(|e| {
            tracing::warn!("recipe fetch failed: {e}");
            err(StatusCode::BAD_GATEWAY, "Couldn't reach that site. Check the link, or paste the recipe text instead.")
        })?;
    let status = res.status();
    if status.is_redirection() {
        return Err(err(StatusCode::BAD_REQUEST, "That link redirects somewhere that can't be imported"));
    }
    if matches!(status.as_u16(), 401 | 402 | 403 | 429 | 503) {
        return Err(err(StatusCode::BAD_GATEWAY, format!(
            "The site refused the request (HTTP {}). Some sites block automatic imports; paste the recipe text or upload a screenshot instead.",
            status.as_u16()
        )));
    }
    if !status.is_success() {
        return Err(err(StatusCode::BAD_GATEWAY, format!("The site returned HTTP {}", status.as_u16())));
    }
    let final_url = res.url().clone();
    let mut body = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|e| err(StatusCode::BAD_GATEWAY, e.to_string()))? {
        body.extend_from_slice(&chunk);
        if body.len() > MAX_PAGE_BYTES {
            break;
        }
    }
    Ok((final_url, String::from_utf8_lossy(&body).into_owned()))
}

/* ---- schema.org Recipe (JSON-LD) ---- */

/// Contents of every <script type="application/ld+json"> block.
fn ld_json_blocks(html: &str) -> Vec<&str> {
    let lower = html.to_ascii_lowercase();
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(start) = lower[from..].find("<script").map(|i| i + from) {
        let Some(tag_end) = lower[start..].find('>').map(|i| i + start) else { break };
        let Some(close) = lower[tag_end..].find("</script").map(|i| i + tag_end) else { break };
        if lower[start..tag_end].contains("ld+json") {
            out.push(&html[tag_end + 1..close]);
        }
        from = close + 8;
    }
    out
}

fn is_recipe(v: &Value) -> bool {
    match &v["@type"] {
        Value::String(t) => t.eq_ignore_ascii_case("recipe") || t.ends_with("/Recipe"),
        Value::Array(ts) => ts.iter().any(|t| t.as_str().is_some_and(|t| t.eq_ignore_ascii_case("recipe"))),
        _ => false,
    }
}

fn find_recipe(v: &Value, depth: u8) -> Option<&Value> {
    if depth > 6 {
        return None;
    }
    match v {
        Value::Object(map) => {
            if is_recipe(v) {
                return Some(v);
            }
            map.values().find_map(|x| find_recipe(x, depth + 1))
        }
        Value::Array(items) => items.iter().find_map(|x| find_recipe(x, depth + 1)),
        _ => None,
    }
}

fn structured_recipe(html: &str) -> Option<Draft> {
    ld_json_blocks(html).into_iter().find_map(|block| {
        // Some sites leave raw control characters inside JSON strings.
        let cleaned: String = block.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
        let v: Value = serde_json::from_str(cleaned.trim()).ok()?;
        find_recipe(&v, 0).map(draft_from_schema)
    })
}

fn draft_from_schema(r: &Value) -> Draft {
    let text = |v: &Value| v.as_str().map(clean_text).unwrap_or_default();
    let mut ingredients: Vec<String> = r["recipeIngredient"]
        .as_array()
        .or_else(|| r["ingredients"].as_array())
        .map(|a| a.iter().map(|i| clean_line(&text(i))).filter(|s| !s.is_empty()).collect())
        .unwrap_or_default();
    ingredients.truncate(200);

    let mut instructions = Vec::new();
    flatten_steps(&r["recipeInstructions"], &mut instructions, 0);
    instructions.truncate(100);

    let time = duration_minutes(&r["totalTime"]).or_else(|| {
        match (duration_minutes(&r["prepTime"]), duration_minutes(&r["cookTime"])) {
            (None, None) => None,
            (a, b) => Some(a.unwrap_or(0) + b.unwrap_or(0)),
        }
    });

    Draft {
        name: text(&r["name"]),
        servings: servings_of(&r["recipeYield"]),
        time_minutes: time.filter(|t| *t > 0),
        image_url: image_of(&r["image"]),
        ingredients,
        instructions,
        ..Default::default()
    }
}

fn flatten_steps(v: &Value, out: &mut Vec<String>, depth: u8) {
    if depth > 5 {
        return;
    }
    match v {
        Value::String(s) => {
            // One block of text, sometimes with HTML list markup: one step per line.
            let s = html_to_lines(s);
            out.extend(s.lines().map(clean_line).filter(|l| !l.is_empty()));
        }
        Value::Array(items) => items.iter().for_each(|i| flatten_steps(i, out, depth + 1)),
        Value::Object(_) => {
            if let Some(list) = v.get("itemListElement") {
                // A HowToSection: keep its heading ("For the gravy:") as a step of its own.
                if let Some(name) = v["name"].as_str().map(clean_text).filter(|n| !n.is_empty()) {
                    out.push(if name.ends_with(':') { name } else { format!("{name}:") });
                }
                flatten_steps(list, out, depth + 1);
            } else if let Some(t) = v["text"].as_str().or_else(|| v["name"].as_str()) {
                flatten_steps(&Value::String(t.to_string()), out, depth + 1);
            }
        }
        _ => {}
    }
}

fn servings_of(v: &Value) -> Option<String> {
    let s = match v {
        Value::Number(n) => n.to_string(),
        Value::String(s) => clean_text(s),
        // Often ["4", "4 servings"]: prefer the more descriptive one.
        Value::Array(a) => a.iter().filter_map(servings_of).max_by_key(|s| s.len())?,
        _ => return None,
    };
    Some(s).filter(|s| !s.is_empty())
}

fn image_of(v: &Value) -> Option<String> {
    let url = match v {
        Value::String(s) => Some(s.trim().to_string()),
        Value::Array(a) => a.iter().find_map(image_of),
        Value::Object(_) => v["url"].as_str().or_else(|| v["contentUrl"].as_str()).map(|s| s.trim().to_string()),
        _ => None,
    }?;
    url.starts_with("http").then_some(url)
}

/// ISO 8601 durations as used by schema.org: "PT1H30M", "P0DT0H45M", "PT90M".
fn duration_minutes(v: &Value) -> Option<i64> {
    let s = v.as_str()?.trim().to_ascii_uppercase();
    let s = s.strip_prefix('P')?;
    let mut total = 0.0;
    let mut num = String::new();
    let mut in_time = false;
    for c in s.chars() {
        match c {
            'T' => in_time = true,
            '0'..='9' | '.' => num.push(c),
            unit => {
                let n: f64 = num.parse().unwrap_or(0.0);
                num.clear();
                total += match (unit, in_time) {
                    ('D', _) => n * 1440.0,
                    ('H', true) => n * 60.0,
                    ('M', true) => n,
                    ('S', true) => n / 60.0,
                    _ => 0.0,
                };
            }
        }
    }
    Some(total.round() as i64)
}

/* ---- page text for the AI fallback ---- */

fn meta_content(html: &str, property: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let needle = format!("\"{property}\"");
    let at = lower.find(&needle)?;
    let start = lower[..at].rfind("<meta")?;
    let end = lower[at..].find('>')? + at;
    let tag = &html[start..end];
    let i = tag.to_ascii_lowercase().find("content=")? + 8;
    let rest = &tag[i..];
    let quote = rest.chars().next()?;
    let rest = &rest[quote.len_utf8()..];
    let value = &rest[..rest.find(quote)?];
    Some(decode_entities(value).trim().to_string())
}

/// The page's title without the site name: "Dalgona Coffee - Wikibooks" -> "Dalgona Coffee".
fn page_title(html: &str) -> String {
    let title = meta_content(html, "og:title").or_else(|| {
        let lower = html.to_ascii_lowercase();
        let start = lower.find("<title")?;
        let open_end = lower[start..].find('>')? + start + 1;
        let end = lower[open_end..].find("</title")? + open_end;
        Some(decode_entities(&html[open_end..end]))
    });
    let title = collapse_ws(&title.unwrap_or_default());
    let cut = [" | ", " - ", " – ", " — "].iter().filter_map(|sep| title.find(sep)).min().unwrap_or(title.len());
    let title = title[..cut].to_string();
    title.strip_prefix("Cookbook:").unwrap_or(&title).trim().to_string()
}

/// Removes a whole element (open tag to close tag) wherever it appears.
fn drop_elements(html: &str, tag: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let (open, close) = (format!("<{tag}"), format!("</{tag}"));
    let mut out = String::with_capacity(html.len());
    let mut from = 0;
    while let Some(start) = lower[from..].find(&open).map(|i| i + from) {
        // "<header" must not match "<headers": the tag name has to end here.
        let after = lower[start + open.len()..].chars().next();
        if after.is_some_and(|c| c.is_ascii_alphanumeric()) {
            out.push_str(&html[from..start + open.len()]);
            from = start + open.len();
            continue;
        }
        out.push_str(&html[from..start]);
        match lower[start..].find(&close) {
            Some(i) => {
                let end = lower[start + i..].find('>').map(|j| start + i + j + 1).unwrap_or(html.len());
                from = end;
            }
            None => return out,
        }
    }
    out.push_str(&html[from..]);
    out
}

/// Block-level tags become line breaks, everything else is stripped.
fn html_to_lines(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut chars = html.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        if c != '<' {
            out.push(c);
            continue;
        }
        let end = html[i..].find('>').map(|j| i + j);
        let Some(end) = end else {
            out.push(c);
            continue;
        };
        let tag = html[i + 1..end].trim_start_matches('/').to_ascii_lowercase();
        let name: String = tag.chars().take_while(|c| c.is_ascii_alphanumeric()).collect();
        if matches!(name.as_str(), "br" | "p" | "div" | "li" | "tr" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "ol" | "ul" | "section" | "article") {
            out.push('\n');
        } else {
            out.push(' ');
        }
        while chars.peek().is_some_and(|(j, _)| *j <= end) {
            chars.next();
        }
    }
    decode_entities(&out)
}

const MAX_AI_TEXT: usize = 12_000;

fn page_text(html: &str) -> String {
    let mut s = html.to_string();
    for tag in ["script", "style", "noscript", "svg", "nav", "header", "footer", "form", "aside", "iframe", "template"] {
        s = drop_elements(&s, tag);
    }
    // Prefer the main content when the page marks it.
    let lower = s.to_ascii_lowercase();
    for marker in ["<main", "<article"] {
        if let Some(i) = lower.find(marker) {
            s = s[i..].to_string();
            break;
        }
    }
    let text = html_to_lines(&s);
    let mut out = String::new();
    for line in text.lines().map(collapse_ws).filter(|l| !l.is_empty()) {
        if out.len() + line.len() > MAX_AI_TEXT {
            break;
        }
        out.push_str(&line);
        out.push('\n');
    }
    out
}

fn collapse_ws(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Text from schema.org fields: decode entities, strip any markup, one line.
fn clean_text(s: &str) -> String {
    collapse_ws(&html_to_lines(&decode_entities(s)))
}

fn decode_entities(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let Some(end) = rest[..rest.len().min(12)].find(';') else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let entity = &rest[1..end];
        let decoded = if let Some(num) = entity.strip_prefix('#') {
            let code = match num.strip_prefix(['x', 'X']) {
                Some(hex) => u32::from_str_radix(hex, 16).ok(),
                None => num.parse().ok(),
            };
            code.and_then(char::from_u32).map(String::from)
        } else {
            match entity {
                "amp" => Some("&"), "lt" => Some("<"), "gt" => Some(">"), "quot" => Some("\""),
                "apos" => Some("'"), "nbsp" => Some(" "), "ndash" => Some("–"), "mdash" => Some("—"),
                "rsquo" | "lsquo" => Some("'"), "ldquo" | "rdquo" => Some("\""), "hellip" => Some("…"),
                "deg" => Some("°"), "frac12" => Some("½"), "frac14" => Some("¼"), "frac34" => Some("¾"),
                "frac13" => Some("⅓"), "frac23" => Some("⅔"), "times" => Some("×"), "eacute" => Some("é"),
                _ => None,
            }
            .map(String::from)
        };
        match decoded {
            Some(d) => {
                out.push_str(&d);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/* ---- local AI ---- */

enum Source<'a> {
    Page(&'a str),
    Text(&'a str),
    Photo(&'a str),
}

const RECIPE_SCHEMA: &str = "Respond ONLY with a JSON object of this shape:\n\
    {\"name\": \"Dal tadka\", \"servings\": \"4\", \"time_minutes\": 40, \
    \"ingredients\": [\"1 cup toor dal\", \"2 tbsp ghee\", \"salt to taste\"], \
    \"instructions\": [\"Rinse the dal.\", \"Pressure cook for 3 whistles.\"]}\n\
    Rules: copy every ingredient line with its amount exactly as written, one per entry. \
    Write each step as its own entry. Do not invent ingredients, amounts or steps. \
    Use null for servings or time_minutes when they are not given. \
    If there is no recipe, respond with {\"name\": \"\", \"ingredients\": [], \"instructions\": []}.";

async fn import_ai(source: Source<'_>) -> Result<Draft, ApiError> {
    let text_model = || {
        std::env::var("OLLAMA_TEXT_MODEL")
            .or_else(|_| std::env::var("OLLAMA_VISION_MODEL"))
            .unwrap_or_else(|_| "llama3.2-vision".to_string())
    };
    let (prompt, image, model) = match source {
        Source::Page(t) => (
            format!("Below is the text of a recipe web page, including some unrelated page text. Extract the recipe.\n{RECIPE_SCHEMA}\n\nPAGE TEXT:\n{t}"),
            None,
            text_model(),
        ),
        Source::Text(t) => {
            let t: String = t.chars().take(MAX_AI_TEXT).collect();
            (format!("Below is a recipe someone pasted. Extract it.\n{RECIPE_SCHEMA}\n\nRECIPE:\n{t}"), None, text_model())
        }
        Source::Photo(img) => (
            format!("This photo shows a recipe, such as a cookbook page, a handwritten card or a screenshot. Read it.\n{RECIPE_SCHEMA}"),
            Some(img),
            std::env::var("OLLAMA_VISION_MODEL").unwrap_or_else(|_| "llama3.2-vision".to_string()),
        ),
    };
    let (v, _raw) = ollama_json(&prompt, image, model).await?;
    let lines = |v: &Value| -> Vec<String> {
        v.as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(str::to_string).or_else(|| x["text"].as_str().map(str::to_string)))
                    .map(|s| clean_line(&s))
                    .filter(|s| !s.is_empty())
                    .take(200)
                    .collect()
            })
            .unwrap_or_default()
    };
    let draft = Draft {
        name: v["name"].as_str().map(collapse_ws).unwrap_or_default(),
        servings: servings_of(&v["servings"]),
        time_minutes: v["time_minutes"].as_i64()
            .or_else(|| v["time_minutes"].as_f64().map(|f| f.round() as i64))
            .or_else(|| v["time_minutes"].as_str().and_then(|s| s.trim().parse().ok()))
            .filter(|t| *t > 0),
        ingredients: lines(&v["ingredients"]),
        instructions: lines(&v["instructions"]),
        ..Default::default()
    };
    if draft.is_empty() {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "No recipe found there. Try a clearer photo, or paste the recipe text."));
    }
    Ok(draft)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> (String, f64, String) {
        parse_ingredient(s)
    }

    #[test]
    fn ingredient_lines() {
        assert_eq!(p("1½ cups basmati rice, rinsed"), ("basmati rice".into(), 1.5, "cup".into()));
        assert_eq!(p("1 1/2 tsp salt"), ("salt".into(), 1.5, "tsp".into()));
        assert_eq!(p("200g paneer (cubed)"), ("paneer".into(), 200.0, "g".into()));
        assert_eq!(p("2-3 green chillies"), ("green chillies".into(), 2.0, "pcs".into()));
        assert_eq!(p("2 to 3 tbsp. ghee"), ("ghee".into(), 2.0, "tbsp".into()));
        assert_eq!(p("½ tsp turmeric powder"), ("turmeric powder".into(), 0.5, "tsp".into()));
        assert_eq!(p("a pinch of hing"), ("hing".into(), 1.0, "pinch".into()));
        assert_eq!(p("Salt to taste"), ("Salt to taste".into(), 0.0, "".into()));
        assert_eq!(p("1 inch ginger, grated"), ("ginger".into(), 1.0, "inch".into()));
        assert_eq!(p("3 onions"), ("onions".into(), 3.0, "pcs".into()));
        assert_eq!(p("1 L milk"), ("milk".into(), 1.0, "L".into()));
        assert_eq!(p("1 cup (200 grams) toor dal ((split pigeon peas))"), ("toor dal".into(), 1.0, "cup".into()));
        assert_eq!(p("1½ to 2 tablespoon oil"), ("oil".into(), 1.5, "tbsp".into()));
    }

    #[test]
    fn durations() {
        assert_eq!(duration_minutes(&json!("PT1H30M")), Some(90));
        assert_eq!(duration_minutes(&json!("P0DT0H45M")), Some(45));
        assert_eq!(duration_minutes(&json!("PT20M30S")), Some(21));
    }

    #[test]
    fn json_ld_recipe() {
        let html = r#"<html><head><script type="application/ld+json">
        {"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":["Recipe"],
        "name":"Jeera Rice &amp; Dal","recipeYield":["4","4 servings"],"totalTime":"PT35M",
        "image":[{"url":"https://example.com/a.jpg"}],
        "recipeIngredient":["1 cup basmati rice","1 tsp cumin seeds"],
        "recipeInstructions":[{"@type":"HowToSection","name":"Rice","itemListElement":[
          {"@type":"HowToStep","text":"Rinse the rice."},{"@type":"HowToStep","text":"Cook it."}]}]}]}
        </script></head><body></body></html>"#;
        let d = structured_recipe(html).expect("recipe");
        assert_eq!(d.name, "Jeera Rice & Dal");
        assert_eq!(d.servings.as_deref(), Some("4 servings"));
        assert_eq!(d.time_minutes, Some(35));
        assert_eq!(d.image_url.as_deref(), Some("https://example.com/a.jpg"));
        assert_eq!(d.ingredients, vec!["1 cup basmati rice", "1 tsp cumin seeds"]);
        assert_eq!(d.instructions, vec!["Rice:", "Rinse the rice.", "Cook it."]);
    }

    #[test]
    fn page_text_drops_chrome() {
        let html = "<html><head><style>x{}</style></head><body><nav>Home | About</nav><main><h1>Poha</h1><p>1 cup poha</p><script>evil()</script></main><footer>(c)</footer></body></html>";
        let t = page_text(html);
        assert!(t.contains("Poha") && t.contains("1 cup poha"));
        assert!(!t.contains("Home") && !t.contains("evil") && !t.contains("(c)"));
    }

    #[test]
    fn private_hosts_blocked() {
        for u in ["http://localhost:3000", "http://192.168.1.1/", "http://127.0.0.1", "http://[::1]/", "http://router/", "http://100.85.1.2/"] {
            assert!(is_private_host(&Url::parse(u).unwrap()), "{u}");
        }
        assert!(!is_private_host(&Url::parse("https://www.example.com/recipe").unwrap()));
    }
}
