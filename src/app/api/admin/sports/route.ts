import { NextResponse } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { handler } from "@/lib/api";
import { SPORT_KEYS } from "@/lib/sports";
import { createAdminClient } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/services/logging";
import { clientIp } from "@/lib/services/rateLimit";

const body = z.object({ key: z.enum(SPORT_KEYS as [string, ...string[]]), enabled: z.boolean() });

export const PATCH = handler("api:admin:sports", async (req: Request) => {
  const admin = await assertAdmin();
  const { key, enabled } = body.parse(await req.json());
  const { error } = await createAdminClient().from("sports").update({ enabled }).eq("key", key);
  if (error) throw error;
  await logActivity(admin.id, "admin:sport_toggle", { key, enabled }, clientIp(req));
  return NextResponse.json({ ok: true });
});
