/**
 * Team strength model fitted on historical results.
 *
 *   E[home score] = μH · att(home) · def(away)
 *   E[away score] = μA · att(away) · def(home)
 *
 * Fitted by weighted iterative proportional fitting (the Maher / Poisson MLE
 * fixed point) with exponential time decay and shrinkage toward the league
 * average. Distribution parameters (Dixon–Coles ρ, negative-binomial size,
 * or normal σ/correlation) are then estimated from the weighted residuals.
 */
import { countGrid, dixonColesTau, normalGrid, poissonPmf, type ScoreGrid } from "./grid";

export type HistoricalMatch = {
  home: number; // team id
  away: number;
  homeScore: number;
  awayScore: number;
  date: Date;
  neutral?: boolean;
};

export type Family = "poisson_dc" | "negbin" | "normal";

export type TeamRating = { att: number; def: number; n: number; nEff: number };

export type FittedModel = {
  family: Family;
  muHome: number;
  muAway: number;
  teams: Record<string, TeamRating>;
  rho: number; // Dixon–Coles (poisson_dc)
  dispersion: number | null; // NB size (negbin); null = Poisson
  sd: number; // normal
  corr: number; // normal
  nMatches: number;
  halfLifeDays: number;
  asOf: string;
};

export type FitOptions = {
  family: Family;
  halfLifeDays: number;
  asOf: Date;
  /** pseudo-matches pulling each team toward average strength */
  shrinkage?: number;
  iterations?: number;
};

const DAY = 86_400_000;

export function fitRatings(history: HistoricalMatch[], opts: FitOptions): FittedModel {
  const { family, halfLifeDays, asOf } = opts;
  const shrink = opts.shrinkage ?? 2;
  const iters = opts.iterations ?? 60;
  const ms = history.filter((m) => m.date < asOf && Number.isFinite(m.homeScore) && Number.isFinite(m.awayScore));
  if (ms.length < 10) throw new Error("Not enough historical matches to fit the model");

  const w = ms.map((m) => Math.pow(0.5, (asOf.getTime() - m.date.getTime()) / DAY / halfLifeDays));
  const ids = Array.from(new Set(ms.flatMap((m) => [m.home, m.away])));
  const att = new Map<number, number>(ids.map((id) => [id, 1]));
  const def = new Map<number, number>(ids.map((id) => [id, 1]));

  const sumW = w.reduce((a, b) => a + b, 0);
  let muH = ms.reduce((s, m, k) => s + w[k] * m.homeScore, 0) / sumW;
  let muA = ms.reduce((s, m, k) => s + w[k] * m.awayScore, 0) / sumW;
  const neutralMu = () => Math.sqrt(muH * muA);
  const mu = (m: HistoricalMatch, side: "h" | "a") => (m.neutral ? neutralMu() : side === "h" ? muH : muA);

  for (let it = 0; it < iters; it++) {
    // attack
    const scored = new Map<number, number>(), expA = new Map<number, number>();
    ms.forEach((m, k) => {
      add(scored, m.home, w[k] * m.homeScore);
      add(expA, m.home, w[k] * mu(m, "h") * def.get(m.away)!);
      add(scored, m.away, w[k] * m.awayScore);
      add(expA, m.away, w[k] * mu(m, "a") * def.get(m.home)!);
    });
    for (const id of ids) {
      // shrink toward 1: pseudo-observations at league-average rate
      att.set(id, ((scored.get(id) ?? 0) + shrink * avgRate()) / ((expA.get(id) ?? 0) + shrink * avgRate()));
    }
    // defence
    const conceded = new Map<number, number>(), expD = new Map<number, number>();
    ms.forEach((m, k) => {
      add(conceded, m.away, w[k] * m.homeScore);
      add(expD, m.away, w[k] * mu(m, "h") * att.get(m.home)!);
      add(conceded, m.home, w[k] * m.awayScore);
      add(expD, m.home, w[k] * mu(m, "a") * att.get(m.away)!);
    });
    for (const id of ids) {
      def.set(id, ((conceded.get(id) ?? 0) + shrink * avgRate()) / ((expD.get(id) ?? 0) + shrink * avgRate()));
    }
    // identifiability: geometric means of att and def = 1
    renorm(att);
    renorm(def);
    // base rates
    let nh = 0, dh = 0, na = 0, da = 0;
    ms.forEach((m, k) => {
      if (m.neutral) return;
      nh += w[k] * m.homeScore;
      dh += w[k] * att.get(m.home)! * def.get(m.away)!;
      na += w[k] * m.awayScore;
      da += w[k] * att.get(m.away)! * def.get(m.home)!;
    });
    if (dh > 0) muH = nh / dh;
    if (da > 0) muA = na / da;
  }

  function avgRate() {
    return (muH + muA) / 2;
  }

  const counts = new Map<number, { n: number; nEff: number }>();
  ms.forEach((m, k) => {
    for (const id of [m.home, m.away]) {
      const c = counts.get(id) ?? { n: 0, nEff: 0 };
      c.n += 1;
      c.nEff += w[k];
      counts.set(id, c);
    }
  });

  const teams: Record<string, TeamRating> = {};
  for (const id of ids) {
    teams[String(id)] = { att: att.get(id)!, def: def.get(id)!, ...(counts.get(id) ?? { n: 0, nEff: 0 }) };
  }

  const model: FittedModel = {
    family,
    muHome: muH,
    muAway: muA,
    teams,
    rho: 0,
    dispersion: null,
    sd: 0,
    corr: 0,
    nMatches: ms.length,
    halfLifeDays,
    asOf: asOf.toISOString(),
  };

  const expected = ms.map((m) => expectedScores(model, m.home, m.away, !!m.neutral)!);

  if (family === "poisson_dc") {
    model.rho = fitDixonColesRho(ms, expected, w);
  } else if (family === "negbin") {
    // method of moments on weighted residuals: var = μ + μ²/k
    let num = 0, den = 0;
    ms.forEach((m, k) => {
      const [eh, ea] = expected[k];
      num += w[k] * ((m.homeScore - eh) ** 2 - eh + (m.awayScore - ea) ** 2 - ea);
      den += w[k] * (eh * eh + ea * ea);
    });
    const invK = num / den;
    model.dispersion = invK > 0.005 ? 1 / invK : null;
  } else {
    let ssH = 0, ssA = 0, cross = 0;
    ms.forEach((m, k) => {
      const [eh, ea] = expected[k];
      const rh = m.homeScore - eh, ra = m.awayScore - ea;
      ssH += w[k] * rh * rh;
      ssA += w[k] * ra * ra;
      cross += w[k] * rh * ra;
    });
    const varH = ssH / sumW, varA = ssA / sumW;
    model.sd = Math.sqrt((varH + varA) / 2);
    model.corr = clamp(cross / sumW / Math.sqrt(varH * varA), -0.5, 0.8);
  }
  return model;
}

