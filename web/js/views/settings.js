import { api, getAuthState, setAuthState } from "../api.js";
import { fail, formData, h, segmented, toast } from "../dom.js";
import { CURRENCIES, getSettings, money, setSettings } from "../money.js";
import { render } from "../router.js";
import { clearCache } from "../store.js";
import { currentTheme, setTheme } from "../theme.js";

export function createLoginView(sync) {
  return function loginView(next) {
    const input = h("input", {
      type: "password", name: "password", placeholder: "Household passphrase",
      required: true, autocomplete: "current-password", "aria-label": "Household passphrase",
    });
    const btn = h("button.primary", { type: "submit" }, "Sign in");
    next.append(h("div.narrow",
      h("h1", "Sign in"),
      h("p.sub", "Enter the household passphrase to open Rosie"),
      h("form.row", {
        onsubmit: async (e) => {
          e.preventDefault();
          btn.disabled = true;
          try {
            await api("/auth/login", { method: "POST", body: { password: input.value } });
            setAuthState({ required: true, authenticated: true });
            sync.connect();
            render();
          } catch (err) {
            fail(err);
          } finally {
            btn.disabled = false;
          }
        },
      }, input, btn),
    ));
  };
}

export function createSettingsView(sync) {
  return async function settingsView(root) {
    const s = getSettings();
    const current = CURRENCIES.find((c) => c[0] === s.currency) || CURRENCIES[0];
    const auth = getAuthState();
    root.append(h("div.narrow",
      h("h1", "Settings"),
      h("p.sub", "Shared by everyone in the household"),
      h("h2", "Currency"),
      h("form.row", {
        onsubmit: async (e) => {
          e.preventDefault();
          const code = formData(e.target).currency;
          const [, locale] = CURRENCIES.find((c) => c[0] === code);
          try {
            await api("/settings", { method: "PUT", body: { currency: code, locale } });
            setSettings({ currency: code, locale });
            toast(`Currency set to ${code}`);
            render();
          } catch (err) {
            fail(err);
          }
        },
      },
        h("select", { name: "currency", "aria-label": "Currency" },
          CURRENCIES.map(([code, , name]) => h("option", { value: code, selected: code === current[0] }, `${code} — ${name}`))),
        h("button.primary", { type: "submit" }, "Save"),
      ),
      h("p.meta", `Preview: ${money(123456.5)}`),
      h("p.hint", "Only changes how amounts are shown; stored amounts are not converted"),
      h("h2", "Appearance"),
      segmented([["dark", "Dark"], ["light", "Light"], ["system", "Match system"]], currentTheme(), (t) => { setTheme(t); render(); }, "Theme"),
      h("p.hint", "Saved on this device only, so each person can pick their own"),
      auth.required ? [
        h("h2", "Session"),
        h("button", {
          type: "button",
          onclick: async () => {
            try {
              await api("/auth/logout", { method: "POST" });
              clearCache();
              setAuthState({ required: true, authenticated: false });
              sync.disconnect();
              toast("Signed out");
              render();
            } catch (err) {
              fail(err);
            }
          },
        }, "Sign out"),
      ] : null,
    ));
  };
}
