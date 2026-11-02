/**
 * Time helpers. Every business rule in Kist runs on India Standard Time (UTC+05:30, no DST),
 * whatever time zone the server or the phone is set to.
 */

export const IST_OFFSET_MINUTES = 330;
const MS_PER_MIN = 60_000;
const MS_PER_DAY = 86_400_000;

export type ISODate = string; // YYYY-MM-DD

/** Wall-clock parts of a moment, as seen in India. */
export function istParts(at: Date) {
  const shifted = new Date(at.getTime() + IST_OFFSET_MINUTES * MS_PER_MIN);
  const hours = shifted.getUTCHours();
  const minutes = shifted.getUTCMinutes();
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hours,
    minutes,
    minuteOfDay: hours * 60 + minutes,
    weekday: shifted.getUTCDay(), // 0 = Sunday
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The calendar date in India for a moment, e.g. "2026-11-02". */
export function istDate(at: Date): ISODate {
  const p = istParts(at);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** A moment from an India date and wall-clock time. */
export function istDateTime(date: ISODate, hours: number, minutes = 0): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hours, minutes) - IST_OFFSET_MINUTES * MS_PER_MIN);
}

export function addDays(date: ISODate, days: number): ISODate {
  const [y, m, d] = date.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * MS_PER_DAY;
  const r = new Date(t);
  return `${r.getUTCFullYear()}-${pad(r.getUTCMonth() + 1)}-${pad(r.getUTCDate())}`;
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: ISODate, b: ISODate): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / MS_PER_DAY);
}

export function isISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Monday of the week containing the date (weeks run Monday to Sunday). */
export function weekStart(date: ISODate): ISODate {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const back = (weekday + 6) % 7;
  return addDays(date, -back);
}

/** "10:05 am" style time in India, for display. */
export function formatISTTime(at: Date, lang: "en" | "hi" = "en"): string {
  const { hours, minutes } = istParts(at);
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  if (lang === "hi") {
    const part = hours < 12 ? "सुबह" : hours < 16 ? "दोपहर" : hours < 19 ? "शाम" : "रात";
    return `${part} ${h12}:${pad(minutes)}`;
  }
  return `${h12}:${pad(minutes)} ${hours < 12 ? "am" : "pm"}`;
}

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_HI = ["जन", "फ़र", "मार्च", "अप्रै", "मई", "जून", "जुला", "अग", "सित", "अक्टू", "नव", "दिस"];

/** "5 Nov" / "5 नव" */
export function formatShortDate(date: ISODate, lang: "en" | "hi" = "en"): string {
  const [, m, d] = date.split("-").map(Number);
  return `${d} ${(lang === "hi" ? MONTHS_HI : MONTHS_EN)[m - 1]}`;
}
