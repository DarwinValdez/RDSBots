import "server-only";

/**
 * Server-side environment access. Secrets are read lazily so the app can boot
 * (and show "not configured" states) when a provider key is missing.
 */
function read(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

export const serverEnv = {
  supabaseUrl: () => read("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => read("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceKey: () => read("SUPABASE_SERVICE_ROLE_KEY"),
  apiSportsKey: () => read("API_SPORTS_KEY"),
  oddsApiKey: () => read("ODDS_API_KEY"),
  anthropicKey: () => read("ANTHROPIC_API_KEY"),
  claudeModel: () => read("CLAUDE_MODEL") ?? "claude-opus-5-5",
  cronSecret: () => read("CRON_SECRET"),
};

export type ProviderStatus = {
  supabase: boolean;
  supabaseService: boolean;
  apiSports: boolean;
  oddsApi: boolean;
  anthropic: boolean;
  cron: boolean;
};

export function providerStatus(): ProviderStatus {
  return {
    supabase: !!(serverEnv.supabaseUrl() && serverEnv.supabaseAnonKey()),
    supabaseService: !!serverEnv.supabaseServiceKey(),
    apiSports: !!serverEnv.apiSportsKey(),
    oddsApi: !!serverEnv.oddsApiKey(),
    anthropic: !!serverEnv.anthropicKey(),
    cron: !!serverEnv.cronSecret(),
  };
}

export class NotConfiguredError extends Error {
  constructor(public readonly provider: string) {
    super(`${provider} is not configured`);
    this.name = "NotConfiguredError";
  }
}
