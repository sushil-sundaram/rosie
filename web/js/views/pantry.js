import { api, conflictCurrent } from "../api.js";
import { addDays, fmtDay, parseISO, today } from "../dates.js";
import { delBtn, fail, formData, h, list, segmented, showConflict, toast } from "../dom.js";
import { fmtQty, money, moneyShort } from "../money.js";
import { defaultLowThreshold, isPantryLow } from "../pantry_match.js";
import { render } from "../router.js";
import { cached } from "../store.js";
import { cal } from "../components/calendar.js";
import { asPending, editBtn, pantryReview, photoButton, setPendingItems } from "../components/domain.js";
import { showModal } from "../shortcuts.js";

let pantryQuery = "";
let pantryFilter = "all";

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

  const openEditModal = (it) => {
    // The version this form was opened from; a save only applies to it.
    let version = it.version ?? null;
    const save = async (target) => {
      const d = formData(target);
      const name = d.name.trim();
      if (!name) return toast("Item name is required", true);
      try {
        await api(`/pantry/${it.id}`, {
          method: "PUT",
          body: {
            name,
            quantity: Number(d.quantity) || 0,
            unit: d.unit.trim() || "pcs",
            expires_on: d.expires_on || "",
            low_threshold: d.low_threshold !== "" ? Number(d.low_threshold) : null,
            version,
          },
        });
        close();
        toast(`Saved ${name}`);
        render();
      } catch (err) {
        const now = conflictCurrent(err);
        if (!now) return fail(err);
        showConflict(form, `It's now ${now.name}, ${fmtQty(now.quantity)} ${now.unit}${now.expires_on ? `, expires ${now.expires_on}` : ""}.`, [
          ["Keep mine", () => { version = now.version; save(form); }, true],
          ["Use theirs", () => { close(); render(); }],
        ]);
      }
    };
    const form = h(
      "form.stack",
      {
        onsubmit: (e) => {
          e.preventDefault();
          save(e.target);
        },
      },
      h("input", { name: "name", value: it.name, placeholder: "Item", required: true, "aria-label": "Item" }),
      h(
        "div.row-fields",
        h("input", { name: "quantity", type: "number", step: "any", min: "0", value: it.quantity, required: true, "aria-label": "Quantity" }),
        h("input", { name: "unit", value: it.unit, placeholder: "Unit", "aria-label": "Unit" }),
        h("input", { name: "expires_on", type: "date", value: it.expires_on || "", "aria-label": "Expiry date" }),
      ),
      h("label.field",
        h("span.meta", "Low-stock alert at or below"),
        h("input", {
          name: "low_threshold",
          type: "number",
          step: "any",
          min: "0",
          value: it.low_threshold ?? "",
          placeholder: `Auto (${defaultLowThreshold(it.unit)} ${it.unit})`,
          "aria-label": "Low stock threshold",
        }),
      ),
      h("button.primary", { type: "submit" }, "Save changes"),
    );
    const { close } = showModal({ title: "Edit pantry item", body: form, backdropClass: "sheet-mobile" });
  };

  const expiryTag = (p) => {
    if (!p.expires_on) return null;
    const cls = p.expires_on < t ? "c-red" : p.expires_on <= addDays(t, 3) ? "c-orange" : "c-muted";
    return h("span.tag", { class: cls, title: `Expires ${p.expires_on}` }, p.expires_on < t ? "Expired" : `Exp ${fmtDay(p.expires_on)}`);
  };
  const boughtTag = (p) => {
    const e = byId[p.expense_id];
    if (!e) return null;
    return h("a.tag.c-pink", {
      href: "#/expenses", title: `Bought with ${e.title} (${money(e.amount)}) — open in Expenses`,
      onclick: () => {
        cal.sel = e.date;
        const d = parseISO(e.date);
        cal.y = d.getFullYear();
        cal.m = d.getMonth();
      },
    }, `Bought ${fmtDay(e.date)}`);
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
        toast(out.topped_up ? `Topped up ${d.name}` : `Added ${d.name}`);
        render();
      } catch (err) {
        fail(err);
      }
    },
  },
    h("input", { name: "name", placeholder: "Item", required: true, autocomplete: "off", "aria-label": "Item" }),
    h("input.w-xs", { name: "quantity", type: "number", step: "any", min: "0", value: "1", required: true, "aria-label": "Quantity" }),
    h("input.w-xs", { name: "unit", placeholder: "Unit", value: "pcs", "aria-label": "Unit" }),
    h("input.w-date", { name: "expires_on", type: "date", title: "Expiry date (optional)", "aria-label": "Expiry date, optional" }),
    recent.length ? h("select", { name: "expense_id", "aria-label": "Bought with expense, optional" },
      h("option", { value: "" }, "Bought with… (optional)"),
      recent.map((e) => h("option", { value: e.id }, `${fmtDay(e.date)} · ${e.title} · ${moneyShort(e.amount)}`))) : null,
    h("button.primary", { type: "submit" }, "Add"),
  );

  const photo = photoButton("Add from photo", "Looking at the photo", "/pantry/scan-photo", (out) => {
    if (!out.items || !out.items.length) return "No items recognised — try a closer, brighter photo";
    setPendingItems({ expense_id: null, items: asPending(out.items) });
    render();
    return "";
  }, "pantry");

  const low = items.filter(isPantryLow);
  const expiring = items.filter((i) => i.expires_on && i.expires_on <= addDays(t, 3));
  // Low items first, then alphabetical.
  const sorted = [...items].sort((a, b) => isPantryLow(b) - isPantryLow(a) || a.name.localeCompare(b.name));

  const listWrap = h("div.pantry-list-wrap");
  const filterWrap = h("div.filter-bar");

  const renderFiltered = () => {
    const q = pantryQuery.trim().toLowerCase();
    const visible = sorted.filter((it) => {
      if (pantryFilter === "low" && !isPantryLow(it)) return false;
      if (pantryFilter === "expiring" && !(it.expires_on && it.expires_on <= addDays(t, 3))) return false;
      if (q && !it.name.toLowerCase().includes(q) && !(it.unit || "").toLowerCase().includes(q)) return false;
      return true;
    });
    const emptyMsg = sorted.length
      ? "No matching pantry items"
      : "Your pantry is empty — add items, or snap a photo of your groceries";
    listWrap.replaceChildren(
      list(visible, (it) => [
        h("span.grow.title", it.name),
        expiryTag(it),
        boughtTag(it),
        h("button.icon", { title: "Decrease", "aria-label": `Decrease ${it.name}`, onclick: () => adjust(it, -1), disabled: it.quantity <= 0 }, "−"),
        h("span.num", { class: isPantryLow(it) ? "c-red" : "c-green" }, `${fmtQty(it.quantity)} ${it.unit}`),
        h("button.icon", { title: "Increase", "aria-label": `Increase ${it.name}`, onclick: () => adjust(it, 1) }, "+"),
        editBtn(it.name, () => openEditModal(it)),
        delBtn(`/pantry/${it.id}`, it.name),
      ], emptyMsg),
    );
  };

  const renderFilters = () => {
    const seg = segmented(
      [["all", `All (${items.length})`], ["low", `Low (${low.length})`], ["expiring", `Expiring (${expiring.length})`]],
      pantryFilter,
      (k) => {
        pantryFilter = k;
        renderFilters();
        renderFiltered();
      },
      "Pantry filter",
    );
    const segSlot = filterWrap.querySelector(".seg");
    if (segSlot) segSlot.replaceWith(seg);
    else filterWrap.append(seg);
  };

  const searchInput = h("input.search-input", {
    type: "search",
    value: pantryQuery,
    placeholder: "Search pantry…",
    "aria-label": "Search pantry",
    "data-shortcut-search": "true",
    oninput: (e) => {
      pantryQuery = e.target.value;
      renderFiltered();
    },
  });
  filterWrap.append(searchInput);
  renderFilters();
  renderFiltered();

  root.append(h("div.narrow",
    h("h1", "Pantry"),
    h("p.sub", `${items.length} items · ${low.length} low · ${expiring.length} expiring soon`),
    form,
    photo,
    pantryReview(),
    h("h2", "Inventory"),
    filterWrap,
    listWrap,
  ));
}
