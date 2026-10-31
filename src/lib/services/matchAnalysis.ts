import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { priceSelections, type OddsRow, type PricedSelection } from "@/lib/model/engine";
import { gridSummary } from "@/lib/model/grid";
import { tieShareHome } from "@/lib/model/markets";
import type { Market } from "@/lib/model/markets";
import { SPORTS, type SportKey } from "@/lib/sports";
import { fetchAll, gridForMatch, latestModelRun, type ModelRun } from "./modelRuns";
import type { Settings } from "./settings";

export type MatchRow = {
  id: number;
  sport_key: SportKey;
  league_id: number | null;
  home_team_id: number;
  away_team_id: number;
  commence_time: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  is_neutral: boolean;
  venue: string | null;
  round: string | null;
  provider_fixture_id: string | null;
  home: { id: number; name: string; logo_url: string | null } | null;
  away: { id: number; name: string; logo_url: string | null } | null;
  league: { id: number; name: string; provider_league_id: number | null; current_season: string | null } | null;
};

export const MATCH_SELECT =
  "id, sport_key, league_id, home_team_id, away_team_id, commence_time, status, home_score, away_score, is_neutral, venue, round, provider_fixture_id, home:teams!matches_home_team_id_fkey(id, name, logo_url), away:teams!matches_away_team_id_fkey(id, name, logo_url), league:leagues(id, name, provider_league_id, current_season)";

export type FormLine = {
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  scored: number;
  conceded: number;
  avgScored: number | null;
  avgConceded: number | null;
  sequence: string; // e.g. "WWDLW", most recent first
};

export type TeamFeatures = {
  last5: FormLine;
  last10: FormLine;
  venueForm: FormLine; // home form for home side, away form for away side
  restDays: number | null;
  matchesLast14Days: number;
};

export type MatchAnalysis = {
  match: MatchRow;
  model: {
    available: boolean;
    reason?: string;
    runId?: number;
    fittedAt?: string;
    version?: string;
    expectedScore?: [number, number] | null;
    outcome?: { home: number; draw: number; away: number };
    detail?: Record<string, unknown>;
    backtest?: unknown;
  };
  selections: PricedSelection[];
  oddsAvailable: boolean;
  features: { home: TeamFeatures; away: TeamFeatures; headToHead: { date: string; home: string; away: string; score: string }[] };
  /** soccer only, fetched on demand; null = not available */
  injuries?: { team: string; player: string; type: string; reason: string }[] | null;
  lineMovement: { market: Market; selection: string; line: number | null; opening: number; current: number; changePct: number; snapshots: number }[];
};

type ResultRow = { home_team_id: number; away_team_id: number; home_score: number; away_score: number; commence_time: string };

function form(rows: ResultRow[], teamId: number, n: number, hasDraw: boolean): FormLine {
  const last = rows.slice(0, n);
  const f: FormLine = { matches: last.length, wins: 0, draws: 0, losses: 0, scored: 0, conceded: 0, avgScored: null, avgConceded: null, sequence: "" };
  for (const r of last) {
    const home = r.home_team_id === teamId;
    const gf = home ? r.home_score : r.away_score;
    const ga = home ? r.away_score : r.home_score;
    f.scored += gf;
    f.conceded += ga;
    if (gf > ga) { f.wins++; f.sequence += "W"; }
    else if (gf < ga) { f.losses++; f.sequence += "L"; }
    else { f.draws++; f.sequence += hasDraw ? "D" : "T"; }
  }
  if (last.length) {
    f.avgScored = f.scored / last.length;
    f.avgConceded = f.conceded / last.length;
  }
  return f;
}

async function teamResults(db: SupabaseClient, teamId: number, before: string): Promise<ResultRow[]> {
  const { data } = await db
    .from("matches")
    .select("home_team_id, away_team_id, home_score, away_score, commence_time")
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .eq("status", "finished")
    .not("home_score", "is", null)
    .lt("commence_time", before)
    .order("commence_time", { ascending: false })
    .limit(40);
  return (data ?? []) as ResultRow[];
}

function teamFeatures(rows: ResultRow[], teamId: number, side: "home" | "away", kickoff: Date, hasDraw: boolean): TeamFeatures {
  const venueRows = rows.filter((r) => (side === "home" ? r.home_team_id === teamId : r.away_team_id === teamId));
  const lastDate = rows[0] ? new Date(rows[0].commence_time) : null;
  return {
    last5: form(rows, teamId, 5, hasDraw),
    last10: form(rows, teamId, 10, hasDraw),
    venueForm: form(venueRows, teamId, 10, hasDraw),
    restDays: lastDate ? Math.round(((kickoff.getTime() - lastDate.getTime()) / 86_400_000) * 10) / 10 : null,
    matchesLast14Days: rows.filter((r) => kickoff.getTime() - new Date(r.commence_time).getTime() < 14 * 86_400_000).length,
  };
}

export async function loadLatestOdds(db: SupabaseClient, matchIds: number[]): Promise<Map<number, OddsRow[]>> {
  const out = new Map<number, OddsRow[]>();
  type Row = { match_id: number; bookmaker: string; market: OddsRow["market"]; selection: OddsRow["selection"]; line: number | null; price: number };
  // PostgREST caps responses (1000 rows on Supabase): small id chunks + paging
  for (let i = 0; i < matchIds.length; i += 20) {
    const chunk = matchIds.slice(i, i + 20);
    const rows = await fetchAll<Row>((from, to) =>
      db.from("latest_odds").select("match_id, bookmaker, market, selection, line, price").in("match_id", chunk).order("id").range(from, to),
    );
    for (const r of rows) {
      const list = out.get(r.match_id) ?? [];
      list.push({ bookmaker: r.bookmaker, market: r.market, selection: r.selection, line: r.line == null ? null : Number(r.line), price: Number(r.price) });
      out.set(r.match_id, list);
    }
  }
  return out;
}

