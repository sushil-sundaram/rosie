import { api, conflictCurrent } from "../api.js";
import { addDays, fmtDay, iso, nextDate, today } from "../dates.js";
import { create, delBtn, fail, formData, h, store, toast, showConflict, rowMenu } from "../dom.js";
import { isJobPending, submitAiJob } from "../jobs.js";
import { CATEGORIES, CAT_COLOR, CHORE_CATEGORIES, CHORE_CAT_COLOR, money, moneyShort } from "../money.js";
import { render, requestRecipeOpen } from "../router.js";
import { showModal } from "../shortcuts.js";
import { cal, moveItem } from "./calendar.js";

export const SLOTS = ["breakfast", "lunch", "dinner"];
export const SLOT_COLOR = { breakfast: "c-yellow", lunch: "c-cyan", dinner: "c-purple" };
/** Calendar tone per meal slot (see the palette in app.css). */
export const SLOT_TONE = { breakfast: "t-breakfast", lunch: "t-lunch", dinner: "t-dinner" };
export const STATUS_TONE = { todo: "t-chore", in_progress: "t-doing", done: "t-done" };
export const SLOT_LABEL = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };
export const STATUS = ["todo", "in_progress", "done"];
export const STATUS_LABEL = { todo: "To do", in_progress: "Doing", done: "Done" };
export const STATUS_COLOR = { todo: "c-orange", in_progress: "c-cyan", done: "c-green" };
export const STATUS_GLYPH = { todo: "○", in_progress: "◐", done: "●" };

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** Only high priority is worth a label; medium and low are the normal case. */
export const priorityTag = (p) => (p === "high" ? h("span.tag.c-red", "High") : null);
export const bySlot = (a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot);

let knownMembers = store.get("members", []);

export function syncMembers(chores = []) {
  const set = new Set(store.get("members", []));
  for (const c of chores) {
    const m = (c.assigned_to || "").trim();
    if (m && m.toLowerCase() !== "anyone") set.add(m);
  }
  const next = [...set].sort((a, b) => a.localeCompare(b));
  knownMembers = next;
  store.set("members", next);
}

export function rememberMember(name) {
  const m = String(name || "").trim();
  if (!m || m.toLowerCase() === "anyone") return;
  if (!knownMembers.includes(m)) {
    knownMembers = [...knownMembers, m].sort((a, b) => a.localeCompare(b));
    store.set("members", knownMembers);
  }
}

export function whoField(currentVal = "Anyone", ariaLabel = "Assigned to", extraClass = "") {
  const val = (currentVal || "").trim() || "Anyone";
  const options = ["Anyone", ...knownMembers.filter((m) => m.toLowerCase() !== "anyone")];
  if (val.toLowerCase() !== "anyone" && !options.includes(val)) options.push(val);
  const wrap = h("span.who-wrap", { class: extraClass || null });

  const showSelect = (selectedVal = val) => {
    const sel = h(
      "select",
      {
        name: "assigned_to",
        "aria-label": ariaLabel,
        onchange: () => {
          if (sel.value === "__new__") showCustomInput();
        },
      },
      options.map((m) => h("option", { value: m, selected: m === selectedVal }, m)),
      h("option", { value: "__new__" }, "+ Add person…"),
    );
    wrap.replaceChildren(sel);
  };

  const showCustomInput = () => {
    const inp = h("input", {
      name: "assigned_to",
      placeholder: "Person name",
      required: true,
      autocomplete: "off",
      "aria-label": ariaLabel,
    });
    const back = h("button.icon", {
      type: "button",
      title: "Choose from list",
      "aria-label": "Choose from existing household members",
      onclick: () => showSelect("Anyone"),
    }, "×");
    wrap.replaceChildren(inp, back);
    inp.focus();
  };

  showSelect(val);
  return wrap;
}

export const choreCategorySelect = (dflt = "", extraClass = "w-sm") =>
  h(
    "select",
    { name: "category", class: extraClass || null, "aria-label": "Category" },
    h("option", { value: "", selected: !dflt }, "Category…"),
    CHORE_CATEGORIES.map((c) => h("option", { value: c, selected: c === dflt }, c)),
  );

