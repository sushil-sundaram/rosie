export const currentTheme = () => document.documentElement.dataset.theme || "system";

export function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem("rosie.theme", t);
  } catch {
    /* storage unavailable */
  }
  syncThemeColor();
}

const prefersLight = window.matchMedia("(prefers-color-scheme: light)");

/** The theme actually showing, with "system" resolved. */
export const effectiveTheme = () => (currentTheme() === "system" ? (prefersLight.matches ? "light" : "dark") : currentTheme());

export function syncThemeColor() {
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

export function initTheme(onToggle) {
  prefersLight.addEventListener("change", syncThemeColor);
  const btn = document.getElementById("theme-toggle");
  if (btn) {
    btn.addEventListener("click", () => {
      setTheme(effectiveTheme() === "light" ? "dark" : "light");
      if (onToggle) onToggle();
    });
  }
  syncThemeColor();
}
