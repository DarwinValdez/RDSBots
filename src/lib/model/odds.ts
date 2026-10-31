/** Bookmaker price utilities (decimal odds). */

export function impliedProb(price: number): number {
  return 1 / price;
}

/** Bookmaker margin (overround) of a complete market: Σ 1/price − 1. */
export function overround(prices: number[]): number {
  return prices.reduce((s, p) => s + 1 / p, 0) - 1;
}

export function devigProportional(prices: number[]): number[] {
  const inv = prices.map((p) => 1 / p);
  const s = inv.reduce((a, b) => a + b, 0);
  return inv.map((x) => x / s);
}

/**
 * Shin (1993) de-vig: models the margin as protection against insiders and
 * corrects the favourite–longshot bias better than proportional scaling.
 */
export function devigShin(prices: number[]): number[] {
  const pi = prices.map((p) => 1 / p);
  const sum = pi.reduce((a, b) => a + b, 0);
  if (sum <= 1 || prices.length < 2) return devigProportional(prices);
  const probsFor = (z: number) =>
    pi.map((p) => (Math.sqrt(z * z + 4 * (1 - z) * (p * p) / sum) - z) / (2 * (1 - z)));
  let lo = 0, hi = 0.4;
  for (let it = 0; it < 100; it++) {
    const z = (lo + hi) / 2;
    const s = probsFor(z).reduce((a, b) => a + b, 0);
    if (s > 1) lo = z;
    else hi = z;
  }
  const probs = probsFor((lo + hi) / 2);
  const s = probs.reduce((a, b) => a + b, 0);
  return probs.map((p) => p / s);
}

export function logit(p: number): number {
  const q = Math.min(Math.max(p, 1e-6), 1 - 1e-6);
  return Math.log(q / (1 - q));
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Logarithmic opinion pool of the model and the de-vigged market consensus.
 * weight = share given to the market (0 → pure model).
 */
export function blendProb(model: number, market: number | null, weight: number): number {
  if (market == null || weight <= 0) return model;
  if (weight >= 1) return market;
  return sigmoid((1 - weight) * logit(model) + weight * logit(market));
}

/** Closing line value: how much better the taken price was than the close. */
export function closingLineValue(takenPrice: number, closingPrice: number): number {
  return takenPrice / closingPrice - 1;
}
