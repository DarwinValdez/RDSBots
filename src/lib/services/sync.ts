import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchSeasonFixtures } from "@/lib/providers/apiSports";
import { fetchOdds, fetchScores, listSports, type OddsEvent } from "@/lib/providers/oddsApi";
import { isSportKey, SPORTS, type SportKey } from "@/lib/sports";
import type { Market, Selection } from "@/lib/model/markets";
import { logError } from "./logging";
import { loadLatestOdds } from "./matchAnalysis";
import { getSettings } from "./settings";
import { TeamDirectory, type TeamRow } from "./teams";

export type LeagueRow = {
  id: number;
  sport_key: SportKey;
  name: string;
  provider_league_id: number | null;
  odds_sport_key: string | null;
  current_season: string | null;
  history_seasons: string[];
  enabled: boolean;
};

export async function enabledLeagues(db: SupabaseClient): Promise<LeagueRow[]> {
  const [{ data: leagues }, { data: sports }] = await Promise.all([
    db.from("leagues").select("*").eq("enabled", true),
    db.from("sports").select("key, enabled"),
  ]);
  const enabledSports = new Set((sports ?? []).filter((s) => s.enabled).map((s) => s.key));
  return ((leagues ?? []) as LeagueRow[]).filter((l) => enabledSports.has(l.sport_key) && isSportKey(l.sport_key));
}

/** Pulls fixtures + results for each enabled league from API-Sports. */
export async function syncFixtures(db: SupabaseClient, opts: { backfill?: boolean } = {}) {
  const leagues = (await enabledLeagues(db)).filter((l) => l.provider_league_id != null && SPORTS[l.sport_key].apiSportsHost);
  const summary: Record<string, number | string> = {};
  const dirs = new Map<SportKey, TeamDirectory>();
  for (const league of leagues) {
    const seasons = [league.current_season, ...(opts.backfill ? league.history_seasons : [])].filter(Boolean) as string[];
    for (const season of seasons) {
      try {
        const fixtures = await fetchSeasonFixtures(league.sport_key, league.provider_league_id!, season);
        let dir = dirs.get(league.sport_key);
        if (!dir) {
          dir = await TeamDirectory.load(db, league.sport_key);
          dirs.set(league.sport_key, dir);
        }
        const rows = [];
        for (const f of fixtures) {
          const home = await dir.upsertProvider(f.home.id, f.home.name, f.home.logo);
          const away = await dir.upsertProvider(f.away.id, f.away.name, f.away.logo);
          rows.push({
            sport_key: league.sport_key,
            league_id: league.id,
            home_team_id: home.id,
            away_team_id: away.id,
            commence_time: f.commenceTime,
            status: f.status,
            home_score: f.status === "finished" ? f.homeScore : null,
            away_score: f.status === "finished" ? f.awayScore : null,
            provider_fixture_id: f.providerId,
            season,
            round: f.round,
            venue: f.venue,
            updated_at: new Date().toISOString(),
          });
        }
        for (let i = 0; i < rows.length; i += 500) {
          const { error } = await db.from("matches").upsert(rows.slice(i, i + 500), { onConflict: "sport_key,provider_fixture_id" });
          if (error) throw error;
        }
        summary[`${league.name} ${season}`] = rows.length;
      } catch (e) {
        summary[`${league.name} ${season}`] = `error: ${e instanceof Error ? e.message : String(e)}`;
        await logError("sync-fixtures", e, { league: league.name, season });
      }
    }
  }
  return summary;
}

/** Adds tennis tournaments currently offered by The Odds API as leagues. */
async function discoverTennis(db: SupabaseClient) {
  const sports = await listSports();
  const active = sports.filter((s) => s.active && s.key.startsWith("tennis_") && !s.has_outrights);
  if (!active.length) return;
  await db.from("leagues").upsert(
    active.map((s) => ({ sport_key: "tennis", name: s.title, odds_sport_key: s.key, enabled: true })),
    { onConflict: "odds_sport_key", ignoreDuplicates: true },
  );
}

