import { NextResponse } from "next/server";
import { assertUser, HttpError } from "@/lib/auth";
import { handler } from "@/lib/api";
import { explainMatch } from "@/lib/ai/analysis";
import { fetchSoccerInjuries } from "@/lib/providers/apiSports";
import { createAdminClient } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/services/logging";
import { analyzeMatch } from "@/lib/services/matchAnalysis";
import { clientIp, enforceRateLimit } from "@/lib/services/rateLimit";
import { getSettings } from "@/lib/services/settings";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Generates (or returns the cached) Claude explanation for a match. */
export const POST = handler("api:analysis", async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await assertUser();
  const settings = await getSettings();
  if (!settings.modules.ai_analysis) throw new HttpError(403, "El módulo de análisis IA está desactivado");
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "Id inválido");
  await enforceRateLimit(`analysis:${user.id}`, 20, 3600);

  const db = createAdminClient();
  const analysis = await analyzeMatch(db, id, settings);
  if (!analysis) throw new HttpError(404, "Partido no encontrado");
  if (analysis.match.sport_key === "soccer" && analysis.match.provider_fixture_id) {
    try {
      analysis.injuries = await fetchSoccerInjuries(analysis.match.provider_fixture_id);
    } catch {
      analysis.injuries = null;
    }
  }
  const result = await explainMatch(db, analysis, user.id);
  await logActivity(user.id, "ai_analysis", { match: id, cached: result.cached }, clientIp(req));
  return NextResponse.json(result);
});
