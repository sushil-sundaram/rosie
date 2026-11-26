import { api } from "../api.js";
import { today } from "../dates.js";
import { create, fail, formData, h, segmented, toast } from "../dom.js";
import { CATEGORIES } from "../money.js";
import { render } from "../router.js";
import { showModal } from "../shortcuts.js";
import { cached } from "../store.js";
import { cal } from "./calendar.js";
import { asPending, photoButton, repeatSelect, setPendingItems, SLOTS, SLOT_LABEL } from "./domain.js";

function routeDefaultKind() {
  const route = (location.hash.replace(/^#\/?/, "").split("/")[0]) || "home";
  return { pantry: "pantry", meals: "meal", recipes: "meal", chores: "chore", expenses: "expense" }[route] || "expense";
}

export function openQuickAdd() {
  const existing = document.querySelector(".modal-backdrop[data-quick-add]");
  if (existing) return;

  let kind = routeDefaultKind();
  let recipes = [];
  let receiptDraft = null;
  const wrap = h("div.quick-add-body");
  const defaultDate = cal.sel || today();

  const { backdrop, close } = showModal({
    title: "Quick add",
    body: wrap,
    backdropClass: "sheet-mobile",
  });
  backdrop.setAttribute("data-quick-add", "true");

  const renderBody = () => {
    const tabs = segmented(
      [
        ["expense", "Expense"],
        ["receipt", "Receipt"],
        ["pantry", "Pantry"],
        ["meal", "Meal"],
        ["chore", "Chore"],
        ["bill", "Bill"],
      ],
      kind,
      (k) => {
        kind = k;
        renderBody();
      },
      "Quick add type",
    );
    tabs.classList.add("quick-tabs");

    let form;
    if (kind === "expense") {
      form = h(
        "form.stack",
        {
          onsubmit: async (e) => {
            e.preventDefault();
            const d = formData(e.target);
            const title = d.title.trim();
            if (await create("/expenses", { title, amount: Number(d.amount), category: d.category, date: d.date || defaultDate }, title)) {
              close();
            }
          },
        },
        h("input", { name: "title", placeholder: "What", required: true, autocomplete: "off", "aria-label": "Expense" }),
        h(
          "div.row-fields",
          h("input", { name: "amount", type: "number", step: "any", min: "0", placeholder: "0.00", required: true, "aria-label": "Amount" }),
          h("select", { name: "category", "aria-label": "Category" }, CATEGORIES.map((c) => h("option", { value: c }, c))),
          h("input", { name: "date", type: "date", value: defaultDate, "aria-label": "Date" }),
        ),
        h("button.primary", { type: "submit" }, "Add expense"),
      );
    } else if (kind === "receipt") {
      const scanBtn = photoButton("Scan receipt", "Reading receipt", "/expenses/scan-receipt", (out) => {
        receiptDraft = {
          title: out.title || "",
          amount: out.amount || "",
          category: CATEGORIES.includes(out.category) ? out.category : "Other",
          date: /^\d{4}-\d{2}-\d{2}$/.test(out.date || "") ? out.date : defaultDate,
          items: out.items || [],
        };
        toast("Receipt read — check details, then save");
        renderBody();
      }, "receipt");
      form = h(
        "div.stack",
        scanBtn,
        receiptDraft ? h(
          "form.stack",
          {
            onsubmit: async (e) => {
              e.preventDefault();
              const d = formData(e.target);
              const title = d.title.trim();
              try {
                const out = await api("/expenses", {
                  method: "POST",
                  body: { title, amount: Number(d.amount), category: d.category, date: d.date || defaultDate },
                });
                toast(`Added ${title}`);
                if (receiptDraft.items && receiptDraft.items.length) {
                  setPendingItems({ expense_id: out.id, label: title, items: asPending(receiptDraft.items) });
                  close();
                  if (!location.hash.startsWith("#/expenses")) location.hash = "#/expenses";
                  else render();
                  return;
                }
                close();
                render();
              } catch (err) {
                fail(err);
              }
            },
          },
          h("input", { name: "title", placeholder: "Merchant or description", required: true, value: receiptDraft.title, "aria-label": "Merchant" }),
          h(
            "div.row-fields",
            h("input", { name: "amount", type: "number", step: "any", min: "0", required: true, value: receiptDraft.amount, "aria-label": "Amount" }),
            h("select", { name: "category", "aria-label": "Category" }, CATEGORIES.map((c) => h("option", { value: c, selected: receiptDraft.category === c }, c))),
            h("input", { name: "date", type: "date", value: receiptDraft.date, "aria-label": "Date" }),
          ),
          receiptDraft.items?.length ? h("p.hint", `${receiptDraft.items.length} pantry item(s) ready to review after saving`) : null,
          h("button.primary", { type: "submit" }, "Save expense"),
        ) : h("p.hint", "Take or choose a receipt photo to extract expense & pantry items."),
      );
    } else if (kind === "pantry") {
      form = h(
        "form.stack",
        {
          onsubmit: async (e) => {
            e.preventDefault();
            const d = formData(e.target);
            const name = d.name.trim();
            if (await create("/pantry", { name, quantity: Number(d.quantity) || 1, unit: d.unit.trim() || "pcs", expires_on: d.expires_on || null }, name)) {
              close();
            }
          },
        },
        h("input", { name: "name", placeholder: "Item (e.g. Milk)", required: true, autocomplete: "off", "aria-label": "Item" }),
        h(
          "div.row-fields",
          h("input", { name: "quantity", type: "number", step: "any", min: "0", value: "1", placeholder: "Qty", "aria-label": "Quantity" }),
          h("input", { name: "unit", value: "pcs", placeholder: "Unit", "aria-label": "Unit" }),
          h("input", { name: "expires_on", type: "date", title: "Expires on", "aria-label": "Expires on" }),
        ),
        h("button.primary", { type: "submit" }, "Add to pantry"),
      );
    } else if (kind === "meal") {
      form = h(
        "form.stack",
        {
          onsubmit: async (e) => {
            e.preventDefault();
            const d = formData(e.target);
            const recipe = recipes.find((r) => String(r.id) === d.recipe_id);
            const title = (d.title || "").trim() || (recipe && recipe.name);
            if (!title) return toast("Enter a meal or pick a recipe", true);
            if (await create("/meals", { date: d.date || defaultDate, slot: d.slot, title, recipe_id: recipe ? recipe.id : null }, title)) {
              close();
            }
          },
        },
        h(
          "div.row-fields",
          h("select", { name: "slot", "aria-label": "Meal slot" }, SLOTS.map((s) => h("option", { value: s, selected: s === "dinner" }, SLOT_LABEL[s]))),
          h("input", { name: "date", type: "date", value: defaultDate, "aria-label": "Date" }),
        ),
        h("input", { name: "title", placeholder: "Meal", autocomplete: "off", "aria-label": "Meal" }),
        recipes.length ? h("select", { name: "recipe_id", "aria-label": "Recipe" },
          h("option", { value: "" }, "Or a recipe…"),
          recipes.map((r) => h("option", { value: r.id }, r.name))) : null,
        h("button.primary", { type: "submit" }, "Add meal"),
      );
    } else if (kind === "chore") {
      form = h(
        "form.stack",
        {
          onsubmit: async (e) => {
            e.preventDefault();
            const d = formData(e.target);
            const title = d.title.trim();
            if (await create("/chores", {
              title, description: null, assigned_to: d.assigned_to.trim() || "Anyone",
              priority: d.priority, status: "todo", points: Number(d.points) || 1,
              due_date: d.due_date || null, repeat: d.repeat || null,
            }, title)) {
              close();
            }
          },
        },
        h("input", { name: "title", placeholder: "Chore", required: true, autocomplete: "off", "aria-label": "Chore" }),
        h(
          "div.row-fields",
          h("input", { name: "assigned_to", placeholder: "Who", "aria-label": "Assigned to" }),
          h("select", { name: "priority", "aria-label": "Priority" }, ["low", "medium", "high"].map((p) => h("option", { value: p, selected: p === "medium" }, p[0].toUpperCase() + p.slice(1)))),
          h("input", { name: "points", type: "number", min: "1", value: "1", "aria-label": "Points" }),
        ),
        h(
          "div.row-fields",
          h("input", { name: "due_date", type: "date", value: defaultDate, "aria-label": "Due date" }),
          repeatSelect(["", "weekly", "monthly"], ""),
        ),
        h("button.primary", { type: "submit" }, "Add chore"),
      );
    } else {
      form = h(
        "form.stack",
        {
          onsubmit: async (e) => {
            e.preventDefault();
            const d = formData(e.target);
            const title = d.title.trim();
            if (await create("/chores", {
              title, description: null, assigned_to: d.assigned_to.trim() || "Anyone",
              priority: "high", status: "todo", points: 1, due_date: d.due_date || defaultDate,
              amount: Number(d.amount), category: d.category, repeat: d.repeat || null,
            }, `bill ${title}`)) {
              close();
            }
          },
        },
        h("input", { name: "title", placeholder: "Bill (e.g. Electricity)", required: true, autocomplete: "off", "aria-label": "Bill" }),
        h(
          "div.row-fields",
          h("input", { name: "amount", type: "number", step: "0.01", min: "0.01", placeholder: "0.00", required: true, "aria-label": "Amount" }),
          h("select", { name: "category", "aria-label": "Category" }, CATEGORIES.map((c) => h("option", { value: c, selected: c === "Utilities" }, c))),
          h("input", { name: "assigned_to", placeholder: "Who pays", "aria-label": "Who pays" }),
        ),
        h(
          "div.row-fields",
          h("input", { name: "due_date", type: "date", value: defaultDate, "aria-label": "Due date" }),
          repeatSelect(["", "monthly", "yearly"], "monthly"),
        ),
        h("button.primary", { type: "submit" }, "Add bill"),
      );
    }

    wrap.replaceChildren(tabs, form);
    const firstInput = form.querySelector("input:not([type=hidden]):not([type=file]), select");
    if (firstInput) firstInput.focus();
  };

  renderBody();
  cached("recipes", "/recipes").then((list) => {
    if (Array.isArray(list) && list.length) {
      recipes = list;
      if (kind === "meal") renderBody();
    }
  }).catch(() => {});
}

export function initQuickAdd() {
  const fab = document.getElementById("quick-add-fab");
  if (fab) fab.onclick = openQuickAdd;
}
