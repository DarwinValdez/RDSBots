import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PricedSelection } from "@/lib/model/engine";
import type { SportKey } from "@/lib/sports";
import { MATCH_SELECT, loadLatestOdds, priceMatch, type MatchRow } from "./matchAnalysis";
import { latestModelRun, type ModelRun } from "./modelRuns";
import type { Settings } from "./settings";

export type PricedMatch = { match: MatchRow; selections: PricedSelection[]; modelReason?: string; hasOdds: boolean };

/** Upcoming fixtures priced with the latest model run and latest odds. */
export async function priceUpcoming(
  db: SupabaseClient,
  settings: Settings,
  opts: { sport?: SportKey; leagueId?: number; from?: Date; to?: Date; limit?: number } = {},
): Promise<PricedMatch[]> {
  const from = opts.from ?? new Date();
  const to = opts.to ?? new Date(from.getTime() + 7 * 86_400_000);
  let q = db
    .from("matches")
    .select(MATCH_SELECT)
    .in("status", ["scheduled", "live"])
    .gte("commence_time", from.toISOString())
    .lte("commence_time", to.toISOString())
    .order("commence_time", { ascending: true })
    .limit(opts.limit ?? 300);
  if (opts.sport) q = q.eq("sport_key", opts.sport);
  if (opts.leagueId) q = q.eq("league_id", opts.leagueId);
  const { data } = await q.returns<MatchRow[]>();
  const matches = data ?? [];
  const odds = await loadLatestOdds(db, matches.map((m) => m.id));

  const runCache = new Map<string, Promise<ModelRun | null>>();
  const runFor = (m: MatchRow) => {
    const leagueId = m.sport_key === "tennis" ? null : m.league_id;
    const k = `${m.sport_key}|${leagueId}`;
    if (!runCache.has(k)) runCache.set(k, latestModelRun(db, m.sport_key, leagueId));
    return runCache.get(k)!;
  };

  const out: PricedMatch[] = [];
  for (const m of matches) {
    const o = odds.get(m.id) ?? [];
    const priced = priceMatch(m, await runFor(m), o, settings);
    out.push({ match: m, selections: priced.selections, modelReason: priced.reason, hasOdds: o.length > 0 });
  }
  return out;
}

export type ValueBet = PricedSelection & { match: MatchRow };

export function extractValueBets(priced: PricedMatch[]): ValueBet[] {
  return priced
    .flatMap((p) => p.selections.filter((s) => s.isValue).map((s) => ({ ...s, match: p.match })))
    .sort((a, b) => (b.ev ?? 0) - (a.ev ?? 0));
}
