import { num, str } from "./market";

const inr = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const qty = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 4 });
const dateTime = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const timeOnly = new Intl.DateTimeFormat("en-IN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** 1,23,456.78 */
export function price(value: unknown) {
  const n = num(value);
  return n === null ? "—" : inr.format(n);
}

/** ₹1,23,456.78 */
export function rupees(value: unknown) {
  const n = num(value);
  if (n === null) return "—";
  return `${n < 0 ? "\u2212" : ""}₹${inr.format(Math.abs(n))}`;
}

/** +1,234.50 / -1,234.50 */
export function signedPrice(value: unknown) {
  const n = num(value);
  if (n === null) return "—";
  return `${n > 0 ? "+" : n < 0 ? "\u2212" : ""}${inr.format(Math.abs(n))}`;
}

/** +1.23% */
export function percent(value: unknown) {
  const n = num(value);
  if (n === null) return "—";
  return `${n > 0 ? "+" : n < 0 ? "\u2212" : ""}${Math.abs(n).toFixed(2)}%`;
}

export function quantity(value: unknown) {
  const n = num(value);
  return n === null ? "—" : qty.format(n);
}

export function stamp(value: unknown) {
  const d = new Date(str(value));
  return Number.isNaN(d.getTime()) ? "—" : dateTime.format(d);
}

export function clock(value: unknown) {
  const d = new Date(typeof value === "number" ? value : str(value));
  return Number.isNaN(d.getTime()) ? "—" : timeOnly.format(d);
}

export function tone(value: unknown) {
  const n = num(value);
  return n === null || n === 0 ? "" : n > 0 ? "up" : "down";
}

export function titleCase(value: string) {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
