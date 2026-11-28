import { fmtDay } from "../dates.js";
import { delBtn, eyebrow, h, list, section, segmented, store } from "../dom.js";
import { moneyShort } from "../money.js";
import { render } from "../router.js";
import { cached } from "../store.js";
import { cal, calendar, dragData, moveItem, split } from "../components/calendar.js";
import {
  chipLabel, choreCategoryTag, choreForm, choreRow, editBtn, ghostChip, moveBtn, openChoreEditModal, payBillBtn, priorityTag, projected, repeatTag, setChore, STATUS, STATUS_COLOR, STATUS_LABEL, syncMembers, choreMenu, choreDetails, STATUS_TONE,
} from "../components/domain.js";

function board(chores) {
  const tasks = chores.filter((c) => !c.amount);
  const bills = chores.filter((c) => c.amount);

  const taskBoard = h("div.board", STATUS.map((key, i) => {
    const items = tasks.filter((c) => c.status === key);
    return h("div.col",
      h("h3", h("span", { class: STATUS_COLOR[key] }, STATUS_LABEL[key]), h("span.c-muted", items.length)),
      items.length ? items.map((c) => h("div.card",
        h("div.spread", h("div.title", c.title), choreMenu(c)),
        h("div.meta", choreDetails(c, { withDate: true }), " ", priorityTag(c.priority)),
        h("div.actions",
          h("button.icon", { onclick: () => setChore(c, { status: STATUS[i - 1] }), disabled: i === 0, "aria-label": `Move ${c.title} back to ${STATUS_LABEL[STATUS[i - 1]] || ""}` }, "←"),
          h("button.icon", { onclick: () => setChore(c, { status: STATUS[i + 1] }), disabled: i === STATUS.length - 1, "aria-label": `Move ${c.title} on to ${STATUS_LABEL[STATUS[i + 1]] || ""}` }, "→"),
        ),
      )) : h("p.empty", "—"),
    );
  }));

  if (!bills.length) return taskBoard;

  const billCols = [
    ["Unpaid", "c-yellow", bills.filter((b) => b.status !== "done")],
    ["Paid", "c-green", bills.filter((b) => b.status === "done")],
  ];
  const billBoard = [
    h("h2", "Bills"),
    h("div.board.bills-board", billCols.map(([title, cls, items]) =>
      h("div.col",
        h("h3", h("span", { class: cls }, title), h("span.c-muted", items.length)),
        items.length ? items.map((c) => h("div.card",
          h("div.spread",
            h("span.title", c.title),
            h("span.num", moneyShort(c.amount)),
            choreMenu(c),
          ),
          h("div.meta", [c.category, choreDetails(c, { withDate: true })].filter(Boolean).join(" · ")),
          h("div.actions", payBillBtn(c)),
        )) : h("p.empty", "—"),
      ),
    )),
  ];

  return [taskBoard, billBoard];
}

export async function choresView(root) {
  const chores = await cached("chores", "/chores");
  syncMembers(chores);
  const mode = store.get("choresMode", "month");
  const setMode = (m) => {
    store.set("choresMode", m);
    render();
  };
  const done = chores.filter((c) => c.status === "done");

  const head = h("div.view-head",
    eyebrow(`Chores · ${done.length} of ${chores.length} done`),
    segmented([["month", "Month"], ["board", "Board"]], mode, setMode, "Chores view"));

  if (mode === "board") {
    root.append(head, choreForm(null), board(chores));
    return;
  }

  const unscheduled = chores.filter((c) => !c.due_date);
  const ghosts = projected(chores);
  root.append(head, split(
    [
      calendar({
        chipsFor: (ds) => chores.filter((c) => c.due_date === ds).map((c) => ({
          label: chipLabel(c), cls: c.amount ? "t-bill" : STATUS_TONE[c.status], kind: "chore", id: c.id, done: c.status === "done",
          title: `${c.title} · ${c.assigned_to} · ${STATUS_LABEL[c.status]}`,
        })).concat(ghosts.filter((p) => p.date === ds).map(ghostChip)),
        onMove: moveItem,
        legend: [...STATUS.map((s) => [STATUS_LABEL[s], STATUS_TONE[s]]), ["Bill", "t-bill"], ["Upcoming repeat", "t-chore ghost"]],
      }),
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
