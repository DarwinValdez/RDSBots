import { CheckCircle2, XCircle } from "lucide-react";
import { providerStatus } from "@/lib/env";

export const dynamic = "force-dynamic";

const ITEMS = [
  ["supabase", "Supabase URL", "NEXT_PUBLIC_SUPABASE_URL"],
  ["supabaseService", "Supabase service role (acceso a datos, solo servidor)", "SUPABASE_SERVICE_ROLE_KEY"],
  ["apiSports", "API-Sports (fútbol, NBA, MLB, NFL, NHL)", "API_SPORTS_KEY"],
  ["oddsApi", "The Odds API (cuotas)", "ODDS_API_KEY"],
  ["anthropic", "Claude API (análisis y chat)", "ANTHROPIC_API_KEY"],
  ["cron", "Secreto de cron", "CRON_SECRET"],
] as const;

export default function SetupPage() {
  const status = providerStatus();
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Configuración requerida</h1>
      <p className="mt-2 text-sm text-muted">
        Define estas variables de entorno en Vercel (Project → Settings → Environment Variables) o en <code>.env.local</code>. Las claves nunca se envían al navegador.
      </p>
      <ul className="mt-8 divide-y divide-line rounded-xl border border-line bg-surface">
        {ITEMS.map(([key, label, vars]) => (
          <li key={key} className="flex items-center gap-3 px-4 py-3">
            {status[key] ? <CheckCircle2 className="size-5 text-brand" /> : <XCircle className="size-5 text-bad" />}
            <div>
              <div className="text-sm font-medium">{label}</div>
              <div className="font-mono text-xs text-muted">{vars}</div>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm text-muted">Después aplica la migración <code>supabase/migrations/0001_init.sql</code> y vuelve a cargar.</p>
    </main>
  );
}
