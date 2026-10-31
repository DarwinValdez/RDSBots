/**
 * Walk-forward validation: refit every `refitDays` using only matches that
 * happened before, forecast the following window, and score the forecasts.
 * A naive base-rate forecaster is scored on the same matches as a benchmark.
 */
import { betOutcomeProbs, type Selection } from "./markets";
import { brierScore, calibrationBins, expectedCalibrationError, logLoss, type Forecast } from "./metrics";
import { fitRatings, matchGrid, type Family, type HistoricalMatch } from "./ratings";

export type BacktestReport = {
  matchesEvaluated: number;
  model: { brier: number; logLoss: number; ece: number };
  baseline: { brier: number; logLoss: number };
  skillVsBaseline: number; // 1 − brier_model / brier_baseline
  calibration: ReturnType<typeof calibrationBins>;
  from: string | null;
  to: string | null;
};

const DAY = 86_400_000;

export function walkForwardBacktest(
  history: HistoricalMatch[],
  opts: { family: Family; halfLifeDays: number; hasDraw: boolean; minTrain?: number; refitDays?: number; minTeamMatches?: number },
): BacktestReport | null {
  const sorted = [...history].sort((a, b) => a.date.getTime() - b.date.getTime());
  const minTrain = opts.minTrain ?? Math.max(60, Math.floor(sorted.length * 0.4));
  const refitDays = opts.refitDays ?? 7;
  const minTeam = opts.minTeamMatches ?? 5;
  if (sorted.length < minTrain + 20) return null;

  const outcomes: Selection[] = opts.hasDraw ? ["home", "draw", "away"] : ["home", "away"];
  const model: Forecast[] = [];
  const base: Forecast[] = [];
  let idx = minTrain;
  let first: Date | null = null, last: Date | null = null;

  while (idx < sorted.length) {
    const asOf = sorted[idx].date;
    const windowEnd = new Date(asOf.getTime() + refitDays * DAY);
    const train = sorted.slice(0, idx);
    let fitted;
    try {
      fitted = fitRatings(train, { family: opts.family, halfLifeDays: opts.halfLifeDays, asOf, iterations: 30 });
    } catch {
      break;
    }
    const rates = baseRates(train, opts.hasDraw);
    while (idx < sorted.length && sorted[idx].date < windowEnd) {
      const m = sorted[idx++];
      const th = fitted.teams[String(m.home)], ta = fitted.teams[String(m.away)];
      if (!th || !ta || th.n < minTeam || ta.n < minTeam) continue;
      const grid = matchGrid(fitted, m.home, m.away, !!m.neutral, !opts.hasDraw);
      if (!grid) continue;
      const actual = m.homeScore > m.awayScore ? "home" : m.homeScore < m.awayScore ? "away" : opts.hasDraw ? "draw" : null;
      if (!actual) continue; // regulation tie in a no-draw sport: winner unknown from the score
      first ??= m.date;
      last = m.date;
      for (const sel of outcomes) {
        const p = betOutcomeProbs(grid, { market: "h2h", selection: sel, line: null }).win;
        model.push({ prob: p, outcome: sel === actual ? 1 : 0 });
        base.push({ prob: rates[sel] ?? 0, outcome: sel === actual ? 1 : 0 });
      }
    }
  }
  if (model.length < 30) return null;
  const bins = calibrationBins(model);
  const bModel = brierScore(model), bBase = brierScore(base);
  return {
    matchesEvaluated: model.length / outcomes.length,
    model: { brier: bModel, logLoss: logLoss(model), ece: expectedCalibrationError(bins) },
    baseline: { brier: bBase, logLoss: logLoss(base) },
    skillVsBaseline: 1 - bModel / bBase,
    calibration: bins,
    from: first?.toISOString() ?? null,
    to: last?.toISOString() ?? null,
  };
}

function baseRates(ms: HistoricalMatch[], hasDraw: boolean): Partial<Record<Selection, number>> {
  let h = 0, d = 0, a = 0;
  for (const m of ms) {
    if (m.homeScore > m.awayScore) h++;
    else if (m.homeScore < m.awayScore) a++;
    else d++;
  }
  if (!hasDraw) {
    const n = h + a || 1;
    return { home: h / n, away: a / n };
  }
  const n = h + d + a || 1;
  return { home: h / n, draw: d / n, away: a / n };
}
