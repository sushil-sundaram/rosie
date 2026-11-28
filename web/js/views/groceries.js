import { api, conflictCurrent } from "../api.js";
import { addDays, today } from "../dates.js";
import { delBtn, fail, formData, h, list, toast } from "../dom.js";
import { fmtQty } from "../money.js";
import { effectiveLowThreshold, isPantryLow, matchRecipePantry } from "../pantry_match.js";
import { render } from "../router.js";
import { cached } from "../store.js";

/*
 * Groceries list. Things get here by hand, from a recipe card, from the next
 * week's meal plan or from low pantry stock — in every case only what the
 * pantry doesn't already cover. Tick items as they go in the cart, then put
 * them in the pantry in one go.
 */

const amount = (g) => (g.quantity > 0 ? `${fmtQty(g.quantity)} ${g.unit}`.trim() : "");

/** Result of a batch add, in words. */
function addedSummary(out) {
  const parts = [];
  if (out.added) parts.push(`${out.added} added`);
  if (out.merged) parts.push(`${out.merged} combined with items already listed`);
  if (out.already) parts.push(`${out.already} already listed for that recipe`);
  return parts.join(", ") || "nothing new to add";
}

async function addBatch(items, what) {
  if (!items.length) return toast(`Nothing to add: the pantry covers ${what}`);
  try {
    const out = await api("/groceries/batch", { method: "POST", body: { items } });
    toast(`Groceries: ${addedSummary(out)}`);
    render();
  } catch (err) {
    fail(err);
  }
}

/** Ingredients for meals planned over the next 7 days that the pantry doesn't cover. */
async function addFromMealPlan(recipes, pantry) {
  const from = today();
  const to = addDays(from, 6);
  let meals;
  try {
    meals = await api(`/meals?from=${from}&to=${to}`);
  } catch (err) {
    return fail(err);
  }
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const planned = meals.map((m) => byId.get(m.recipe_id)).filter(Boolean);
  if (!planned.length) return toast("No meals with recipes planned for the next 7 days");
  // One pass over all of them, so two recipes can't both count the same stock.
  const ingredients = planned.flatMap((r) => (r.ingredients || []).map((i) => ({ ...i, source: r.name })));
  const { missingItems } = matchRecipePantry(ingredients, pantry);
  addBatch(missingItems, `the next 7 days of meals (${planned.length} planned)`);
}

/** Restock low items to about twice their alert level, in the pantry's own unit. */
function lowStockItems(pantry) {
  return pantry.filter(isPantryLow).map((p) => {
    const target = Math.max(effectiveLowThreshold(p) * 2, 1);
    return { name: p.name, quantity: Math.round(Math.max(target - Number(p.quantity), 0) * 100) / 100 || 1, unit: p.unit, source: "Low stock" };
  });
}

function addForm() {
  return h("form.row", {
    onsubmit: async (e) => {
      e.preventDefault();
      const d = formData(e.target);
      const name = d.name.trim();
      if (!name) return;
      try {
        const out = await api("/groceries", {
          method: "POST",
          body: { name, quantity: Number(d.quantity) || 0, unit: d.unit.trim() },
        });
        toast(out.status === "merged" ? `Added to ${name} already on the list` : `Added ${name}`);
        render();
      } catch (err) {
        fail(err);
      }
    },
  },
    h("input", { name: "name", placeholder: "Add an item", required: true, autocomplete: "off", "aria-label": "Item" }),
    h("input.w-xs", { name: "quantity", type: "number", step: "any", min: "0", placeholder: "Qty", "aria-label": "Quantity (optional)" }),
    h("input.w-xs", { name: "unit", placeholder: "Unit", autocomplete: "off", "aria-label": "Unit (optional)" }),
    h("button.primary", { type: "submit" }, "Add"),
  );
}

async function setChecked(g, checked) {
  try {
    await api(`/groceries/${g.id}`, { method: "PATCH", body: { checked } });
    render();
  } catch (err) {
    fail(err);
  }
}

