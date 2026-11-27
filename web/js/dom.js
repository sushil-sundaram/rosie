import { api } from "./api.js";

let triggerRender = () => {};

export function setDomRender(fn) {
  triggerRender = fn;
}

/** h("div.cls", {attrs}, ...children) — builds DOM without innerHTML. */
export function h(tag, attrs, ...kids) {
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
export function toast(msg, isErr = false, action = null) {
  const t = document.getElementById("toast");
  // replaceChildren would print a null as the text "null", hence the filter.
  t.replaceChildren(...[
    h("span", msg),
    action
      ? h(
          "button.toast-action",
          {
            type: "button",
            onclick: () => {
              clearTimeout(toastTimer);
              t.className = "";
              action.onclick();
            },
          },
          action.label,
        )
      : null,
  ].filter(Boolean));
  t.className = ["show", isErr && "err", action && "has-action"].filter(Boolean).join(" ");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ""), action ? 5000 : 2600);
}

export const fail = (e) => toast(e.message || String(e), true);

/**
 * Shown in an edit form when someone else saved the same thing first.
 * `actions` are [label, onClick, primary?]. Replaces any earlier notice in `form`.
 */
export function showConflict(form, message, actions) {
  form.querySelector(".conflict")?.remove();
  const notice = h("div.conflict", { role: "alert" },
    h("p", h("strong", "Changed by someone else. "), message),
    h("div.scan", actions.map(([label, onClick, primary]) =>
      h(primary ? "button.primary" : "button", { type: "button", onclick: onClick }, label))));
  form.prepend(notice);
  notice.scrollIntoView({ block: "nearest" });
  return notice;
}
export const formData = (form) => Object.fromEntries(new FormData(form).entries());

export const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem("rosie." + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem("rosie." + k, JSON.stringify(v));
    } catch {
      /* storage unavailable */
    }
  },
};

export function list(items, row, ...emptyMsg) {
  if (!items.length) return h("p.empty", ...emptyMsg);
  return h("ul.list", items.map((it) => h("li", row(it))));
}

/**
 * A "⋯" button opening a small menu of actions for one row.
 * items: { label, onSelect } or, for deleting, { label, deletePath } which
 * asks for a second tap before deleting.
 */
export function rowMenu(name, items) {
  const wrap = h("span.menu-wrap");
  let menu = null;
  const close = () => {
    if (!menu) return;
    menu.remove();
    menu = null;
    btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
  };
  const onOutside = (e) => { if (!wrap.contains(e.target)) close(); };
  const onKey = (e) => {
    if (e.key === "Escape") { close(); btn.focus(); }
  };
  const itemBtn = (it) => {
    const b = h("button", { type: "button", role: "menuitem", class: it.deletePath ? "c-red" : null }, it.label);
    let armed = false;
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (it.deletePath) {
        if (!armed) {
          armed = true;
          b.textContent = `Tap again to delete`;
          return;
        }
        close();
        try {
          await api(it.deletePath, { method: "DELETE" });
          toast(`Deleted ${name}`);
          triggerRender();
        } catch (err) {
          fail(err);
        }
        return;
      }
      close();
      it.onSelect();
    });
    return b;
  };
  const open = () => {
    menu = h("div.row-menu", { role: "menu", "aria-label": `Actions for ${name}` }, items.filter(Boolean).map(itemBtn));
    wrap.append(menu);
    btn.setAttribute("aria-expanded", "true");
    menu.querySelector("button")?.focus();
    // Open upwards when there's no room below (bottom of a phone screen).
    const r = menu.getBoundingClientRect();
    if (r.bottom > window.innerHeight - 80) menu.classList.add("up");
    document.addEventListener("click", onOutside, true);
    document.addEventListener("keydown", onKey, true);
  };
  const btn = h("button.icon.menu-btn", {
    type: "button",
    title: "More",
    "aria-label": `More actions for ${name}`,
    "aria-haspopup": "menu",
    "aria-expanded": "false",
    onclick: (e) => {
      e.stopPropagation();
      if (menu) close();
      else open();
    },
  }, "⋯");
  wrap.append(btn);
  return wrap;
}

export function delBtn(path, label) {
  let resetTimer = 0;
  const wrap = h("span.del-wrap");
  const showIdle = () => {
    clearTimeout(resetTimer);
    wrap.replaceChildren(
      h("button.icon.del", {
        type: "button",
        title: `Delete ${label}`,
        "aria-label": `Delete ${label}`,
        onclick: (e) => {
          e.stopPropagation();
          showConfirm();
        },
      }, "×"),
    );
  };
  const showConfirm = () => {
    clearTimeout(resetTimer);
    resetTimer = setTimeout(showIdle, 4000);
    wrap.replaceChildren(
      h("button.tag.linkish.c-red", {
        type: "button",
        "aria-label": `Confirm delete ${label}`,
        onclick: async (e) => {
          e.stopPropagation();
          clearTimeout(resetTimer);
          try {
            await api(path, { method: "DELETE" });
            toast(`Deleted ${label}`);
            triggerRender();
          } catch (err) {
            fail(err);
            showIdle();
          }
        },
      }, "Delete?"),
      h("button.icon", {
        type: "button",
        "aria-label": `Cancel deleting ${label}`,
        onclick: (e) => {
          e.stopPropagation();
          showIdle();
        },
      }, "Cancel"),
    );
  };
  showIdle();
  return wrap;
}

/** Sends a create request, toasts, re-renders. Returns true on success. */
export async function create(path, body, label) {
  try {
    await api(path, { method: "POST", body });
    toast(`Added ${label}`);
    triggerRender();
    return true;
  } catch (err) {
    fail(err);
    return false;
  }
}

export const eyebrow = (s) => h("p.eyebrow", s);
export const section = (title, ...kids) => [h("h2", title), ...kids];

export function segmented(options, value, onChange, label) {
  return h("div.seg", { role: "group", "aria-label": label },
    options.map(([key, text]) => h("button", {
      type: "button",
      "aria-pressed": key === value ? "true" : "false",
      class: key === value ? "on" : null,
      onclick: () => onChange(key),
    }, text)));
}

export function stat(value, label, cls) {
  return h("div.stat", h("b", { class: cls }, value), h("span", label));
}

export const safeHref = (u) => (/^https?:\/\//i.test(String(u || "").trim()) ? String(u).trim() : null);
export const safeImg = (u) => (/^(\/api\/recipes\/images\/|data:image\/)/i.test(String(u || "").trim()) ? String(u).trim() : null);
