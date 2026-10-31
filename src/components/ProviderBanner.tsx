import { Notice } from "@/components/ui";
import { providerStatus } from "@/lib/env";

/** Lists data sources that are not configured, so missing data is never silent. */
export function ProviderBanner() {
  const s = providerStatus();
  const missing = [
    !s.oddsApi && "The Odds API (cuotas)",
    !s.apiSports && "API-Sports (estadísticas y resultados)",
    !s.anthropic && "Claude API (explicaciones y chat)",
    !s.supabaseService && "Supabase service role (sincronización)",
  ].filter(Boolean);
  if (!missing.length) return null;
  return (
    <div className="mb-6">
      <Notice>
        Fuentes de datos no configuradas: <strong className="text-ink">{missing.join(", ")}</strong>. Los datos que dependen de ellas se
        muestran como no disponibles; la plataforma no genera datos simulados.
      </Notice>
    </div>
  );
}
