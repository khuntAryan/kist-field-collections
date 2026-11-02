import { FEATURE_NAMES, toFeatures, type ScoreInput } from "./features";
import weights from "./model-weights.json";

/**
 * Logistic regression: the probability that a loan rolls into the next DPD bucket
 * within 30 days if nothing changes. Weights are produced by scripts/train-model.ts.
 */
export type ModelWeights = {
  version: string;
  trainedOn: string;
  features: string[];
  mean: number[];
  std: number[];
  weights: number[];
  bias: number;
  metrics: { auc: number; n: number; positiveRate: number; holdoutN: number };
};

export const MODEL: ModelWeights = weights as ModelWeights;

if (MODEL.features.join(",") !== FEATURE_NAMES.join(",")) {
  throw new Error("model-weights.json does not match FEATURE_NAMES. Re-run npm run model:train.");
}

export const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export function logit(features: number[], model: ModelWeights = MODEL): number {
  let z = model.bias;
  for (let i = 0; i < features.length; i++) {
    const std = model.std[i] || 1;
    z += model.weights[i] * ((features[i] - model.mean[i]) / std);
  }
  return z;
}

export function probabilityOfRoll(input: ScoreInput, model: ModelWeights = MODEL): number {
  return sigmoid(logit(toFeatures(input), model));
}
