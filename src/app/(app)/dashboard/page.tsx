import Link from "next/link";
import { ProfitChart } from "@/components/charts/Charts";
import { Filters } from "@/components/Filters";
import { MatchCard } from "@/components/MatchCard";
import { ProviderBanner } from "@/components/ProviderBanner";
import { ValueBetTable } from "@/components/tables/ValueBetTable";
import { Badge, Card, ConfidenceBadge, DataUnavailable, PageHeader, ProbBar, Stat, Table, td, th } from "@/components/ui";
import { dateWindow } from "@/lib/dates";
import { filterOptions, parseId, parseSport } from "@/lib/filters";
import { dateTime, odds, pct, RESULT_LABEL, signedPct, units } from "@/lib/format";
import { betLabel } from "@/lib/model/markets";
import { loadPredictions, summarize } from "@/lib/services/performance";
import { getSettings } from "@/lib/services/settings";
import { extractValueBets, priceUpcoming } from "@/lib/services/valueBets";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function DashboardPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const db = await createClient();
  const settings = await getSettings();
  const sport = parseSport(sp.sport);
  const leagueId = parseId(sp.league);
  const { from, to } = dateWindow(sp.range as string, sp.date as string);

  const [options, priced, predictions] = await Promise.all([
    filterOptions(db),
    priceUpcoming(db, settings, { sport, leagueId, from, to }),
    loadPredictions(db, { sport, sinceDays: 180 }),
  ]);
  const perf = summarize(predictions, settings.model.bankroll_units, true);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const today = priced.filter((p) => new Date(p.match.commence_time) <= endOfToday);
  const upcoming = priced.filter((p) => new Date(p.match.commence_time) > endOfToday);
  const valueBets = extractValueBets(priced).slice(0, 8);
  const featured = priced
    .flatMap((p) => p.selections.filter((s) => s.isMainLine && s.bestPrice != null && s.confidence !== "low").map((s) => ({ ...s, match: p.match })))
    .sort((a, b) => (b.confidence === "high" ? 1 : 0) - (a.confidence === "high" ? 1 : 0) || b.finalProb - a.finalProb)
    .slice(0, 6);

  const { data: recent } = await db
    .from("predictions")
    .select("id, market, selection, line, best_price, final_prob, result, profit, clv, kickoff_at, match:matches(id, home:teams!matches_home_team_id_fkey(name), away:teams!matches_away_team_id_fkey(name))")
    .eq("is_value", true)
    .neq("result", "pending")
    .order("settled_at", { ascending: false })
    .limit(8);

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Partidos, probabilidades del modelo y oportunidades con cuotas actuales." />
      <ProviderBanner />
      <Filters sports={options.sports} leagues={options.leagues} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <Stat label="Value bets registradas" value={perf.recorded} hint={`${perf.pending} pendientes`} />
        <Stat label="Yield" value={signedPct(perf.yield)} tone={perf.yield == null ? "neutral" : perf.yield >= 0 ? "good" : "bad"} hint={`${perf.bets} liquidadas`} />
        <Stat label="Beneficio" value={units(perf.bets ? perf.profit : null)} hint="stake plano 1u" />
        <Stat label="Win rate" value={pct(perf.winRate)} hint={perf.avgOdds ? `cuota media ${odds(perf.avgOdds)}` : undefined} />
        <Stat label="CLV medio" value={signedPct(perf.avgClv)} tone={perf.avgClv == null ? "neutral" : perf.avgClv >= 0 ? "good" : "bad"} hint={perf.positiveClvShare != null ? `${pct(perf.positiveClvShare, 0)} con CLV+` : undefined} />
        <Stat label="Brier" value={perf.brier == null ? "—" : perf.brier.toFixed(3)} hint="menor es mejor" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title={`Partidos de hoy (${today.length})`}>
            {today.length ? (
              <div className="grid gap-3 sm:grid-cols-2">{today.slice(0, 8).map((p) => <MatchCard key={p.match.id} item={p} />)}</div>
            ) : (
              <DataUnavailable title="No hay partidos registrados para hoy con estos filtros">
                Los partidos aparecen tras la sincronización con API-Sports / The Odds API.
              </DataUnavailable>
            )}
          </Card>

          <Card title="Mejores oportunidades" action={<Link href="/value-bets" className="text-xs text-info">Ver todas</Link>}>
            {valueBets.length ? (
              <ValueBetTable bets={valueBets} compact />
            ) : (
              <DataUnavailable title="Sin value bets en este momento">
                Se muestran cuando la probabilidad estimada supera la implícita (tras margen) con EV ≥ {pct(settings.model.min_ev, 0)} y confianza suficiente.
              </DataUnavailable>
            )}
          </Card>

          <Card title={`Próximos encuentros (${upcoming.length})`}>
            {upcoming.length ? (
              <div className="grid gap-3 sm:grid-cols-2">{upcoming.slice(0, 10).map((p) => <MatchCard key={p.match.id} item={p} />)}</div>
            ) : (
              <DataUnavailable title="Sin próximos encuentros en el rango seleccionado" />
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Predicciones destacadas">
            {featured.length ? (
              <ul className="space-y-4">
                {featured.map((s, i) => (
                  <li key={i}>
                    <Link href={`/matches/${s.match.id}`} className="text-sm font-medium hover:text-info">
                      {betLabel(s, s.match.home?.name ?? "", s.match.away?.name ?? "")}
                    </Link>
                    <div className="mb-1.5 text-xs text-muted">
                      {s.match.home?.name} vs {s.match.away?.name} · {dateTime(s.match.commence_time)}
                    </div>
                    <ProbBar estimated={s.finalProb} implied={s.impliedProb} />
                    <div className="tabular mt-1.5 flex items-center justify-between text-xs text-ink-2">
                      <span>Est. {pct(s.finalProb)} · Impl. {pct(s.impliedProb)} · @{odds(s.bestPrice)}</span>
                      <ConfidenceBadge level={s.confidence} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <DataUnavailable title="Sin predicciones con confianza suficiente" />
            )}
          </Card>

          <Card title="Rendimiento del modelo (value bets)">
            {perf.cumulative.length > 1 ? <ProfitChart data={perf.cumulative} /> : <DataUnavailable title="Aún no hay suficientes predicciones liquidadas" />}
          </Card>

          <Card title="Resultados recientes" action={<Link href="/history" className="text-xs text-info">Historial</Link>}>
            {recent?.length ? (
              <Table>
                <thead>
                  <tr><th className={th}>Selección</th><th className={`${th} text-right`}>Cuota</th><th className={th}>Resultado</th></tr>
                </thead>
                <tbody>
                  {recent.map((r) => {
                    const m = r.match as unknown as { id: number; home: { name: string } | null; away: { name: string } | null } | null;
                    return (
                      <tr key={r.id}>
                        <td className={td}>
                          <div className="text-sm">{betLabel({ market: r.market, selection: r.selection, line: r.line } as never, m?.home?.name ?? "", m?.away?.name ?? "")}</div>
                          <div className="text-xs text-muted">{m?.home?.name} vs {m?.away?.name}</div>
                        </td>
                        <td className={`${td} tabular text-right`}>{odds(Number(r.best_price))}</td>
                        <td className={td}>
                          <Badge tone={r.result.includes("won") ? "green" : r.result.includes("lost") ? "red" : "gray"}>{RESULT_LABEL[r.result]}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            ) : (
              <DataUnavailable title="Sin predicciones liquidadas todavía" />
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