/** Amount editor: saves on change, and won't overwrite a newer edit from another device. */
function qtyInput(g) {
  return h("input.w-xs.grocery-qty", {
    type: "number", step: "any", min: "0",
    value: g.quantity > 0 ? g.quantity : "",
    placeholder: "Qty",
    "aria-label": `Amount of ${g.name}`,
    title: g.unit ? `Amount in ${g.unit}` : "Amount",
    onchange: async (e) => {
      try {
        await api(`/groceries/${g.id}`, { method: "PATCH", body: { quantity: Number(e.target.value) || 0, version: g.version } });
        render();
      } catch (err) {
        const now = conflictCurrent(err);
        if (now) toast(`${now.name} was just changed on another device (now ${amount(now) || "no amount"}). Showing the latest.`, true);
        else fail(err);
        render();
      }
    },
  });
}

function toBuyRow(g) {
  return [
    h("input", { type: "checkbox", "aria-label": `In the cart: ${g.name}`, onchange: () => setChecked(g, true) }),
    h("div.grow",
      h("span.title", g.name),
      g.note ? h("div.meta", `For ${g.note.split("; ").join(", ")}`) : null),
    qtyInput(g),
    g.unit ? h("span.meta.unit", g.unit) : null,
    delBtn(`/groceries/${g.id}`, g.name),
  ];
}

function cartRow(g) {
  return [
    h("input", { type: "checkbox", checked: true, "aria-label": `Take ${g.name} out of the cart`, onchange: () => setChecked(g, false) }),
    h("span.grow.title.strike", g.name),
    amount(g) ? h("span.meta", amount(g)) : null,
    delBtn(`/groceries/${g.id}`, g.name),
  ];
}

/** The list as plain text, for sending to whoever is at the shop. */
function asText(items) {
  return items.map((g) => `• ${g.name}${amount(g) ? ` — ${amount(g)}` : ""}`).join("\n");
}

async function shareList(items) {
  const text = `Groceries\n${asText(items)}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: "Groceries", text });
      return;
    }
    await navigator.clipboard.writeText(text);
    toast("List copied — paste it into a message");
  } catch (err) {
    if (err && err.name !== "AbortError") toast("Couldn't share or copy the list", true);
  }
}

export async function groceriesView(root) {
  const [items, pantry, recipes] = await Promise.all([
    cached("groceries", "/groceries"),
    cached("pantry", "/pantry"),
    cached("recipes", "/recipes"),
  ]);
  const toBuy = items.filter((g) => !g.checked);
  const inCart = items.filter((g) => g.checked);
  const low = lowStockItems(pantry);

  const putAway = async () => {
    try {
      const out = await api("/groceries/to-pantry", { method: "POST", body: {} });
      toast(`Pantry: ${out.added} added, ${out.topped_up} topped up`);
      render();
    } catch (err) {
      fail(err);
    }
  };
  const clearCart = async () => {
    if (!confirm(`Remove ${inCart.length} item${inCart.length === 1 ? "" : "s"} from the list without adding them to the pantry?`)) return;
    try {
      await api("/groceries/clear-checked", { method: "POST", body: {} });
      render();
    } catch (err) {
      fail(err);
    }
  };

  root.append(h("div.narrow",
    h("h1", "Groceries"),
    h("p.sub", `${toBuy.length} to buy${inCart.length ? ` · ${inCart.length} in the cart` : ""}`),
    addForm(),
    h("div.scan.fill-from",
      h("span.meta", "Add what the pantry is missing for:"),
      h("button", { type: "button", onclick: () => addFromMealPlan(recipes, pantry) }, "Next 7 days of meals"),
      h("button", { type: "button", disabled: !low.length, onclick: () => addBatch(low, "every item") },
        low.length ? `Low stock (${low.length})` : "Low stock (none)"),
      h("a.button-link", { href: "#/recipes" }, "A recipe…")),
    h("div.spread",
      h("h2", "To buy"),
      toBuy.length ? h("button.icon", { type: "button", onclick: () => shareList(toBuy), title: "Share or copy the list", "aria-label": "Share or copy the list" }, "Share") : null),
    list(toBuy, toBuyRow, "Nothing to buy. Add items above, or from a recipe's ingredients."),
    inCart.length ? [
      h("h2", "In the cart"),
      list(inCart, cartRow),
      h("div.scan",
        h("button.primary", { type: "button", onclick: putAway }, `Put ${inCart.length} in the pantry`),
        h("button", { type: "button", onclick: clearCart }, "Remove without adding")),
      h("p.hint", "Items already in the pantry with the same name and unit are topped up, not duplicated."),
    ] : null,
  ));
}
