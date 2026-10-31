import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SPORTS, isSportKey, type SportKey } from "@/lib/sports";

/** Filter options for sports + leagues (enabled only). */
export async function filterOptions(db: SupabaseClient) {
  const [{ data: sports }, { data: leagues }] = await Promise.all([
    db.from("sports").select("key, name, enabled").eq("enabled", true).order("sort_order"),
    db.from("leagues").select("id, name, sport_key").eq("enabled", true).order("name"),
  ]);
  return {
    sports: (sports ?? []).map((s) => ({ value: s.key, label: s.name })),
    leagues: (leagues ?? []).map((l) => ({ value: String(l.id), label: l.name, sport: l.sport_key })),
  };
}

export function parseSport(v: string | string[] | undefined): SportKey | undefined {
  return typeof v === "string" && isSportKey(v) ? v : undefined;
}

export function parseId(v: string | string[] | undefined): number | undefined {
  const n = typeof v === "string" ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export { SPORTS };
