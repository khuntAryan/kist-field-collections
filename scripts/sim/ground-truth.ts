import { daysToNextBucket, type ScoreInput } from "../../src/lib/scoring/features";
import type { Rng } from "./rng";

/**
 * The hidden "true" borrower behaviour used to generate synthetic history.
 * The production model never sees this function; it only sees the data it produces.
 * `quality` is a latent trait (higher = more reliable) that the model cannot observe directly.
 */
export function trueRollLogit(input: ScoreInput, quality: number): number {
  const k = daysToNextBucket(input.dpd);
  const paid = input.paidRatio6m ?? 0.78 + 0.1 * quality;
  const months = (input.daysSinceLastPayment ?? input.dpd + 30) / 30;
  let z = -1.9;
  z += 1.7 * Math.exp(-k / 6);
  z += input.dpd >= 31 ? 0.55 : 0;
  z += 0.55 * Math.min(input.brokenPromises90d, 3);
  z -= 3.0 * (paid - 0.78);
  z += 0.35 * (Math.min(months, 6) - 1.5);
  z += 0.35 * Math.min(input.unreachable7d, 4);
  z += 0.3 * Math.log(input.outstanding / 500_000);
  z -= input.upcomingPromiseDate ? 0.8 : 0;
  z += input.brokenPromises90d >= 2 && input.unreachable7d >= 2 ? 0.6 : 0;
  z -= 0.35 * quality;
  return z;
}

export function sampleOutstanding(rng: Rng): number {
  const v = 400_000 * Math.exp(0.55 * rng.normal());
  return Math.round(Math.min(Math.max(v, 60_000), 2_000_000) / 1000) * 1000;
}

export function samplePaidRatio(rng: Rng, quality: number): number {
  const raw = 0.78 + 0.12 * quality + 0.1 * rng.normal();
  return Math.round(Math.min(Math.max(raw, 0), 1) * 6) / 6;
}
