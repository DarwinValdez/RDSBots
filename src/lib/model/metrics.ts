/** Scoring rules and calibration diagnostics for probabilistic forecasts. */
export type Forecast = { prob: number; outcome: 0 | 1 };

export function brierScore(fs: Forecast[]): number {
  if (!fs.length) return NaN;
  return fs.reduce((s, f) => s + (f.prob - f.outcome) ** 2, 0) / fs.length;
}

export function logLoss(fs: Forecast[]): number {
  if (!fs.length) return NaN;
  return (
    -fs.reduce((s, f) => {
      const p = Math.min(Math.max(f.prob, 1e-9), 1 - 1e-9);
      return s + (f.outcome ? Math.log(p) : Math.log(1 - p));
    }, 0) / fs.length
  );
}

export type CalibrationBin = { lo: number; hi: number; n: number; meanPred: number; observed: number };

export function calibrationBins(fs: Forecast[], bins = 10): CalibrationBin[] {
  const out: CalibrationBin[] = Array.from({ length: bins }, (_, i) => ({
    lo: i / bins, hi: (i + 1) / bins, n: 0, meanPred: 0, observed: 0,
  }));
  for (const f of fs) {
    const b = out[Math.min(bins - 1, Math.floor(f.prob * bins))];
    b.n++;
    b.meanPred += f.prob;
    b.observed += f.outcome;
  }
  for (const b of out) {
    if (b.n) {
      b.meanPred /= b.n;
      b.observed /= b.n;
    }
  }
  return out;
}

/** Expected calibration error (weighted mean |pred − observed|). */
export function expectedCalibrationError(bins: CalibrationBin[]): number {
  const n = bins.reduce((s, b) => s + b.n, 0);
  return n ? bins.reduce((s, b) => s + (b.n / n) * Math.abs(b.meanPred - b.observed), 0) : NaN;
}
