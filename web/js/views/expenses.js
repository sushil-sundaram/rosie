import { api } from "../api.js";
import { fmtDay, parseISO, today } from "../dates.js";
import { delBtn, eyebrow, fail, h, list, section, segmented, toast } from "../dom.js";
import { CAT_COLOR, CATEGORIES, cents, money, moneyShort } from "../money.js";
import { render } from "../router.js";
import { cached } from "../store.js";
import { cal, calendar, gridRange, inMonth, monthKey, moveItem, split } from "../components/calendar.js";
import {
  billForm, chipLabel, expenseForm, expenseRow, ghostChip,
  pantryReview, projected, repeatTag, setChore,
} from "../components/domain.js";

let expenseAdd = "expense";
const budgetColor = (spent, budget) => (!budget ? "var(--muted)" : cents(spent) > cents(budget) ? "var(--red)" : cents(spent) >= cents(budget) * 0.8 ? "var(--orange)" : "var(--green)");

export async function expensesView(root) {
  const { from, to } = gridRange();
  const win = monthKey();
  const [expenses, budgets, chores, pantry] = await Promise.all([
    cached(`expenses:${win}`, `/expenses?from=${from}&to=${to}`),
    cached("budgets", "/budgets"),
    cached("chores", "/chores"),
    cached("pantry", "/pantry"),
  ]);
  const linkedCount = (e) => pantry.filter((p) => p.expense_id === e.id).length;
  const month = expenses.filter((e) => inMonth(e.date));
  const total = month.reduce((s, e) => s + e.amount, 0);
  const spentBy = {};
  for (const e of month) spentBy[e.category] = (spentBy[e.category] || 0) + e.amount;
  const budgetOf = Object.fromEntries(budgets.map((b) => [b.category, b.amount]));
  const budgetTotal = budgets.reduce((s, b) => s + b.amount, 0);
  const dayTotal = (ds) => expenses.filter((e) => e.date === ds).reduce((s, e) => s + e.amount, 0);
  const day = expenses.filter((e) => e.date === cal.sel);

  const bills = chores.filter((c) => c.amount);
  const unpaid = bills.filter((c) => c.status !== "done").sort((a, b) => (a.due_date || "9").localeCompare(b.due_date || "9"));
  const billGhosts = projected(bills);
  const stillDue = unpaid.filter((c) => inMonth(c.due_date)).reduce((s, c) => s + c.amount, 0)
    + billGhosts.filter((p) => inMonth(p.date)).reduce((s, p) => s + p.chore.amount, 0);
  const dayBills = unpaid.filter((c) => c.due_date === cal.sel);
  const t = today();

  // Pace: how much of the month has gone vs how much budget is used.
  const isCurrent = `${cal.y}-${String(cal.m + 1).padStart(2, "0")}` === t.slice(0, 7);
  const daysInMonth = new Date(cal.y, cal.m + 1, 0).getDate();
  const daysLeft = isCurrent ? daysInMonth - parseISO(t).getDate() + 1 : 0;

  const saveBudget = async (category, amount) => {
    try {
      await api(`/budgets/${encodeURIComponent(category)}`, { method: "PUT", body: { amount: Number(amount) || 0 } });
      toast(`Budget for ${category} saved`);
      render();
    } catch (err) {
      fail(err);
    }
  };

  const budgetRow = (cat) => {
    const spent = spentBy[cat] || 0;
    const budget = budgetOf[cat] || 0;
    const pct = budget ? Math.min(100, (spent / budget) * 100) : 0;
    return h("li", h("div.grow",
      h("div.spread",
        h("span", { class: CAT_COLOR[cat] }, cat),
        h("span.budget-nums",
          h("span.num", moneyShort(spent)),
          h("span.meta", " / "),
          h("input.budget", {
            type: "number", min: "0", step: "any", value: budget || "", placeholder: "Set",
            "aria-label": `Monthly budget for ${cat}`, title: "Monthly budget — press Enter to save",
            onchange: (e) => saveBudget(cat, e.target.value),
          }),
        ),
      ),
      h("div.bar", h("i", { style: `width:${budget ? pct : 0}%;background:${budgetColor(spent, budget)}` })),
      budget && cents(spent) > cents(budget) ? h("span.meta.c-red", `Over by ${moneyShort(spent - budget)}`) : null,
    ));
  };

  const remaining = (cents(budgetTotal) - cents(total)) / 100;
  root.append(eyebrow("Expenses"), split(
    [
      calendar({
        chipsFor: (ds) => {
          const out = [];
          const tt = dayTotal(ds);
          if (tt) out.push({ label: moneyShort(tt), cls: "c-pink", title: `Spent ${money(tt)}` });
          unpaid.filter((c) => c.due_date === ds).forEach((c) => out.push({ label: chipLabel(c), cls: ds < t ? "c-red" : "c-yellow", kind: "chore", id: c.id, title: `Bill due: ${c.title} ${money(c.amount)}` }));
          billGhosts.filter((p) => p.date === ds).forEach((p) => out.push(ghostChip(p)));
          return out;
        },
        onMove: moveItem,
        legend: [["Spent", "c-pink"], ["Bill due", "c-yellow"], ["Bill overdue", "c-red"], ["Upcoming repeat", "c-muted ghost"]],
      }),

      h("h2", "Budget"),
      h("div.budget-head",
        h("div", h("b.num", { style: `color:${budgetColor(total, budgetTotal)}` }, moneyShort(total)),
          h("span.meta", budgetTotal ? ` of ${moneyShort(budgetTotal)}` : " spent")),
        budgetTotal ? h("span.meta", remaining >= 0
          ? `${moneyShort(remaining)} left${isCurrent ? ` · ${daysLeft} day${daysLeft === 1 ? "" : "s"} to go · ~${moneyShort(remaining / daysLeft)}/day` : ""}`
          : `Over by ${moneyShort(-remaining)}`) : h("span.meta", "Set a monthly amount per category below"),
      ),
      budgetTotal ? h("div.bar.big", h("i", { style: `width:${Math.min(100, (total / budgetTotal) * 100)}%;background:${budgetColor(total, budgetTotal)}` })) : null,
      stillDue ? h("p.hint", h("span.c-yellow", moneyShort(stillDue)), " in bills still due this month",
        budgetTotal ? ` · ${moneyShort(budgetTotal - total - stillDue)} free after bills` : "") : null,
      h("ul.list", CATEGORIES.filter((c) => budgetOf[c] || spentBy[c]).concat(CATEGORIES.filter((c) => !budgetOf[c] && !spentBy[c]))
        .slice(0, CATEGORIES.length).map(budgetRow)),

      h("h2", "Bills to pay"),
      list(unpaid, (c) => [
        h("span.meta.num", { class: c.due_date && c.due_date < t ? "c-red" : null }, c.due_date ? (c.due_date < t ? `Overdue ${fmtDay(c.due_date)}` : fmtDay(c.due_date)) : "No date"),
        h("span.grow.title", c.title),
        repeatTag(c),
        h("span.num", money(c.amount)),
        h("button", { onclick: () => setChore(c, { status: "done" }), title: "Mark paid and log as an expense" }, "Pay"),
        delBtn(`/chores/${c.id}`, c.title),
      ], "No bills due"),
    ],
    [
      pantryReview(),
      day.length ? [list(day, (e) => expenseRow(e, linkedCount(e))), h("p.total.right", h("span.num", money(dayTotal(cal.sel))))] : h("p.empty", "Nothing spent"),
      dayBills.length ? section("Bills due", list(dayBills, (c) => [
        h("span.grow.title", c.title), h("span.num", money(c.amount)),
        h("button", { onclick: () => setChore(c, { status: "done" }) }, "Pay"),
      ])) : null,
      h("h2", "Add"),
      segmented([["expense", "Expense"], ["bill", "Bill to pay"]], expenseAdd, (k) => { expenseAdd = k; render(); }, "Add type"),
      expenseAdd === "bill"
        ? [billForm(cal.sel), h("p.hint", "Bills show up in Chores on their due date; paying one logs it as an expense")]
        : expenseForm(cal.sel, true),
    ],
  ));
}