export const choreCategoryTag = (cat) =>
  cat ? h("span.tag", { class: CHORE_CAT_COLOR[cat] || "c-muted" }, cat) : null;

export async function setChore(c, body, isUndo = false) {
  try {
    await api(`/chores/${c.id}`, { method: "PATCH", body });
    if (c.amount && body.status === "done") {
      if (isUndo) {
        toast(`Paid ${c.title} — logged as an expense`);
      } else {
        const prevStatus = c.status && c.status !== "done" ? c.status : "todo";
        toast(`Paid ${c.title} — logged as an expense`, false, {
          label: "Undo",
          onclick: () => setChore({ ...c, status: "done" }, { status: prevStatus }, true),
        });
      }
    } else if (c.amount && body.status && c.status === "done") {
      toast(`${c.title} unpaid — expense removed`);
    }
    render();
  } catch (err) {
    fail(err);
  }
}

export const chipLabel = (c) => (c.amount ? `${c.title} ${moneyShort(c.amount)}` : c.title);

/* ---- recurring ---- */
export const REPEAT_LABEL = { "": "Once", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };

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
  cls: `${p.chore.amount ? "t-bill" : "t-chore"} ghost`,
  title: `${p.chore.title} — Repeats ${p.chore.repeat}, created when the previous one is done`,
});

/** Change or stop a chore's repeat schedule. */
export function openRepeatModal(c) {
  const body = h(
    "div.stack",
    h("p.meta", c.repeat ? `${c.title} currently repeats ${(REPEAT_LABEL[c.repeat] || c.repeat).toLowerCase()}.` : `${c.title} happens once. Make it repeat:`),
    h(
      "div.move-quick",
      ["weekly", "monthly", "yearly"].map((r) =>
        h("button", {
          type: "button",
          class: c.repeat === r ? "primary" : null,
          onclick: async () => {
            close();
            if (c.repeat !== r) await setChore(c, { repeat: r });
          },
        }, REPEAT_LABEL[r]),
      ),
      c.repeat
        ? h("button.c-red", {
            type: "button",
            onclick: async () => {
              close();
              await setChore(c, { repeat: "" });
            },
          }, "Stop repeating")
        : null,
    ),
  );
  const { close } = showModal({ title: "Repeat schedule", body, backdropClass: "sheet-mobile" });
}

export function repeatTag(c) {
  if (!c.repeat) return null;
  return h("button.tag.linkish", {
    type: "button",
    "aria-label": `${c.title} repeats ${c.repeat}; change or stop repeat`,
    onclick: (e) => {
      e.stopPropagation();
      openRepeatModal(c);
    },
  }, `↻ ${cap(c.repeat)}`);
}

export function openMoveModal({ kind, id, label, currentDate }) {
  const t = today();
  const base = currentDate || t;
  const dateInput = h("input", { type: "date", value: base, "aria-label": "Choose date" });
  const pick = async (date) => {
    close();
    await moveItem(kind, id, date);
  };
  const body = h(
    "div.stack",
    h("p.meta", label + (currentDate ? ` · Currently ${fmtDay(currentDate)}` : " · Unscheduled")),
    h(
      "div.move-quick",
      h("button", { type: "button", onclick: () => pick(t) }, "Today"),
      h("button", { type: "button", onclick: () => pick(addDays(t, 1)) }, "Tomorrow"),
      h("button", { type: "button", onclick: () => pick(addDays(base, 7)) }, "+1 week"),
      kind === "chore" && currentDate ? h("button.c-muted", { type: "button", onclick: () => pick("") }, "Unschedule") : null,
    ),
    h(
      "form.row",
      {
        onsubmit: (e) => {
          e.preventDefault();
          if (dateInput.value) pick(dateInput.value);
        },
      },
      dateInput,
      h("button.primary", { type: "submit" }, "Move"),
    ),
  );
  const { close } = showModal({ title: "Move / Reschedule", body, backdropClass: "sheet-mobile" });
}

