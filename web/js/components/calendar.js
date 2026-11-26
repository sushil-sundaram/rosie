import { api } from "../api.js";
import { addDays, fmtDay, iso, parseISO, today } from "../dates.js";
import { fail, h, toast } from "../dom.js";
import { render } from "../router.js";

// Month on screen and selected day — shared by every calendar view.
export const cal = (() => {
  const t = new Date();
  return { y: t.getFullYear(), m: t.getMonth(), sel: today() };
})();

let focusSel = false;

export function consumeFocusSel() {
  if (!focusSel) return false;
  focusSel = false;
  return true;
}

export const monthKey = () => `${cal.y}-${String(cal.m + 1).padStart(2, "0")}`;
export const inMonth = (d) => !!d && d.startsWith(monthKey());

export function gridRange(y = cal.y, m = cal.m) {
  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  const weeks = Math.ceil((lead + days) / 7);
  const start = new Date(y, m, 1 - lead);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + weeks * 7 - 1);
  return { from: iso(start), to: iso(end) };
}

export function shiftMonth(n) {
  const d = new Date(cal.y, cal.m + n, 1);
  cal.y = d.getFullYear();
  cal.m = d.getMonth();
}

export function shiftWeek(n) {
  selectDay(addDays(cal.sel, n * 7));
}

export function selectDay(ds, focus = false) {
  cal.sel = ds;
  const d = parseISO(ds);
  cal.y = d.getFullYear();
  cal.m = d.getMonth();
  focusSel = focus;
  render();
}

/** Attributes that make an element draggable onto a calendar day. */
export const dragData = (kind, id, from) => ({
  draggable: "true",
  ondragstart: (e) => {
    e.stopPropagation();
    e.dataTransfer.setData("text/plain", JSON.stringify({ kind, id, from }));
    e.dataTransfer.effectAllowed = "move";
  },
});

/** Drop or tap handler shared across views: reschedule a chore or meal. */
export async function moveItem(kind, id, date) {
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) return false;
  try {
    if (kind === "chore") await api(`/chores/${numId}`, { method: "PATCH", body: { due_date: date ?? "" } });
    else if (kind === "meal" && date) await api(`/meals/${numId}`, { method: "PATCH", body: { date } });
    else return false;
    toast(date ? `Moved to ${fmtDay(date)}` : "Unscheduled");
    render();
    return true;
  } catch (err) {
    fail(err);
    return false;
  }
}

/**
 * Month grid.
 *   chipsFor(date) -> [{ label, cls, kind?, id?, done?, title? }]
 *   onMove(kind, id, date) — when set, chips with an id can be dragged to another day.
 */
