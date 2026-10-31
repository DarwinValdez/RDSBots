import { NextResponse } from "next/server";
import { z } from "zod";
import { assertAdmin, HttpError } from "@/lib/auth";
import { handler } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/services/logging";
import { clientIp } from "@/lib/services/rateLimit";

const body = z.object({
  userId: z.string().uuid(),
  role: z.enum(["user", "admin"]).optional(),
  is_active: z.boolean().optional(),
});

export const PATCH = handler("api:admin:users", async (req: Request) => {
  const admin = await assertAdmin();
  const { userId, ...changes } = body.parse(await req.json());
  if (userId === admin.id && (changes.role === "user" || changes.is_active === false))
    throw new HttpError(400, "No puedes quitarte tu propio acceso de administrador");
  if (!Object.keys(changes).length) throw new HttpError(400, "Sin cambios");
  const { error } = await createAdminClient().from("profiles").update(changes).eq("id", userId);
  if (error) throw error;
  await logActivity(admin.id, "admin:user_update", { userId, ...changes }, clientIp(req));
  return NextResponse.json({ ok: true });
});
