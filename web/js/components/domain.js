import { api } from "../api.js";
import { fmtDay, iso, nextDate } from "../dates.js";
import { create, delBtn, fail, formData, h, toast } from "../dom.js";
import { CATEGORIES, CAT_COLOR, money, moneyShort } from "../money.js";
import { render } from "../router.js";
import { cal } from "./calendar.js";

export const SLOTS = ["breakfast", "lunch", "dinner"];
export const SLOT_COLOR = { breakfast: "c-yellow", lunch: "c-cyan", dinner: "c-purple" };
export const STATUS = ["todo", "in_progress", "done"];
export const STATUS_LABEL = { todo: "to do", in_progress: "doing", done: "done" };
export const STATUS_COLOR = { todo: "c-orange", in_progress: "c-cyan", done: "c-green" };
export const STATUS_GLYPH = { todo: "○", in_progress: "◐", done: "●" };

export const priorityTag = (p) => h("span.tag", { class: { high: "c-red", medium: "c-orange", low: "c-green" }[p] || "c-muted" }, p);
export const bySlot = (a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot);

export async function setChore(c, body) {
  try {
    await api(`/chores/${c.id}`, { method: "PATCH", body });
    if (c.amount && body.status === "done") toast(`paid ${c.title} — logged as an expense`);
    else if (c.amount && body.status && c.status === "done") toast(`${c.title} unpaid — expense removed`);
    render();
  } catch (err) {
    fail(err);
  }
}

export const chipLabel = (c) => (c.amount ? `${c.title} ${moneyShort(c.amount)}` : c.title);

/* ---- recurring ---- */
export const REPEAT_LABEL = { "": "once", weekly: "weekly", monthly: "monthly", yearly: "yearly" };

/**
 * Future occurrences of repeating chores that don't exist yet, for the visible grid.
 * Only the latest open occurrence of a series projects forward.
 */
export function projected(chores) {
  const from = iso(new Date(cal.y, cal.m, -7));
  const until = iso(new Date(cal.y, cal.m + 1, 7));
  const out = [];
  for (const c of chores) {
    if (!c.repeat || c.status === "done" || c.next_id || !c.due_date) continue;
    let d = c.due_date;
    for (let i = 0; i < 600; i++) {
      d = nextDate(d, c.repeat, c.repeat_day || Number(c.due_date.slice(8)));
      if (d > until) break;
      if (d >= from) out.push({ chore: c, date: d });
    }
  }
  return out;
}

export const ghostChip = (p) => ({
  label: chipLabel(p.chore),
  cls: `${p.chore.amount ? "c-yellow" : "c-orange"} ghost`,
  title: `${p.chore.title} — repeats ${p.chore.repeat}, created when the previous one is done`,
});

export function repeatTag(c) {
  if (!c.repeat) return null;
  return h("button.tag.linkish.c-purple", {
    title: `repeats ${c.repeat} — click to stop repeating`,
    "aria-label": `${c.title} repeats ${c.repeat}; stop repeating`,
    onclick: (e) => {
      e.stopPropagation();
      if (confirm(`Stop "${c.title}" repeating ${c.repeat}?`)) setChore(c, { repeat: "" });
    },
  }, `↻ ${c.repeat}`);
}

export const repeatSelect = (opts, dflt) => h("select.w-sm", { name: "repeat", "aria-label": "repeat" },
  opts.map((r) => h("option", { value: r, selected: r === dflt }, REPEAT_LABEL[r])));

export function billForm(date) {
  return h("form.row", {
    onsubmit: (e) => {
      e.preventDefault();
      const d = formData(e.target);
      create("/chores", {
        title: d.title.trim(), description: null, assigned_to: d.assigned_to.trim() || "anyone",
        priority: "high", status: "todo", points: 1, due_date: date,
        amount: Number(d.amount), category: d.category, repeat: d.repeat || null,
      }, `bill ${d.title}`);
    },
  },
    h("input", { name: "title", placeholder: "bill (e.g. electricity)", required: true, autocomplete: "off", "aria-label": "bill" }),
    h("input.w-sm", { name: "amount", type: "number", step: "0.01", min: "0.01", placeholder: "0.00", required: true, "aria-label": "amount" }),
    h("select.w-sm", { name: "category", "aria-label": "category" }, CATEGORIES.map((c) => h("option", { value: c, selected: c === "Utilities" }, c.toLowerCase()))),
    h("input.w-sm", { name: "assigned_to", placeholder: "who pays", "aria-label": "who pays" }),
    repeatSelect(["", "monthly", "yearly"], "monthly"),
    h("button.primary", { type: "submit" }, "add bill"),
  );
}

export function choreRow(c) {
  const next = STATUS[(STATUS.indexOf(c.status) + 1) % STATUS.length];
  return [
    h("button.icon.status", {
      class: STATUS_COLOR[c.status],
      title: `${STATUS_LABEL[c.status]} — click for ${STATUS_LABEL[next]}`,
      "aria-label": `${c.title} is ${STATUS_LABEL[c.status]}, mark ${STATUS_LABEL[next]}`,
      onclick: () => setChore(c, { status: next }),
    }, STATUS_GLYPH[c.status]),
    h("span.grow",
      h("span.title", { class: c.status === "done" ? "strike" : null }, c.title),
      h("span.meta", ` ${c.assigned_to}${c.amount ? "" : ` · ${c.points} pt${c.points === 1 ? "" : "s"}`}`)),
    repeatTag(c),
    c.amount ? h("span.tag.c-yellow", { title: c.status === "done" ? "paid — logged as an expense" : "bill" }, `bill ${moneyShort(c.amount)}`) : priorityTag(c.priority),
    delBtn(`/chores/${c.id}`, c.title),
  ];
}

export const mealRow = (m) => [h("span.tag", { class: SLOT_COLOR[m.slot] || "c-muted" }, m.slot), h("span.grow.title", m.title), delBtn(`/meals/${m.id}`, m.title)];

export const expenseRow = (e, linked = 0) => [
  h("span.grow.title", e.title),
  linked ? h("a.tag.c-green", { href: "#/pantry", title: "items from this purchase in the pantry" }, `${linked} in pantry`) : null,
  h("span.tag", { class: CAT_COLOR[e.category] || "c-muted" }, e.category.toLowerCase()),
  h("span.num", money(e.amount)),
  delBtn(`/expenses/${e.id}`, e.title),
];

export function choreForm(date) {
  return h("form.row", {
    onsubmit: (e) => {
      e.preventDefault();
      const d = formData(e.target);
      create("/chores", {
        title: d.title.trim(), description: null, assigned_to: d.assigned_to.trim() || "anyone",
        priority: d.priority, status: "todo", points: Number(d.points) || 1, due_date: date || null,
        repeat: d.repeat || null,
      }, d.title);
    },
  },
    h("input", { name: "title", placeholder: "chore", required: true, autocomplete: "off", "aria-label": "chore" }),
    h("input.w-sm", { name: "assigned_to", placeholder: "who", "aria-label": "assigned to" }),
    h("select.w-sm", { name: "priority", "aria-label": "priority" }, ["low", "medium", "high"].map((p) => h("option", { value: p, selected: p === "medium" }, p))),
    h("input.w-xs", { name: "points", type: "number", min: "1", value: "1", title: "points", "aria-label": "points" }),
    repeatSelect(["", "weekly", "monthly"], ""),
    h("button.primary", { type: "submit" }, "add"),
  );
}

export function mealForm(date, recipes = []) {
  return h("form.row", {
    onsubmit: (e) => {
      e.preventDefault();
      const d = formData(e.target);
      const recipe = recipes.find((r) => String(r.id) === d.recipe_id);
      const title = (d.title || "").trim() || (recipe && recipe.name);
      if (!title) return toast("enter a meal or pick a recipe", true);
      create("/meals", { date, slot: d.slot, title, recipe_id: recipe ? recipe.id : null }, title);
    },
  },
    h("select.w-sm", { name: "slot", "aria-label": "meal slot" }, SLOTS.map((s) => h("option", { value: s, selected: s === "dinner" }, s))),
    h("input", { name: "title", placeholder: "meal", autocomplete: "off", "aria-label": "meal" }),
    recipes.length ? h("select", { name: "recipe_id", "aria-label": "recipe" },
      h("option", { value: "" }, "or a recipe…"),
      recipes.map((r) => h("option", { value: r.id }, r.name))) : null,
    h("button.primary", { type: "submit" }, "add"),
  );
}

/** Reads an image file and downsizes it (max 1600px, JPEG) so uploads stay small and the model is faster. */
export function readImage(file, maxSide = 1600) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("could not read that image")); };
    img.src = url;
  });
}

/** A button that opens the camera/file picker, sends the photo to `path`, and hands back the JSON. */
export function photoButton(label, busyText, path, onResult) {
  const input = h("input", { type: "file", accept: "image/*", hidden: true });
  const btn = h("button", { type: "button", onclick: () => input.click() }, label);
  const status = h("span.meta");
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    btn.disabled = true;
    status.className = "spinner";
    status.textContent = busyText;
    let note = "";
    try {
      const image_base64 = await readImage(file);
      note = (await onResult(await api(path, { method: "POST", body: { image_base64 } }))) || "";
    } catch (err) {
      fail(err);
    } finally {
      btn.disabled = false;
      status.className = "meta";
      status.textContent = note;
      input.value = "";
    }
  });
  return h("div.scan", btn, input, status);
}

