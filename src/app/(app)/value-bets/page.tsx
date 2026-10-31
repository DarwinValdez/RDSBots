import { Filters } from "@/components/Filters";
import { ModuleDisabled } from "@/components/ModuleDisabled";
import { ProviderBanner } from "@/components/ProviderBanner";
import { ValueBetTable } from "@/components/tables/ValueBetTable";
import { Card, DataUnavailable, PageHeader } from "@/components/ui";
import { dateWindow } from "@/lib/dates";
import { filterOptions, parseId, parseSport } from "@/lib/filters";
import { pct } from "@/lib/format";
import { getSettings } from "@/lib/services/settings";
import { extractValueBets, priceUpcoming } from "@/lib/services/valueBets";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Value Bets" };
export const dynamic = "force-dynamic";

export default async function ValueBetsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const settings = await getSettings();
  if (!settings.modules.value_bets) return <ModuleDisabled name="Value Bets" />;
  const db = await createClient();
  const { from, to } = dateWindow(sp.range, sp.date);
  const [options, priced] = await Promise.all([
    filterOptions(db),
    priceUpcoming(db, settings, { sport: parseSport(sp.sport), leagueId: parseId(sp.league), from, to }),
  ]);
  let bets = extractValueBets(priced);
  if (sp.sort === "time") bets = bets.sort((a, b) => a.match.commence_time.localeCompare(b.match.commence_time));
  if (sp.sort === "prob") bets = bets.sort((a, b) => b.finalProb - a.finalProb);
  if (sp.sort === "edge") bets = bets.sort((a, b) => (b.edge ?? 0) - (a.edge ?? 0));
  const evaluated = priced.filter((p) => p.selections.length).length;

  return (
    <>
      <PageHeader
        title="Value Bet Finder"
        subtitle={`Selecciones donde la probabilidad estimada supera la implícita de la mejor cuota tras el margen: EV ≥ ${pct(settings.model.min_ev, 0)}, diferencia ≥ ${pct(settings.model.min_edge, 0)}, cuota ≤ ${settings.model.max_odds} y confianza media/alta.`}
      />
      <ProviderBanner />
      <Filters
        sports={options.sports}
        leagues={options.leagues}
        extra={[{ name: "sort", label: "Ordenar", options: [
          { value: "", label: "Ordenar por EV" }, { value: "edge", label: "Por diferencia" }, { value: "prob", label: "Por probabilidad" }, { value: "time", label: "Por fecha" },
        ] }]}
      />
      <Card title={`${bets.length} oportunidades · ${evaluated} partidos evaluados`}>
        {bets.length ? (
          <ValueBetTable bets={bets} />
        ) : (
          <DataUnavailable title="No se han encontrado oportunidades con los criterios actuales">
            Esto es habitual: los mercados principales suelen ser eficientes. Solo se listan oportunidades calculadas con cuotas y modelos reales.
          </DataUnavailable>
        )}
        <p className="mt-4 text-xs text-muted">
          EV = valor esperado por unidad apostada con la probabilidad final (modelo combinado con el consenso de mercado sin margen, peso de mercado {pct(settings.model.market_blend_weight, 0)}). Una
          EV positiva no garantiza ganancias; describe el resultado medio a largo plazo si las probabilidades son correctas.
        </p>
      </Card>
    </>
  );
}
