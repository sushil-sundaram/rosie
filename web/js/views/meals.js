import { delBtn, eyebrow, h } from "../dom.js";
import { cached } from "../store.js";
import { cal, calendar, gridRange, inMonth, monthKey, moveItem, split } from "../components/calendar.js";
import { bySlot, mealForm, moveBtn, SLOT_COLOR, SLOTS } from "../components/domain.js";

const SLOT_LABEL = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };

export async function mealsView(root) {
  const { from, to } = gridRange();
  const win = monthKey();
  const [meals, recipes] = await Promise.all([
    cached(`meals:${win}`, `/meals?from=${from}&to=${to}`),
    cached("recipes", "/recipes"),
  ]);
  const day = meals.filter((m) => m.date === cal.sel).sort(bySlot);
  root.append(eyebrow(`Meals · ${meals.filter((m) => inMonth(m.date)).length} planned this month`), split(
    [calendar({
      chipsFor: (ds) => meals.filter((m) => m.date === ds).sort(bySlot)
        .map((m) => ({ label: m.title, cls: SLOT_COLOR[m.slot], kind: "meal", id: m.id, title: `${SLOT_LABEL[m.slot] || m.slot}: ${m.title}` })),
      onMove: moveItem,
      legend: SLOTS.map((s) => [SLOT_LABEL[s] || s, SLOT_COLOR[s]]),
    })],
    [
      SLOTS.map((s) => {
        const items = day.filter((m) => m.slot === s);
        return h("div.slot",
          h("span.tag", { class: SLOT_COLOR[s] }, SLOT_LABEL[s] || s),
          items.length ? h("ul.list", items.map((m) => h("li", h("span.grow.title", m.title), moveBtn("meal", m.id, m.title, m.date), delBtn(`/meals/${m.id}`, m.title)))) : h("p.empty", "—"));
      }),
      h("h2", "Add meal"),
      mealForm(cal.sel, recipes),
    ],
  ));
}