export function engineSettings(s: Settings) {
  return {
    marketBlendWeight: s.model.market_blend_weight,
    minEv: s.model.min_ev,
    minEdge: s.model.min_edge,
    maxOdds: s.model.max_odds,
    requiredSample: s.model.min_matches_per_team,
  };
}

/** Prices a fixture with a given model run and odds (no I/O). */
export function priceMatch(match: MatchRow, run: ModelRun | null, odds: OddsRow[], settings: Settings) {
  if (!run) return { model: null, selections: [] as PricedSelection[], reason: "Modelo aún no entrenado para esta competición (datos históricos insuficientes)." };
  const mm = gridForMatch(run, match.sport_key, match.home_team_id, match.away_team_id, match.is_neutral);
  if (!mm) return { model: null, selections: [] as PricedSelection[], reason: "Uno de los equipos no tiene historial suficiente en el modelo." };
  if (mm.minTeamSample < settings.model.min_matches_per_team / 2) {
    return { model: mm, selections: [] as PricedSelection[], reason: "Muestra histórica demasiado pequeña para una estimación fiable." };
  }
  const selections = priceSelections({
    sport: match.sport_key,
    grid: mm.grid,
    odds,
    hasDraw: SPORTS[match.sport_key].hasDraw,
    minTeamSample: mm.minTeamSample,
    settings: engineSettings(settings),
    modelOnlyMarkets: ["h2h", "btts"],
  });
  return { model: mm, selections, reason: undefined };
}

export async function analyzeMatch(db: SupabaseClient, matchId: number, settings: Settings): Promise<MatchAnalysis | null> {
  const { data: match } = await db.from("matches").select(MATCH_SELECT).eq("id", matchId).maybeSingle<MatchRow>();
  if (!match) return null;
  const cfg = SPORTS[match.sport_key];
  const kickoff = new Date(match.commence_time);
  const leagueForModel = match.sport_key === "tennis" ? null : match.league_id;

  const [run, oddsMap, homeRows, awayRows, history] = await Promise.all([
    latestModelRun(db, match.sport_key, leagueForModel),
    loadLatestOdds(db, [match.id]),
    teamResults(db, match.home_team_id, match.commence_time),
    teamResults(db, match.away_team_id, match.commence_time),
    fetchAll<{ market: Market; selection: string; line: number | null; price: number; captured_at: string }>((from, to) =>
      db
        .from("odds_snapshots")
        .select("market, selection, line, price, captured_at")
        .eq("match_id", match.id)
        .order("captured_at", { ascending: true })
        .range(from, to),
    ),
  ]);
  const odds = oddsMap.get(match.id) ?? [];
  const priced = priceMatch(match, run, odds, settings);

  const h2h = homeRows
    .filter((r) => (r.home_team_id === match.away_team_id || r.away_team_id === match.away_team_id))
    .slice(0, 10)
    .map((r) => ({
      date: r.commence_time,
      home: r.home_team_id === match.home_team_id ? match.home?.name ?? "" : match.away?.name ?? "",
      away: r.away_team_id === match.home_team_id ? match.home?.name ?? "" : match.away?.name ?? "",
      score: `${r.home_score}-${r.away_score}`,
    }));

  // line movement: best price per selection, first vs latest snapshot window
  const movement: MatchAnalysis["lineMovement"] = [];
  const snaps = history;
  const mainSel = priced.selections.filter((s) => s.isMainLine && s.bestPrice != null);
  for (const s of mainSel) {
    const rows = snaps.filter((r) => r.market === s.market && r.selection === s.selection && (r.line == null ? null : Number(r.line)) === s.line);
    if (rows.length < 2) continue;
    const firstT = rows[0].captured_at.slice(0, 16);
    const opening = Math.max(...rows.filter((r) => r.captured_at.slice(0, 16) === firstT).map((r) => Number(r.price)));
    const current = s.bestPrice!;
    movement.push({ market: s.market, selection: s.selection, line: s.line, opening, current, changePct: current / opening - 1, snapshots: rows.length });
  }

  const summary = priced.model ? gridSummary(priced.model.grid) : null;
  if (summary && !cfg.hasDraw && priced.model) {
    // regulation ties go to overtime: split them by relative strength
    const share = tieShareHome(priced.model.grid);
    summary.home += summary.draw * share;
    summary.away += summary.draw * (1 - share);
    summary.draw = 0;
  }
  return {
    match,
    model: priced.model
      ? {
          available: priced.selections.length > 0,
          reason: priced.reason,
          runId: run?.id,
          fittedAt: run?.fitted_at,
          version: run?.model_version,
          expectedScore: priced.model.expected,
          outcome: summary ? { home: summary.home, draw: summary.draw, away: summary.away } : undefined,
          detail: priced.model.detail,
          backtest: (run?.metrics as { backtest?: unknown } | null)?.backtest,
        }
      : { available: false, reason: priced.reason },
    selections: priced.selections,
    oddsAvailable: odds.length > 0,
    features: {
      home: teamFeatures(homeRows, match.home_team_id, "home", kickoff, cfg.hasDraw),
      away: teamFeatures(awayRows, match.away_team_id, "away", kickoff, cfg.hasDraw),
      headToHead: h2h,
    },
    lineMovement: movement,
  };
}