export function calendar({ chipsFor, onMove, legend }) {
  const first = new Date(cal.y, cal.m, 1);
  const lead = (first.getDay() + 6) % 7; // Monday-first
  const days = new Date(cal.y, cal.m + 1, 0).getDate();
  const weeks = Math.ceil((lead + days) / 7);
  const start = new Date(cal.y, cal.m, 1 - lead);
  const max = 3;

  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const ds = iso(d);
    const chips = chipsFor(ds);
    const cell = h("div.cell", {
      role: "gridcell",
      tabindex: ds === cal.sel ? "0" : "-1",
      "aria-selected": ds === cal.sel ? "true" : "false",
      "aria-label": fmtDay(ds) + (chips.length ? `, ${chips.length} item${chips.length > 1 ? "s" : ""}` : ""),
      class: [
        d.getMonth() !== cal.m && "out",
        ds === today() && "today",
        ds === cal.sel && "sel",
        (chips.length > max || chips.reduce((n, c) => n + c.label.length, 0) > 42) && "has-more",
      ].filter(Boolean).join(" ") || null,
      onclick: () => selectDay(ds),
      onkeydown: (e) => {
        const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
        if (step) {
          e.preventDefault();
          selectDay(addDays(ds, step), true);
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectDay(ds, true);
        }
      },
      ondragover: onMove ? (e) => { e.preventDefault(); cell.classList.add("drop"); } : null,
      ondragleave: onMove ? () => cell.classList.remove("drop") : null,
      ondrop: onMove ? (e) => {
        e.preventDefault();
        cell.classList.remove("drop");
        try {
          const data = JSON.parse(e.dataTransfer.getData("text/plain"));
          const id = data && Number(data.id);
          if (data && (data.kind === "chore" || data.kind === "meal") && Number.isInteger(id) && id > 0 && data.from !== ds) {
            onMove(data.kind, id, ds);
          }
        } catch {
          /* not ours */
        }
      } : null,
    },
      h("div.cell-inner",
        h("span.dn", d.getDate()),
        h("div.chips",
          chips.map((c, idx) => h("span.chip", {
            class: [c.cls, c.done && "done", idx >= max && "chip-extra"].filter(Boolean).join(" "),
            title: c.title || c.label,
            ...(onMove && c.id != null ? dragData(c.kind, c.id, ds) : {}),
          }, c.label)),
          chips.length > max ? h("span.more", `+${chips.length - max}`) : null,
        ),
      ),
    );
    cells.push(cell);
  }

  const title = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return h("section.cal",
    h("div.cal-head",
      h("h1", title),
      h("div.cal-nav",
        h("button.icon", { onclick: () => { shiftMonth(-1); render(); }, "aria-label": "Previous month" }, "←"),
        h("button.icon", { onclick: () => selectDay(today()) }, "Today"),
        h("button.icon", { onclick: () => { shiftMonth(1); render(); }, "aria-label": "Next month" }, "→"),
      ),
    ),
    h("div.cal-grid.dow", { "aria-hidden": "true" }, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => h("div", d))),
    h("div.cal-grid", { role: "grid", "aria-label": title }, cells),
    legend ? h("div.legend", legend.map(([label, cls]) => h("span", h("i", { class: cls }), label))) : null,
    onMove ? h("p.hint", "Drag items between days or tap Move · Arrow keys move selection") : null,
  );
}

/** Compact horizontal 7-day strip around the selected date for mobile agenda navigation. */
export function weekStrip({ chipsFor, extraNav = null }) {
  const selDate = parseISO(cal.sel);
  const lead = (selDate.getDay() + 6) % 7;
  const startDs = addDays(cal.sel, -lead);
  const title = selDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const days = [];
  for (let i = 0; i < 7; i++) {
    const ds = addDays(startDs, i);
    const d = parseISO(ds);
    const chips = chipsFor(ds);
    const cls = ["week-day", ds === today() && "today", ds === cal.sel && "sel"].filter(Boolean).join(" ");
    days.push(
      h(
        "button",
        {
          type: "button",
          class: cls,
          "aria-pressed": ds === cal.sel ? "true" : "false",
          "aria-label": fmtDay(ds) + (chips.length ? `, ${chips.length} item${chips.length > 1 ? "s" : ""}` : ""),
          onclick: () => selectDay(ds),
        },
        h("span.wd-dow", d.toLocaleDateString(undefined, { weekday: "short" })),
        h("span.wd-num", d.getDate()),
        h("span.wd-dots", chips.slice(0, 4).map((c) => h("i", { class: c.cls || "c-muted" }))),
      ),
    );
  }
  return h(
    "section.week-strip-wrap",
    h(
      "div.week-head",
      h("span.week-title", title),
      h(
        "div.week-actions",
        h("button.icon", { type: "button", onclick: () => shiftWeek(-1), "aria-label": "Previous week" }, "←"),
        h("button.icon", { type: "button", onclick: () => selectDay(today()) }, "Today"),
        h("button.icon", { type: "button", onclick: () => shiftWeek(1), "aria-label": "Next week" }, "→"),
        extraNav,
      ),
    ),
    h("div.week-strip", { role: "group", "aria-label": "Week days" }, days),
  );
}

/** Two-column layout: calendar + extras on the left, selected-day panel on the right. */
export function split(mainKids, panelKids, opts = {}) {
  const cls = ["split", opts.className].filter(Boolean).join(" ");
  return h("div", { class: cls },
    opts.mobileTop || null,
    h("div.main-col", mainKids),
    h("aside.panel", { "aria-label": `Selected day ${fmtDay(cal.sel)}` },
      h("div.panel-head",
        h("h3", fmtDay(cal.sel)),
        cal.sel === today() ? h("span.tag.c-pink", "Today") : null,
      ),
      panelKids,
    ),
  );
}
