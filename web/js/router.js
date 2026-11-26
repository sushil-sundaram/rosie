import { getAuthState } from "./api.js";
import { h } from "./dom.js";
import { setSettings } from "./money.js";
import { cached } from "./store.js";

let views = {};
let renderLogin = () => {};
let syncCtrl = { markFresh() {} };
let consumeFocus = () => false;
let renderGen = 0;

export function configureRouter({ viewMap, loginView, sync, consumeFocusSel }) {
  views = viewMap;
  renderLogin = loginView;
  syncCtrl = sync;
  if (consumeFocusSel) consumeFocus = consumeFocusSel;
}

export async function render() {
  // Only the newest render may update the screen: a slow earlier one (quick
  // navigation, a live-sync refresh) must not overwrite it when it finishes.
  const gen = ++renderGen;
  syncCtrl.markFresh();
  const route = (location.hash.replace(/^#\/?/, "").split("/")[0]) || "home";
  const view = Object.hasOwn(views, route) ? views[route] : views.home;
  for (const a of document.querySelectorAll("#nav a, a.gear")) {
    const r = a.getAttribute("href").replace(/^#\/?/, "") || "home";
    a.classList.toggle("active", r === route);
    if (r === route) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  const root = document.getElementById("view");
  const next = document.createElement("div");
  // Views pass optional sections (null) and grouped sections (arrays); flatten and drop empties.
  next.append = (...kids) => Element.prototype.append.apply(next, kids.flat(Infinity).filter((k) => k != null && k !== false));
  const y = window.scrollY;
  try {
    const auth = getAuthState();
    if (auth.required && !auth.authenticated) {
      renderLogin(next);
    } else {
      const s = await cached("settings", "/settings").catch(() => null);
      if (s) setSettings(s);
      const afterAuth = getAuthState();
      if (afterAuth.required && !afterAuth.authenticated) renderLogin(next);
      else await view(next);
    }
  } catch (err) {
    const auth = getAuthState();
    if (auth.required && !auth.authenticated) renderLogin(next);
    else next.replaceChildren(h("h1", "Offline"), h("p.sub.c-red", err.message), h("button", { onclick: render }, "Retry"));
  }
  if (gen !== renderGen) return;
  root.replaceChildren(next);
  window.scrollTo(0, y);
  if (consumeFocus()) {
    const c = root.querySelector(".cell.sel");
    if (c) c.focus();
  }
  document.title = route === "home" ? "Rosie" : `${route[0].toUpperCase() + route.slice(1)} · Rosie`;
}
