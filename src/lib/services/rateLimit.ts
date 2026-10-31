import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { HttpError } from "@/lib/auth";

/**
 * Database-backed fixed-window limiter (works across serverless instances).
 * Fails open if the database is unreachable so outages don't lock users out.
 */
export async function enforceRateLimit(key: string, limit: number, windowSeconds: number) {
  try {
    const { data, error } = await createAdminClient().rpc("check_rate_limit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) return;
    if (data === false) throw new HttpError(429, "Too many requests, try again later");
  } catch (e) {
    if (e instanceof HttpError) throw e;
  }
}

export function clientIp(req: Request): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip");
}
