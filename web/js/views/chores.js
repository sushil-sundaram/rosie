import { fmtDay } from "../dates.js";
import { delBtn, eyebrow, h, list, section, segmented, store } from "../dom.js";
import { render } from "../router.js";
import { cached } from "../store.js";
import { cal, calendar, dragData, moveItem, split } from "../components/calendar.js";
import {
  chipLabel, choreForm, choreRow, ghostChip, priorityTag,
  projected, setChore, STATUS, STATUS_COLOR, STATUS_LABEL,
} from "../components/domain.js";

function board(chores) {
  return h("div.board", STATUS.map((key, i) => {
    const items = chores.filter((c) => c.status === key);
    return h("div.col",
      h("h3", h("span", { class: STATUS_COLOR[key] }, STATUS_LABEL[key]), h("span.c-muted", items.length)),
      items.length ? items.map((c) => h("div.card",
        h("div.title", c.title),
        h("div.meta", `${c.assigned_to} · ${c.points} pt${c.points === 1 ? "" : "s"}${c.due_date ? " · " + fmtDay(c.due_date) : ""} `, priorityTag(c.priority)),
        h("div.actions",
          h("button.icon", { onclick: () => setChore(c, { status: STATUS[i - 1] }), disabled: i === 0, "aria-label": "Move back" }, "←"),
          delBtn(`/chores/${c.id}`, c.title),
          h("button.icon", { onclick: () => setChore(c, { status: STATUS[i + 1] }), disabled: i === STATUS.length - 1, "aria-label": "Move forward" }, "→"),
        ),
      )) : h("p.empty", "—"),
    );
  }));
}

export async function choresView(root) {
  const chores = await cached("chores", "/chores");
  const mode = store.get("choresMode", "month");
  const setMode = (m) => {
    store.set("choresMode", m);
    render();
  };
  const done = chores.filter((c) => c.status === "done");

  const pts = {};
  for (const c of done) pts[c.assigned_to] = (pts[c.assigned_to] || 0) + c.points;
  const points = Object.keys(pts).length
    ? section("Points", list(Object.entries(pts).sort((a, b) => b[1] - a[1]), ([who, p]) => [h("span.grow", who), h("span.num.c-purple", p)]))
    : null;

  const head = h("div.view-head",
    eyebrow(`Chores · ${done.length} of ${chores.length} done`),
    segmented([["month", "Month"], ["board", "Board"]], mode, setMode, "Chores view"));

  if (mode === "board") {
    root.append(head, choreForm(null), board(chores), points);
    return;
  }

  const unscheduled = chores.filter((c) => !c.due_date);
  const ghosts = projected(chores);
  root.append(head, split(
    [
      calendar({
        chipsFor: (ds) => chores.filter((c) => c.due_date === ds).map((c) => ({
          label: chipLabel(c), cls: STATUS_COLOR[c.status], kind: "chore", id: c.id, done: c.status === "done",
          title: `${c.title} · ${c.assigned_to} · ${STATUS_LABEL[c.status]}`,
        })).concat(ghosts.filter((p) => p.date === ds).map(ghostChip)),
        onMove: moveItem,
        legend: [...STATUS.map((s) => [STATUS_LABEL[s], STATUS_COLOR[s]]), ["Upcoming repeat", "c-muted ghost"]],
      }),
      points,
    ],
    [
      list(chores.filter((c) => c.due_date === cal.sel), choreRow, "No chores this day"),
      h("h2", "Add chore"),
      choreForm(cal.sel),
      unscheduled.length ? section("Unscheduled",
        h("p.hint", "Drag onto a day, or → to put it on the selected day"),
        h("ul.list", unscheduled.map((c) => h("li", dragData("chore", c.id, ""),
          choreRow(c).slice(0, 2),
          h("button.icon", { title: `Schedule on ${fmtDay(cal.sel)}`, "aria-label": `Schedule ${c.title} on ${fmtDay(cal.sel)}`, onclick: () => setChore(c, { due_date: cal.sel }) }, "→"),
        )))) : null,
    ],
  ));
}
