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

export function shiftMonth(n) {
  const d = new Date(cal.y, cal.m + n, 1);
  cal.y = d.getFullYear();
  cal.m = d.getMonth();
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

/** Drop handler shared by every calendar: reschedule a chore or meal. */
export async function moveItem(kind, id, date) {
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) return;
  try {
    if (kind === "chore") await api(`/chores/${numId}`, { method: "PATCH", body: { due_date: date } });
    else if (kind === "meal") await api(`/meals/${numId}`, { method: "PATCH", body: { date } });
    else return;
    toast(`moved to ${fmtDay(date)}`);
    render();
  } catch (err) {
    fail(err);
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
      class: [d.getMonth() !== cal.m && "out", ds === today() && "today", ds === cal.sel && "sel"].filter(Boolean).join(" ") || null,
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
      h("span.dn", d.getDate()),
      h("div.chips",
        chips.slice(0, max).map((c) => h("span.chip", {
          class: [c.cls, c.done && "done"].filter(Boolean).join(" "),
          title: c.title || c.label,
          ...(onMove && c.id != null ? dragData(c.kind, c.id, ds) : {}),
        }, c.label)),
        chips.length > max ? h("span.more", `+${chips.length - max}`) : null,
      ),
    );
    cells.push(cell);
  }

  const title = first.toLocaleDateString(undefined, { month: "long", year: "numeric" }).toLowerCase();
  return h("section.cal",
    h("div.cal-head",
      h("h1", title),
      h("div.cal-nav",
        h("button.icon", { onclick: () => { shiftMonth(-1); render(); }, "aria-label": "previous month" }, "←"),
        h("button.icon", { onclick: () => selectDay(today()) }, "today"),
        h("button.icon", { onclick: () => { shiftMonth(1); render(); }, "aria-label": "next month" }, "→"),
      ),
    ),
    h("div.cal-grid.dow", { "aria-hidden": "true" }, ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => h("div", d))),
    h("div.cal-grid", { role: "grid", "aria-label": title }, cells),
    legend ? h("div.legend", legend.map(([label, cls]) => h("span", h("i", { class: cls }), label))) : null,
    onMove ? h("p.hint", "drag items between days to reschedule · arrow keys move the selection") : null,
  );
}

/** Two-column layout: calendar + extras on the left, selected-day panel on the right. */
export function split(mainKids, panelKids) {
  return h("div.split",
    h("div.main-col", mainKids),
    h("aside.panel", { "aria-label": `selected day ${fmtDay(cal.sel)}` },
      h("div.panel-head",
        h("h3", fmtDay(cal.sel)),
        cal.sel === today() ? h("span.tag.c-pink", "today") : null,
      ),
      panelKids,
    ),
  );
}
