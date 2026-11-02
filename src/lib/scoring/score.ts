import { daysToNextBucket, nextBucketBoundary, type ScoreInput } from "./features";
import { toFeatures } from "./features";
import { MODEL, logit, probabilityOfRoll, type ModelWeights } from "./model";

/**
 * Priority score, 0-100.
 *
 *   score = 100 x P(roll) x (0.6 + 0.4 x exposure)
 *   exposure = sqrt(outstanding / Rs 10 lakh), capped at 1
 *
 * Risk comes first; the amount at stake can move the score by up to 40%.
 * A Rs 10 lakh loan with a 70% chance of rolling scores 70; a Rs 2.5 lakh loan with
 * the same risk scores 56.
 */
export const EXPOSURE_FULL_AT = 1_000_000;

export function exposureFactor(outstanding: number): number {
  return Math.min(1, Math.sqrt(Math.max(outstanding, 0) / EXPOSURE_FULL_AT));
}

export function priorityScore(input: ScoreInput, model: ModelWeights = MODEL): number {
  const p = probabilityOfRoll(input, model);
  return Math.round(100 * p * (0.6 + 0.4 * exposureFactor(input.outstanding)));
}

/**
 * A typical overdue loan. Reasons explain how this loan differs from it.
 */
export const REFERENCE: ScoreInput = {
  dpd: 15,
  outstanding: 400_000,
  brokenPromises90d: 0,
  paidRatio6m: 0.8,
  daysSinceLastPayment: 45,
  unreachable7d: 0,
  upcomingPromiseDate: null,
};

export type ReasonKey =
  | "crossing_soon"
  | "dpd_high"
  | "dpd_low"
  | "broken_promises"
  | "poor_payment_history"
  | "good_payment_history"
  | "no_recent_payment"
  | "recent_payment"
  | "unreachable"
  | "high_exposure"
  | "small_exposure"
  | "upcoming_promise";

export type ScoreReason = {
  key: ReasonKey;
  /**
   * How strongly this factor pushes the score up (+) or down (-) compared with a typical
   * overdue loan, in log-odds. Roughly: 0.3 is a noticeable push, 1.0 a strong one.
   */
  effect: number;
  params: Record<string, string | number>;
};

export type ScoreResult = {
  score: number;
  pRoll: number;
  reasons: ScoreReason[];
  limitedHistory: boolean;
  modelVersion: string;
};

type Factor = keyof ScoreInput;
const FACTORS: Factor[] = [
  "dpd",
  "brokenPromises90d",
  "paidRatio6m",
  "daysSinceLastPayment",
  "unreachable7d",
  "outstanding",
  "upcomingPromiseDate",
];

const MIN_EFFECT = 0.12;

function describe(factor: Factor, input: ScoreInput, effect: number): ScoreReason | null {
  const up = effect > 0;
  switch (factor) {
    case "dpd": {
      const days = daysToNextBucket(input.dpd);
      if (up && days <= 7)
        return { key: "crossing_soon", effect, params: { days, next: nextBucketBoundary(input.dpd), dpd: input.dpd } };
      return { key: up ? "dpd_high" : "dpd_low", effect, params: { dpd: input.dpd } };
    }
    case "brokenPromises90d":
      return up ? { key: "broken_promises", effect, params: { n: input.brokenPromises90d } } : null;
    case "paidRatio6m": {
      if (input.paidRatio6m === null) return null;
      const paid = Math.round(input.paidRatio6m * 6);
      return { key: up ? "poor_payment_history" : "good_payment_history", effect, params: { paid } };
    }
    case "daysSinceLastPayment":
      if (input.daysSinceLastPayment === null) return null;
      return { key: up ? "no_recent_payment" : "recent_payment", effect, params: { days: input.daysSinceLastPayment } };
    case "unreachable7d":
      return up ? { key: "unreachable", effect, params: { n: input.unreachable7d } } : null;
    case "outstanding":
      return { key: up ? "high_exposure" : "small_exposure", effect, params: { amount: input.outstanding } };
    case "upcomingPromiseDate":
      return !up && input.upcomingPromiseDate
        ? { key: "upcoming_promise", effect, params: { date: input.upcomingPromiseDate } }
        : null;
  }
}

/**
 * Reasons by swapping: for each factor, put in the typical loan's value and measure how far
 * the model's log-odds move (plus the amount weighting, for outstanding). Log-odds are used
 * instead of the 0-100 score because the score flattens out near 100, which would hide the
 * reasons on exactly the riskiest loans. The three biggest movers are shown, risk-raising first.
 */
export function scoreLoan(input: ScoreInput, model: ModelWeights = MODEL): ScoreResult {
  const pRoll = probabilityOfRoll(input, model);
  const score = Math.round(100 * pRoll * (0.6 + 0.4 * exposureFactor(input.outstanding)));
  const z = logit(toFeatures(input), model);
  const weight = (o: number) => Math.log(0.6 + 0.4 * exposureFactor(o));

  const candidates: ScoreReason[] = [];
  for (const factor of FACTORS) {
    // A missing value cannot be a reason.
    if (input[factor] === null && factor !== "upcomingPromiseDate") continue;
    const swapped: ScoreInput = { ...input, [factor]: REFERENCE[factor] };
    let effect = z - logit(toFeatures(swapped), model);
    if (factor === "outstanding") effect += weight(input.outstanding) - weight(REFERENCE.outstanding);
    effect = Math.round(effect * 100) / 100;
    if (Math.abs(effect) < MIN_EFFECT) continue;
    const reason = describe(factor, input, effect);
    if (reason) candidates.push(reason);
  }

  const raising = candidates.filter((r) => r.effect > 0).sort((a, b) => b.effect - a.effect);
  const lowering = candidates.filter((r) => r.effect < 0).sort((a, b) => a.effect - b.effect);
  const reasons = [...raising, ...lowering].slice(0, 3);

  return {
    score,
    pRoll,
    reasons,
    limitedHistory: input.paidRatio6m === null,
    modelVersion: model.version,
  };
}

/** Officer list order: manager overrides first (by their rank), then score, then DPD. */
export function compareForList(
  a: { manualRank: number | null; score: number; dpd: number; id: string },
  b: { manualRank: number | null; score: number; dpd: number; id: string },
): number {
  if (a.manualRank !== null && b.manualRank !== null) return a.manualRank - b.manualRank;
  if (a.manualRank !== null) return -1;
  if (b.manualRank !== null) return 1;
  if (b.score !== a.score) return b.score - a.score;
  if (b.dpd !== a.dpd) return b.dpd - a.dpd;
  return a.id.localeCompare(b.id);
}
