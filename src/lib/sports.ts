import type { Family } from "@/lib/model/ratings";
import type { Market } from "@/lib/model/markets";

export type SportKey = "soccer" | "nba" | "mlb" | "nfl" | "nhl" | "tennis";

export type SportConfig = {
  key: SportKey;
  name: string;
  /** API-Sports host (null = no stats provider, odds-only) */
  apiSportsHost: string | null;
  /** model family; "elo" for individual sports */
  family: Family | "elo";
  /** draw is a betting outcome in the moneyline market */
  hasDraw: boolean;
  markets: Market[];
  scoreUnit: string;
};

export const SPORTS: Record<SportKey, SportConfig> = {
  soccer: {
    key: "soccer", name: "Fútbol", apiSportsHost: "v3.football.api-sports.io",
    family: "poisson_dc", hasDraw: true, markets: ["h2h", "totals", "spreads", "btts"], scoreUnit: "goles",
  },
  nba: {
    key: "nba", name: "NBA", apiSportsHost: "v1.basketball.api-sports.io",
    family: "normal", hasDraw: false, markets: ["h2h", "totals", "spreads"], scoreUnit: "puntos",
  },
  mlb: {
    key: "mlb", name: "MLB", apiSportsHost: "v1.baseball.api-sports.io",
    family: "negbin", hasDraw: false, markets: ["h2h", "totals", "spreads"], scoreUnit: "carreras",
  },
  nfl: {
    key: "nfl", name: "NFL", apiSportsHost: "v1.american-football.api-sports.io",
    family: "normal", hasDraw: false, markets: ["h2h", "totals", "spreads"], scoreUnit: "puntos",
  },
  nhl: {
    key: "nhl", name: "NHL", apiSportsHost: "v1.hockey.api-sports.io",
    family: "negbin", hasDraw: false, markets: ["h2h", "totals", "spreads"], scoreUnit: "goles",
  },
  tennis: {
    key: "tennis", name: "Tenis", apiSportsHost: null,
    family: "elo", hasDraw: false, markets: ["h2h"], scoreUnit: "sets",
  },
};

export const SPORT_KEYS = Object.keys(SPORTS) as SportKey[];

export function isSportKey(s: string): s is SportKey {
  return s in SPORTS;
}

export const MODEL_VERSION = "v1.0";
