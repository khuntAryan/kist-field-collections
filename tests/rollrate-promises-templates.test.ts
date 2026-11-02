import { describe, expect, it } from "vitest";
import { computeRollRate, nearestOnOrBefore } from "@/lib/roll-rate";
import { evaluatePromise } from "@/lib/promises";
import { choosePurpose, findBlockedPhrases, renderTemplate } from "@/lib/templates";

describe("roll rate", () => {
  it("counts 1-30 DPD loans that reached 31+ DPD", () => {
    const start = [
      { loanId: "A", dpd: 12, branchId: "IDR" },
      { loanId: "B", dpd: 27, branchId: "IDR" },
      { loanId: "C", dpd: 5, branchId: "PTP" },
      { loanId: "D", dpd: 45, branchId: "PTP" }, // not in the 1-30 cohort
    ];
    const end = [
      { loanId: "B", dpd: 57, branchId: "IDR" }, // rolled
      { loanId: "C", dpd: 20, branchId: "PTP" }, // still 1-30 after a new miss
      { loanId: "D", dpd: 75, branchId: "PTP" },
      // A paid up and left the file: not rolled
    ];
    const r = computeRollRate(start, end);
    expect(r.overall).toEqual({ cohort: 3, rolled: 1, rate: 1 / 3 });
    expect(r.byBranch.IDR.rate).toBe(0.5);
    expect(r.byBranch.PTP.rate).toBe(0);
  });
  it("returns no rate for an empty cohort rather than 0%", () => {
    expect(computeRollRate([], []).overall.rate).toBeNull();
  });
  it("uses the latest snapshot on or before a date", () => {
    expect(nearestOnOrBefore(["2026-10-01", "2026-10-03"], "2026-10-02")).toBe("2026-10-01");
    expect(nearestOnOrBefore(["2026-10-03"], "2026-10-02")).toBeNull();
  });
});

describe("promise to pay", () => {
  const p = { madeOn: "2026-10-28", promisedDate: "2026-10-31", amount: 20000 };
  it("is broken when the date passes without payment (LN-11930 in the brief)", () => {
    expect(evaluatePromise(p, [], "2026-11-02")).toBe("broken");
  });
  it("is still open on the promised day", () => {
    expect(evaluatePromise(p, [], "2026-10-31")).toBe("open");
  });
  it("is kept when payments reach 90% by the date", () => {
    expect(evaluatePromise(p, [{ date: "2026-10-30", amount: 18000 }], "2026-11-02")).toBe("kept");
  });
  it("does not count a payment made after the promised date", () => {
    expect(evaluatePromise(p, [{ date: "2026-11-01", amount: 20000 }], "2026-11-02")).toBe("broken");
  });
});

describe("reminder drafts", () => {
  it("picks the template for the situation", () => {
    const base = { today: "2026-11-02", tomorrow: "2026-11-03", promiseBroken: false };
    expect(choosePurpose({ ...base, promisedDate: "2026-11-03" })).toBe("promise_tomorrow");
    expect(choosePurpose({ ...base, promisedDate: "2026-11-02" })).toBe("promise_today");
    expect(choosePurpose({ ...base, promisedDate: null, promiseBroken: true })).toBe("promise_broken");
    expect(choosePurpose({ ...base, promisedDate: null })).toBe("overdue_reminder");
  });
  it("fills placeholders and refuses to send a template with a missing value", () => {
    expect(renderTemplate("Namaste {name}, EMI {amount}", { name: "Company B", amount: "₹21,000" })).toBe("Namaste Company B, EMI ₹21,000");
    expect(() => renderTemplate("{name} {date}", { name: "x" })).toThrow("{date}");
  });
  it("blocks threatening and shaming language in English, Hindi and Hinglish", () => {
    expect(findBlockedPhrases("Pay today or we will call the police")).toEqual(["police"]);
    expect(findBlockedPhrases("हम आपके पड़ोसी को बताएंगे")).toContain("पड़ोसी");
    expect(findBlockedPhrases("warna dekh lenge")).toContain("dekh lenge");
  });
  it("does not block innocent words that contain a blocked word", () => {
    expect(findBlockedPhrases("Your firm's EMI of ₹21,000 is due")).toEqual([]);
  });
});
