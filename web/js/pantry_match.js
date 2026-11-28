const UNIT_CONV = {
  g: ["mass", 1],
  gram: ["mass", 1],
  grams: ["mass", 1],
  kg: ["mass", 1000],
  kilogram: ["mass", 1000],
  kilograms: ["mass", 1000],
  oz: ["mass", 28.3495],
  lb: ["mass", 453.592],
  lbs: ["mass", 453.592],
  ml: ["vol", 1],
  l: ["vol", 1000],
  liter: ["vol", 1000],
  liters: ["vol", 1000],
  litre: ["vol", 1000],
  litres: ["vol", 1000],
  tsp: ["vol", 5],
  tbsp: ["vol", 15],
  cup: ["vol", 240],
  cups: ["vol", 240],
  "": ["count", 1],
  pc: ["count", 1],
  pcs: ["count", 1],
  piece: ["count", 1],
  pieces: ["count", 1],
  clove: ["count", 1],
  cloves: ["count", 1],
  slice: ["count", 1],
  slices: ["count", 1],
  can: ["count", 1],
  cans: ["count", 1],
  pack: ["count", 1],
  packs: ["count", 1],
};

export function defaultLowThreshold(unit) {
  const u = String(unit || "").trim().toLowerCase();
  if (u === "g" || u === "gram" || u === "grams" || u === "ml") return 100;
  if (u === "kg" || u === "kilogram" || u === "kilograms" || u === "l" || u === "liter" || u === "liters" || u === "litre" || u === "litres") return 0.5;
  if (u === "tsp" || u === "tbsp") return 2;
  // Counted things (1 coconut, 1 pack) aren't "low" until they run out; a
  // per-item alert level (e.g. eggs at 4) can be set when editing an item.
  return 0;
}

export function effectiveLowThreshold(item) {
  return item && item.low_threshold != null ? Number(item.low_threshold) : defaultLowThreshold(item?.unit);
}

export function isPantryLow(item) {
  if (!item) return false;
  return Number(item.quantity) <= effectiveLowThreshold(item);
}

function normName(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function singularize(word) {
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

function nameTokens(raw) {
  return normName(raw).split(" ").filter(Boolean).map(singularize);
}

function findPantryMatch(ingName, pantry) {
  const targetNorm = normName(ingName);
  if (!targetNorm) return null;
  const targetTokens = nameTokens(ingName);
  const targetKey = targetTokens.join(" ");

  let best = null;
  let bestScore = 0;
  for (const p of pantry) {
    const pNorm = normName(p.name);
    if (!pNorm) continue;
    const pTokens = nameTokens(p.name);
    const pKey = pTokens.join(" ");
    let score = 0;
    if (pNorm === targetNorm || pKey === targetKey) score = 100;
    else if (pKey && targetKey && (pKey.includes(targetKey) || targetKey.includes(pKey))) score = 70;
    else {
      const overlap = targetTokens.filter((t) => pTokens.includes(t)).length;
      if (overlap > 0 && overlap >= Math.min(targetTokens.length, pTokens.length)) {
        score = 40 + overlap * 10;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return bestScore >= 40 ? best : null;
}

/** "Salt to taste" -> "Salt": the words a shopping list doesn't need. */
export function groceryName(raw) {
  return String(raw || "")
    .replace(/\b(to taste|as needed|as required|as per taste|for garnish(ing)?|optional|if needed)\b/gi, "")
    .replace(/\s*[,(]\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * What to buy so the pantry covers these ingredients: missing ones in the
 * recipe's amount, partly-stocked ones as the shortfall in the pantry's unit.
 * Ingredients may carry `source` (the recipe name), passed through for notes.
 */
export function matchRecipePantry(ingredients = [], pantry = []) {
  const matches = [];
  const deductMap = new Map();
  const missingItems = [];
  let availableCount = 0;

  for (const ing of ingredients) {
    const queryName = ing.name || ing.text || "";
    const pantryItem = findPantryMatch(queryName, pantry);
    const needQty = Number(ing.quantity) || 0;
    const needUnit = String(ing.unit || "").trim().toLowerCase();

    if (!pantryItem || Number(pantryItem.quantity) <= 0) {
      matches.push({ ing, pantryItem, status: "missing", deductQty: 0 });
      const name = groceryName(ing.name || queryName);
      if (name) {
        missingItems.push({
          name,
          // 0 = "some": no amount was given ("salt to taste").
          quantity: needQty > 0 ? needQty : 0,
          unit: needQty > 0 ? needUnit : "",
          source: ing.source || null,
        });
      }
      continue;
    }

    if (needQty <= 0) {
      availableCount += 1;
      matches.push({ ing, pantryItem, status: "available", deductQty: 0 });
      continue;
    }

    const haveUnit = String(pantryItem.unit || "").trim().toLowerCase();
    const cNeed = UNIT_CONV[needUnit];
    const cHave = UNIT_CONV[haveUnit];
    let ratio = null;
    if (needUnit === haveUnit) ratio = 1;
    else if (cNeed && cHave && cNeed[0] === cHave[0]) ratio = cNeed[1] / cHave[1];

    if (ratio == null) {
      availableCount += 1;
      matches.push({ ing, pantryItem, status: "check", deductQty: 0 });
      continue;
    }

    const needInPantry = Math.round(needQty * ratio * 1000) / 1000;
    const alreadyPlanned = deductMap.get(pantryItem.id)?.delta || 0;
    const remaining = Math.max(0, Number(pantryItem.quantity) - alreadyPlanned);

    if (remaining >= needInPantry) {
      availableCount += 1;
      const take = needInPantry;
      if (take > 0) {
        const prev = deductMap.get(pantryItem.id) || { id: pantryItem.id, name: pantryItem.name, unit: pantryItem.unit, delta: 0 };
        prev.delta = Math.round((prev.delta + take) * 1000) / 1000;
        deductMap.set(pantryItem.id, prev);
      }
      matches.push({ ing, pantryItem, status: "available", deductQty: take });
    } else {
      const take = Math.round(remaining * 1000) / 1000;
      if (take > 0) {
        const prev = deductMap.get(pantryItem.id) || { id: pantryItem.id, name: pantryItem.name, unit: pantryItem.unit, delta: 0 };
        prev.delta = Math.round((prev.delta + take) * 1000) / 1000;
        deductMap.set(pantryItem.id, prev);
      }
      matches.push({ ing, pantryItem, status: "low", deductQty: take });
      // Buy the difference, named and measured like the pantry item so it tops it up.
      const short = Math.round((needInPantry - take) * 1000) / 1000;
      if (short > 0) missingItems.push({ name: pantryItem.name, quantity: short, unit: pantryItem.unit, source: ing.source || null });
    }
  }

  return {
    matches,
    availableCount,
    totalCount: ingredients.length,
    deductItems: [...deductMap.values()].filter((d) => d.delta > 0),
    missingItems,
  };
}
