import { api, getAuthState, setApiHooks, setAuthState } from "./js/api.js";
import { consumeFocusSel } from "./js/components/calendar.js";
import { setDomRender } from "./js/dom.js";
import { notifyJobEvent } from "./js/jobs.js";
import { configureRouter, render } from "./js/router.js";
import { clearCache, invalidateAll, invalidateForPath, setStoreUpdateHook } from "./js/store.js";
import { createSync } from "./js/sync.js";
import { initTheme } from "./js/theme.js";
import { choresView } from "./js/views/chores.js";
import { expensesView } from "./js/views/expenses.js";
import { homeView } from "./js/views/home.js";
import { mealsView } from "./js/views/meals.js";
import { pantryView } from "./js/views/pantry.js";
import { recipesView } from "./js/views/recipes.js";
import { createLoginView, createSettingsView } from "./js/views/settings.js";

const sync = createSync(
  () => render(),
  (paths) => {
    if (!paths || !paths.length) invalidateAll();
    else paths.forEach(invalidateForPath);
  },
  (msg) => notifyJobEvent(msg),
);

setDomRender(render);
setStoreUpdateHook(() => render());
setApiHooks({
  authLost: () => {
    clearCache();
    sync.disconnect();
    setTimeout(() => render(), 0);
  },
  notFoundWrite: (path) => {
    invalidateForPath(path);
    sync.refreshSoon(path);
  },
  mutation: (path) => invalidateForPath(path),
});

configureRouter({
  viewMap: {
    home: homeView,
    pantry: pantryView,
    meals: mealsView,
    recipes: recipesView,
    chores: choresView,
    expenses: expensesView,
    settings: createSettingsView(sync),
  },
  loginView: createLoginView(sync),
  sync,
  consumeFocusSel,
});

initTheme(() => {
  if ((location.hash || "").includes("settings")) render();
});

window.addEventListener("hashchange", () => {
  window.scrollTo(0, 0);
  render();
});

(async () => {
  try {
    const status = await api("/auth");
    if (status) setAuthState(status);
  } catch {
    /* offline handled in render */
  }
  const auth = getAuthState();
  if (!auth.required || auth.authenticated) sync.connect();
  render();
})();
