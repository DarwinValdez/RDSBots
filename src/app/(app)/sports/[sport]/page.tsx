import { notFound } from "next/navigation";
import { Filters } from "@/components/Filters";
import { MatchCard } from "@/components/MatchCard";
import { ProviderBanner } from "@/components/ProviderBanner";
import { Card, DataUnavailable, PageHeader } from "@/components/ui";
import { dateWindow } from "@/lib/dates";
import { filterOptions, parseId } from "@/lib/filters";
import { getSettings } from "@/lib/services/settings";
import { priceUpcoming } from "@/lib/services/valueBets";
import { isSportKey, SPORTS } from "@/lib/sports";
import { createClient } from "@/lib/supabase/server";
import { date } from "@/lib/format";

export const dynamic = "force-dynamic";

const MODEL_TEXT: Record<string, string> = {
  poisson_dc: "Poisson bivariado con corrección Dixon–Coles y ratings de ataque/defensa con decaimiento temporal.",
  negbin: "Binomial negativa (sobredispersión estimada) sobre ratings de ataque/defensa con decaimiento temporal.",
  normal: "Normal bivariada discretizada (σ y correlación estimadas de residuos) sobre ratings ofensivos/defensivos.",
  elo: "Elo con factor K decreciente por número de partidos del jugador.",
};

export async function generateMetadata({ params }: { params: Promise<{ sport: string }> }) {
  const { sport } = await params;
  return { title: isSportKey(sport) ? SPORTS[sport].name : "Deporte" };
}

export default async function SportPage({ params, searchParams }: { params: Promise<{ sport: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { sport } = await params;
  if (!isSportKey(sport)) notFound();
  const sp = await searchParams;
  const db = await createClient();
  const settings = await getSettings();
  const { from, to } = dateWindow(sp.range, sp.date);
  const [options, priced] = await Promise.all([
    filterOptions(db),
    priceUpcoming(db, settings, { sport, leagueId: parseId(sp.league), from, to }),
  ]);
  const cfg = SPORTS[sport];
  const byDay = new Map<string, typeof priced>();
  for (const p of priced) {
    const d = p.match.commence_time.slice(0, 10);
    byDay.set(d, [...(byDay.get(d) ?? []), p]);
  }
  return (
    <>
      <PageHeader title={cfg.name} subtitle={`Modelo: ${MODEL_TEXT[cfg.family]} Mercados: ${cfg.markets.join(", ")}.`} />
      <ProviderBanner />
      <Filters leagues={options.leagues.filter((l) => l.sport === sport)} showSport={false} />
      {priced.length ? (
        <div className="space-y-6">
          {Array.from(byDay.entries()).map(([d, items]) => (
            <Card key={d} title={date(`${d}T12:00:00Z`)}>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{items.map((p) => <MatchCard key={p.match.id} item={p} />)}</div>
            </Card>
          ))}
        </div>
      ) : (
        <DataUnavailable title={`No hay encuentros de ${cfg.name} disponibles en este rango`}>
          {cfg.apiSportsHost ? "Requiere API-Sports para calendario/resultados y The Odds API para cuotas." : "Los torneos de tenis se descubren desde The Odds API; el modelo Elo se construye con los resultados registrados."}
        </DataUnavailable>
      )}
    </>
  );
}
