import { api, conflictCurrent } from "../api.js";
import { addDays, fmtDay, iso, nextDate, today } from "../dates.js";
import { create, delBtn, fail, formData, h, store, toast, showConflict } from "../dom.js";
import { isJobPending, submitAiJob } from "../jobs.js";
import { CATEGORIES, CAT_COLOR, CHORE_CATEGORIES, CHORE_CAT_COLOR, money, moneyShort } from "../money.js";
import { render, requestRecipeOpen } from "../router.js";
import { showModal } from "../shortcuts.js";
import { cal, moveItem } from "./calendar.js";

export const SLOTS = ["breakfast", "lunch", "dinner"];
export const SLOT_COLOR = { breakfast: "c-yellow", lunch: "c-cyan", dinner: "c-purple" };
export const SLOT_LABEL = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };
export const STATUS = ["todo", "in_progress", "done"];
export const STATUS_LABEL = { todo: "To do", in_progress: "Doing", done: "Done" };
export const STATUS_COLOR = { todo: "c-orange", in_progress: "c-cyan", done: "c-green" };
export const STATUS_GLYPH = { todo: "○", in_progress: "◐", done: "●" };

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const priorityTag = (p) => h("span.tag", { class: { high: "c-red", medium: "c-orange", low: "c-green" }[p] || "c-muted" }, cap(p));
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
  cls: `${p.chore.amount ? "c-yellow" : "c-orange"} ghost`,
  title: `${p.chore.title} — Repeats ${p.chore.repeat}, created when the previous one is done`,
});