export function expectedScores(model: FittedModel, home: number, away: number, neutral = false): [number, number] | null {
  const h = model.teams[String(home)];
  const a = model.teams[String(away)];
  if (!h || !a) return null;
  const muH = neutral ? Math.sqrt(model.muHome * model.muAway) : model.muHome;
  const muA = neutral ? Math.sqrt(model.muHome * model.muAway) : model.muAway;
  return [muH * h.att * a.def, muA * a.att * h.def];
}

export function matchGrid(model: FittedModel, home: number, away: number, neutral: boolean, noDraw: boolean): ScoreGrid | null {
  const e = expectedScores(model, home, away, neutral);
  if (!e) return null;
  const [lh, la] = e;
  switch (model.family) {
    case "poisson_dc":
      return countGrid({ lambdaHome: lh, lambdaAway: la, rho: model.rho, noDraw });
    case "negbin":
      return countGrid({ lambdaHome: lh, lambdaAway: la, dispersion: model.dispersion ?? undefined, noDraw });
    case "normal":
      return normalGrid({ muHome: lh, muAway: la, sd: model.sd, corr: model.corr });
  }
}

function fitDixonColesRho(ms: HistoricalMatch[], expected: [number, number][], w: number[]): number {
  let best = 0, bestLL = -Infinity;
  for (let rho = -0.2; rho <= 0.1001; rho += 0.005) {
    let ll = 0;
    let ok = true;
    ms.forEach((m, k) => {
      const [lh, la] = expected[k];
      const tau = dixonColesTau(m.homeScore, m.awayScore, lh, la, rho);
      if (tau <= 0) ok = false;
      ll += w[k] * (Math.log(Math.max(tau, 1e-12)) + Math.log(poissonPmf(m.homeScore, lh)) + Math.log(poissonPmf(m.awayScore, la)));
    });
    if (ok && ll > bestLL) {
      bestLL = ll;
      best = rho;
    }
  }
  return Math.round(best * 1000) / 1000;
}

function add(m: Map<number, number>, k: number, v: number) {
  m.set(k, (m.get(k) ?? 0) + v);
}

function renorm(m: Map<number, number>) {
  const vals = Array.from(m.values());
  const g = Math.exp(vals.reduce((s, v) => s + Math.log(v), 0) / vals.length);
  for (const [k, v] of m) m.set(k, v / g);
}

function clamp(x: number, lo: number, hi: number) {
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : 0;
}
