/**
 * Trains the priority model (logistic regression) and writes src/lib/scoring/model-weights.json.
 *
 *   npm run model:train
 *
 * Training data is synthetic: the brief gives no loan history, so we generate 8,000 past
 * loan-days from a hidden behaviour model (scripts/sim/ground-truth.ts). In production this
 * script would read 12-24 months of the lender's own loan history instead.
 */
import { writeFileSync } from "node:fs";
import { FEATURE_NAMES, toFeatures, type ScoreInput } from "../src/lib/scoring/features";
import { createRng } from "./sim/rng";
import { sampleOutstanding, samplePaidRatio, trueRollLogit } from "./sim/ground-truth";

const rng = createRng(20261102);
const N = 8000;

function sampleDpd(): number {
  const r = rng.next();
  if (r < 0.7) return rng.int(1, 30);
  if (r < 0.92) return rng.int(31, 60);
  return rng.int(61, 90);
}

const rows: { x: number[]; y: number }[] = [];
for (let i = 0; i < N; i++) {
  const quality = rng.normal();
  const dpd = sampleDpd();
  const input: ScoreInput = {
    dpd,
    outstanding: sampleOutstanding(rng),
    brokenPromises90d: Math.min(3, rng.poisson(0.3 + 0.45 * Math.max(0, -quality))),
    paidRatio6m: rng.chance(0.08) ? null : samplePaidRatio(rng, quality),
    daysSinceLastPayment: rng.chance(0.2) ? rng.int(1, Math.max(dpd, 2)) : dpd + rng.int(20, 40),
    unreachable7d: Math.min(4, rng.poisson(0.3 + 0.35 * Math.max(0, -quality))),
    upcomingPromiseDate: rng.chance(0.25) ? "2026-01-01" : null,
  };
  const p = 1 / (1 + Math.exp(-(trueRollLogit(input, quality) + 0.3 * rng.normal())));
  rows.push({ x: toFeatures(input), y: rng.chance(p) ? 1 : 0 });
}

// Hold out 20% to measure how well the model ranks loans it has not seen.
const split = Math.floor(N * 0.8);
const train = rows.slice(0, split);
const holdout = rows.slice(split);
const d = FEATURE_NAMES.length;

const mean = Array.from({ length: d }, (_, j) => train.reduce((s, r) => s + r.x[j], 0) / train.length);
const std = Array.from({ length: d }, (_, j) => {
  const v = train.reduce((s, r) => s + (r.x[j] - mean[j]) ** 2, 0) / train.length;
  return Math.sqrt(v) || 1;
});
const z = (x: number[]) => x.map((v, j) => (v - mean[j]) / std[j]);
const trainZ = train.map((r) => ({ x: z(r.x), y: r.y }));

let w = new Array(d).fill(0);
let b = 0;
const lr = 0.2;
const l2 = 0.001;
for (let epoch = 0; epoch < 3000; epoch++) {
  const gw = new Array(d).fill(0);
  let gb = 0;
  for (const r of trainZ) {
    let s = b;
    for (let j = 0; j < d; j++) s += w[j] * r.x[j];
    const err = 1 / (1 + Math.exp(-s)) - r.y;
    for (let j = 0; j < d; j++) gw[j] += err * r.x[j];
    gb += err;
  }
  w = w.map((wj, j) => wj - lr * (gw[j] / trainZ.length + l2 * wj));
  b -= lr * (gb / trainZ.length);
}

function auc(scored: { p: number; y: number }[]): number {
  const sorted = [...scored].sort((a, c) => a.p - c.p);
  let rankSum = 0;
  let pos = 0;
  sorted.forEach((s, i) => {
    if (s.y === 1) {
      rankSum += i + 1;
      pos++;
    }
  });
  const neg = sorted.length - pos;
  return (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);
}

const holdoutScored = holdout.map((r) => {
  const x = z(r.x);
  let s = b;
  for (let j = 0; j < d; j++) s += w[j] * x[j];
  return { p: 1 / (1 + Math.exp(-s)), y: r.y };
});

const round = (v: number, n = 5) => Math.round(v * 10 ** n) / 10 ** n;
const out = {
  version: "v1-synthetic-2026-11",
  trainedOn: `${N} synthetic loan-days (seed 20261102); see scripts/train-model.ts`,
  features: [...FEATURE_NAMES],
  mean: mean.map((v) => round(v)),
  std: std.map((v) => round(v)),
  weights: w.map((v) => round(v)),
  bias: round(b),
  metrics: {
    auc: round(auc(holdoutScored), 3),
    n: train.length,
    holdoutN: holdout.length,
    positiveRate: round(rows.reduce((s, r) => s + r.y, 0) / N, 3),
  },
};

writeFileSync("src/lib/scoring/model-weights.json", JSON.stringify(out, null, 2) + "\n");
console.log("Weights written. Holdout AUC:", out.metrics.auc, "Positive rate:", out.metrics.positiveRate);
console.table(FEATURE_NAMES.map((f, j) => ({ feature: f, weight: out.weights[j] })));
