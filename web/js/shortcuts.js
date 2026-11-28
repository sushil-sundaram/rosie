import { h } from "./dom.js";

const GO_ROUTES = {
  h: "#/",
  p: "#/pantry",
  m: "#/meals",
  r: "#/recipes",
  l: "#/groceries",
  c: "#/chores",
  e: "#/expenses",
  s: "#/settings",
};

const SHORTCUT_ITEMS = [
  ["g h", "Go to Home"],
  ["g p", "Go to Pantry"],
  ["g l", "Go to Groceries list"],
  ["g m", "Go to Meals"],
  ["g r", "Go to Recipes"],
  ["g c", "Go to Chores"],
  ["g e", "Go to Expenses"],
  ["g s", "Go to Settings"],
  ["/", "Focus search or first field"],
  ["n", "New item or quick add"],
  ["?", "Show keyboard shortcuts"],
  ["Esc", "Close dialog or clear focus"],
];

let gPending = false;
let gTimer = 0;

function clearG() {
  gPending = false;
  clearTimeout(gTimer);
}

function isEditable(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function closeTopModal() {
  const openModals = document.querySelectorAll(".modal-backdrop[data-modal]");
  if (!openModals.length) return false;
  const top = openModals[openModals.length - 1];
  if (typeof top._onClose === "function") top._onClose();
  else top.remove();
  return true;
}

export function showModal({ title, body, className = "", backdropClass = "", onClose }) {
  const dismiss = () => {
    backdrop.remove();
    if (onClose) onClose();
  };
  const dialog = h(
    `div.modal-dialog${className ? "." + className : ""}`,
    { role: "dialog", "aria-modal": "true", "aria-label": title, onclick: (e) => e.stopPropagation() },
    h(
      "div.modal-head",
      h("h3", title),
      h("button.icon", { type: "button", "aria-label": "Close", onclick: dismiss }, "×"),
    ),
    body,
  );
  const backdrop = h(
    `div.modal-backdrop${backdropClass ? "." + backdropClass : ""}`,
    { "data-modal": "true", onclick: dismiss },
    dialog,
  );
  backdrop._onClose = dismiss;
  document.body.append(backdrop);
  const focusable = dialog.querySelector("input, select, textarea, button:not(.icon)");
  if (focusable) focusable.focus();
  return { backdrop, dialog, close: dismiss };
}

export function toggleShortcutsHelp() {
  const existing = document.querySelector(".modal-backdrop[data-shortcuts-help]");
  if (existing) {
    existing.remove();
    return;
  }
  const { backdrop } = showModal({
    title: "Keyboard shortcuts",
    body: h(
      "div.kbd-list",
      SHORTCUT_ITEMS.map(([keys, desc]) =>
        h(
          "div.kbd-row",
          h("span.kbd-keys", keys.split(" ").map((k) => h("kbd", k))),
          h("span.kbd-desc", desc),
        ),
      ),
    ),
  });
  backdrop.setAttribute("data-shortcuts-help", "true");
}

function focusSearchField() {
  const target = document.querySelector(
    "[data-shortcut-search], main input[type=search], main input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=date]):not([type=file])",
  );
  if (!target) return false;
  target.focus();
  if (typeof target.select === "function") target.select();
  return true;
}

function triggerNewAction() {
  const trigger = document.querySelector("[data-shortcut-new]");
  if (trigger) {
    trigger.click();
    return true;
  }
  const target = document.querySelector(
    "main form input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=date]):not([type=file]), main form textarea",
  );
  if (target) {
    target.focus();
    return true;
  }
  return false;
}

export function initShortcuts() {
  const helpBtn = document.getElementById("shortcuts-btn");
  if (helpBtn) helpBtn.onclick = toggleShortcutsHelp;

  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === "Escape") {
      clearG();
      if (closeTopModal()) {
        e.preventDefault();
        return;
      }
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
      return;
    }

    if (isEditable(e.target)) return;

    const k = e.key.toLowerCase();
    if (gPending) {
      clearG();
      if (GO_ROUTES[k]) {
        e.preventDefault();
        location.hash = GO_ROUTES[k];
      }
      return;
    }

    if (k === "g") {
      gPending = true;
      gTimer = setTimeout(clearG, 1200);
      return;
    }

    if (e.key === "/") {
      if (focusSearchField()) e.preventDefault();
      return;
    }

    if (k === "n") {
      if (triggerNewAction()) e.preventDefault();
      return;
    }

    if (e.key === "?") {
      e.preventDefault();
      toggleShortcutsHelp();
    }
  });
}
