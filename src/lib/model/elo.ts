/**
 * Elo ratings for individual sports (tennis). Uses a decaying K-factor
 * (K = 250 / (n + 5)^0.4), the form popularised for tennis Elo, so new
 * players move quickly and established ratings stabilise.
 */
export type EloMatch = { winner: number; loser: number; date: Date };
export type EloRatings = Record<string, { rating: number; n: number }>;

export const ELO_BASE = 1500;

export function eloExpected(ra: number, rb: number): number {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

export function fitElo(matches: EloMatch[], asOf: Date): EloRatings {
  const r: EloRatings = {};
  const get = (id: number) => (r[String(id)] ??= { rating: ELO_BASE, n: 0 });
  const sorted = matches.filter((m) => m.date < asOf).sort((a, b) => a.date.getTime() - b.date.getTime());
  for (const m of sorted) {
    const w = get(m.winner);
    const l = get(m.loser);
    const e = eloExpected(w.rating, l.rating);
    const kw = 250 / Math.pow(w.n + 5, 0.4);
    const kl = 250 / Math.pow(l.n + 5, 0.4);
    w.rating += kw * (1 - e);
    l.rating -= kl * (1 - e);
    w.n += 1;
    l.n += 1;
  }
  return r;
}
