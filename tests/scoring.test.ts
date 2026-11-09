import { describe, expect, it } from "vitest";
import { scoreLoan, priorityScore, compareForList, exposureFactor } from "@/lib/scoring/score";
import { daysToNextBucket, nextBucketBoundary, type ScoreInput } from "@/lib/scoring/features";
import { MODEL } from "@/lib/scoring/model";
import { reasonText } from "@/lib/i18n";

const base: ScoreInput = {
  dpd: 15,
  outstanding: 400_000,
  brokenPromises90d: 0,
  paidRatio6m: 0.8,
  daysSinceLastPayment: 45,
  unreachable7d: 0,
  upcomingPromiseDate: null,
};

describe("DPD buckets", () => {
  it("knows the next roll-over day", () => {
    expect(nextBucketBoundary(1)).toBe(31);
    expect(nextBucketBoundary(30)).toBe(31);
    expect(nextBucketBoundary(31)).toBe(61);
    expect(daysToNextBucket(27)).toBe(4);
  });
});

describe("priority score", () => {
  it("stays between 0 and 100", () => {
    const worst = { ...base, dpd: 29, brokenPromises90d: 3, paidRatio6m: 0, daysSinceLastPayment: 180, unreachable7d: 4, outstanding: 2_000_000 };
    const best = { ...base, dpd: 1, paidRatio6m: 1, daysSinceLastPayment: 5, upcomingPromiseDate: "2026-11-05", outstanding: 60_000 };
    for (const s of [priorityScore(worst), priorityScore(best)]) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
    expect(priorityScore(worst)).toBeGreaterThan(priorityScore(best) + 40);
  });

  it("rises when a promise is broken", () => {
    expect(priorityScore({ ...base, brokenPromises90d: 1 })).toBeGreaterThan(priorityScore(base));
  });

  it("rises as the loan nears 30 DPD", () => {
    expect(priorityScore({ ...base, dpd: 28 })).toBeGreaterThan(priorityScore({ ...base, dpd: 10 }));
  });

  it("falls when the borrower has an upcoming promise", () => {
    expect(priorityScore({ ...base, upcomingPromiseDate: "2026-11-05" })).toBeLessThan(priorityScore(base));
  });

  it("gives bigger loans more weight at the same risk", () => {
    expect(exposureFactor(1_000_000)).toBe(1);
    expect(exposureFactor(250_000)).toBeCloseTo(0.5);
  });

  it("was trained well enough to rank loans", () => {
    expect(MODEL.metrics.auc).toBeGreaterThan(0.7);
  });
});

describe("top three reasons", () => {
  it("explains a risky loan with the factors that raise its score most", () => {
    const r = scoreLoan({ ...base, dpd: 27, brokenPromises90d: 2, unreachable7d: 3 });
    expect(r.reasons.length).toBe(3);
    expect(r.reasons.every((x) => x.effect > 0)).toBe(true);
    const keys = r.reasons.map((x) => x.key);
    expect(keys).toContain("broken_promises");
    expect(keys).toContain("crossing_soon");
    // sorted strongest first
    expect(r.reasons[0].effect).toBeGreaterThanOrEqual(r.reasons[1].effect);
  });

  it("names what lowers the score when little raises it", () => {
    const r = scoreLoan({ ...base, dpd: 3, upcomingPromiseDate: "2026-11-05", paidRatio6m: 1 });
    expect(r.reasons.some((x) => x.effect < 0)).toBe(true);
    expect(r.reasons.map((x) => x.key)).toContain("upcoming_promise");
  });

  it("flags limited history instead of inventing a payment-history reason", () => {
    const r = scoreLoan({ ...base, paidRatio6m: null });
    expect(r.limitedHistory).toBe(true);
    expect(r.reasons.map((x) => x.key)).not.toContain("poor_payment_history");
  });

  it("never shows more than three reasons", () => {
    const r = scoreLoan({ ...base, dpd: 29, brokenPromises90d: 3, paidRatio6m: 0, daysSinceLastPayment: 150, unreachable7d: 4, outstanding: 1_800_000 });
    expect(r.reasons.length).toBe(3);
  });
});

describe("list order", () => {
  it("puts manager overrides first, then score", () => {
    const items = [
      { id: "LN-1", manualRank: null, score: 90, dpd: 10 },
      { id: "LN-2", manualRank: 1, score: 20, dpd: 3 },
      { id: "LN-3", manualRank: null, score: 95, dpd: 2 },
    ];
    expect(items.sort(compareForList).map((i) => i.id)).toEqual(["LN-2", "LN-3", "LN-1"]);
  });
});

describe("reason wording", () => {
  it("uses the singular for one day and one time", () => {
    expect(reasonText({ key: "crossing_soon", params: { next: 31, days: 1 } }, "en")).toBe("Crosses 31 DPD in 1 day");
    expect(reasonText({ key: "crossing_soon", params: { next: 61, days: 4 } }, "en")).toBe("Crosses 61 DPD in 4 days");
    expect(reasonText({ key: "unreachable", params: { n: 1 } }, "en")).toBe("Not reachable 1 time this week");
    expect(reasonText({ key: "crossing_soon", params: { next: 31, days: 1 } }, "hi")).toBe("1 दिन में 31 DPD पार होगा");
  });
});
