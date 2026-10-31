/**
 * Statistical confidence label. It reflects how much data backs the estimate
 * and how far the model departs from an efficient-market consensus — not the
 * chance that the bet wins.
 */
export type Confidence = "low" | "medium" | "high";

export function confidenceLevel(opts: {
  minTeamSample: number; // effective (time-weighted) matches of the less-observed team
  requiredSample: number;
  modelProb: number;
  marketProb: number | null;
  bookmakers: number;
}): Confidence {
  const { minTeamSample, requiredSample, modelProb, marketProb, bookmakers } = opts;
  const gap = marketProb == null ? 0.2 : Math.abs(modelProb - marketProb);
  if (minTeamSample >= 2 * requiredSample && gap < 0.08 && bookmakers >= 3) return "high";
  if (minTeamSample >= requiredSample && gap < 0.15 && bookmakers >= 1) return "medium";
  return "low";
}

/** Approximate standard error of a probability estimated from n outcomes. */
export function probStdError(p: number, n: number): number {
  return n > 0 ? Math.sqrt((p * (1 - p)) / n) : 1;
}
