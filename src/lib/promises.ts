/**
 * Promise-to-pay evaluation.
 * Kept: payments between the day the promise was made and the promised date add up to at
 * least 90% of the promised amount. Broken: the promised date has passed without that.
 */
export type PromiseState = "open" | "kept" | "broken";
export const KEPT_THRESHOLD = 0.9;

export function evaluatePromise(
  promise: { madeOn: string; promisedDate: string; amount: number },
  payments: { date: string; amount: number }[],
  today: string,
): PromiseState {
  const paid = payments
    .filter((p) => p.date >= promise.madeOn && p.date <= promise.promisedDate)
    .reduce((s, p) => s + p.amount, 0);
  if (paid >= promise.amount * KEPT_THRESHOLD) return "kept";
  return today > promise.promisedDate ? "broken" : "open";
}

/** Promise dates an officer can pick: tomorrow up to 30 days ahead. */
export const MAX_PROMISE_DAYS = 30;
