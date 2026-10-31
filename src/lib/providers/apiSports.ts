import "server-only";
import { NotConfiguredError, serverEnv } from "@/lib/env";
import { SPORTS, type SportKey } from "@/lib/sports";
import { fetchJson, ProviderError } from "./http";

/**
 * API-Sports client (API-Football, Basketball, Baseball, American Football,
 * Hockey). All endpoints share one key and one response envelope.
 */
export type NormalizedFixture = {
  providerId: string;
  commenceTime: string;
  status: "scheduled" | "live" | "finished" | "postponed" | "cancelled";
  home: { id: number; name: string; logo: string | null };
  away: { id: number; name: string; logo: string | null };
  homeScore: number | null;
  awayScore: number | null;
  round: string | null;
  venue: string | null;
};

type Envelope<T> = { response: T[]; errors: unknown; results: number };

async function call<T>(sport: SportKey, path: string, params: Record<string, string | number>) {
  const key = serverEnv.apiSportsKey();
  if (!key) throw new NotConfiguredError("API-Sports");
  const host = SPORTS[sport].apiSportsHost;
  if (!host) throw new ProviderError("api-sports", null, `${sport} has no API-Sports endpoint`);
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const { data } = await fetchJson<Envelope<T>>({
    provider: `api-sports:${sport}`,
    url: `https://${host}/${path}?${qs}`,
    headers: { "x-apisports-key": key },
    quotaHeader: "x-ratelimit-requests-remaining",
  });
  const errs = data.errors;
  const hasErrors = Array.isArray(errs) ? errs.length > 0 : errs && typeof errs === "object" && Object.keys(errs).length > 0;
  if (hasErrors) throw new ProviderError(`api-sports:${sport}`, 200, JSON.stringify(errs).slice(0, 300));
  return data.response ?? [];
}

const FINISHED = new Set(["FT", "AET", "PEN", "AOT", "AP", "AW", "WO"]);
const LIVE = new Set(["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT", "Q1", "Q2", "Q3", "Q4", "OT", "BT", "P1", "P2", "P3", "PT"]);
const POSTPONED = new Set(["PST", "POST", "TBD", "SUSP"]);
const CANCELLED = new Set(["CANC", "ABD", "AWD"]);

function mapStatus(short: string | undefined): NormalizedFixture["status"] {
  const s = (short ?? "").toUpperCase();
  if (FINISHED.has(s)) return "finished";
  if (POSTPONED.has(s)) return "postponed";
  if (CANCELLED.has(s)) return "cancelled";
  if (LIVE.has(s) || /^IN\d+$/.test(s)) return "live";
  return "scheduled";
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/* eslint-disable @typescript-eslint/no-explicit-any */
function normalize(sport: SportKey, r: any): NormalizedFixture | null {
  try {
    if (sport === "soccer") {
      const ft = r.score?.fulltime; // regulation 90' (what markets settle on)
      return {
        providerId: String(r.fixture.id),
        commenceTime: r.fixture.date,
        status: mapStatus(r.fixture.status?.short),
        home: { id: r.teams.home.id, name: r.teams.home.name, logo: r.teams.home.logo ?? null },
        away: { id: r.teams.away.id, name: r.teams.away.name, logo: r.teams.away.logo ?? null },
        homeScore: num(ft?.home) ?? num(r.goals?.home),
        awayScore: num(ft?.away) ?? num(r.goals?.away),
        round: r.league?.round ?? null,
        venue: r.fixture.venue?.name ?? null,
      };
    }
    if (sport === "nfl") {
      const g = r.game;
      return {
        providerId: String(g.id),
        commenceTime: g.date?.timestamp ? new Date(g.date.timestamp * 1000).toISOString() : `${g.date.date}T${g.date.time ?? "00:00"}:00Z`,
        status: mapStatus(g.status?.short),
        home: { id: r.teams.home.id, name: r.teams.home.name, logo: r.teams.home.logo ?? null },
        away: { id: r.teams.away.id, name: r.teams.away.name, logo: r.teams.away.logo ?? null },
        homeScore: num(r.scores?.home?.total),
        awayScore: num(r.scores?.away?.total),
        round: g.week ?? g.stage ?? null,
        venue: g.venue?.name ?? null,
      };
    }
    // basketball / baseball / hockey share a shape; hockey scores are plain numbers
    const hs = typeof r.scores?.home === "number" || r.scores?.home === null ? r.scores?.home : r.scores?.home?.total;
    const as = typeof r.scores?.away === "number" || r.scores?.away === null ? r.scores?.away : r.scores?.away?.total;
    return {
      providerId: String(r.id),
      commenceTime: r.date,
      status: mapStatus(r.status?.short),
      home: { id: r.teams.home.id, name: r.teams.home.name, logo: r.teams.home.logo ?? null },
      away: { id: r.teams.away.id, name: r.teams.away.name, logo: r.teams.away.logo ?? null },
      homeScore: num(hs),
      awayScore: num(as),
      round: r.week ?? r.stage ?? null,
      venue: r.venue?.name ?? (typeof r.venue === "string" ? r.venue : null),
    };
  } catch {
    return null;
  }
}

export async function fetchSeasonFixtures(sport: SportKey, leagueId: number, season: string): Promise<NormalizedFixture[]> {
  const path = sport === "soccer" ? "fixtures" : "games";
  const rows = await call<unknown>(sport, path, { league: leagueId, season });
  return rows.map((r) => normalize(sport, r)).filter((x): x is NormalizedFixture => x !== null);
}

export type Injury = { team: string; teamId: number; player: string; type: string; reason: string };

/** Injuries / absences — available from API-Football only. */
export async function fetchSoccerInjuries(fixtureId: string): Promise<Injury[]> {
  const rows = await call<any>("soccer", "injuries", { fixture: fixtureId });
  return rows.map((r) => ({
    team: r.team?.name ?? "",
    teamId: r.team?.id ?? 0,
    player: r.player?.name ?? "",
    type: r.player?.type ?? "",
    reason: r.player?.reason ?? "",
  }));
}

export type PlayerSeasonStat = { player: string; team: string; games: number | null; goals: number | null; assists: number | null; rating: string | null; minutes: number | null };

/** Top scorers of a soccer league — used by the chat for player questions. */
export async function fetchSoccerTopScorers(leagueId: number, season: string): Promise<PlayerSeasonStat[]> {
  const rows = await call<any>("soccer", "players/topscorers", { league: leagueId, season });
  return rows.slice(0, 20).map((r) => {
    const s = r.statistics?.[0] ?? {};
    return {
      player: r.player?.name ?? "",
      team: s.team?.name ?? "",
      games: num(s.games?.appearences),
      goals: num(s.goals?.total),
      assists: num(s.goals?.assists),
      rating: s.games?.rating ?? null,
      minutes: num(s.games?.minutes),
    };
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */
