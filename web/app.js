"use strict";

/* ================= helpers ================= */

const API = "/api";
// Identifies this tab so live-sync can skip echoes of our own changes.
const CLIENT_ID = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2);

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { "Content-Type": "application/json", "X-Client-Id": CLIENT_ID },
    ...opts,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  const text = await res.text().catch(() => "");
  try { data = text ? JSON.parse(text) : null; } catch { data = res.ok ? null : { error: text.slice(0, 200) }; }
  if (!res.ok) {
    // Someone else removed/changed it: refresh so the screen matches.
    if (res.status === 404 && opts.method && opts.method !== "GET") setTimeout(() => sync.refreshSoon(), 0);
    throw new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
  }
  return data;
}

/** h("div.cls", {attrs}, ...children) — builds DOM without innerHTML. */
function h(tag, attrs, ...kids) {
  const [name, ...classes] = tag.split(".");
  const el = document.createElement(name);
  if (classes.length) el.className = classes.join(" ");
  if (attrs && (typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs))) {
    kids.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = (el.className + " " + v).trim();
    // CSSOM, not a style attribute: the content security policy blocks inline style attributes.
    else if (k === "style") el.style.cssText = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

let toastTimer;
function toast(msg, isErr = false) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "show" + (isErr ? " err" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ""), 2600);
}
const fail = (e) => toast(e.message || String(e), true);

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => iso(new Date());
const parseISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
const fmtDay = (s) => parseISO(s).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }).toLowerCase();
// Household settings, loaded from the server before the first render.
let settings = { currency: "INR", locale: "en-IN" };
const CURRENCIES = [
  ["INR", "en-IN", "Indian rupee"], ["USD", "en-US", "US dollar"], ["EUR", "en-IE", "Euro"],
  ["GBP", "en-GB", "British pound"], ["AED", "en-AE", "UAE dirham"], ["SGD", "en-SG", "Singapore dollar"],
  ["AUD", "en-AU", "Australian dollar"], ["CAD", "en-CA", "Canadian dollar"], ["JPY", "ja-JP", "Japanese yen"],
];
const money = (n, digits) => {
  try {
    return (Number(n) || 0).toLocaleString(settings.locale, {
      style: "currency", currency: settings.currency,
      ...(digits != null ? { minimumFractionDigits: digits, maximumFractionDigits: digits } : {}),
    });
  } catch { return `${settings.currency} ${(Number(n) || 0).toFixed(2)}`; }
};
/** Whole-unit amount for tight spaces (calendar chips, stats). */
const moneyShort = (n) => money(Math.round(Number(n) || 0), 0);
/** Rounds to cents: 1.1 + 2.2 must equal 3.3 when comparing spend with a budget. */
const cents = (n) => Math.round((Number(n) || 0) * 100);
const fmtQty = (n) => (Number.isInteger(n) ? n : Number(n).toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));
const formData = (form) => Object.fromEntries(new FormData(form).entries());

const store = {
  get(k, d) { try { const v = localStorage.getItem("rosie." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("rosie." + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

function list(items, row, ...emptyMsg) {
  if (!items.length) return h("p.empty", ...emptyMsg);
  return h("ul.list", items.map((it) => h("li", row(it))));
}

function delBtn(path, label) {
  return h("button.icon.del", {
    title: `delete ${label}`,
    "aria-label": `delete ${label}`,
    onclick: async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${label}"?`)) return;
      try { await api(path, { method: "DELETE" }); toast(`deleted ${label}`); render(); } catch (err) { fail(err); }
    },
  }, "×");
}

/** Sends a create request, toasts, re-renders. */
async function create(path, body, label) {
  try { await api(path, { method: "POST", body }); toast(`added ${label}`); render(); } catch (err) { fail(err); }
}

/* ================= shared calendar ================= */

// Month on screen and selected day — shared by every calendar view.
const cal = (() => { const t = new Date(); return { y: t.getFullYear(), m: t.getMonth(), sel: today() }; })();
let focusSel = false;

const monthKey = () => `${cal.y}-${pad(cal.m + 1)}`;
const inMonth = (d) => !!d && d.startsWith(monthKey());
function shiftMonth(n) { const d = new Date(cal.y, cal.m + n, 1); cal.y = d.getFullYear(); cal.m = d.getMonth(); }
function selectDay(ds, focus = false) {
  cal.sel = ds;
  const d = parseISO(ds);
  cal.y = d.getFullYear(); cal.m = d.getMonth();
  focusSel = focus;
  render();
}

/** Attributes that make an element draggable onto a calendar day. */
const dragData = (kind, id, from) => ({
  draggable: "true",
  ondragstart: (e) => {
    e.stopPropagation();
    e.dataTransfer.setData("text/plain", JSON.stringify({ kind, id, from }));
    e.dataTransfer.effectAllowed = "move";
  },
});

/**
 * Month grid.
 *   chipsFor(date) -> [{ label, cls, kind?, id?, done?, title? }]
 *   onMove(kind, id, date) — when set, chips with an id can be dragged to another day.
 */
function calendar({ chipsFor, onMove, legend }) {
  const first = new Date(cal.y, cal.m, 1);
  const lead = (first.getDay() + 6) % 7; // Monday-first
  const days = new Date(cal.y, cal.m + 1, 0).getDate();
  const weeks = Math.ceil((lead + days) / 7);
  const start = new Date(cal.y, cal.m, 1 - lead);
  const max = 3;

  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const ds = iso(d);
    const chips = chipsFor(ds);
    const cell = h("div.cell", {
      role: "gridcell",
      tabindex: ds === cal.sel ? "0" : "-1",
      "aria-selected": ds === cal.sel ? "true" : "false",
      "aria-label": fmtDay(ds) + (chips.length ? `, ${chips.length} item${chips.length > 1 ? "s" : ""}` : ""),
      class: [d.getMonth() !== cal.m && "out", ds === today() && "today", ds === cal.sel && "sel"].filter(Boolean).join(" ") || null,
      onclick: () => selectDay(ds),
      onkeydown: (e) => {
        const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
        if (step) { e.preventDefault(); selectDay(addDays(ds, step), true); }
        else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectDay(ds, true); }
      },
      ondragover: onMove ? (e) => { e.preventDefault(); cell.classList.add("drop"); } : null,
      ondragleave: onMove ? () => cell.classList.remove("drop") : null,
      ondrop: onMove ? (e) => {
        e.preventDefault();
        cell.classList.remove("drop");
        try {
          const { kind, id, from } = JSON.parse(e.dataTransfer.getData("text/plain"));
          if (from !== ds) onMove(kind, id, ds);
        } catch { /* not ours */ }
      } : null,
    },
      h("span.dn", d.getDate()),
      h("div.chips",
        chips.slice(0, max).map((c) => h("span.chip", {
          class: [c.cls, c.done && "done"].filter(Boolean).join(" "),
          title: c.title || c.label,
          ...(onMove && c.id != null ? dragData(c.kind, c.id, ds) : {}),
        }, c.label)),
        chips.length > max ? h("span.more", `+${chips.length - max}`) : null,
      ),
    );
    cells.push(cell);
  }

  const title = first.toLocaleDateString(undefined, { month: "long", year: "numeric" }).toLowerCase();
  return h("section.cal",
    h("div.cal-head",
      h("h1", title),
      h("div.cal-nav",
        h("button.icon", { onclick: () => { shiftMonth(-1); render(); }, "aria-label": "previous month" }, "←"),
        h("button.icon", { onclick: () => selectDay(today()) }, "today"),
        h("button.icon", { onclick: () => { shiftMonth(1); render(); }, "aria-label": "next month" }, "→"),
      ),
    ),
    h("div.cal-grid.dow", { "aria-hidden": "true" }, ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => h("div", d))),
    h("div.cal-grid", { role: "grid", "aria-label": title }, cells),
    legend ? h("div.legend", legend.map(([label, cls]) => h("span", h("i", { class: cls }), label))) : null,
    onMove ? h("p.hint", "drag items between days to reschedule · arrow keys move the selection") : null,
  );
}

/** Two-column layout: calendar + extras on the left, selected-day panel on the right. */
function split(mainKids, panelKids) {
  return h("div.split",
    h("div.main-col", mainKids),
    h("aside.panel", { "aria-label": `selected day ${fmtDay(cal.sel)}` },
      h("div.panel-head",
        h("h3", fmtDay(cal.sel)),
        cal.sel === today() ? h("span.tag.c-pink", "today") : null,
      ),
      panelKids,
    ),
  );
}

const eyebrow = (s) => h("p.eyebrow", s);
const section = (title, ...kids) => [h("h2", title), ...kids];

function segmented(options, value, onChange, label) {
  return h("div.seg", { role: "group", "aria-label": label },
    options.map(([key, text]) => h("button", {
      type: "button", "aria-pressed": key === value ? "true" : "false",
      class: key === value ? "on" : null, onclick: () => onChange(key),
    }, text)));
}

/* ================= domain bits ================= */

const SLOTS = ["breakfast", "lunch", "dinner"];
const SLOT_COLOR = { breakfast: "c-yellow", lunch: "c-cyan", dinner: "c-purple" };
const STATUS = ["todo", "in_progress", "done"];
const STATUS_LABEL = { todo: "to do", in_progress: "doing", done: "done" };
const STATUS_COLOR = { todo: "c-orange", in_progress: "c-cyan", done: "c-green" };
const STATUS_GLYPH = { todo: "○", in_progress: "◐", done: "●" };
const CATEGORIES = ["Groceries", "Utilities", "Household", "Dining", "Entertainment", "Transportation", "Health", "Other"];
const CAT_COLOR = { Groceries: "c-green", Utilities: "c-cyan", Household: "c-purple", Dining: "c-orange", Entertainment: "c-pink", Transportation: "c-yellow", Health: "c-red", Other: "c-muted" };

const priorityTag = (p) => h("span.tag", { class: { high: "c-red", medium: "c-orange", low: "c-green" }[p] || "c-muted" }, p);
const bySlot = (a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot);

/** Drop handler shared by every calendar: reschedule a chore, meal or pantry expiry. */
async function moveItem(kind, id, date) {
  try {
    if (kind === "chore") await api(`/chores/${id}`, { method: "PATCH", body: { due_date: date } });
    else if (kind === "meal") await api(`/meals/${id}`, { method: "PATCH", body: { date } });
    else return;
    toast(`moved to ${fmtDay(date)}`);
    render();
  } catch (err) { fail(err); }
}

async function setChore(c, body) {
  try {
    await api(`/chores/${c.id}`, { method: "PATCH", body });
    if (c.amount && body.status === "done") toast(`paid ${c.title} — logged as an expense`);
    else if (c.amount && body.status && c.status === "done") toast(`${c.title} unpaid — expense removed`);
    render();
  } catch (err) { fail(err); }
}

const chipLabel = (c) => (c.amount ? `${c.title} ${moneyShort(c.amount)}` : c.title);

/* ---- recurring ---- */
const REPEAT_LABEL = { "": "once", weekly: "weekly", monthly: "monthly", yearly: "yearly" };

/** Same rule as the server: monthly/yearly keep the anchor day, clamped to month end. */
function nextDate(ds, repeat, anchor) {
  if (repeat === "weekly") return addDays(ds, 7);
  const d = parseISO(ds);
  const m = d.getMonth() + (repeat === "yearly" ? 12 : 1);
  const last = new Date(d.getFullYear(), m + 1, 0).getDate();
  return iso(new Date(d.getFullYear(), m, Math.min(anchor || d.getDate(), last)));
}

/**
 * Future occurrences of repeating chores that don't exist yet, for the visible grid.
 * Only the latest open occurrence of a series projects forward.
 */
function projected(chores) {
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

const ghostChip = (p) => ({
  label: chipLabel(p.chore), cls: `${p.chore.amount ? "c-yellow" : "c-orange"} ghost`,
  title: `${p.chore.title} — repeats ${p.chore.repeat}, created when the previous one is done`,
});

function repeatTag(c) {
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

const repeatSelect = (opts, dflt) => h("select.w-sm", { name: "repeat", "aria-label": "repeat" },
  opts.map((r) => h("option", { value: r, selected: r === dflt }, REPEAT_LABEL[r])));

function billForm(date) {
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

function choreRow(c) {
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

const mealRow = (m) => [h("span.tag", { class: SLOT_COLOR[m.slot] || "c-muted" }, m.slot), h("span.grow.title", m.title), delBtn(`/meals/${m.id}`, m.title)];

const expenseRow = (e, linked = 0) => [
  h("span.grow.title", e.title),
  linked ? h("a.tag.c-green", { href: "#/pantry", title: "items from this purchase in the pantry" }, `${linked} in pantry`) : null,
  h("span.tag", { class: CAT_COLOR[e.category] || "c-muted" }, e.category.toLowerCase()),
  h("span.num", money(e.amount)),
  delBtn(`/expenses/${e.id}`, e.title),
];

function choreForm(date) {
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

function mealForm(date, recipes = []) {
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
function readImage(file, maxSide = 1600) {
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
function photoButton(label, busyText, path, onResult) {
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
    } catch (err) { fail(err); }
    finally {
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

function pantryReview() {
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
    } catch (err) { fail(err); }
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
      h("button.primary", { onclick: confirmAdd }, `add to pantry`),
      p.expense_id ? h("span.meta", "linked to that expense") : null),
  );
}

const asPending = (items) => items.map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit, keep: true }));

/*
 * The last scanned receipt, waiting to be added. Kept outside the form so a
 * re-render (live sync, picking another day) doesn't throw the scan away.
 */
let scannedReceipt = null;

function expenseForm(date, withScan = false) {
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
      } catch (err) { fail(err); } finally { delete form.dataset.busy; }
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

/* ================= views ================= */

const views = {};

/* ---- home: everything on one month ---- */
let homeAdd = "chore";
views.home = async (root) => {
  const [pantry, chores, meals, expenses, recipes, budgets] = await Promise.all([
    api("/pantry"), api("/chores"), api("/meals"), api("/expenses"), api("/recipes"), api("/budgets"),
  ]);
  const budgetTotal = budgets.reduce((s, b) => s + b.amount, 0);
  const layers = store.get("layers", { meals: true, chores: true, expenses: true });
  const toggleLayer = (k) => { layers[k] = !layers[k]; store.set("layers", layers); render(); };

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
};

function stat(value, label, cls) {
  return h("div.stat", h("b", { class: cls }, value), h("span", label));
}

/* ---- chores: month or board ---- */
views.chores = async (root) => {
  const chores = await api("/chores");
  const mode = store.get("choresMode", "month");
  const setMode = (m) => { store.set("choresMode", m); render(); };
  const done = chores.filter((c) => c.status === "done");

  const pts = {};
  for (const c of done) pts[c.assigned_to] = (pts[c.assigned_to] || 0) + c.points;
  const points = Object.keys(pts).length
    ? section("points", list(Object.entries(pts).sort((a, b) => b[1] - a[1]), ([who, p]) => [h("span.grow", who), h("span.num.c-purple", p)]))
    : null;

  const head = h("div.view-head",
    eyebrow(`chores · ${done.length} of ${chores.length} done`),
    segmented([["month", "month"], ["board", "board"]], mode, setMode, "chores view"));

  if (mode === "board") {
    root.append(head, choreForm(null), board(chores), points);
    return;
  }

  const unscheduled = chores.filter((c) => !c.due_date);
  const ghosts = projected(chores);
  root.append(head, split(
    [
      calendar({
        chipsFor: (ds) => chores.filter((c) => c.due_date === ds).map((c) => ({
          label: chipLabel(c), cls: STATUS_COLOR[c.status], kind: "chore", id: c.id, done: c.status === "done",
          title: `${c.title} · ${c.assigned_to} · ${STATUS_LABEL[c.status]}`,
        })).concat(ghosts.filter((p) => p.date === ds).map(ghostChip)),
        onMove: moveItem,
        legend: [...STATUS.map((s) => [STATUS_LABEL[s], STATUS_COLOR[s]]), ["upcoming repeat", "c-muted ghost"]],
      }),
      points,
    ],
    [
      list(chores.filter((c) => c.due_date === cal.sel), choreRow, "no chores this day"),
      h("h2", "add chore"),
      choreForm(cal.sel),
      unscheduled.length ? section("unscheduled",
        h("p.hint", "drag onto a day, or → to put it on the selected day"),
        h("ul.list", unscheduled.map((c) => h("li", dragData("chore", c.id, ""),
          choreRow(c).slice(0, 2),
          h("button.icon", { title: `schedule on ${fmtDay(cal.sel)}`, "aria-label": `schedule ${c.title} on ${fmtDay(cal.sel)}`, onclick: () => setChore(c, { due_date: cal.sel }) }, "→"),
        )))) : null,
    ],
  ));
};

function board(chores) {
  return h("div.board", STATUS.map((key, i) => {
    const items = chores.filter((c) => c.status === key);
    return h("div.col",
      h("h3", h("span", { class: STATUS_COLOR[key] }, STATUS_LABEL[key]), h("span.c-muted", items.length)),
      items.length ? items.map((c) => h("div.card",
        h("div.title", c.title),
        h("div.meta", `${c.assigned_to} · ${c.points} pt${c.points === 1 ? "" : "s"}${c.due_date ? " · " + fmtDay(c.due_date) : ""} `, priorityTag(c.priority)),
        h("div.actions",
          h("button.icon", { onclick: () => setChore(c, { status: STATUS[i - 1] }), disabled: i === 0, "aria-label": "move back" }, "←"),
          delBtn(`/chores/${c.id}`, c.title),
          h("button.icon", { onclick: () => setChore(c, { status: STATUS[i + 1] }), disabled: i === STATUS.length - 1, "aria-label": "move forward" }, "→"),
        ),
      )) : h("p.empty", "—"),
    );
  }));
}

/* ---- meals ---- */
views.meals = async (root) => {
  const [meals, recipes] = await Promise.all([api("/meals"), api("/recipes")]);
  const day = meals.filter((m) => m.date === cal.sel).sort(bySlot);
  root.append(eyebrow(`meals · ${meals.filter((m) => inMonth(m.date)).length} planned this month`), split(
    [calendar({
      chipsFor: (ds) => meals.filter((m) => m.date === ds).sort(bySlot)
        .map((m) => ({ label: m.title, cls: SLOT_COLOR[m.slot], kind: "meal", id: m.id, title: `${m.slot}: ${m.title}` })),
      onMove: moveItem,
      legend: SLOTS.map((s) => [s, SLOT_COLOR[s]]),
    })],
    [
      SLOTS.map((s) => {
        const items = day.filter((m) => m.slot === s);
        return h("div.slot",
          h("span.tag", { class: SLOT_COLOR[s] }, s),
          items.length ? h("ul.list", items.map((m) => h("li", h("span.grow.title", m.title), delBtn(`/meals/${m.id}`, m.title)))) : h("p.empty", "—"));
      }),
      h("h2", "add meal"),
      mealForm(cal.sel, recipes),
    ],
  ));
};

/* ---- expenses: calendar, budget, bills ---- */
let expenseAdd = "expense";
const budgetColor = (spent, budget) => (!budget ? "var(--muted)" : cents(spent) > cents(budget) ? "var(--red)" : cents(spent) >= cents(budget) * 0.8 ? "var(--orange)" : "var(--green)");

views.expenses = async (root) => {
  const [expenses, budgets, chores, pantry] = await Promise.all([api("/expenses"), api("/budgets"), api("/chores"), api("/pantry")]);
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
  const isCurrent = monthKey() === t.slice(0, 7);
  const daysInMonth = new Date(cal.y, cal.m + 1, 0).getDate();
  const daysLeft = isCurrent ? daysInMonth - parseISO(t).getDate() + 1 : 0;

  const saveBudget = async (category, amount) => {
    try { await api(`/budgets/${encodeURIComponent(category)}`, { method: "PUT", body: { amount: Number(amount) || 0 } }); toast(`budget for ${category.toLowerCase()} saved`); render(); } catch (err) { fail(err); }
  };

  const budgetRow = (cat) => {
    const spent = spentBy[cat] || 0;
    const budget = budgetOf[cat] || 0;
    const pct = budget ? Math.min(100, (spent / budget) * 100) : 0;
    return h("li", h("div.grow",
      h("div.spread",
        h("span", { class: CAT_COLOR[cat] }, cat.toLowerCase()),
        h("span.budget-nums",
          h("span.num", moneyShort(spent)),
          h("span.meta", " / "),
          h("input.budget", {
            type: "number", min: "0", step: "any", value: budget || "", placeholder: "set",
            "aria-label": `monthly budget for ${cat}`, title: "monthly budget — press enter to save",
            onchange: (e) => saveBudget(cat, e.target.value),
          }),
        ),
      ),
      h("div.bar", h("i", { style: `width:${budget ? pct : 0}%;background:${budgetColor(spent, budget)}` })),
      budget && cents(spent) > cents(budget) ? h("span.meta.c-red", `over by ${moneyShort(spent - budget)}`) : null,
    ));
  };

  const remaining = (cents(budgetTotal) - cents(total)) / 100;
  root.append(eyebrow("expenses"), split(
    [
      calendar({
        chipsFor: (ds) => {
          const out = [];
          const tt = dayTotal(ds);
          if (tt) out.push({ label: moneyShort(tt), cls: "c-pink", title: `spent ${money(tt)}` });
          unpaid.filter((c) => c.due_date === ds).forEach((c) => out.push({ label: chipLabel(c), cls: ds < t ? "c-red" : "c-yellow", kind: "chore", id: c.id, title: `bill due: ${c.title} ${money(c.amount)}` }));
          billGhosts.filter((p) => p.date === ds).forEach((p) => out.push(ghostChip(p)));
          return out;
        },
        onMove: moveItem,
        legend: [["spent", "c-pink"], ["bill due", "c-yellow"], ["bill overdue", "c-red"], ["upcoming repeat", "c-muted ghost"]],
      }),

      h("h2", "budget"),
      h("div.budget-head",
        h("div", h("b.num", { style: `color:${budgetColor(total, budgetTotal)}` }, moneyShort(total)),
          h("span.meta", budgetTotal ? ` of ${moneyShort(budgetTotal)}` : " spent")),
        budgetTotal ? h("span.meta", remaining >= 0
          ? `${moneyShort(remaining)} left${isCurrent ? ` · ${daysLeft} day${daysLeft === 1 ? "" : "s"} to go · ~${moneyShort(remaining / daysLeft)}/day` : ""}`
          : `over by ${moneyShort(-remaining)}`) : h("span.meta", "set a monthly amount per category below"),
      ),
      budgetTotal ? h("div.bar.big", h("i", { style: `width:${Math.min(100, (total / budgetTotal) * 100)}%;background:${budgetColor(total, budgetTotal)}` })) : null,
      stillDue ? h("p.hint", h("span.c-yellow", moneyShort(stillDue)), " in bills still due this month",
        budgetTotal ? ` · ${moneyShort(budgetTotal - total - stillDue)} free after bills` : "") : null,
      h("ul.list", CATEGORIES.filter((c) => budgetOf[c] || spentBy[c]).concat(CATEGORIES.filter((c) => !budgetOf[c] && !spentBy[c]))
        .slice(0, CATEGORIES.length).map(budgetRow)),

      h("h2", "bills to pay"),
      list(unpaid, (c) => [
        h("span.meta.num", { class: c.due_date && c.due_date < t ? "c-red" : null }, c.due_date ? (c.due_date < t ? `overdue ${fmtDay(c.due_date)}` : fmtDay(c.due_date)) : "no date"),
        h("span.grow.title", c.title),
        repeatTag(c),
        h("span.num", money(c.amount)),
        h("button", { onclick: () => setChore(c, { status: "done" }), title: "mark paid and log as an expense" }, "pay"),
        delBtn(`/chores/${c.id}`, c.title),
      ], "no bills due"),
    ],
    [
      pantryReview(),
      day.length ? [list(day, (e) => expenseRow(e, linkedCount(e))), h("p.total.right", h("span.num", money(dayTotal(cal.sel))))] : h("p.empty", "nothing spent"),
      dayBills.length ? section("bills due", list(dayBills, (c) => [
        h("span.grow.title", c.title), h("span.num", money(c.amount)),
        h("button", { onclick: () => setChore(c, { status: "done" }) }, "pay"),
      ])) : null,
      h("h2", "add"),
      segmented([["expense", "expense"], ["bill", "bill to pay"]], expenseAdd, (k) => { expenseAdd = k; render(); }, "add type"),
      expenseAdd === "bill"
        ? [billForm(cal.sel), h("p.hint", "bills show up in chores on their due date; paying one logs it as an expense")]
        : expenseForm(cal.sel, true),
    ],
  ));
};

/* ---- theme (per device) ---- */
const currentTheme = () => document.documentElement.dataset.theme || "system";
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("rosie.theme", t); } catch { /* storage unavailable */ }
  syncThemeColor();
}
const prefersLight = window.matchMedia("(prefers-color-scheme: light)");
/** The theme actually showing, with "system" resolved. */
const effectiveTheme = () => (currentTheme() === "system" ? (prefersLight.matches ? "light" : "dark") : currentTheme());

function syncThemeColor() {
  const light = effectiveTheme() === "light";
  document.documentElement.classList.toggle("is-light", light);
  const btn = document.getElementById("theme-toggle");
  if (btn) {
    const label = `switch to ${light ? "dark" : "light"} mode`;
    btn.setAttribute("aria-label", label);
    btn.title = label;
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
}
prefersLight.addEventListener("change", syncThemeColor);
document.getElementById("theme-toggle").addEventListener("click", () => {
  setTheme(effectiveTheme() === "light" ? "dark" : "light");
  if ((location.hash || "").includes("settings")) render(); // keep the settings switch in step
});

/* ---- settings ---- */
views.settings = async (root) => {
  const current = CURRENCIES.find((c) => c[0] === settings.currency) || CURRENCIES[0];
  root.append(h("div.narrow",
    h("h1", "settings"),
    h("p.sub", "shared by everyone in the household"),
    h("h2", "currency"),
    h("form.row", {
      onsubmit: async (e) => {
        e.preventDefault();
        const code = formData(e.target).currency;
        const [, locale] = CURRENCIES.find((c) => c[0] === code);
        try {
          await api("/settings", { method: "PUT", body: { currency: code, locale } });
          settings = { ...settings, currency: code, locale };
          toast(`currency set to ${code}`);
          render();
        } catch (err) { fail(err); }
      },
    },
      h("select", { name: "currency", "aria-label": "currency" },
        CURRENCIES.map(([code, , name]) => h("option", { value: code, selected: code === current[0] }, `${code} — ${name}`))),
      h("button.primary", { type: "submit" }, "save"),
    ),
    h("p.meta", `preview: ${money(123456.5)}`),
    h("p.hint", "only changes how amounts are shown; stored amounts are not converted"),
    h("h2", "appearance"),
    segmented([["dark", "dark"], ["light", "light"], ["system", "match system"]], currentTheme(), (t) => { setTheme(t); render(); }, "theme"),
    h("p.hint", "saved on this device only, so each person can pick their own"),
  ));
};

/* ---- pantry: inventory list, photo scan, links to purchases ---- */
views.pantry = async (root) => {
  const [items, expenses] = await Promise.all([api("/pantry"), api("/expenses")]);
  const byId = Object.fromEntries(expenses.map((e) => [e.id, e]));
  const t = today();

  const save = async (item, patch) => {
    try { await api(`/pantry/${item.id}`, { method: "PUT", body: { ...item, ...patch } }); render(); } catch (err) { fail(err); }
  };
  const adjust = async (item, delta) => {
    try { await api(`/pantry/${item.id}/adjust`, { method: "POST", body: { delta } }); render(); } catch (err) { fail(err); }
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
      onclick: () => { cal.sel = e.date; const d = parseISO(e.date); cal.y = d.getFullYear(); cal.m = d.getMonth(); },
    }, `bought ${fmtDay(e.date)}`);
  };

  // Recent expenses a manual add can be linked to.
  const recent = expenses.filter((e) => e.date >= addDays(t, -30)).slice(0, 25);
  const form = h("form.row", {
    onsubmit: async (e) => {
      e.preventDefault();
      const d = formData(e.target);
      try {
        const out = await api("/pantry/batch", { method: "POST", body: {
          expense_id: d.expense_id ? Number(d.expense_id) : null,
          items: [{ name: d.name.trim(), quantity: Number(d.quantity), unit: d.unit.trim() || "pcs", expires_on: d.expires_on || null }],
        } });
        toast(out.topped_up ? `topped up ${d.name}` : `added ${d.name}`);
        render();
      } catch (err) { fail(err); }
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
    pendingItems = { expense_id: null, items: asPending(out.items) };
    render();
    return "";
  });

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
};

/* ---- recipes (no calendar) ---- */

/*
 * A recipe being reviewed before it is saved: an import result, a new blank
 * recipe, or an existing one being edited (then it has an id). Kept outside
 * the view so live-sync re-renders don't lose it.
 */
let recipeDraft = null;
let recipeImporting = false;
const openRecipes = new Set(); // ids of expanded recipe cards // an import is in flight (survives re-renders)

const lines = (s) => String(s || "").split("\n").map((l) => l.trim()).filter(Boolean);
const fmtTime = (m) => (!m ? "" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`);
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const asDraft = (r, extra = {}) => ({
  id: r.id || null,
  name: r.name || "",
  servings: r.servings || "",
  time_minutes: r.time_minutes || "",
  source_url: r.source_url || "",
  image_url: r.image_url || "",
  ingredients: (r.ingredients || []).map((i) => (typeof i === "string" ? i : i.text)).join("\n"),
  instructions: Array.isArray(r.instructions) ? r.instructions.join("\n") : (r.instructions || ""),
  ...extra,
});

function recipeImport() {
  const status = h("span.meta");
  const box = h("textarea.import", {
    name: "source", rows: 2, autocomplete: "off",
    placeholder: "paste a recipe link — or the recipe text itself",
    "aria-label": "recipe link or text",
  });
  const go = h("button.primary", { type: "submit" }, "import");
  if (recipeImporting) { go.disabled = true; status.className = "spinner"; status.textContent = "still reading the last import"; }
  const run = async (body, busyText) => {
    if (recipeImporting) return;
    recipeImporting = true;
    go.disabled = true;
    status.className = "spinner";
    status.textContent = busyText;
    try {
      const out = await api("/recipes/import", { method: "POST", body });
      recipeDraft = asDraft(out, { method: out.method });
      render();
    } catch (err) {
      fail(err);
      status.className = "meta";
      status.textContent = "";
    } finally { recipeImporting = false; go.disabled = false; }
  };
  const form = h("form.stack", {
    onsubmit: (e) => {
      e.preventDefault();
      const v = box.value.trim();
      if (!v) return toast("paste a link or some recipe text", true);
      const link = /^https?:\/\/\S+$/i.test(v) ? v : /^(www\.)?[\w-]+(\.[\w-]+)+\/\S*$/i.test(v) ? `https://${v}` : null;
      if (link) run({ url: link }, "reading the page");
      else run({ text: v }, "reading it with local AI — this can take a minute");
    },
  }, box);
  const photo = photoButton("from a photo", "reading the photo with local AI — this can take a minute", "/recipes/import", (out) => {
    recipeDraft = asDraft(out, { method: out.method });
    render();
    return "";
  });
  form.append(h("div.scan", go, photo, status,
    h("button", { type: "button", onclick: () => { recipeDraft = asDraft({}); render(); } }, "write one")));
  return form;
}

function recipeEditor() {
  const d = recipeDraft;
  if (!d) return null;
  const bind = (key) => ({ value: d[key], oninput: (e) => { d[key] = e.target.value; } });
  const save = async (e) => {
    e.preventDefault();
    if (!d.name.trim()) return toast("give the recipe a name", true);
    const body = {
      name: d.name.trim(),
      servings: String(d.servings).trim() || null,
      time_minutes: Number(d.time_minutes) || null,
      source_url: d.source_url || null,
      image_url: d.image_url || null,
      ingredients: lines(d.ingredients),
      instructions: lines(d.instructions).join("\n"),
    };
    try {
      if (d.id) await api(`/recipes/${d.id}`, { method: "PUT", body });
      else await api("/recipes", { method: "POST", body });
      recipeDraft = null;
      toast(d.id ? `updated ${body.name}` : `saved ${body.name}`);
      render();
    } catch (err) { fail(err); }
  };
  const note = d.id ? "editing"
    : d.method === "structured" ? `read from ${hostOf(d.source_url) || "the site"}'s recipe data`
    : d.method === "ai" ? "read by local AI — check the amounts before saving"
    : "new recipe";
  const n = lines(d.ingredients).length;
  return h("form.review.recipe-edit", { onsubmit: save, "aria-label": "review recipe" },
    h("div.spread",
      h("h3", note),
      h("button.icon", { type: "button", onclick: () => { recipeDraft = null; render(); }, "aria-label": "discard" }, "×")),
    h("div.edit-head",
      d.image_url ? h("img.thumb", { src: d.image_url, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : null,
      h("div.stack.grow",
        h("input", { name: "name", placeholder: "recipe name", required: true, autocomplete: "off", "aria-label": "recipe name", ...bind("name") }),
        h("div.row",
          h("label.field", h("span.meta", "serves"), h("input", { name: "servings", autocomplete: "off", ...bind("servings") })),
          h("label.field", h("span.meta", "minutes"), h("input", { name: "time_minutes", type: "number", min: "0", ...bind("time_minutes") }))),
        d.source_url ? h("a.meta", { href: d.source_url, target: "_blank", rel: "noopener noreferrer" }, hostOf(d.source_url) + " ↗") : null)),
    h("label.meta", { for: "rd-ing" }, "ingredients — one per line"),
    h("textarea", { id: "rd-ing", name: "ingredients", rows: Math.min(16, Math.max(4, n + 1)), oninput: bind("ingredients").oninput }, d.ingredients),
    h("label.meta", { for: "rd-steps" }, "steps — one per line"),
    h("textarea", { id: "rd-steps", name: "instructions", rows: Math.min(16, Math.max(4, lines(d.instructions).length + 1)), oninput: bind("instructions").oninput }, d.instructions),
    h("div.scan", h("button.primary", { type: "submit" }, d.id ? "save changes" : "save recipe")),
  );
}

/** Steps as numbered lists; a line ending in ":" ("For the gravy:") starts a new group. */
function stepGroups(steps) {
  const out = [];
  let ol = null;
  for (const s of steps) {
    if (s.endsWith(":") && s.length < 60 && (/^for\b/i.test(s) || s.split(/\s+/).length <= 3)) { out.push(h("p.step-section", s.slice(0, -1))); ol = null; continue; }
    if (!ol) { ol = h("ol.steps"); out.push(ol); }
    ol.append(h("li", s));
  }
  return out;
}

function recipeCard(r) {
  const steps = lines(r.instructions);
  const facts = [fmtTime(r.time_minutes), r.servings && (/^\d+$/.test(r.servings) ? `serves ${r.servings}` : r.servings)].filter(Boolean);
  return [
    h("details.grow.recipe", { open: openRecipes.has(r.id), ontoggle: (e) => { if (e.target.open) openRecipes.add(r.id); else openRecipes.delete(r.id); } },
      h("summary", h("span.title", r.name), facts.length ? h("span.meta", " · " + facts.join(" · ")) : null),
      h("div.recipe-body",
        r.image_url ? h("img.photo", { src: r.image_url, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : null,
        r.ingredients.length ? [h("h4", `ingredients (${r.ingredients.length})`), h("ul.ingredients", r.ingredients.map((i) => h("li", i.text)))] : null,
        steps.length ? [h("h4", "steps"), stepGroups(steps)] : null,
        h("div.scan",
          h("button", { type: "button", onclick: async () => { recipeDraft = asDraft(r); await render(); window.scrollTo(0, 0); } }, "edit"),
          r.source_url ? h("a.meta", { href: r.source_url, target: "_blank", rel: "noopener noreferrer" }, hostOf(r.source_url) + " ↗") : null))),
    delBtn(`/recipes/${r.id}`, r.name),
  ];
}

views.recipes = async (root) => {
  const recipes = await api("/recipes");
  root.append(h("div.narrow",
    h("h1", "recipes"),
    h("p.sub", `${recipes.length} saved`),
    recipeDraft ? recipeEditor() : recipeImport(),
    h("h2", "recipe box"),
    list(recipes, recipeCard, "no recipes yet — paste a link from any recipe site to start"),
  ));
};

/* ================= router ================= */

let renderGen = 0;

async function render() {
  // Only the newest render may update the screen: a slow earlier one (quick
  // navigation, a live-sync refresh) must not overwrite it when it finishes.
  const gen = ++renderGen;
  sync.markFresh();
  const route = (location.hash.replace(/^#\/?/, "").split("/")[0]) || "home";
  const view = Object.hasOwn(views, route) ? views[route] : views.home;
  for (const a of document.querySelectorAll("#nav a, a.gear")) {
    const r = a.getAttribute("href").replace(/^#\/?/, "") || "home";
    a.classList.toggle("active", r === route);
    if (r === route) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  const root = document.getElementById("view");
  const next = document.createElement("div");
  // Views pass optional sections (null) and grouped sections (arrays); flatten and drop empties.
  next.append = (...kids) => Element.prototype.append.apply(next, kids.flat(Infinity).filter((k) => k != null && k !== false));
  const y = window.scrollY;
  try {
    // Settings can change on another device (currency): load them with the view.
    const s = await api("/settings").catch(() => null);
    if (s) settings = { ...settings, ...s };
    await view(next);
  } catch (err) {
    next.replaceChildren(h("h1", "offline"), h("p.sub.c-red", err.message), h("button", { onclick: render }, "retry"));
  }
  if (gen !== renderGen) return;
  root.replaceChildren(next);
  window.scrollTo(0, y);
  if (focusSel) { focusSel = false; const c = root.querySelector(".cell.sel"); if (c) c.focus(); }
  document.title = route === "home" ? "Rosie" : `${route} · Rosie`;
}

/* ================= live sync ================= */

/*
 * The server announces every change on /api/events. When someone else changes
 * something we re-render — unless this person is mid-typing, in which case the
 * dot turns orange and the refresh waits until they leave the field (or click the dot).
 */
const sync = (() => {
  const dot = document.getElementById("sync");
  let stale = false;
  let timer;
  let wasDown = false;

  const setDot = (state, title) => { dot.className = `sync ${state}`; dot.title = title; dot.setAttribute("aria-label", title); };
  const busy = () => {
    const a = document.activeElement;
    if (a && a.closest && a.closest("#view") && a.matches("input, textarea, select")) return true;
    return [...document.querySelectorAll("#view form input, #view form textarea")]
      .some((i) => i.type !== "hidden" && i.type !== "checkbox" && i.value !== i.defaultValue);
  };
  const tryRefresh = (force = false) => {
    if (!stale) return;
    if (!force && busy()) { setDot("live pending", "someone else made changes — click to load them"); return; }
    stale = false;
    setDot("live", "live — changes from other devices appear automatically");
    render();
  };
  const refreshSoon = () => { stale = true; clearTimeout(timer); timer = setTimeout(tryRefresh, 200); };
  /** Called by render(): whatever was pending is now on screen. */
  const markFresh = () => {
    if (!stale) return;
    stale = false;
    if (dot.classList.contains("pending")) setDot("live", "live — changes from other devices appear automatically");
  };

  dot.addEventListener("click", () => tryRefresh(true));
  document.addEventListener("focusout", () => setTimeout(tryRefresh, 50));

  let retry = 1000;
  function connect() {
    if (!window.EventSource) return;
    const es = new EventSource(API + "/events");
    es.onopen = () => {
      retry = 1000;
      setDot("live", "live — changes from other devices appear automatically");
      if (wasDown) { wasDown = false; refreshSoon(); } // catch up on anything missed
    };
    es.onerror = () => {
      wasDown = true;
      setDot("", "offline — reconnecting…");
      // EventSource retries network drops itself, but gives up for good after
      // an error response (a proxy 502, say): then reconnect ourselves.
      if (es.readyState === EventSource.CLOSED) {
        setTimeout(connect, retry);
        retry = Math.min(retry * 2, 30000);
      }
    };
    es.onmessage = (e) => {
      let by = "";
      try { by = JSON.parse(e.data).by; } catch { /* keep-alive */ }
      if (by !== CLIENT_ID) refreshSoon();
    };
  }
  return { connect, refreshSoon, markFresh };
})();

window.addEventListener("hashchange", () => { window.scrollTo(0, 0); render(); });
sync.connect();
syncThemeColor();
render();
