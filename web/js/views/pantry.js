import { api } from "../api.js";
import { addDays, fmtDay, parseISO, today } from "../dates.js";
import { delBtn, fail, formData, h, list, toast } from "../dom.js";
import { fmtQty, money, moneyShort } from "../money.js";
import { render } from "../router.js";
import { cached } from "../store.js";
import { cal } from "../components/calendar.js";
import { asPending, pantryReview, photoButton, setPendingItems } from "../components/domain.js";

export async function pantryView(root) {
  const [items, expenses] = await Promise.all([
    cached("pantry", "/pantry"),
    cached("expenses:recent", "/expenses?limit=200"),
  ]);
  const byId = Object.fromEntries(expenses.map((e) => [e.id, e]));
  const t = today();

  const adjust = async (item, delta) => {
    try {
      await api(`/pantry/${item.id}/adjust`, { method: "POST", body: { delta } });
      render();
    } catch (err) {
      fail(err);
    }
  };

  const expiryTag = (p) => {
    if (!p.expires_on) return null;
    const cls = p.expires_on < t ? "c-red" : p.expires_on <= addDays(t, 3) ? "c-orange" : "c-muted";
    return h("span.tag", { class: cls, title: `expires ${p.expires_on}` }, p.expires_on < t ? "expired" : `exp ${fmtDay(p.expires_on)}`);
  };
  const boughtTag = (p) => {
    const e = byId[p.expense_id];
    if (!e) return null;
    return h("a.tag.c-pink", {
      href: "#/expenses", title: `bought with ${e.title} (${money(e.amount)}) — open in expenses`,
      onclick: () => {
        cal.sel = e.date;
        const d = parseISO(e.date);
        cal.y = d.getFullYear();
        cal.m = d.getMonth();
      },
    }, `bought ${fmtDay(e.date)}`);
  };

  // Recent expenses a manual add can be linked to.
  const recent = expenses.filter((e) => e.date >= addDays(t, -30)).slice(0, 25);
  const form = h("form.row", {
    onsubmit: async (e) => {
      e.preventDefault();
      const d = formData(e.target);
      try {
        const out = await api("/pantry/batch", {
          method: "POST",
          body: {
            expense_id: d.expense_id ? Number(d.expense_id) : null,
            items: [{ name: d.name.trim(), quantity: Number(d.quantity), unit: d.unit.trim() || "pcs", expires_on: d.expires_on || null }],
          },
        });
        toast(out.topped_up ? `topped up ${d.name}` : `added ${d.name}`);
        render();
      } catch (err) {
        fail(err);
      }
    },
  },
    h("input", { name: "name", placeholder: "item", required: true, autocomplete: "off", "aria-label": "item" }),
    h("input.w-xs", { name: "quantity", type: "number", step: "any", min: "0", value: "1", required: true, "aria-label": "quantity" }),
    h("input.w-xs", { name: "unit", placeholder: "unit", value: "pcs", "aria-label": "unit" }),
    h("input.w-date", { name: "expires_on", type: "date", title: "expiry date (optional)", "aria-label": "expiry date, optional" }),
    recent.length ? h("select", { name: "expense_id", "aria-label": "bought with expense, optional" },
      h("option", { value: "" }, "bought with… (optional)"),
      recent.map((e) => h("option", { value: e.id }, `${fmtDay(e.date)} · ${e.title} · ${moneyShort(e.amount)}`))) : null,
    h("button.primary", { type: "submit" }, "add"),
  );

  const photo = photoButton("add from photo", "looking at the photo", "/pantry/scan-photo", (out) => {
    if (!out.items || !out.items.length) return "no items recognised — try a closer, brighter photo";
    setPendingItems({ expense_id: null, items: asPending(out.items) });
    render();
    return "";
  }, "pantry");

  const low = items.filter((i) => i.quantity <= 1);
  // Low items first, then alphabetical.
  const sorted = [...items].sort((a, b) => (b.quantity <= 1) - (a.quantity <= 1) || a.name.localeCompare(b.name));

  root.append(h("div.narrow",
    h("h1", "pantry"),
    h("p.sub", `${items.length} items · ${low.length} low · ${items.filter((i) => i.expires_on && i.expires_on <= addDays(t, 3)).length} expiring soon`),
    form,
    photo,
    pantryReview(),
    h("h2", "inventory"),
    list(sorted, (it) => [
      h("span.grow.title", it.name),
      expiryTag(it),
      boughtTag(it),
      h("button.icon", { title: "decrease", "aria-label": `decrease ${it.name}`, onclick: () => adjust(it, -1), disabled: it.quantity <= 0 }, "−"),
      h("span.num", { class: it.quantity <= 1 ? "c-red" : "c-green" }, `${fmtQty(it.quantity)} ${it.unit}`),
      h("button.icon", { title: "increase", "aria-label": `increase ${it.name}`, onclick: () => adjust(it, 1) }, "+"),
      delBtn(`/pantry/${it.id}`, it.name),
    ], "your pantry is empty — add items, or snap a photo of your groceries"),
  ));
}
