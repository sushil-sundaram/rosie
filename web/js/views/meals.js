import { api } from "../api.js";
import { delBtn, eyebrow, h } from "../dom.js";
import { cal, calendar, inMonth, moveItem, split } from "../components/calendar.js";
import { bySlot, mealForm, SLOT_COLOR, SLOTS } from "../components/domain.js";

export async function mealsView(root) {
  const [meals, recipes] = await Promise.all([api("/meals"), api("/recipes")]);
  const day = meals.filter((m) => m.date === cal.sel).sort(bySlot);
  root.append(eyebrow(`meals · ${meals.filter((m) => inMonth(m.date)).length} planned this month`), split(
    [calendar({
      chipsFor: (ds) => meals.filter((m) => m.date === ds).sort(bySlot)
        .map((m) => ({ label: m.title, cls: SLOT_COLOR[m.slot], kind: "meal", id: m.id, title: `${m.slot}: ${m.title}` })),
      onMove: moveItem,
      legend: SLOTS.map((s) => [s, SLOT_COLOR[s]]),
    })],
    [
      SLOTS.map((s) => {
        const items = day.filter((m) => m.slot === s);
        return h("div.slot",
          h("span.tag", { class: SLOT_COLOR[s] }, s),
          items.length ? h("ul.list", items.map((m) => h("li", h("span.grow.title", m.title), delBtn(`/meals/${m.id}`, m.title)))) : h("p.empty", "—"));
      }),
      h("h2", "add meal"),
      mealForm(cal.sel, recipes),
    ],
  ));
}