type SnapshotRow = { match_id: number; bookmaker: string; market: Market; selection: Selection; line: number | null; price: number };

function eventSnapshots(ev: OddsEvent, matchId: number, sport: SportKey): SnapshotRow[] {
  const out: SnapshotRow[] = [];
  const allowed = new Set(SPORTS[sport].markets);
  for (const b of ev.bookmakers) {
    for (const m of b.markets) {
      const market = m.key as Market;
      if (!allowed.has(market)) continue;
      for (const o of m.outcomes) {
        let selection: Selection | null = null;
        if (market === "h2h" || market === "spreads") {
          selection = o.name === ev.home_team ? "home" : o.name === ev.away_team ? "away" : o.name === "Draw" ? "draw" : null;
        } else if (market === "totals") {
          selection = o.name === "Over" ? "over" : o.name === "Under" ? "under" : null;
        } else if (market === "btts") {
          selection = o.name === "Yes" ? "yes" : o.name === "No" ? "no" : null;
        }
        if (!selection || !(o.price > 1)) continue;
        if (selection === "draw" && !SPORTS[sport].hasDraw) continue;
        out.push({
          match_id: matchId,
          bookmaker: b.title,
          market,
          selection,
          line: market === "totals" || market === "spreads" ? (o.point ?? null) : null,
          price: o.price,
        });
      }
    }
  }
  return out;
}

const lineKey = (r: { match_id: number; bookmaker: string; market: string; selection: string; line: number | null }) =>
  `${r.match_id}|${r.bookmaker}|${r.market}|${r.selection}|${r.line ?? ""}`;

/** Pulls current odds, links events to fixtures, stores changed prices. */
export async function syncOdds(db: SupabaseClient) {
  const settings = await getSettings();
  try {
    await discoverTennis(db);
  } catch (e) {
    await logError("sync-odds", e, { step: "discover-tennis" });
  }
  const leagues = (await enabledLeagues(db)).filter((l) => l.odds_sport_key);
  const summary: Record<string, number | string> = {};
  const dirs = new Map<SportKey, TeamDirectory>();

  for (const league of leagues) {
    try {
      const events = await fetchOdds(league.odds_sport_key!, settings.providers.odds_regions, settings.providers.odds_markets);
      if (!events.length) {
        summary[league.name] = 0;
        continue;
      }
      let dir = dirs.get(league.sport_key);
      if (!dir) {
        dir = await TeamDirectory.load(db, league.sport_key);
        dirs.set(league.sport_key, dir);
      }
      const matchIds = await linkEvents(db, dir, league, events);
      const snapshots = events.flatMap((ev) => (matchIds.has(ev.id) ? eventSnapshots(ev, matchIds.get(ev.id)!, league.sport_key) : []));

      // only store prices that changed since the latest stored snapshot
      const ids = Array.from(new Set(snapshots.map((s) => s.match_id)));
      const latest = new Map<string, number>();
      for (const [matchId, rows] of await loadLatestOdds(db, ids)) {
        for (const r of rows) latest.set(lineKey({ match_id: matchId, ...r }), r.price);
      }
      const changed = snapshots.filter((s) => latest.get(lineKey(s)) !== s.price);
      for (let i = 0; i < changed.length; i += 1000) {
        const { error } = await db.from("odds_snapshots").insert(changed.slice(i, i + 1000));
        if (error) throw error;
      }
      summary[league.name] = changed.length;
    } catch (e) {
      summary[league.name] = `error: ${e instanceof Error ? e.message : String(e)}`;
      await logError("sync-odds", e, { league: league.name });
    }
  }
  return summary;
}