export function moveBtn(kind, id, label, currentDate) {
  return h("button.tag.linkish.c-cyan.move-btn", {
    type: "button",
    "aria-label": `Move ${label}`,
    onclick: (e) => {
      e.stopPropagation();
      openMoveModal({ kind, id, label, currentDate });
    },
  }, "Move");
}

export function editBtn(label, onClick) {
  return h("button.tag.linkish.c-purple", {
    type: "button",
    "aria-label": `Edit ${label}`,
    onclick: (e) => {
      e.stopPropagation();
      onClick();
    },
  }, "Edit");
}

export function openChoreEditModal(c) {
  const isBill = c.amount != null && c.amount > 0;
  const form = h(
    "form.stack",
    {
      onsubmit: async (ev) => {
        ev.preventDefault();
        const d = formData(ev.target);
        const title = d.title.trim();
        if (!title) return toast("Title is required", true);
        const assigned_to = (d.assigned_to || "").trim() || "Anyone";
        rememberMember(assigned_to);
        const body = {
          title,
          assigned_to,
          due_date: d.due_date || "",
          repeat: d.repeat || "",
        };
        if (isBill) {
          body.amount = Number(d.amount);
          body.category = d.category;
        } else {
          body.priority = d.priority;
          body.category = d.category || "";
          body.description = d.description.trim();
        }
        try {
          await api(`/chores/${c.id}`, { method: "PATCH", body });
          close();
          toast(`Saved ${title}`);
          render();
        } catch (err) {
          fail(err);
        }
      },
    },
    h("input", { name: "title", value: c.title, placeholder: isBill ? "Bill" : "Chore", required: true, "aria-label": "Title" }),
    isBill
      ? h(
          "div.row-fields",
          h("input", { name: "amount", type: "number", step: "0.01", min: "0.01", value: c.amount, required: true, "aria-label": "Amount" }),
          h("select", { name: "category", "aria-label": "Category" },
            CATEGORIES.map((cat) => h("option", { value: cat, selected: (c.category || "Utilities") === cat }, cat))),
        )
      : [
          h(
            "div.row-fields",
            choreCategorySelect(c.category || "", ""),
            h("select", { name: "priority", "aria-label": "Priority" },
              ["low", "medium", "high"].map((p) => h("option", { value: p, selected: c.priority === p }, cap(p)))),
          ),
          h("textarea", { name: "description", placeholder: "Notes (optional)", "aria-label": "Notes", value: c.description || "" }),
        ],
    h(
      "div.row-fields",
      whoField(c.assigned_to, isBill ? "Who pays" : "Assigned to", ""),
      h("input", { name: "due_date", type: "date", value: c.due_date || "", "aria-label": "Due date" }),
      repeatSelect(isBill ? ["", "monthly", "yearly"] : ["", "weekly", "monthly", "yearly"], c.repeat || ""),
    ),
    h("button.primary", { type: "submit" }, "Save changes"),
  );
  const { close } = showModal({
    title: isBill ? "Edit bill" : "Edit chore",
    body: form,
    backdropClass: "sheet-mobile",
  });
}

export function openExpenseEditModal(e) {
  let version = e.version ?? null; // a save only applies to the expense as loaded
  const save = async () => {
    const d = formData(form);
    const title = d.title.trim();
    if (!title) return toast("Title is required", true);
    try {
      await api(`/expenses/${e.id}`, {
        method: "PUT",
        body: { title, amount: Number(d.amount), category: d.category, date: d.date, version },
      });
      close();
      toast(`Saved ${title}`);
      render();
    } catch (err) {
      const now = conflictCurrent(err);
      if (!now) return fail(err);
      showConflict(form, `It's now ${now.title}, ${money(now.amount)} on ${now.date}.`, [
        ["Keep mine", () => { version = now.version; save(); }, true],
        ["Use theirs", () => { close(); render(); }],
      ]);
    }
  };
  const form = h(
    "form.stack",
    {
      onsubmit: (ev) => {
        ev.preventDefault();
        save();
      },
    },
    h("input", { name: "title", value: e.title, placeholder: "What", required: true, "aria-label": "Expense" }),
    h(
      "div.row-fields",
      h("input", { name: "amount", type: "number", step: "any", min: "0.01", value: e.amount, required: true, "aria-label": "Amount" }),
      h("select", { name: "category", "aria-label": "Category" },
        CATEGORIES.map((cat) => h("option", { value: cat, selected: e.category === cat }, cat))),
      h("input", { name: "date", type: "date", value: e.date, required: true, "aria-label": "Date" }),
    ),
    h("button.primary", { type: "submit" }, "Save changes"),
  );
  const { close } = showModal({ title: "Edit expense", body: form, backdropClass: "sheet-mobile" });
}