export function repeatTag(c) {
  if (!c.repeat) return null;
  return h("button.tag.linkish.c-purple", {
    type: "button",
    "aria-label": `${c.title} repeats ${c.repeat}; change or stop repeat`,
    onclick: (e) => {
      e.stopPropagation();
      const body = h(
        "div.stack",
        h("p.meta", `${c.title} currently repeats ${REPEAT_LABEL[c.repeat] || c.repeat}.`),
        h(
          "div.move-quick",
          ["weekly", "monthly", "yearly"].map((r) =>
            h(
              "button",
              {
                type: "button",
                class: c.repeat === r ? "primary" : null,
                onclick: async () => {
                  close();
                  if (c.repeat !== r) await setChore(c, { repeat: r });
                },
              },
              REPEAT_LABEL[r],
            ),
          ),
          h(
            "button.c-red",
            {
              type: "button",
              onclick: async () => {
                close();
                await setChore(c, { repeat: "" });
              },
            },
            "Stop repeating",
          ),
        ),
      );
      const { close } = showModal({ title: "Repeat schedule", body, backdropClass: "sheet-mobile" });
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
  return h("button", {
    type: "button",
    class: paid ? "tag linkish c-green" : "tag linkish c-yellow",
    onclick: (e) => {
      e.stopPropagation();
      setChore(c, { status: paid ? "todo" : "done" });
    },
  }, paid ? "Paid · Undo" : "Pay");
}

export function choreRow(c) {
  const isBill = c.amount != null && c.amount > 0;
  const next = STATUS[(STATUS.indexOf(c.status) + 1) % STATUS.length];
  return [
    isBill
      ? payBillBtn(c)
      : h("button.icon.status", {
          type: "button",
          class: STATUS_COLOR[c.status],
          title: `${STATUS_LABEL[c.status]} — Click for ${STATUS_LABEL[next]}`,
          "aria-label": `${c.title} is ${STATUS_LABEL[c.status]}, mark ${STATUS_LABEL[next]}`,
          onclick: () => setChore(c, { status: next }),
        }, STATUS_GLYPH[c.status]),
    h("span.grow",
      h("span.title", { class: c.status === "done" ? "strike" : null }, c.title),
      h("span.meta", ` ${c.assigned_to}`)),
    repeatTag(c),
    isBill ? null : choreCategoryTag(c.category),
    isBill
      ? h("span.tag", { class: c.status === "done" ? "c-green" : "c-yellow" }, c.status === "done" ? `Paid · ${moneyShort(c.amount)}` : `Bill ${moneyShort(c.amount)}`)
      : priorityTag(c.priority),
    moveBtn("chore", c.id, c.title, c.due_date),
    editBtn(c.title, () => openChoreEditModal(c)),
    delBtn(`/chores/${c.id}`, c.title),
  ];
}

export const mealTitleNode = (m) =>
  m.recipe_id
    ? [
        h(
          "a.grow.title.meal-link",
          {
            href: "#/recipes",
            onclick: () => requestRecipeOpen(m.recipe_id),
          },
          m.title,
        ),
        h(
          "a.tag.c-cyan",
          {
            href: "#/recipes",
            onclick: () => requestRecipeOpen(m.recipe_id),
          },
          "Recipe →",
        ),
      ]
    : h("span.grow.title", m.title);

export const mealRow = (m) => [
  h("span.tag", { class: SLOT_COLOR[m.slot] || "c-muted" }, SLOT_LABEL[m.slot] || cap(m.slot)),
  mealTitleNode(m),
  moveBtn("meal", m.id, m.title, m.date),
  delBtn(`/meals/${m.id}`, m.title),
];

export const expenseRow = (e, linked = 0, fromBill = false) => [
  h("span.grow.title", e.title),
  fromBill ? h("a.tag.c-yellow", { href: "#/chores" }, "From bill") : null,
  linked ? h("a.tag.c-green", { href: "#/pantry" }, `${linked} in pantry`) : null,
  h("span.tag", { class: CAT_COLOR[e.category] || "c-muted" }, e.category),
  h("span.num", money(e.amount)),
  editBtn(e.title, () => openExpenseEditModal(e)),
  delBtn(`/expenses/${e.id}`, e.title),
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
    h("input", { name: "title", placeholder: "Chore", required: true, autocomplete: "off", "aria-label": "Chore" }),
    whoField("Anyone", "Assigned to", "w-sm"),
    choreCategorySelect(),
    h("select.w-sm", { name: "priority", "aria-label": "Priority" }, ["low", "medium", "high"].map((p) => h("option", { value: p, selected: p === "medium" }, cap(p)))),
    repeatSelect(["", "weekly", "monthly"], ""),
    h("button.primary", { type: "submit" }, "Add"),
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
export function photoButton(label, busyText, path, onResult, kindHint = null) {
  const input = h("input", { type: "file", accept: "image/*", hidden: true });
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
      const image_base64 = await readImage(file);
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

export const asPending = (items) => items.map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit, keep: true }));

export function pantryReview() {
  if (!pendingItems || !pendingItems.items.length) return null;
  const p = pendingItems;
  const items = p.items;
  const confirmAdd = async () => {
    const chosen = items.filter((i) => i.keep && i.name.trim());
    if (!chosen.length) return toast("Nothing selected", true);
    try {
      const out = await api("/pantry/batch", {
        method: "POST",
        body: { expense_id: p.expense_id || null, items: chosen.map(({ name, quantity, unit }) => ({ name: name.trim(), quantity: Number(quantity) || 1, unit: unit.trim() || "pcs" })) },
      });
      pendingItems = null;
      toast(`Pantry: ${out.added} added, ${out.topped_up} topped up`);
      render();
    } catch (err) {
      fail(err);
    }
  };
  return h("section.review", { "aria-label": "Review items for the pantry" },
    h("div.spread",
      h("h3", p.expense_id ? `Add items from ${p.label} to the pantry?` : "Items found in the photo"),
      h("button.icon", { onclick: () => { pendingItems = null; render(); }, "aria-label": "Dismiss" }, "×")),
    h("p.hint", "Edit or untick anything that's wrong; existing items are topped up, not duplicated"),
    h("ul.list", items.map((it) => h("li",
      h("input", { type: "checkbox", checked: it.keep, "aria-label": `Keep ${it.name}`, onchange: (e) => { it.keep = e.target.checked; } }),
      h("input.grow", { value: it.name, "aria-label": "Name", oninput: (e) => { it.name = e.target.value; } }),
      h("input.w-xs", { type: "number", step: "any", min: "0", value: it.quantity, "aria-label": "Quantity", oninput: (e) => { it.quantity = e.target.value; } }),
      h("input.w-xs", { value: it.unit, "aria-label": "Unit", oninput: (e) => { it.unit = e.target.value; } }),
    ))),
    h("div.scan",
      h("button.primary", { onclick: confirmAdd }, "Add to pantry"),
      p.expense_id ? h("span.meta", "Linked to that expense") : null),
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
        toast(`Added ${title}`);
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
    h("input", { name: "title", placeholder: "What", required: true, autocomplete: "off", "aria-label": "Expense", value: r ? r.title : null }),
    h("input.w-sm", { name: "amount", type: "number", step: "any", min: "0", placeholder: "0.00", required: true, "aria-label": "Amount", value: r && r.amount ? r.amount : null }),
    h("select.w-sm", { name: "category", "aria-label": "Category" },
      CATEGORIES.map((c) => h("option", { value: c, selected: r && r.category === c }, c))),
    h("input.w-date", { name: "date", type: "date", value: day, required: true, "aria-label": "Date" }),
    h("button.primary", { type: "submit" }, "Add"),
  );
  if (!withScan) return form;

  const scan = photoButton("Scan receipt", "Reading receipt", "/expenses/scan-receipt", (out) => {
    scannedReceipt = {
      title: out.title || "",
      amount: out.amount || "",
      category: CATEGORIES.includes(out.category) ? out.category : "Other",
      date: /^\d{4}-\d{2}-\d{2}$/.test(out.date || "") ? out.date : null,
      items: out.items || [],
    };
    toast("Receipt read — check it, then add");
    render();
    return "";
  }, "receipt");

  const notes = [];
  if (r) {
    if (r.date && r.date !== date) notes.push(`Dated ${fmtDay(r.date)} — saved on that day`);
    if (r.items.length) notes.push(`${r.items.length} item${r.items.length > 1 ? "s" : ""} can go to the pantry after you add`);
  }
  return h("div", form, scan,
    r ? h("p.hint", "Scanned receipt — check it, then add", notes.length ? ` · ${notes.join(" · ")}` : "", " · ",
      h("button.link", { type: "button", onclick: () => { scannedReceipt = null; render(); } }, "Discard")) : null);
}
