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
export function toast(msg, isErr = false) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "show" + (isErr ? " err" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ""), 2600);
}

export const fail = (e) => toast(e.message || String(e), true);
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