export const repeatSelect = (opts, dflt) => h("select.w-sm", { name: "repeat", "aria-label": "Repeat" },
  opts.map((r) => h("option", { value: r, selected: r === dflt }, REPEAT_LABEL[r])));

export function billForm(date) {
  return h("form.row", {
    onsubmit: (e) => {
      e.preventDefault();
      const d = formData(e.target);
      const assigned_to = (d.assigned_to || "").trim() || "Anyone";
      rememberMember(assigned_to);
      create("/chores", {
        title: d.title.trim(), description: null, assigned_to,
        priority: "high", status: "todo", due_date: date,
        amount: Number(d.amount), category: d.category, repeat: d.repeat || null,
      }, `bill ${d.title}`);
    },
  },
    h("input", { name: "title", placeholder: "Bill (e.g. Electricity)", required: true, autocomplete: "off", "aria-label": "Bill" }),
    h("input.w-sm", { name: "amount", type: "number", step: "0.01", min: "0.01", placeholder: "0.00", required: true, "aria-label": "Amount" }),
    h("select.w-sm", { name: "category", "aria-label": "Category" }, CATEGORIES.map((c) => h("option", { value: c, selected: c === "Utilities" }, c))),
    whoField("Anyone", "Who pays", "w-sm"),
    repeatSelect(["", "monthly", "yearly"], "monthly"),
    h("button.primary", { type: "submit" }, "Add bill"),
  );
}

export function payBillBtn(c) {
  const paid = c.status === "done";
  return h("button.pay-btn", {
    type: "button",
    class: paid ? "paid" : null,
    title: paid ? "Paid. Tap to mark unpaid" : "Mark as paid",
    "aria-label": paid ? `${c.title} is paid; mark unpaid` : `Pay ${c.title}`,
    onclick: (e) => {
      e.stopPropagation();
      setChore(c, { status: paid ? "todo" : "done" });
    },
  }, paid ? "Paid ✓" : "Pay");
}

/** Clear status picker: To do / Doing / Done (a native select, so it's easy on phones). */
export function choreStatusSelect(c) {
  return h("select.status-select", {
    class: STATUS_COLOR[c.status],
    "aria-label": `Status of ${c.title}`,
    title: "Change status",
    onclick: (e) => e.stopPropagation(),
    onchange: (e) => setChore(c, { status: e.target.value }),
  }, STATUS.map((s) => h("option", { value: s, selected: s === c.status }, STATUS_LABEL[s])));
}

/** Move, Edit, Repeat and Delete for one chore or bill, behind a "⋯" menu. */
export function choreMenu(c) {
  return rowMenu(c.title, [
    { label: c.due_date ? "Move to another day" : "Set a day", onSelect: () => openMoveModal({ kind: "chore", id: c.id, label: c.title, currentDate: c.due_date }) },
    { label: "Edit", onSelect: () => openChoreEditModal(c) },
    { label: c.repeat ? "Change repeat" : "Repeat…", onSelect: () => openRepeatModal(c) },
    { label: "Delete", deletePath: `/chores/${c.id}` },
  ]);
}

/** "Tanvi · Kitchen · ↻ Weekly": the quiet second line under a chore. */
export function choreDetails(c, { withDate = false } = {}) {
  const isBill = c.amount != null && c.amount > 0;
  return [
    c.assigned_to && c.assigned_to !== "Anyone" ? c.assigned_to : null,
    isBill ? null : c.category,
    withDate && c.due_date ? fmtDay(c.due_date) : null,
    c.repeat ? `↻ ${REPEAT_LABEL[c.repeat] || c.repeat}` : null,
  ].filter(Boolean).join(" · ");
}

