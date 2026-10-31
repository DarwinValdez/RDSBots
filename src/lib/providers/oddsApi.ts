import "server-only";
import { NotConfiguredError, serverEnv } from "@/lib/env";
import { fetchJson } from "./http";

/** The Odds API v4 client (decimal odds). */
const BASE = "https://api.the-odds-api.com/v4";

export type OddsOutcome = { name: string; price: number; point?: number };
export type OddsEvent = {
  id: string;
  sport_key: string;
  sport_title?: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: {
    key: string;
    title: string;
    last_update: string;
    markets: { key: string; last_update?: string; outcomes: OddsOutcome[] }[];
  }[];
};
export type ScoreEvent = {
  id: string;
  sport_key: string;
  commence_time: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  scores: { name: string; score: string }[] | null;
};
export type OddsSport = { key: string; group: string; title: string; active: boolean; has_outrights: boolean };

function key() {
  const k = serverEnv.oddsApiKey();
  if (!k) throw new NotConfiguredError("The Odds API");
  return k;
}

const redact = (u: string) => u.replace(/apiKey=[^&]+/, "apiKey=***");

async function get<T>(path: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams({ apiKey: key(), ...params });
  return fetchJson<T>({
    provider: "the-odds-api",
    url: `${BASE}${path}?${qs}`,
    quotaHeader: "x-requests-remaining",
    redact,
  });
}

/** Free endpoint (does not consume quota). */
export async function listSports(): Promise<OddsSport[]> {
  return (await get<OddsSport[]>("/sports")).data;
}

export async function fetchOdds(sportKey: string, regions: string, markets: string): Promise<OddsEvent[]> {
  return (
    await get<OddsEvent[]>(`/sports/${encodeURIComponent(sportKey)}/odds`, {
      regions,
      markets,
      oddsFormat: "decimal",
      dateFormat: "iso",
    })
  ).data;
}

export async function fetchScores(sportKey: string, daysFrom = 3): Promise<ScoreEvent[]> {
  return (
    await get<ScoreEvent[]>(`/sports/${encodeURIComponent(sportKey)}/scores`, {
      daysFrom: String(daysFrom),
      dateFormat: "iso",
    })
  ).data;
}
