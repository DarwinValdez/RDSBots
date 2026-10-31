import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** Persists an error; never throws (logging must not break the request). */
export async function logError(source: string, error: unknown, context?: Record<string, unknown>) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${source}]`, message, context ?? "");
  try {
    await createAdminClient().from("error_logs").insert({ source, message: message.slice(0, 2000), context });
  } catch {
    /* ignore */
  }
}

export async function logActivity(userId: string | null, action: string, details?: Record<string, unknown>, ip?: string | null) {
  try {
    await createAdminClient().from("activity_logs").insert({ user_id: userId, action, details, ip: ip ?? null });
  } catch {
    /* ignore */
  }
}

export async function logApiUsage(entry: {
  provider: string;
  endpoint: string;
  status: number | null;
  latencyMs: number;
  quotaRemaining: number | null;
}) {
  try {
    await createAdminClient().from("api_usage").insert({
      provider: entry.provider,
      endpoint: entry.endpoint,
      status: entry.status,
      latency_ms: entry.latencyMs,
      quota_remaining: entry.quotaRemaining,
    });
  } catch {
    /* ignore */
  }
}