/*
 * Items waiting to be added to the pantry — from a pantry photo, or from a
 * receipt once its expense is saved (then expense_id links them to it).
 */
let pendingItems = null;
let scannedReceipt = null;

export function setPendingItems(items) {
  pendingItems = items;
}

export const asPending = (items) => items.map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit, keep: true }));

export function pantryReview() {
  if (!pendingItems || !pendingItems.items.length) return null;
  const p = pendingItems;
  const items = p.items;
  const confirmAdd = async () => {
    const chosen = items.filter((i) => i.keep && i.name.trim());
    if (!chosen.length) return toast("nothing selected", true);
    try {
      const out = await api("/pantry/batch", {
        method: "POST",
        body: { expense_id: p.expense_id || null, items: chosen.map(({ name, quantity, unit }) => ({ name: name.trim(), quantity: Number(quantity) || 1, unit: unit.trim() || "pcs" })) },
      });
      pendingItems = null;
      toast(`pantry: ${out.added} added, ${out.topped_up} topped up`);
      render();
    } catch (err) {
      fail(err);
    }
  };
  return h("section.review", { "aria-label": "review items for the pantry" },
    h("div.spread",
      h("h3", p.expense_id ? `add items from ${p.label} to the pantry?` : "items found in the photo"),
      h("button.icon", { onclick: () => { pendingItems = null; render(); }, "aria-label": "dismiss" }, "×")),
    h("p.hint", "edit or untick anything that's wrong; existing items are topped up, not duplicated"),
    h("ul.list", items.map((it) => h("li",
      h("input", { type: "checkbox", checked: it.keep, "aria-label": `keep ${it.name}`, onchange: (e) => { it.keep = e.target.checked; } }),
      h("input.grow", { value: it.name, "aria-label": "name", oninput: (e) => { it.name = e.target.value; } }),
      h("input.w-xs", { type: "number", step: "any", min: "0", value: it.quantity, "aria-label": "quantity", oninput: (e) => { it.quantity = e.target.value; } }),
      h("input.w-xs", { value: it.unit, "aria-label": "unit", oninput: (e) => { it.unit = e.target.value; } }),
    ))),
    h("div.scan",
      h("button.primary", { onclick: confirmAdd }, "add to pantry"),
      p.expense_id ? h("span.meta", "linked to that expense") : null),
  );
}

export function expenseForm(date, withScan = false) {
  const r = withScan ? scannedReceipt : null;
  const day = (r && r.date) || date;
  const form = h("form.row", {
    onsubmit: async (e) => {
      e.preventDefault();
      if (form.dataset.busy) return; // no double submit
      const d = formData(e.target);
      const title = d.title.trim();
      form.dataset.busy = "1";
      try {
        const out = await api("/expenses", { method: "POST", body: { title, amount: Number(d.amount), category: d.category, date: d.date || date } });
        toast(`added ${title}`);
        if (r && r.items.length) pendingItems = { expense_id: out.id, label: title, items: asPending(r.items) };
        if (r) scannedReceipt = null;
        render();
      } catch (err) {
        fail(err);
      } finally {
        delete form.dataset.busy;
      }
    },
  },
    h("input", { name: "title", placeholder: "what", required: true, autocomplete: "off", "aria-label": "expense", value: r ? r.title : null }),
    h("input.w-sm", { name: "amount", type: "number", step: "any", min: "0", placeholder: "0.00", required: true, "aria-label": "amount", value: r && r.amount ? r.amount : null }),
    h("select.w-sm", { name: "category", "aria-label": "category" },
      CATEGORIES.map((c) => h("option", { value: c, selected: r && r.category === c }, c.toLowerCase()))),
    h("input", { name: "date", type: "hidden", value: day }),
    h("button.primary", { type: "submit" }, "add"),
  );
  if (!withScan) return form;

  const scan = photoButton("scan receipt", "reading receipt", "/expenses/scan-receipt", (out) => {
    scannedReceipt = {
      title: out.title || "",
      amount: out.amount || "",
      category: CATEGORIES.includes(out.category) ? out.category : "Other",
      date: /^\d{4}-\d{2}-\d{2}$/.test(out.date || "") ? out.date : null,
      items: out.items || [],
    };
    toast("receipt read — check it, then add");
    render();
    return "";
  });

  const notes = [];
  if (r) {
    if (r.date && r.date !== date) notes.push(`dated ${fmtDay(r.date)} — saved on that day`);
    if (r.items.length) notes.push(`${r.items.length} item${r.items.length > 1 ? "s" : ""} can go to the pantry after you add`);
  }
  return h("div", form, scan,
    r ? h("p.hint", "scanned receipt — check it, then add", notes.length ? ` · ${notes.join(" · ")}` : "", " · ",
      h("button.link", { type: "button", onclick: () => { scannedReceipt = null; render(); } }, "discard")) : null);
}
