// Household settings, loaded from the server before the first render.
let settings = { currency: "INR", locale: "en-IN" };

export function getSettings() {
  return settings;
}

export function setSettings(next) {
  settings = { ...settings, ...next };
}

export const CURRENCIES = [
  ["INR", "en-IN", "Indian rupee"], ["USD", "en-US", "US dollar"], ["EUR", "en-IE", "Euro"],
  ["GBP", "en-GB", "British pound"], ["AED", "en-AE", "UAE dirham"], ["SGD", "en-SG", "Singapore dollar"],
  ["AUD", "en-AU", "Australian dollar"], ["CAD", "en-CA", "Canadian dollar"], ["JPY", "ja-JP", "Japanese yen"],
];

export const CATEGORIES = ["Groceries", "Utilities", "Household", "Dining", "Entertainment", "Transportation", "Health", "Other"];
export const CAT_COLOR = {
  Groceries: "c-green", Utilities: "c-cyan", Household: "c-purple", Dining: "c-orange",
  Entertainment: "c-pink", Transportation: "c-yellow", Health: "c-red", Other: "c-muted",
};

export const money = (n, digits) => {
  try {
    return (Number(n) || 0).toLocaleString(settings.locale, {
      style: "currency",
      currency: settings.currency,
      ...(digits != null ? { minimumFractionDigits: digits, maximumFractionDigits: digits } : {}),
    });
  } catch {
    return `${settings.currency} ${(Number(n) || 0).toFixed(2)}`;
  }
};

/** Whole-unit amount for tight spaces (calendar chips, stats). */
export const moneyShort = (n) => money(Math.round(Number(n) || 0), 0);

/** Rounds to cents: 1.1 + 2.2 must equal 3.3 when comparing spend with a budget. */
export const cents = (n) => Math.round((Number(n) || 0) * 100);

export const fmtQty = (n) => (Number.isInteger(n) ? n : Number(n).toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));
