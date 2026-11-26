import { api } from "../api.js";
import { h, list, section, segmented, stat, store } from "../dom.js";
import { cents, fmtQty, money, moneyShort } from "../money.js";
import { render } from "../router.js";
import { cal, calendar, inMonth, moveItem, split } from "../components/calendar.js";
import {
  bySlot, chipLabel, choreForm, choreRow, expenseForm, expenseRow,
  ghostChip, mealForm, mealRow, projected, SLOT_COLOR,
} from "../components/domain.js";

let homeAdd = "chore";

export async function homeView(root) {
  const [pantry, chores, meals, expenses, recipes, budgets] = await Promise.all([
    api("/pantry"), api("/chores"), api("/meals"), api("/expenses"), api("/recipes"), api("/budgets"),
  ]);
  const budgetTotal = budgets.reduce((s, b) => s + b.amount, 0);
  const layers = store.get("layers", { meals: true, chores: true, expenses: true });
  const toggleLayer = (k) => {
    layers[k] = !layers[k];
    store.set("layers", layers);
    render();
  };

  const mChores = chores.filter((c) => inMonth(c.due_date));
  const spend = expenses.filter((e) => inMonth(e.date)).reduce((s, e) => s + e.amount, 0);
  const low = pantry.filter((p) => p.quantity <= 1);

  const ghosts = projected(chores);
  const chipsFor = (ds) => {
    const out = [];
    if (layers.chores) ghosts.filter((p) => p.date === ds).forEach((p) => out.push(ghostChip(p)));
    if (layers.meals) meals.filter((m) => m.date === ds).sort(bySlot)
      .forEach((m) => out.push({ label: m.title, cls: SLOT_COLOR[m.slot], kind: "meal", id: m.id, title: `${m.slot}: ${m.title}` }));
    if (layers.chores) chores.filter((c) => c.due_date === ds)
      .forEach((c) => out.push({ label: chipLabel(c), cls: c.amount ? "c-yellow" : "c-orange", kind: "chore", id: c.id, done: c.status === "done" }));
    if (layers.expenses) {
      const t = expenses.filter((e) => e.date === ds).reduce((s, e) => s + e.amount, 0);
      if (t) out.push({ label: moneyShort(t), cls: "c-pink", title: `spent ${money(t)}` });
    }
    return out;
  };

  const sel = cal.sel;
  const dMeals = meals.filter((m) => m.date === sel).sort(bySlot);
  const dChores = chores.filter((c) => c.due_date === sel);
  const dExp = expenses.filter((e) => e.date === sel);

  root.append(split(
    [
      h("div.stats",
        stat(moneyShort(spend), budgetTotal ? `spent of ${moneyShort(budgetTotal)} budget` : "spent this month",
          budgetTotal && cents(spend) > cents(budgetTotal) ? "c-red" : "c-pink"),
        stat(`${mChores.filter((c) => c.status === "done").length}/${mChores.length}`, "chores done this month", "c-orange"),
        stat(meals.filter((m) => inMonth(m.date)).length, "meals planned this month", "c-cyan"),
        stat(low.length, "pantry items low", low.length ? "c-red" : "c-green"),
      ),
      h("div.layers", { role: "group", "aria-label": "show on calendar" },
        [["meals", "c-purple"], ["chores", "c-orange"], ["expenses", "c-pink"]].map(([k, c]) =>
          h("button.toggle", { type: "button", class: layers[k] ? `on ${c}` : null, "aria-pressed": String(!!layers[k]), onclick: () => toggleLayer(k) }, k))),
      calendar({ chipsFor, onMove: moveItem }),
    ],
    [
      section("meals", list(dMeals, mealRow, "nothing planned")),
      section("chores", list(dChores, choreRow, "no chores")),
      section("expenses", list(dExp, expenseRow, "nothing spent")),
      h("h2", "add to this day"),
      segmented([["chore", "chore"], ["meal", "meal"], ["expense", "expense"]], homeAdd, (k) => { homeAdd = k; render(); }, "item type"),
      homeAdd === "chore" ? choreForm(sel) : homeAdd === "meal" ? mealForm(sel, recipes) : expenseForm(sel),
      low.length ? section("running low", list(low, (p) => [h("span.grow.title", p.name), h("span.num.c-red", `${fmtQty(p.quantity)} ${p.unit}`)])) : null,
    ],
  ));
}
