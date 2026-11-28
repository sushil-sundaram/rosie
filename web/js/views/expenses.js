import { api } from "../api.js";
import { fmtDay, parseISO, today } from "../dates.js";
import { delBtn, eyebrow, fail, h, list, section, segmented, toast } from "../dom.js";
import { CAT_COLOR, CATEGORIES, cents, money, moneyShort } from "../money.js";
import { render } from "../router.js";
import { cached } from "../store.js";
import { cal, calendar, gridRange, inMonth, monthKey, moveItem, split } from "../components/calendar.js";
import {
  billForm, chipLabel, editBtn, expenseForm, expenseRow, ghostChip, moveBtn, openChoreEditModal, pantryReview, payBillBtn, projected, repeatTag, syncMembers, choreMenu, choreDetails,
} from "../components/domain.js";

let expenseAdd = "expense";
/** Bars stay grey while things are fine; orange near the limit, red over it. */
const budgetColor = (spent, budget) => (!budget ? "var(--line)" : cents(spent) > cents(budget) ? "var(--red)" : cents(spent) >= cents(budget) * 0.8 ? "var(--orange)" : "var(--muted)");

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
  const paidBillExpenseIds = new Set(chores.filter((c) => c.expense_id != null).map((c) => c.expense_id));
  const month = expenses.filter((e) => inMonth(e.date));
  const total = month.reduce((s, e) => s + e.amount, 0);
  const spentBy = {};
  for (const e of month) spentBy[e.category] = (spentBy[e.category] || 0) + e.amount;
  const budgetOf = Object.fromEntries(budgets.map((b) => [b.category, b.amount]));
  const budgetTotal = budgets.reduce((s, b) => s + b.amount, 0);
  const dayTotal = (ds) => expenses.filter((e) => e.date === ds).reduce((s, e) => s + e.amount, 0);
  const day = expenses.filter((e) => e.date === cal.sel);

  const bills = chores.filter((c) => c.amount);
  syncMembers(chores);
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
    const initial = budget ? String(budget) : "";
    const pct = budget ? Math.min(100, (spent / budget) * 100) : 0;
    let savedValue = initial;
    let saving = false;
    const saveBtn = h("button.tag.linkish.budget-save", { type: "submit", hidden: true }, "Save");
    const input = h("input.budget", {
      type: "number", min: "0", step: "any", value: initial, placeholder: "Set",
      "aria-label": `Monthly budget for ${cat}`,
      oninput: () => { saveBtn.hidden = input.value === savedValue; },
      onblur: (e) => {
        if (e.relatedTarget === saveBtn) return;
        if (input.value !== savedValue) commit();
      },
    });
    const commit = async () => {
      if (saving || input.value === savedValue) return;
      saving = true;
      savedValue = input.value;
      saveBtn.hidden = true;
      await saveBudget(cat, input.value);
      saving = false;
    };
    return h("li", h("div.grow",
      h("div.spread",
        h("span", cat),
        h("form.budget-nums",
          {
            onsubmit: (e) => {
              e.preventDefault();
              commit();
            },
          },
          h("span.num", moneyShort(spent)),
          h("span.meta", " / "),
          input,
          saveBtn,
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
          if (tt) out.push({ label: moneyShort(tt), cls: "t-spend", title: `Spent ${money(tt)}` });
          unpaid.filter((c) => c.due_date === ds).forEach((c) => out.push({ label: chipLabel(c), cls: ds < t ? "c-red" : "t-bill", kind: "chore", id: c.id, title: `Bill due: ${c.title} ${money(c.amount)}` }));
          billGhosts.filter((p) => p.date === ds).forEach((p) => out.push(ghostChip(p)));
          return out;
        },
        onMove: moveItem,
        legend: [["Spent", "t-spend"], ["Bill due", "t-bill"], ["Bill overdue", "c-red"], ["Upcoming repeat", "t-bill ghost"]],
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
      stillDue ? h("p.hint", h("span.num", moneyShort(stillDue)), " in bills still due this month",
        budgetTotal ? ` · ${moneyShort(budgetTotal - total - stillDue)} free after bills` : "") : null,
      h("p.hint", "Tap a budget amount below and press Enter or tap Save to update."),
      h("ul.list", CATEGORIES.filter((c) => budgetOf[c] || spentBy[c]).concat(CATEGORIES.filter((c) => !budgetOf[c] && !spentBy[c]))
        .slice(0, CATEGORIES.length).map(budgetRow)),

      h("h2", "Bills to pay"),
      list(unpaid, (c) => [
        h("span.meta.num", { class: c.due_date && c.due_date < t ? "c-red" : null }, c.due_date ? (c.due_date < t ? `Overdue ${fmtDay(c.due_date)}` : fmtDay(c.due_date)) : "No date"),
        h("div.grow", h("div.title", c.title), choreDetails(c) ? h("div.meta", choreDetails(c)) : null),
        h("span.num", money(c.amount)),
        payBillBtn(c),
        choreMenu(c),
      ], "No bills due"),
    ],
    [
      pantryReview(),
      day.length ? [list(day, (e) => expenseRow(e, linkedCount(e), paidBillExpenseIds.has(e.id))), h("p.total.right", h("span.num", money(dayTotal(cal.sel))))] : h("p.empty", "Nothing spent"),
      dayBills.length ? section("Bills due", list(dayBills, (c) => [
        h("span.grow.title", c.title), h("span.num", money(c.amount)),
        payBillBtn(c),
        choreMenu(c),
      ])) : null,
      h("h2", "Add"),
      segmented([["expense", "Expense"], ["bill", "Bill to pay"]], expenseAdd, (k) => { expenseAdd = k; render(); }, "Add type"),
      expenseAdd === "bill"
        ? [billForm(cal.sel), h("p.hint", "Bills show up in Chores on their due date; paying one logs it as an expense")]
        : expenseForm(cal.sel, true),
    ],
  ));
}
