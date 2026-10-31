import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

export const modulesSchema = z.object({
  dashboard: z.boolean(),
  value_bets: z.boolean(),
  parlays: z.boolean(),
  history: z.boolean(),
  chat: z.boolean(),
  ai_analysis: z.boolean(),
});

export const modelSettingsSchema = z.object({
  time_decay_half_life_days: z.number().min(14).max(1460),
  market_blend_weight: z.number().min(0).max(1),
  min_ev: z.number().min(0).max(1),
  min_edge: z.number().min(0).max(1),
  min_matches_per_team: z.number().int().min(1).max(50),
  prediction_window_hours: z.number().min(1).max(240),
  max_odds: z.number().min(1.01).max(100),
  bankroll_units: z.number().min(1).max(100000),
});

export const refreshSchema = z.object({
  sync_fixtures_minutes: z.number().int().min(15).max(10080),
  sync_odds_minutes: z.number().int().min(5).max(1440),
  predict_minutes: z.number().int().min(15).max(1440),
  settle_minutes: z.number().int().min(15).max(1440),
});

export const providersSchema = z.object({
  odds_regions: z.string().regex(/^[a-z]{2}(,[a-z]{2})*$/),
  odds_markets: z.string().regex(/^[a-z_]+(,[a-z_]+)*$/),
});

export const settingsSchemas = {
  modules: modulesSchema,
  model: modelSettingsSchema,
  refresh: refreshSchema,
  providers: providersSchema,
} as const;

export type SettingsKey = keyof typeof settingsSchemas;
export type Settings = { [K in SettingsKey]: z.infer<(typeof settingsSchemas)[K]> };

export const DEFAULT_SETTINGS: Settings = {
  modules: { dashboard: true, value_bets: true, parlays: true, history: true, chat: true, ai_analysis: true },
  model: {
    time_decay_half_life_days: 180,
    market_blend_weight: 0.5,
    min_ev: 0.02,
    min_edge: 0.01,
    min_matches_per_team: 6,
    prediction_window_hours: 48,
    max_odds: 10,
    bankroll_units: 100,
  },
  refresh: { sync_fixtures_minutes: 360, sync_odds_minutes: 30, predict_minutes: 60, settle_minutes: 60 },
  providers: { odds_regions: "eu,uk,us", odds_markets: "h2h,totals,spreads" },
};

export async function getSettings(): Promise<Settings> {
  const out: Settings = structuredClone(DEFAULT_SETTINGS);
  try {
    const { data } = await createAdminClient().from("app_settings").select("key, value");
    for (const row of data ?? []) {
      const key = row.key as SettingsKey;
      const schema = settingsSchemas[key];
      if (!schema) continue;
      const parsed = schema.safeParse({ ...DEFAULT_SETTINGS[key], ...(row.value as object) });
      if (parsed.success) (out as Record<string, unknown>)[key] = parsed.data;
    }
  } catch {
    /* fall back to defaults when the DB is not configured */
  }
  return out;
}