export function choreRow(c) {
  const isBill = c.amount != null && c.amount > 0;
  const details = choreDetails(c);
  return [
    isBill ? payBillBtn(c) : choreStatusSelect(c),
    h("div.grow",
      h("div.title", { class: c.status === "done" ? "strike" : null }, c.title),
      details ? h("div.meta", details) : null),
    isBill ? h("span.num", { class: c.status === "done" ? "c-muted" : null }, moneyShort(c.amount)) : priorityTag(c.priority),
    choreMenu(c),
  ];
}

export const mealTitleNode = (m) =>
  m.recipe_id
    ? h("a.grow.title.meal-link", {
        href: "#/recipes",
        title: "Open recipe",
        onclick: () => requestRecipeOpen(m.recipe_id),
      }, m.title)
    : h("span.grow.title", m.title);

/** Move and Delete for a planned meal. */
export function mealMenu(m) {
  return rowMenu(m.title, [
    { label: "Move to another day", onSelect: () => openMoveModal({ kind: "meal", id: m.id, label: m.title, currentDate: m.date }) },
    m.recipe_id ? { label: "Open recipe", onSelect: () => { requestRecipeOpen(m.recipe_id); location.hash = "#/recipes"; } } : null,
    { label: "Delete", deletePath: `/meals/${m.id}` },
  ]);
}

/** Edit and Delete for an expense. */
export function expenseMenu(e) {
  return rowMenu(e.title, [
    { label: "Edit", onSelect: () => openExpenseEditModal(e) },
    { label: "Delete", deletePath: `/expenses/${e.id}` },
  ]);
}

export const mealRow = (m) => [
  h("span.slot-label", { class: SLOT_TONE[m.slot] }, SLOT_LABEL[m.slot] || cap(m.slot)),
  mealTitleNode(m),
  mealMenu(m),
];

export const expenseRow = (e, linked = 0, fromBill = false) => [
  h("div.grow",
    h("div.title", e.title),
    h("div.meta", [e.category, fromBill ? "Bill" : null, linked ? `${linked} in pantry` : null].filter(Boolean).join(" · "))),
  h("span.num", money(e.amount)),
  expenseMenu(e),
];

export function choreForm(date) {
  return h("form.row", {
    onsubmit: (e) => {
      e.preventDefault();
      const d = formData(e.target);
      const assigned_to = (d.assigned_to || "").trim() || "Anyone";
      rememberMember(assigned_to);
      create("/chores", {
        title: d.title.trim(), description: null, assigned_to,
        priority: d.priority, status: "todo", category: d.category || null, due_date: date || null,
        repeat: d.repeat || null,
      }, d.title);
    },
  },
    h("input", { name: "title", placeholder: "Add a chore", required: true, autocomplete: "off", "aria-label": "Chore" }),
    h("button.primary", { type: "submit" }, "Add"),
    h("details.form-more",
      h("summary", "More options"),
      h("div.row-fields",
        whoField("Anyone", "Assigned to", ""),
        choreCategorySelect(),
        h("select", { name: "priority", "aria-label": "Priority" }, ["low", "medium", "high"].map((p) => h("option", { value: p, selected: p === "medium" }, `${cap(p)} priority`))),
        repeatSelect(["", "weekly", "monthly"], ""))),
  );
}

export function mealForm(date, recipes = []) {
  return h("form.row", {
    onsubmit: (e) => {
      e.preventDefault();
      const d = formData(e.target);
      const recipe = recipes.find((r) => String(r.id) === d.recipe_id);
      const title = (d.title || "").trim() || (recipe && recipe.name);
      if (!title) return toast("Enter a meal or pick a recipe", true);
      create("/meals", { date, slot: d.slot, title, recipe_id: recipe ? recipe.id : null }, title);
    },
  },
    h("select.w-sm", { name: "slot", "aria-label": "Meal slot" }, SLOTS.map((s) => h("option", { value: s, selected: s === "dinner" }, SLOT_LABEL[s]))),
    h("input", { name: "title", placeholder: "Meal", autocomplete: "off", "aria-label": "Meal" }),
    recipes.length ? h("select", { name: "recipe_id", "aria-label": "Recipe" },
      h("option", { value: "" }, "Or a recipe…"),
      recipes.map((r) => h("option", { value: r.id }, r.name))) : null,
    h("button.primary", { type: "submit" }, "Add"),
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
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read that image")); };
    img.src = url;
  });
}

