export const pad = (n) => String(n).padStart(2, "0");
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => iso(new Date());
export const parseISO = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (s, n) => {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};
export const fmtDay = (s) =>
  parseISO(s).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

/** Same rule as the server: monthly/yearly keep the anchor day, clamped to month end. */
export function nextDate(ds, repeat, anchor) {
  if (repeat === "weekly") return addDays(ds, 7);
  const d = parseISO(ds);
  const m = d.getMonth() + (repeat === "yearly" ? 12 : 1);
  const last = new Date(d.getFullYear(), m + 1, 0).getDate();
  return iso(new Date(d.getFullYear(), m, Math.min(anchor || d.getDate(), last)));
}
