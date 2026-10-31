import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError } from "@/lib/auth";
import { handler } from "@/lib/api";
import { chat } from "@/lib/ai/chat";
import { createAdminClient } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/services/logging";
import { clientIp, enforceRateLimit } from "@/lib/services/rateLimit";
import { getSettings } from "@/lib/services/settings";

export const runtime = "nodejs";
export const maxDuration = 180;

const body = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(20)
    .refine((m) => m[m.length - 1].role === "user", "El último mensaje debe ser del usuario"),
});

export const POST = handler("api:chat", async (req: Request) => {
  const settings = await getSettings();
  if (!settings.modules.chat) throw new HttpError(403, "El chat está desactivado");
  const ip = clientIp(req) ?? "unknown";
  await enforceRateLimit(`chat:${ip}`, 40, 3600);
  const { messages } = body.parse(await req.json());
  const result = await chat(createAdminClient(), messages);
  await logActivity(null, "chat", { tools: result.toolsUsed }, ip);
  return NextResponse.json(result);
});
