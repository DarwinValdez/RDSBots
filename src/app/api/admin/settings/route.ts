import { NextResponse } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { handler } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/services/logging";
import { clientIp } from "@/lib/services/rateLimit";
import { settingsSchemas, type SettingsKey } from "@/lib/services/settings";

const body = z.object({ key: z.enum(Object.keys(settingsSchemas) as [SettingsKey, ...SettingsKey[]]), value: z.unknown() });

export const PUT = handler("api:admin:settings", async (req: Request) => {
  const admin = await assertAdmin();
  const { key, value } = body.parse(await req.json());
  const parsed = settingsSchemas[key].parse(value);
  const { error } = await createAdminClient()
    .from("app_settings")
    .upsert({ key, value: parsed, updated_by: admin.id, updated_at: new Date().toISOString() });
  if (error) throw error;
  await logActivity(admin.id, "admin:settings", { key, value: parsed }, clientIp(req));
  return NextResponse.json({ ok: true, value: parsed });
});
