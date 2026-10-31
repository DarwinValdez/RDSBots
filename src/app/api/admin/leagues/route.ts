import { NextResponse } from "next/server";
import { z } from "zod";
import { assertAdmin, HttpError } from "@/lib/auth";
import { handler } from "@/lib/api";
import { SPORT_KEYS } from "@/lib/sports";
import { createAdminClient } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/services/logging";
import { clientIp } from "@/lib/services/rateLimit";

const season = z.string().regex(/^\d{4}(-\d{4})?$/, "Temporada: 2026 o 2025-2026");

const create = z.object({
  sport_key: z.enum(SPORT_KEYS as [string, ...string[]]),
  name: z.string().min(2).max(100),
  country: z.string().max(60).nullable().optional(),
  provider_league_id: z.number().int().positive().nullable(),
  odds_sport_key: z.string().regex(/^[a-z0-9_]+$/).nullable(),
  current_season: season.nullable(),
});

const update = z.object({
  id: z.number().int().positive(),
  enabled: z.boolean().optional(),
  current_season: season.nullable().optional(),
  history_seasons: z.array(season).max(10).optional(),
  odds_sport_key: z.string().regex(/^[a-z0-9_]+$/).nullable().optional(),
  provider_league_id: z.number().int().positive().nullable().optional(),
});

export const POST = handler("api:admin:leagues", async (req: Request) => {
  const admin = await assertAdmin();
  const data = create.parse(await req.json());
  const { error } = await createAdminClient().from("leagues").insert(data);
  if (error) throw new HttpError(400, error.message);
  await logActivity(admin.id, "admin:league_create", data, clientIp(req));
  return NextResponse.json({ ok: true });
});

export const PATCH = handler("api:admin:leagues", async (req: Request) => {
  const admin = await assertAdmin();
  const { id, ...changes } = update.parse(await req.json());
  const { error } = await createAdminClient().from("leagues").update(changes).eq("id", id);
  if (error) throw new HttpError(400, error.message);
  await logActivity(admin.id, "admin:league_update", { id, ...changes }, clientIp(req));
  return NextResponse.json({ ok: true });
});
