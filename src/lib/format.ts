/** Money and number formatting in the Indian system (lakh, crore). */
const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export function formatINR(n: number): string {
  return `₹${inr.format(Math.round(n))}`;
}

/** ₹6.4 L / ₹6.4 लाख, ₹1.2 Cr / ₹1.2 करोड़ for large figures; plain rupees below a lakh. */
export function formatCompactINR(n: number, lang: "en" | "hi" = "en"): string {
  if (n >= 10_000_000) return `₹${trim(n / 10_000_000)} ${lang === "hi" ? "करोड़" : "Cr"}`;
  if (n >= 100_000) return `₹${trim(n / 100_000)} ${lang === "hi" ? "लाख" : "L"}`;
  return formatINR(n);
}

const trim = (v: number) => (Math.round(v * 10) / 10).toString();

export function formatPercent(v: number | null, digits = 1): string {
  return v === null ? "–" : `${(v * 100).toFixed(digits)}%`;
}

/** 98270 11223 shown as 98xxx xx223 in lists. */
export function maskPhone(p: string): string {
  return p.length === 10 ? `${p.slice(0, 2)}xxx xx${p.slice(7)}` : "xxxxx";
}