/** A button that opens the camera/file picker, sends the photo to `path`, and hands back the JSON. */
/** A PDF goes up as it is (the server reads its text); a photo is shrunk first. */
function readUpload(file) {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
  if (!isPdf) return readImage(file);
  if (file.size > 15 * 1024 * 1024) return Promise.reject(new Error("That PDF is too large (15 MB at most)"));
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^;,]*/, "data:application/pdf"));
    r.onerror = () => reject(new Error("Could not read that PDF"));
    r.readAsDataURL(file);
  });
}

export function photoButton(label, busyText, path, onResult, kindHint = null, { accept = "image/*" } = {}) {
  const input = h("input", { type: "file", accept, hidden: true });
  const btn = h("button", { type: "button", onclick: () => input.click() }, label);
  const status = h("span.meta");
  if (kindHint && isJobPending(kindHint)) {
    btn.disabled = true;
    status.className = "spinner";
    status.textContent = busyText;
  }
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    btn.disabled = true;
    status.className = "spinner";
    status.textContent = busyText;
    let note = "";
    try {
      const image_base64 = await readUpload(file);
      const result = await submitAiJob(path, { image_base64 }, kindHint);
      note = (await onResult(result)) || "";
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

export const asPending = (items) => items.map((i) => ({
  name: i.name, quantity: i.quantity, unit: i.unit, expires_on: i.expires_on || "", keep: true,
  // What the scan read and suggested, so edits can be remembered for next time.
  source: i.source || i.name, suggested: { name: i.name, unit: i.unit }, remembered: !!i.remembered,
}));

/**
 * Remembers the names and units someone fixed in a scan review, so the next
 * scan that reads the same thing uses their version.
 */
async function rememberCorrections(items) {
  const fixed = items
    .filter((i) => i.keep && i.name.trim() && i.suggested)
    .filter((i) => i.name.trim().toLowerCase() !== String(i.suggested.name || "").trim().toLowerCase()
      || (i.unit || "").trim().toLowerCase() !== String(i.suggested.unit || "").trim().toLowerCase())
    .map((i) => ({ source: i.source, name: i.name.trim(), unit: (i.unit || "").trim() || null }));
  if (!fixed.length) return 0;
  try {
    const out = await api("/corrections", { method: "POST", body: { items: fixed } });
    return out.saved || 0;
  } catch {
    return 0; // remembering is a bonus; the save itself already worked
  }
}

const learnedNote = (n) => (n ? ` · remembered ${n} correction${n === 1 ? "" : "s"} for next time` : "");

/** Editable rows of scanned items: tick, name, amount, unit (and expiry for pantry photos). */
function itemTable(items, { withExpiry = false, onChange = () => {} } = {}) {
  return h("table.review-table",
    h("thead", h("tr",
      h("th", { scope: "col" }, h("span.sr-only", "Keep")),
      h("th", { scope: "col" }, "Item"),
      h("th", { scope: "col" }, "Qty"),
      h("th", { scope: "col" }, "Unit"),
      withExpiry ? h("th", { scope: "col" }, "Expires") : null)),
    h("tbody", items.map((it) => h("tr", { class: it.keep ? null : "off" },
      h("td", h("input", { type: "checkbox", checked: it.keep, "aria-label": `Keep ${it.name}`, onchange: (e) => { it.keep = e.target.checked; e.target.closest("tr").classList.toggle("off", !it.keep); onChange(); } })),
      h("td", h("input", { value: it.name, "aria-label": "Item name", oninput: (e) => { it.name = e.target.value; } }),
        it.remembered ? h("span.learned", { title: "Named the way you corrected it last time" }, "✓ your correction") : null),
      h("td", h("input.qty", { type: "number", step: "any", min: "0", value: it.quantity, "aria-label": `Quantity of ${it.name}`, oninput: (e) => { it.quantity = e.target.value; } })),
      h("td", h("input.unit", { value: it.unit, "aria-label": `Unit of ${it.name}`, oninput: (e) => { it.unit = e.target.value; } })),
      withExpiry ? h("td", h("input", { type: "date", value: it.expires_on || "", "aria-label": `Expiry date of ${it.name}`, oninput: (e) => { it.expires_on = e.target.value; } })) : null,
    ))));
}

const pantryBody = (chosen) => chosen.map(({ name, quantity, unit, expires_on }) => ({
  name: name.trim(), quantity: Number(quantity) || 1, unit: (unit || "").trim() || "pcs", expires_on: expires_on || null,
}));

export function pantryReview() {
  if (!pendingItems || !pendingItems.items.length) return null;
  const p = pendingItems;
  const items = p.items;
  const fromPhoto = !p.expense_id;
  const confirmAdd = async () => {
    const chosen = items.filter((i) => i.keep && i.name.trim());
    if (!chosen.length) return toast("Nothing selected", true);
    try {
      const out = await api("/pantry/batch", { method: "POST", body: { expense_id: p.expense_id || null, items: pantryBody(chosen) } });
      const learned = await rememberCorrections(items);
      pendingItems = null;
      toast(`Pantry: ${out.added} added, ${out.topped_up} topped up${learnedNote(learned)}`);
      render();
    } catch (err) {
      fail(err);
    }
  };
  return h("section.review", { "aria-label": "Review items for the pantry" },
    h("div.spread",
      h("h3", fromPhoto ? `Found ${items.length} item${items.length === 1 ? "" : "s"} in the photo` : `Add items from ${p.label} to the pantry?`),
      h("button.icon", { onclick: () => { pendingItems = null; render(); }, "aria-label": "Dismiss" }, "×")),
    h("p.hint", fromPhoto
      ? "Filled in from what could be read on the packs. Fix or untick anything that's wrong; amounts and dates left as guesses can be edited."
      : "Edit or untick anything that's wrong; existing items are topped up, not duplicated."),
    itemTable(items, { withExpiry: true }),
    h("div.scan",
      h("button.primary", { onclick: confirmAdd }, "Add to pantry"),
      p.expense_id ? h("span.meta", "Linked to that expense") : null),
  );
}

/**
 * A scanned receipt or invoice, shown as a table to check and approve in one
 * go: the expense (shop, total, category, date) and the items to put in the
 * pantry. Nothing is saved until "Add" is pressed.
 */
function receiptReview(date) {
  const r = scannedReceipt;
  const discard = () => { scannedReceipt = null; render(); };
  const addBtn = h("button.primary", { type: "submit" });
  const label = () => {
    const n = r.items.filter((i) => i.keep && i.name.trim()).length;
    addBtn.textContent = n ? `Add expense and ${n} item${n === 1 ? "" : "s"} to pantry` : "Add expense";
  };
  label();
  const form = h("form.receipt-review", {
    onsubmit: async (e) => {
      e.preventDefault();
      if (form.dataset.busy) return;
      const title = r.title.trim();
      if (!title) return toast("Add the shop name", true);
      if (!(Number(r.amount) > 0)) return toast("Add the total", true);
      form.dataset.busy = "1";
      try {
        const out = await api("/expenses", { method: "POST", body: { title, amount: Number(r.amount), category: r.category, date: r.date || date } });
        const chosen = r.items.filter((i) => i.keep && i.name.trim());
        let note = "";
        if (chosen.length) {
          const p = await api("/pantry/batch", { method: "POST", body: { expense_id: out.id, items: pantryBody(chosen) } });
          note = ` · pantry: ${p.added} added, ${p.topped_up} topped up`;
        }
        const learned = await rememberCorrections(r.items);
        scannedReceipt = null;
        toast(`Added ${title}${note}${learnedNote(learned)}`);
        render();
      } catch (err) {
        fail(err);
      } finally {
        delete form.dataset.busy;
      }
    },
  },
    h("div.spread", h("h3", "Check the scanned receipt"), h("button.icon", { type: "button", onclick: discard, "aria-label": "Discard scan" }, "×")),
    h("div.receipt-fields",
      h("label.field", h("span.meta", "Shop"), h("input", { value: r.title, required: true, oninput: (e) => { r.title = e.target.value; } })),
      h("label.field", h("span.meta", "Total"), h("input", { type: "number", step: "any", min: "0", value: r.amount || "", required: true, oninput: (e) => { r.amount = e.target.value; } })),
      h("label.field", h("span.meta", "Category"), h("select", { onchange: (e) => { r.category = e.target.value; } },
        CATEGORIES.map((c) => h("option", { value: c, selected: r.category === c }, c)))),
      h("label.field", h("span.meta", "Date"), h("input", { type: "date", value: r.date || date, oninput: (e) => { r.date = e.target.value; } }))),
    r.expected && r.items.length < r.expected
      ? h("p.hint.c-orange", `The invoice lists ${r.expected} items but ${r.items.length} were read. Add any that are missing below.`)
      : null,
    r.items.length
      ? [h("p.hint", `${r.items.length} item${r.items.length === 1 ? "" : "s"} found. Ticked ones go to the pantry, linked to this expense; edit or untick any that are wrong. Rosie remembers your fixes for next time.`),
         itemTable(r.items, { onChange: label })]
      : h("p.hint", "No pantry items found on this receipt."),
    h("button.link", { type: "button", onclick: () => { r.items.push({ name: "", quantity: 1, unit: "pcs", expires_on: "", keep: true }); render(); } }, "+ Add a row"),
    h("div.scan", addBtn, h("button", { type: "button", onclick: discard }, "Discard")),
  );
  return form;
}

/** Photos and PDF invoices (online orders usually send PDFs). */
export const RECEIPT_FILES = "image/*,application/pdf,.pdf";

/** Puts a scan result into the review table on the Expenses page. */
export function showReceiptReview(out) {
  scannedReceipt = {
    title: out.title || "",
    amount: out.amount || "",
    category: CATEGORIES.includes(out.category) ? out.category : "Other",
    date: /^\d{4}-\d{2}-\d{2}$/.test(out.date || "") ? out.date : "",
    items: asPending(out.items || []),
    expected: Number(out.expected_items) || 0,
  };
}

export function expenseForm(date, withScan = false) {
  if (withScan && scannedReceipt) return receiptReview(date);
  const form = h("form.row", {
    onsubmit: async (e) => {
      e.preventDefault();
      if (form.dataset.busy) return; // no double submit
      const d = formData(e.target);
      const title = d.title.trim();
      form.dataset.busy = "1";
      try {
        await api("/expenses", { method: "POST", body: { title, amount: Number(d.amount), category: d.category, date: d.date || date } });
        toast(`Added ${title}`);
        render();
      } catch (err) { fail(err); } finally { delete form.dataset.busy; }
    },
  },
    h("input", { name: "title", placeholder: "What", required: true, autocomplete: "off", "aria-label": "Expense" }),
    h("input.w-sm", { name: "amount", type: "number", step: "any", min: "0", placeholder: "0.00", required: true, "aria-label": "Amount" }),
    h("select.w-sm", { name: "category", "aria-label": "Category" }, CATEGORIES.map((c) => h("option", { value: c }, c))),
    h("input", { name: "date", type: "hidden", value: date }),
    h("button.primary", { type: "submit" }, "Add"),
  );
  if (!withScan) return form;

  const scan = photoButton("Scan receipt or invoice", "Reading it — usually under a minute", "/expenses/scan-receipt", (out) => {
    showReceiptReview(out);
    toast("Read it — check and approve below");
    render();
    return "";
  }, "receipt", { accept: RECEIPT_FILES });

  return h("div", form, scan, h("p.hint", "A photo of a bill, or the PDF invoice from an online order."));
}
