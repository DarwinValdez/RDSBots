import { CalibrationChart, ProfitChart, YieldBars } from "@/components/charts/Charts";
import { Filters } from "@/components/Filters";
import { ModuleDisabled } from "@/components/ModuleDisabled";
import { Badge, Card, DataUnavailable, PageHeader, Stat, Table, td, th } from "@/components/ui";
import { filterOptions, parseSport } from "@/lib/filters";
import { dateTime, odds, pct, RESULT_LABEL, signedPct, units } from "@/lib/format";
import { betLabel, MARKET_LABELS, type Market } from "@/lib/model/markets";
import { loadPredictions, summarize } from "@/lib/services/performance";
import { getSettings } from "@/lib/services/settings";
import { SPORTS, isSportKey } from "@/lib/sports";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Historial y rendimiento" };
export const dynamic = "force-dynamic";

export default async function HistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const settings = await getSettings();
  if (!settings.modules.history) return <ModuleDisabled name="Historial" />;
  const db = createAdminClient();
  const sport = parseSport(sp.sport);
  const onlyValue = sp.scope !== "all";
  const days = Number(sp.period) > 0 ? Number(sp.period) : 365;
  const [options, rows] = await Promise.all([filterOptions(db), loadPredictions(db, { sport, sinceDays: days })]);
  const s = summarize(rows, settings.model.bankroll_units, onlyValue);
  const visible = (onlyValue ? rows.filter((r) => r.is_value) : rows).slice(0, 150);

  const ids = Array.from(new Set(visible.map((r) => r.match_id)));
  const { data: matches } = ids.length
    ? await db.from("matches").select("id, home:teams!matches_home_team_id_fkey(name), away:teams!matches_away_team_id_fkey(name), home_score, away_score").in("id", ids)
    : { data: [] };
  const byId = new Map((matches ?? []).map((m) => [m.id, m as unknown as { home: { name: string } | null; away: { name: string } | null; home_score: number | null; away_score: number | null }]));

  return (
    <>
      <PageHeader
        title="Historial y rendimiento"
        subtitle="Cada predicción se registra automáticamente antes del inicio del evento y es inmutable: la base de datos rechaza modificaciones o borrados. Stake plano de 1 unidad."
      />
      <Filters
        sports={options.sports}
        showDate={false}
        extra={[
          { name: "scope", label: "Alcance", options: [{ value: "", label: "Solo value bets" }, { value: "all", label: "Todas las predicciones" }] },
          { name: "period", label: "Periodo", options: [{ value: "", label: "Último año" }, { value: "30", label: "30 días" }, { value: "90", label: "90 días" }, { value: "730", label: "2 años" }] },
        ]}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
        <Stat label="Registradas" value={s.recorded} hint={`${s.pending} pendientes · ${s.settled} liquidadas`} />
        <Stat label="Win rate" value={pct(s.winRate)} hint={`${s.wins}/${s.bets} (sin anuladas)`} />
        <Stat label="Beneficio" value={units(s.bets ? s.profit : null)} tone={s.profit >= 0 ? "good" : "bad"} hint={`cuota media ${odds(s.avgOdds)}`} />
        <Stat label="Yield" value={signedPct(s.yield)} tone={s.yield == null ? "neutral" : s.yield >= 0 ? "good" : "bad"} hint="beneficio / volumen apostado" />
        <Stat label="ROI" value={signedPct(s.roi)} tone={s.roi == null ? "neutral" : s.roi >= 0 ? "good" : "bad"} hint={`sobre bankroll de ${settings.model.bankroll_units}u`} />
        <Stat label="CLV medio" value={signedPct(s.avgClv)} tone={s.avgClv == null ? "neutral" : s.avgClv >= 0 ? "good" : "bad"} hint={s.positiveClvShare != null ? `${pct(s.positiveClvShare, 0)} superan el cierre` : "cuota tomada vs cierre"} />
        <Stat label="Brier" value={s.brier == null ? "—" : s.brier.toFixed(4)} hint="precisión probabilística" />
        <Stat label="Log loss" value={s.logLoss == null ? "—" : s.logLoss.toFixed(4)} />
        <Stat label="Error de calibración" value={pct(s.ece)} hint="ECE, menor es mejor" />
        <Stat label="Liquidadas" value={s.bets} hint="ganadas, perdidas y medias" />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card title="Beneficio acumulado (unidades)">
          {s.cumulative.length > 1 ? <ProfitChart data={s.cumulative} /> : <DataUnavailable title="Aún no hay suficientes resultados" />}
        </Card>
        <Card title="Calibración: probabilidad predicha vs frecuencia observada">
          {s.calibration.some((b) => b.n > 0) ? <CalibrationChart bins={s.calibration} /> : <DataUnavailable title="Sin datos de calibración" />}
          <p className="mt-2 text-xs text-muted">Puntos sobre la diagonal = bien calibrado. Tamaño = número de predicciones.</p>
        </Card>
        <Card title="Yield por deporte">
          {s.bySport.length ? <YieldBars data={s.bySport.map((x) => ({ label: isSportKey(x.sport) ? SPORTS[x.sport].name : x.sport, yield: x.yield, bets: x.bets }))} /> : <DataUnavailable title="Sin datos" />}
        </Card>
        <Card title="Yield por mercado">
          {s.byMarket.length ? <YieldBars data={s.byMarket.map((x) => ({ label: MARKET_LABELS[x.market as Market] ?? x.market, yield: x.yield, bets: x.bets }))} /> : <DataUnavailable title="Sin datos" />}
        </Card>
      </div>

      <Card title="Registro de predicciones">
        {visible.length ? (
          <Table>
            <thead>
              <tr>
                <th className={th}>Registrada</th>
                <th className={th}>Partido</th>
                <th className={th}>Predicción</th>
                <th className={`${th} text-right`}>Prob.</th>
                <th className={`${th} text-right`}>Cuota</th>
                <th className={`${th} text-right`}>Cierre</th>
                <th className={`${th} text-right`}>CLV</th>
                <th className={th}>Resultado</th>
                <th className={`${th} text-right`}>Beneficio</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const m = byId.get(r.match_id);
                return (
                  <tr key={r.id}>
                    <td className={`${td} tabular whitespace-nowrap text-xs text-muted`}>{dateTime(r.created_at)}<div>inicio {dateTime(r.kickoff_at)}</div></td>
                    <td className={td}>
                      {m?.home?.name} vs {m?.away?.name}
                      {m?.home_score != null && <span className="tabular ml-1 text-muted">({m.home_score}-{m.away_score})</span>}
                    </td>
                    <td className={td}>{betLabel({ market: r.market as Market, selection: r.selection as never, line: r.line == null ? null : Number(r.line) }, m?.home?.name ?? "Local", m?.away?.name ?? "Visitante")}</td>
                    <td className={`${td} tabular text-right`}>{pct(Number(r.final_prob))}</td>
                    <td className={`${td} tabular text-right`}>{odds(Number(r.best_price))}<div className="text-xs text-muted">{r.bookmaker}</div></td>
                    <td className={`${td} tabular text-right text-ink-2`}>{r.closing_price ? odds(Number(r.closing_price)) : "—"}</td>
                    <td className={`${td} tabular text-right`}>{signedPct(r.clv == null ? null : Number(r.clv))}</td>
                    <td className={td}><Badge tone={r.result.includes("won") ? "green" : r.result.includes("lost") ? "red" : r.result === "void" ? "gray" : "blue"}>{RESULT_LABEL[r.result]}</Badge></td>
                    <td className={`${td} tabular text-right`}>{r.profit == null ? "—" : units(Number(r.profit))}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <DataUnavailable title="Todavía no hay predicciones registradas">Se registran automáticamente con el job de predicción para los partidos con cuotas y modelo.</DataUnavailable>
        )}
      </Card>
    </>
  );
}