/** Links odds events to existing fixtures (by teams + kickoff) or creates them. */
async function linkEvents(db: SupabaseClient, dir: TeamDirectory, league: LeagueRow, events: OddsEvent[]) {
  const result = new Map<string, number>();
  const { data: linked } = await db.from("matches").select("id, odds_event_id").in("odds_event_id", events.map((e) => e.id));
  for (const m of linked ?? []) result.set(m.odds_event_id, m.id);

  const pending = events.filter((e) => !result.has(e.id));
  if (!pending.length) return result;
  const times = pending.map((e) => new Date(e.commence_time).getTime());
  const from = new Date(Math.min(...times) - 36 * 3600_000).toISOString();
  const to = new Date(Math.max(...times) + 36 * 3600_000).toISOString();
  const { data: candidates } = await db
    .from("matches")
    .select("id, home_team_id, away_team_id, commence_time, odds_event_id")
    .eq("sport_key", league.sport_key)
    .is("odds_event_id", null)
    .gte("commence_time", from)
    .lte("commence_time", to);

  const hasStatsProvider = league.provider_league_id != null && SPORTS[league.sport_key].apiSportsHost;

  for (const ev of pending) {
    const t = new Date(ev.commence_time).getTime();
    const near = (candidates ?? []).filter((c) => !c.odds_event_id && Math.abs(new Date(c.commence_time).getTime() - t) < 36 * 3600_000);
    const homeCands = near.map((c) => dir.get(c.home_team_id)).filter(Boolean) as TeamRow[];
    const awayCands = near.map((c) => dir.get(c.away_team_id)).filter(Boolean) as TeamRow[];
    const home = dir.match(ev.home_team, homeCands);
    const away = dir.match(ev.away_team, awayCands);
    const match = home && away ? near.find((c) => c.home_team_id === home.id && c.away_team_id === away.id) : undefined;

    if (match) {
      await db.from("matches").update({ odds_event_id: ev.id }).eq("id", match.id);
      match.odds_event_id = ev.id;
      await dir.addAlias(home!, ev.home_team);
      await dir.addAlias(away!, ev.away_team);
      result.set(ev.id, match.id);
      continue;
    }
    if (hasStatsProvider) continue; // unmatched: wait for the fixture feed instead of creating duplicates

    // odds-only competitions (e.g. tennis): the odds feed is the fixture source
    const h = await dir.upsertByName(ev.home_team);
    const a = await dir.upsertByName(ev.away_team);
    const { data, error } = await db
      .from("matches")
      .upsert(
        {
          sport_key: league.sport_key,
          league_id: league.id,
          home_team_id: h.id,
          away_team_id: a.id,
          commence_time: ev.commence_time,
          odds_event_id: ev.id,
          is_neutral: league.sport_key === "tennis",
          status: new Date(ev.commence_time) <= new Date() ? "live" : "scheduled",
        },
        { onConflict: "odds_event_id" },
      )
      .select("id")
      .single();
    if (!error && data) result.set(ev.id, data.id);
  }
  return result;
}

/** Results for odds-only competitions (no stats provider) via The Odds API. */
export async function syncOddsOnlyScores(db: SupabaseClient) {
  const leagues = (await enabledLeagues(db)).filter((l) => l.odds_sport_key && (l.provider_league_id == null || !SPORTS[l.sport_key].apiSportsHost));
  const summary: Record<string, number | string> = {};
  for (const league of leagues) {
    try {
      const { count } = await db
        .from("matches")
        .select("id", { count: "exact", head: true })
        .eq("league_id", league.id)
        .in("status", ["scheduled", "live"])
        .lt("commence_time", new Date().toISOString());
      if (!count) continue; // nothing to settle → don't spend quota
      const scores = await fetchScores(league.odds_sport_key!, 3);
      let n = 0;
      for (const s of scores) {
        if (!s.completed || !s.scores) continue;
        const hs = Number(s.scores.find((x) => x.name === s.home_team)?.score);
        const as = Number(s.scores.find((x) => x.name === s.away_team)?.score);
        if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
        const { error } = await db
          .from("matches")
          .update({ status: "finished", home_score: hs, away_score: as, updated_at: new Date().toISOString() })
          .eq("odds_event_id", s.id);
        if (!error) n++;
      }
      summary[league.name] = n;
    } catch (e) {
      summary[league.name] = `error: ${e instanceof Error ? e.message : String(e)}`;
      await logError("sync-scores", e, { league: league.name });
    }
  }
  return summary;
}
