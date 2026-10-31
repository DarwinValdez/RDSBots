/**
 * Joint score distributions. Every market (1X2, totals, spreads, BTTS) and
 * every same-event parlay is derived from one grid P(home = i, away = j), so
 * correlations between selections of the same event are exact, not assumed.
 */
export type ScoreGrid = {
  /** score represented by row/col index 0 */
  offsetH: number;
  offsetA: number;
  rows: number; // home scores
  cols: number; // away scores
  p: Float64Array; // row-major, sums to 1
  /** Regulation ties go to overtime/extra innings (no draw market). */
  noDraw: boolean;
};

export function cell(g: ScoreGrid, i: number, j: number): number {
  return g.p[i * g.cols + j];
}

export function forEachCell(g: ScoreGrid, fn: (h: number, a: number, p: number) => void) {
  for (let i = 0; i < g.rows; i++) {
    for (let j = 0; j < g.cols; j++) {
      const p = g.p[i * g.cols + j];
      if (p > 0) fn(i + g.offsetH, j + g.offsetA, p);
    }
  }
}

function normalize(p: Float64Array) {
  let s = 0;
  for (let k = 0; k < p.length; k++) s += p[k];
  if (s <= 0) throw new Error("Degenerate grid");
  for (let k = 0; k < p.length; k++) p[k] /= s;
}

function logFactorial(n: number): number {
  let s = 0;
  for (let k = 2; k <= n; k++) s += Math.log(k);
  return s;
}

export function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return Math.exp(k * Math.log(lambda) - lambda - logFactorial(k));
}

/** Negative binomial with mean mu and size k (var = mu + mu^2 / k). */
export function negBinPmf(x: number, mu: number, k: number): number {
  if (!Number.isFinite(k) || k <= 0) return poissonPmf(x, mu);
  const logCoef = lgamma(x + k) - lgamma(k) - logFactorial(x);
  return Math.exp(logCoef + k * Math.log(k / (k + mu)) + x * Math.log(mu / (k + mu)));
}

/** Lanczos approximation of ln Γ(z). */
export function lgamma(z: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Dixon–Coles low-score correction factor τ. */
export function dixonColesTau(h: number, a: number, lh: number, la: number, rho: number): number {
  if (h === 0 && a === 0) return 1 - lh * la * rho;
  if (h === 0 && a === 1) return 1 + lh * rho;
  if (h === 1 && a === 0) return 1 + la * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

/** Independent count model (Poisson or negative binomial) with optional Dixon–Coles. */
export function countGrid(opts: {
  lambdaHome: number;
  lambdaAway: number;
  rho?: number;
  dispersion?: number; // NB size k; Infinity / undefined → Poisson
  noDraw: boolean;
}): ScoreGrid {
  const { lambdaHome: lh, lambdaAway: la, rho = 0, dispersion } = opts;
  const pmf = (x: number, mu: number) => (dispersion ? negBinPmf(x, mu, dispersion) : poissonPmf(x, mu));
  const maxGoals = (mu: number) => Math.max(10, Math.ceil(mu + 8 * Math.sqrt(mu + (dispersion ? (mu * mu) / dispersion : 0))));
  const rows = maxGoals(lh) + 1;
  const cols = maxGoals(la) + 1;
  const ph = Array.from({ length: rows }, (_, i) => pmf(i, lh));
  const pa = Array.from({ length: cols }, (_, j) => pmf(j, la));
  const p = new Float64Array(rows * cols);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const tau = rho !== 0 ? dixonColesTau(i, j, lh, la, rho) : 1;
      p[i * cols + j] = Math.max(0, ph[i] * pa[j] * tau);
    }
  }
  normalize(p);
  return { offsetH: 0, offsetA: 0, rows, cols, p, noDraw: opts.noDraw };
}

function normPdf(x: number, mu: number, sd: number) {
  const z = (x - mu) / sd;
  return Math.exp(-0.5 * z * z);
}

/**
 * Discretised bivariate normal for high-scoring sports (NBA, NFL).
 * With equal marginal s.d. σ and correlation r, margin and total are
 * independent: var(M) = 2σ²(1−r), var(T) = 2σ²(1+r).
 */
export function normalGrid(opts: { muHome: number; muAway: number; sd: number; corr: number }): ScoreGrid {
  const { muHome, muAway, sd, corr } = opts;
  const sdM = Math.sqrt(2 * sd * sd * (1 - corr));
  const sdT = Math.sqrt(2 * sd * sd * (1 + corr));
  const span = Math.ceil(5 * sd);
  const offsetH = Math.max(0, Math.floor(muHome - span));
  const offsetA = Math.max(0, Math.floor(muAway - span));
  const rows = Math.ceil(muHome + span) - offsetH + 1;
  const cols = Math.ceil(muAway + span) - offsetA + 1;
  const p = new Float64Array(rows * cols);
  const muM = muHome - muAway;
  const muT = muHome + muAway;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const h = i + offsetH;
      const a = j + offsetA;
      p[i * cols + j] = normPdf(h - a, muM, sdM) * normPdf(h + a, muT, sdT);
    }
  }
  normalize(p);
  return { offsetH, offsetA, rows, cols, p, noDraw: true };
}

/** Two-outcome event (tennis): (1,0) = home/player 1 wins. */
export function binaryGrid(pHome: number): ScoreGrid {
  const p = new Float64Array(4);
  p[1 * 2 + 0] = pHome;
  p[0 * 2 + 1] = 1 - pHome;
  return { offsetH: 0, offsetA: 0, rows: 2, cols: 2, p, noDraw: true };
}

export function gridSummary(g: ScoreGrid) {
  let home = 0, draw = 0, away = 0, eh = 0, ea = 0;
  forEachCell(g, (h, a, p) => {
    if (h > a) home += p;
    else if (h < a) away += p;
    else draw += p;
    eh += h * p;
    ea += a * p;
  });
  return { home, draw, away, expectedHome: eh, expectedAway: ea };
}
