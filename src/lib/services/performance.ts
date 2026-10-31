import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { brierScore, calibrationBins, expectedCalibrationError, logLoss, type Forecast } from "@/lib/model/metrics";
import { fetchAll } from "./modelRuns";

export type PredictionRow = {
  id: number;
  match_id: number;
  sport_key: string;
  market: string;
  selection: string;
  line: number | null;
  final_prob: number;
  model_prob: number;
  best_price: number;
  bookmaker: string;
  ev: number;
  edge: number;
  confidence: string;
  is_value: boolean;
  kickoff_at: string;
  created_at: string;
  result: string;
  closing_price: number | null;
  clv: number | null;
  profit: number | null;
  settled_at: string | null;
};

export type PerformanceSummary = {
  recorded: number;
  settled: number;
  pending: number;
  bets: number; // settled excluding void
  wins: number;
  winRate: number | null;
  profit: number;
  turnover: number;
  yield: number | null;
  roi: number | null;
  avgOdds: number | null;
  avgClv: number | null;
  positiveClvShare: number | null;
  brier: number | null;
  logLoss: number | null;
  ece: number | null;
  calibration: ReturnType<typeof calibrationBins>;
  cumulative: { date: string; profit: number; bets: number }[];
  bySport: { sport: string; bets: number; profit: number; yield: number | null }[];
  byMarket: { market: string; bets: number; profit: number; yield: number | null }[];
};

export function summarize(rows: PredictionRow[], bankrollUnits: number, onlyValue: boolean): PerformanceSummary {
  const all = onlyValue ? rows.filter((r) => r.is_value) : rows;
  const settled = all.filter((r) => r.result !== "pending");
  const bets = settled.filter((r) => r.result !== "void");
  const wins = bets.filter((r) => r.result === "won" || r.result === "half_won").length;
  const profit = bets.reduce((s, r) => s + Number(r.profit ?? 0), 0);
  const turnover = bets.length; // flat 1-unit stakes
  const clvs = all.map((r) => r.clv).filter((x): x is number => x != null).map(Number);

  const forecasts: Forecast[] = bets
    .filter((r) => r.result === "won" || r.result === "lost")
    .map((r) => ({ prob: Number(r.final_prob), outcome: r.result === "won" ? 1 : 0 }));
  const bins = calibrationBins(forecasts);

  const sorted = [...bets].sort((a, b) => (a.settled_at ?? "").localeCompare(b.settled_at ?? ""));
  const cumulative: PerformanceSummary["cumulative"] = [];
  let run = 0;
  sorted.forEach((r, i) => {
    run += Number(r.profit ?? 0);
    const date = (r.settled_at ?? r.kickoff_at).slice(0, 10);
    const last = cumulative[cumulative.length - 1];
    if (last && last.date === date) {
      last.profit = run;
      last.bets = i + 1;
    } else cumulative.push({ date, profit: run, bets: i + 1 });
  });

  const group = (key: (r: PredictionRow) => string) => {
    const m = new Map<string, { bets: number; profit: number }>();
    for (const r of bets) {
      const g = m.get(key(r)) ?? { bets: 0, profit: 0 };
      g.bets++;
      g.profit += Number(r.profit ?? 0);
      m.set(key(r), g);
    }
    return Array.from(m.entries()).map(([k, v]) => ({ key: k, ...v, yield: v.bets ? v.profit / v.bets : null }));
  };

  return {
    recorded: all.length,
    settled: settled.length,
    pending: all.length - settled.length,
    bets: bets.length,
    wins,
    winRate: bets.length ? wins / bets.length : null,
    profit,
    turnover,
    yield: turnover ? profit / turnover : null,
    roi: bankrollUnits ? profit / bankrollUnits : null,
    avgOdds: bets.length ? bets.reduce((s, r) => s + Number(r.best_price), 0) / bets.length : null,
    avgClv: clvs.length ? clvs.reduce((a, b) => a + b, 0) / clvs.length : null,
    positiveClvShare: clvs.length ? clvs.filter((c) => c > 0).length / clvs.length : null,
    brier: forecasts.length ? brierScore(forecasts) : null,
    logLoss: forecasts.length ? logLoss(forecasts) : null,
    ece: forecasts.length ? expectedCalibrationError(bins) : null,
    calibration: bins,
    cumulative,
    bySport: group((r) => r.sport_key).map(({ key, ...v }) => ({ sport: key, ...v })),
    byMarket: group((r) => r.market).map(({ key, ...v }) => ({ market: key, ...v })),
  };
}

export async function loadPredictions(db: SupabaseClient, opts: { sport?: string; sinceDays?: number } = {}) {
  const since = new Date(Date.now() - (opts.sinceDays ?? 365) * 86_400_000).toISOString();
  return fetchAll<PredictionRow>((from, to) => {
    let q = db.from("predictions").select("*").gte("kickoff_at", since).order("kickoff_at", { ascending: false }).range(from, to);
    if (opts.sport) q = q.eq("sport_key", opts.sport);
    return q;
  });
}
