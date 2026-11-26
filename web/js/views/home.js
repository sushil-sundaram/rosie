import { h, list, section, segmented, stat, store } from "../dom.js";
import { cents, fmtQty, money, moneyShort } from "../money.js";
import { isPantryLow } from "../pantry_match.js";
import { render } from "../router.js";
import { cached } from "../store.js";
import { cal, calendar, gridRange, inMonth, monthKey, moveItem, split, weekStrip } from "../components/calendar.js";
import {
  bySlot, chipLabel, choreForm, choreRow, expenseForm, expenseRow,
  ghostChip, mealForm, mealRow, projected, SLOT_COLOR,
} from "../components/domain.js";

let homeAdd = "chore";

export async function homeView(root) {
  const { from, to } = gridRange();
  const win = monthKey();
  const [pantry, chores, meals, expenses, recipes, budgets] = await Promise.all([
    cached("pantry", "/pantry"),
    cached("chores", "/chores"),
    cached(`meals:${win}`, `/meals?from=${from}&to=${to}`),
    cached(`expenses:${win}`, `/expenses?from=${from}&to=${to}`),
    cached("recipes", "/recipes"),
    cached("budgets", "/budgets"),
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
  const low = pantry.filter(isPantryLow);

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
      if (t) out.push({ label: moneyShort(t), cls: "c-pink", title: `Spent ${money(t)}` });
    }
    return out;
  };

  const sel = cal.sel;
  const dMeals = meals.filter((m) => m.date === sel).sort(bySlot);
  const dChores = chores.filter((c) => c.due_date === sel);
  const dExp = expenses.filter((e) => e.date === sel);
  const calMode = store.get("homeCalMode", "week");
  const modeToggle = segmented([["week", "Week"], ["month", "Month"]], calMode, (k) => { store.set("homeCalMode", k); render(); }, "Calendar view");

  root.append(split(
    [
      h("div.stats",
        stat(moneyShort(spend), budgetTotal ? `Spent of ${moneyShort(budgetTotal)} budget` : "Spent this month",
          budgetTotal && cents(spend) > cents(budgetTotal) ? "c-red" : "c-pink"),
        stat(`${mChores.filter((c) => c.status === "done").length}/${mChores.length}`, "Chores done this month", "c-orange"),
        stat(meals.filter((m) => inMonth(m.date)).length, "Meals planned this month", "c-cyan"),
        stat(low.length, "Pantry items low", low.length ? "c-red" : "c-green"),
      ),
      h("div.layers", { role: "group", "aria-label": "Show on calendar" },
        [["meals", "Meals", "c-purple"], ["chores", "Chores", "c-orange"], ["expenses", "Expenses", "c-pink"]].map(([k, label, c]) =>
          h("button.toggle", { type: "button", class: layers[k] ? `on ${c}` : null, "aria-pressed": String(!!layers[k]), onclick: () => toggleLayer(k) }, label))),
      h("div.home-cal-wrap", calendar({ chipsFor, onMove: moveItem })),
    ],
    [
      section("Meals", list(dMeals, mealRow, "Nothing planned")),
      section("Chores", list(dChores, choreRow, "No chores")),
      section("Expenses", list(dExp, expenseRow, "Nothing spent")),
      h("h2", "Add to this day"),
      segmented([["chore", "Chore"], ["meal", "Meal"], ["expense", "Expense"]], homeAdd, (k) => { homeAdd = k; render(); }, "Item type"),
      homeAdd === "chore" ? choreForm(sel) : homeAdd === "meal" ? mealForm(sel, recipes) : expenseForm(sel),
      low.length ? section("Running low", list(low, (p) => [h("span.grow.title", p.name), h("span.num.c-red", `${fmtQty(p.quantity)} ${p.unit}`)])) : null,
    ],
    {
      className: `home-split mode-${calMode}`,
      mobileTop: h("div.home-mobile-top", weekStrip({ chipsFor, extraNav: modeToggle })),
    },
  ));
}
