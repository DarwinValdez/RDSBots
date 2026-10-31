import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cellOutcome, tieShareHome } from "@/lib/model/markets";
import { binaryGrid } from "@/lib/model/grid";
import { closingLineValue } from "@/lib/model/odds";
import { MODEL_VERSION, SPORTS, type SportKey } from "@/lib/sports";
import { logError } from "./logging";
import { MATCH_SELECT, loadLatestOdds, priceMatch, type MatchRow } from "./matchAnalysis";
import { fitAndStore, latestModelRun, type ModelRun } from "./modelRuns";
import { getSettings } from "./settings";
import { enabledLeagues } from "./sync";

/**
 * Refits models and records the official prediction for every main-line
 * selection of upcoming fixtures. Each selection is recorded once, before
 * kickoff; the database rejects later edits (see guard_predictions).
 */
export async function runPredictions(db: SupabaseClient) {
  const settings = await getSettings();
  const leagues = await enabledLeagues(db);
  const summary: Record<string, string | number> = {};

  // 1. fit models (one per league; one for all tennis)
  const runs = new Map<string, ModelRun | null>();
  const targets: { sport: SportKey; leagueId: number | null; label: string }[] = [];
  for (const l of leagues) if (l.sport_key !== "tennis") targets.push({ sport: l.sport_key, leagueId: l.id, label: l.name });
  if (leagues.some((l) => l.sport_key === "tennis")) targets.push({ sport: "tennis", leagueId: null, label: "Tenis (Elo)" });

  for (const t of targets) {
    try {
      const prev = await latestModelRun(db, t.sport, t.leagueId);
      const day = 86_400_000;
      const withBacktest = !prev?.metrics || Date.now() - new Date(prev.fitted_at).getTime() > day;
      const run = await fitAndStore(db, t.sport, t.leagueId, { halfLifeDays: settings.model.time_decay_half_life_days, withBacktest });
      // keep the previous backtest when it was not recomputed
      if (run && !run.metrics && prev?.metrics) run.metrics = prev.metrics;
      runs.set(`${t.sport}|${t.leagueId}`, run ?? prev);
      summary[`model ${t.label}`] = run ? `${run.n_matches} partidos` : "historial insuficiente";
    } catch (e) {
      summary[`model ${t.label}`] = `error: ${e instanceof Error ? e.message : String(e)}`;
      await logError("predict:fit", e, { target: t.label });
    }
  }

  // 2. record predictions for fixtures inside the window
  const now = new Date();
  const until = new Date(now.getTime() + settings.model.prediction_window_hours * 3600_000);
  const { data: upcoming } = await db
    .from("matches")
    .select(MATCH_SELECT)
    .eq("status", "scheduled")
    .gt("commence_time", new Date(now.getTime() + 5 * 60_000).toISOString())
    .lte("commence_time", until.toISOString())
    .not("odds_event_id", "is", null)
    .returns<MatchRow[]>();
  const matches = upcoming ?? [];
  const oddsMap = await loadLatestOdds(db, matches.map((m) => m.id));

  let recorded = 0, skipped = 0;
  for (const m of matches) {
    const odds = oddsMap.get(m.id) ?? [];
    if (!odds.length) continue;
    const run = runs.get(`${m.sport_key}|${m.sport_key === "tennis" ? null : m.league_id}`) ?? null;
    const priced = priceMatch(m, run, odds, settings);
    const rows = priced.selections
      .filter((s) => s.isMainLine && s.bestPrice != null && s.ev != null)
      .map((s) => ({
        match_id: m.id,
        sport_key: m.sport_key,
        market: s.market,
        selection: s.selection,
        line: s.line,
        model_prob: round(s.modelProb),
        market_prob: s.marketProb == null ? null : round(s.marketProb),
        final_prob: round(s.finalProb),
        best_price: s.bestPrice,
        bookmaker: s.bookmaker,
        implied_prob: round(s.impliedProb!),
        bookmaker_margin: s.bookmakerMargin == null ? null : round(s.bookmakerMargin),
        ev: round(s.ev!),
        edge: round(s.edge!),
        confidence: s.confidence,
        is_value: s.isValue,
        factors: { modelDetail: priced.model?.detail ?? null, expected: priced.model?.expected ?? null, bookmakers: s.bookmakers, pushProb: round(s.pushProb) },
        model_version: run?.model_version ?? MODEL_VERSION,
        model_run_id: run?.id ?? null,
        kickoff_at: m.commence_time,
      }));
    if (!rows.length) {
      skipped++;
      continue;
    }
    const { data: existing } = await db.from("predictions").select("market, selection, line").eq("match_id", m.id);
    const seen = new Set((existing ?? []).map((e) => `${e.market}|${e.selection}|${e.line ?? ""}`));
    const fresh = rows.filter((r) => !seen.has(`${r.market}|${r.selection}|${r.line ?? ""}`));
    if (!fresh.length) continue;
    const { error } = await db.from("predictions").insert(fresh);
    if (!error) recorded += fresh.length;
    else if (error.code !== "23505") await logError("predict:record", error.message, { match: m.id });
  }
  summary.fixtures = matches.length;
  summary.recorded = recorded;
  summary.without_model = skipped;
  return summary;
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;

type PendingRow = {
  id: number;
  match_id: number;
  market: string;
  selection: string;
  line: number | null;
  best_price: number;
  bookmaker: string;
  kickoff_at: string;
  closing_price: number | null;
};

/** Settles pending predictions of finished / cancelled events and records CLV. */
export async function settlePredictions(db: SupabaseClient) {
  const { data: pending } = await db
    .from("predictions")
    .select("id, match_id, market, selection, line, best_price, bookmaker, kickoff_at, closing_price")
    .eq("result", "pending")
    .lt("kickoff_at", new Date().toISOString())
    .limit(2000)
    .returns<PendingRow[]>();
  if (!pending?.length) return { settled: 0 };

  const ids = Array.from(new Set(pending.map((p) => p.match_id)));
  const { data: matches } = await db
    .from("matches")
    .select("id, sport_key, status, home_score, away_score, commence_time")
    .in("id", ids);
  const byId = new Map((matches ?? []).map((m) => [m.id, m]));
  let settled = 0, closing = 0;

  for (const p of pending) {
    const m = byId.get(p.match_id);
    if (!m) continue;
    try {
      // closing line: best price per selection in the last snapshot set before kickoff
      let closingPrice = p.closing_price;
      if (closingPrice == null) {
        closingPrice = await closingPriceFor(db, p);
        if (closingPrice != null) {
          await db.from("predictions").update({ closing_price: closingPrice, clv: round(closingLineValue(p.best_price, closingPrice)) }).eq("id", p.id);
          closing++;
        }
      }

      const hoursSince = (Date.now() - new Date(m.commence_time).getTime()) / 3600_000;
      if ((m.status === "cancelled" || m.status === "postponed") && hoursSince > 48) {
        await db.from("predictions").update({ result: "void", profit: 0, settled_at: new Date().toISOString() }).eq("id", p.id);
        settled++;
        continue;
      }
      if (m.status !== "finished" || m.home_score == null || m.away_score == null) continue;

      const sport = m.sport_key as SportKey;
      // settlement uses the actual final score; a tie in a no-draw sport can't be settled from the score alone
      const grid = binaryGrid(0.5);
      grid.noDraw = !SPORTS[sport].hasDraw;
      const bet = { market: p.market as never, selection: p.selection as never, line: p.line == null ? null : Number(p.line) };
      if (grid.noDraw && p.market === "h2h" && m.home_score === m.away_score) continue;
      const o = cellOutcome(bet, m.home_score, m.away_score, grid, tieShareHome(grid));
      const price = Number(p.best_price);
      let result: string, profit: number;
      if (o.win === 1) { result = "won"; profit = price - 1; }
      else if (o.push === 1) { result = "void"; profit = 0; }
      else if (o.halfWin === 1) { result = "half_won"; profit = (price - 1) / 2; }
      else if (o.halfLoss === 1) { result = "half_lost"; profit = -0.5; }
      else { result = "lost"; profit = -1; }
      const { error } = await db
        .from("predictions")
        .update({ result, profit: round(profit), settled_at: new Date().toISOString() })
        .eq("id", p.id)
        .eq("result", "pending");
      if (!error) settled++;
    } catch (e) {
      await logError("settle", e, { prediction: p.id });
    }
  }
  return { settled, closing_lines: closing, pending: pending.length };
}

async function closingPriceFor(db: SupabaseClient, p: PendingRow): Promise<number | null> {
  let q = db
    .from("odds_snapshots")
    .select("bookmaker, price, captured_at")
    .eq("match_id", p.match_id)
    .eq("market", p.market)
    .eq("selection", p.selection)
    .lte("captured_at", p.kickoff_at)
    .order("captured_at", { ascending: false })
    .limit(500);
  q = p.line == null ? q.is("line", null) : q.eq("line", p.line);
  const { data } = await q;
  if (!data?.length) return null;
  // latest price per bookmaker as of kickoff, then the best of them
  const latest = new Map<string, number>();
  for (const r of data) if (!latest.has(r.bookmaker)) latest.set(r.bookmaker, Number(r.price));
  return Math.max(...latest.values());
}
