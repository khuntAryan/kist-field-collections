/**
 * Inputs the priority model looks at, and how they become the numeric features it was trained on.
 * Only DPD, payment history, promise history, contact history and amount are used, as the brief asks.
 */

export type ScoreInput = {
  dpd: number;
  outstanding: number; // rupees
  brokenPromises90d: number;
  paidRatio6m: number | null; // share of the last 6 EMIs paid on time; null = loan too new
  daysSinceLastPayment: number | null;
  unreachable7d: number; // "not reachable" outcomes in the last 7 days
  upcomingPromiseDate: string | null; // open promise dated today or later
};

export const FEATURE_NAMES = [
  "days_to_next_bucket",
  "dpd_scaled",
  "bucket_31_plus",
  "broken_promises_90d",
  "paid_ratio_6m",
  "months_since_payment",
  "unreachable_7d",
  "log_outstanding",
  "has_upcoming_promise",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];

/** DPD buckets roll over at 31, 61 and 91 days. */
export function nextBucketBoundary(dpd: number): number {
  return Math.floor((Math.max(dpd, 1) - 1) / 30) * 30 + 31;
}

export function daysToNextBucket(dpd: number): number {
  return nextBucketBoundary(dpd) - dpd;
}

/** Values used when a loan has no history yet. */
export const IMPUTE = { paidRatio6m: 0.75 };

export function toFeatures(input: ScoreInput): number[] {
  const dpd = Math.max(0, Math.min(input.dpd, 180));
  const paidRatio = input.paidRatio6m ?? IMPUTE.paidRatio6m;
  const sinceRaw = input.daysSinceLastPayment ?? dpd + 30;
  return [
    daysToNextBucket(dpd),
    dpd / 30,
    dpd >= 31 ? 1 : 0,
    Math.min(input.brokenPromises90d, 3),
    Math.max(0, Math.min(paidRatio, 1)),
    Math.min(sinceRaw, 180) / 30,
    Math.min(input.unreachable7d, 4),
    Math.log(Math.max(input.outstanding, 10_000) / 500_000),
    input.upcomingPromiseDate ? 1 : 0,
  ];
}
