import { NextResponse } from "next/server";
import { z } from "zod";
import { assertUser, HttpError } from "@/lib/auth";
import { handler } from "@/lib/api";
import { evaluateParlay, type ParlayLeg } from "@/lib/model/parlay";
import type { ScoreGrid } from "@/lib/model/grid";
import { createAdminClient } from "@/lib/supabase/admin";
import { MATCH_SELECT, loadLatestOdds, priceMatch, type MatchRow } from "@/lib/services/matchAnalysis";
import { latestModelRun } from "@/lib/services/modelRuns";
import { enforceRateLimit } from "@/lib/services/rateLimit";
import { getSettings } from "@/lib/services/settings";

export const runtime = "nodejs";

const body = z.object({
  legs: z
    .array(
      z.object({
        matchId: z.number().int().positive(),
        market: z.enum(["h2h", "totals", "spreads", "btts"]),
        selection: z.enum(["home", "draw", "away", "over", "under", "yes", "no"]),
        line: z.number().nullable(),
      }),
    )
    .min(2)
    .max(12),
});

export const POST = handler("api:parlay", async (req: Request) => {
  const user = await assertUser();
  const settings = await getSettings();
  if (!settings.modules.parlays) throw new HttpError(403, "El constructor de parlays está desactivado");
  await enforceRateLimit(`parlay:${user.id}`, 120, 3600);
  const { legs } = body.parse(await req.json());

  const db = createAdminClient();
  const ids = Array.from(new Set(legs.map((l) => l.matchId)));
  const { data: matches } = await db.from("matches").select(MATCH_SELECT).in("id", ids).returns<MatchRow[]>();
  const odds = await loadLatestOdds(db, ids);
  const grids = new Map<string, ScoreGrid>();
  const parlayLegs: ParlayLeg[] = [];

  for (const leg of legs) {
    const m = matches?.find((x) => x.id === leg.matchId);
    if (!m) throw new HttpError(404, `Partido ${leg.matchId} no encontrado`);
    if (new Date(m.commence_time) <= new Date()) throw new HttpError(400, `El partido ${leg.matchId} ya comenzó`);
    const run = await latestModelRun(db, m.sport_key, m.sport_key === "tennis" ? null : m.league_id);
    const priced = priceMatch(m, run, odds.get(m.id) ?? [], settings);
    if (!priced.model) throw new HttpError(422, `Sin modelo para ${m.home?.name} vs ${m.away?.name}: ${priced.reason}`);
    const sel = priced.selections.find((s) => s.market === leg.market && s.selection === leg.selection && (s.line ?? null) === (leg.line ?? null));
    if (!sel?.bestPrice) throw new HttpError(422, "Selección sin cuota disponible");
    grids.set(String(m.id), priced.model.grid);
    parlayLegs.push({ eventId: String(m.id), bet: { market: leg.market, selection: leg.selection, line: leg.line }, price: sel.bestPrice, finalProb: sel.finalProb });
  }
  return NextResponse.json(evaluateParlay(parlayLegs, grids));
});
