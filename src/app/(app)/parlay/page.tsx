import { ModuleDisabled } from "@/components/ModuleDisabled";
import { ParlayBuilder, type ParlayOption } from "@/components/ParlayBuilder";
import { ProviderBanner } from "@/components/ProviderBanner";
import { PageHeader } from "@/components/ui";
import { betLabel } from "@/lib/model/markets";
import { getSettings } from "@/lib/services/settings";
import { priceUpcoming } from "@/lib/services/valueBets";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Constructor de parlays" };
export const dynamic = "force-dynamic";

export default async function ParlayPage() {
  const settings = await getSettings();
  if (!settings.modules.parlays) return <ModuleDisabled name="Parlays" />;
  const db = await createClient();
  const priced = await priceUpcoming(db, settings, { to: new Date(Date.now() + 4 * 86_400_000) });
  const options: ParlayOption[] = priced.flatMap((p) =>
    p.selections
      .filter((s) => s.isMainLine && s.bestPrice != null)
      .map((s) => ({
        matchId: p.match.id,
        match: `${p.match.home?.name} vs ${p.match.away?.name}`,
        league: p.match.league?.name ?? p.match.sport_key,
        sport: p.match.sport_key,
        kickoff: p.match.commence_time,
        market: s.market,
        selection: s.selection,
        line: s.line,
        label: betLabel(s, p.match.home?.name ?? "Local", p.match.away?.name ?? "Visitante"),
        price: s.bestPrice!,
        prob: s.finalProb,
      })),
  );
  return (
    <>
      <PageHeader
        title="Constructor de parlays"
        subtitle="Las selecciones de un mismo partido se evalúan conjuntamente sobre la distribución de marcadores del modelo (sin asumir independencia). Entre partidos distintos se asume independencia."
      />
      <ProviderBanner />
      <ParlayBuilder options={options} />
    </>
  );
}
