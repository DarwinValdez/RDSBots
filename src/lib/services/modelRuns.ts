import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { walkForwardBacktest } from "@/lib/model/backtest";
import { eloExpected, fitElo, ELO_BASE, type EloRatings } from "@/lib/model/elo";
import { binaryGrid, type ScoreGrid } from "@/lib/model/grid";
import { fitRatings, matchGrid, type FittedModel, type HistoricalMatch } from "@/lib/model/ratings";
import { MODEL_VERSION, SPORTS, type SportKey } from "@/lib/sports";

export type EloModel = { family: "elo"; players: EloRatings; nMatches: number; asOf: string };
export type AnyModel = FittedModel | EloModel;

export type ModelRun = {
  id: number;
  sport_key: SportKey;
  league_id: number | null;
  model_version: string;
  params: Record<string, unknown>;
  ratings: AnyModel;
  n_matches: number;
  metrics: Record<string, unknown> | null;
  fitted_at: string;
};

/** Pages through a Supabase query (PostgREST caps responses at 1000 rows). */
export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>, max = 20_000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

type FinishedRow = { home_team_id: number; away_team_id: number; home_score: number; away_score: number; commence_time: string; is_neutral: boolean };

export async function loadHistory(db: SupabaseClient, sport: SportKey, leagueId: number | null, sinceDays: number): Promise<HistoricalMatch[]> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const rows = await fetchAll<FinishedRow>((from, to) => {
    let q = db
      .from("matches")
      .select("home_team_id, away_team_id, home_score, away_score, commence_time, is_neutral")
      .eq("sport_key", sport)
      .eq("status", "finished")
      .not("home_score", "is", null)
      .gte("commence_time", since)
      .order("commence_time", { ascending: true })
      .range(from, to);
    if (leagueId != null) q = q.eq("league_id", leagueId);
    return q;
  });
  return rows.map((r) => ({
    home: r.home_team_id,
    away: r.away_team_id,
    homeScore: r.home_score,
    awayScore: r.away_score,
    date: new Date(r.commence_time),
    neutral: r.is_neutral,
  }));
}

/** Fits and stores a model for one competition (or the whole sport for tennis). */
export async function fitAndStore(
  db: SupabaseClient,
  sport: SportKey,
  leagueId: number | null,
  opts: { halfLifeDays: number; withBacktest: boolean },
): Promise<ModelRun | null> {
  const cfg = SPORTS[sport];
  const history = await loadHistory(db, sport, leagueId, Math.max(730, opts.halfLifeDays * 4));
  const asOf = new Date();
  let ratings: AnyModel;
  let metrics: Record<string, unknown> | null = null;

  if (cfg.family === "elo") {
    if (history.length < 20) return null;
    const players = fitElo(
      history.filter((m) => m.homeScore !== m.awayScore).map((m) => ({
        winner: m.homeScore > m.awayScore ? m.home : m.away,
        loser: m.homeScore > m.awayScore ? m.away : m.home,
        date: m.date,
      })),
      asOf,
    );
    ratings = { family: "elo", players, nMatches: history.length, asOf: asOf.toISOString() };
  } else {
    if (history.length < 30) return null;
    ratings = fitRatings(history, { family: cfg.family, halfLifeDays: opts.halfLifeDays, asOf });
    if (opts.withBacktest) {
      const report = walkForwardBacktest(history, { family: cfg.family, halfLifeDays: opts.halfLifeDays, hasDraw: cfg.hasDraw });
      if (report) metrics = { backtest: report };
    }
  }

  const { data, error } = await db
    .from("model_runs")
    .insert({
      sport_key: sport,
      league_id: leagueId,
      model_version: MODEL_VERSION,
      params: { family: cfg.family, half_life_days: opts.halfLifeDays },
      ratings,
      n_matches: history.length,
      metrics,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as ModelRun;
}

export async function latestModelRun(db: SupabaseClient, sport: SportKey, leagueId: number | null): Promise<ModelRun | null> {
  let q = db.from("model_runs").select("*").eq("sport_key", sport).order("fitted_at", { ascending: false }).limit(1);
  q = sport === "tennis" || leagueId == null ? q.is("league_id", null) : q.eq("league_id", leagueId);
  const { data } = await q.maybeSingle();
  return (data as ModelRun) ?? null;
}

export type MatchModel = { grid: ScoreGrid; minTeamSample: number; expected: [number, number] | null; detail: Record<string, unknown> };

/** Score distribution for a fixture from a stored model run (null if a side lacks data). */
export function gridForMatch(run: ModelRun, sport: SportKey, homeId: number, awayId: number, neutral: boolean): MatchModel | null {
  const r = run.ratings;
  if (r.family === "elo") {
    const h = r.players[String(homeId)], a = r.players[String(awayId)];
    if (!h || !a) return null;
    const p = eloExpected(h.rating ?? ELO_BASE, a.rating ?? ELO_BASE);
    return { grid: binaryGrid(p), minTeamSample: Math.min(h.n, a.n), expected: null, detail: { eloHome: h.rating, eloAway: a.rating, nHome: h.n, nAway: a.n } };
  }
  const th = r.teams[String(homeId)], ta = r.teams[String(awayId)];
  if (!th || !ta) return null;
  const grid = matchGrid(r, homeId, awayId, neutral, !SPORTS[sport].hasDraw);
  if (!grid) return null;
  const expected: [number, number] = [
    (neutral ? Math.sqrt(r.muHome * r.muAway) : r.muHome) * th.att * ta.def,
    (neutral ? Math.sqrt(r.muHome * r.muAway) : r.muAway) * ta.att * th.def,
  ];
  return {
    grid,
    minTeamSample: Math.min(th.nEff, ta.nEff),
    expected,
    detail: {
      family: r.family,
      home: { attack: th.att, defence: th.def, matches: th.n, effectiveMatches: th.nEff },
      away: { attack: ta.att, defence: ta.def, matches: ta.n, effectiveMatches: ta.nEff },
      leagueHomeRate: r.muHome,
      leagueAwayRate: r.muAway,
      rho: r.rho,
      dispersion: r.dispersion,
      sd: r.sd,
      corr: r.corr,
    },
  };
}
