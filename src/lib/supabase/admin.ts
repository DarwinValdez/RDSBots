import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NotConfiguredError, serverEnv } from "@/lib/env";

let cached: SupabaseClient | null = null;

/**
 * Service-role client. Bypasses RLS — only use in cron jobs and in route
 * handlers that have already verified the caller is an admin.
 */
export function createAdminClient(): SupabaseClient {
  if (cached) return cached;
  const url = serverEnv.supabaseUrl();
  const key = serverEnv.supabaseServiceKey();
  if (!url || !key) throw new NotConfiguredError("Supabase service role");
  cached = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return cached;
}
