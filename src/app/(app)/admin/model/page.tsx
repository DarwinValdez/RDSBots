import { CalibrationChart } from "@/components/charts/Charts";
import { Card, DataUnavailable, PageHeader, Table, td, th } from "@/components/ui";
import { requireAdminPage } from "@/lib/auth";
import { dateTime, pct, signedPct, units } from "@/lib/format";
import { loadPredictions, summarize } from "@/lib/services/performance";
import { getSettings } from "@/lib/services/settings";
import { SPORT_KEYS, SPORTS } from "@/lib/sports";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Backtest = { matchesEvaluated: number; model: { brier: number; logLoss: number; ece: number }; baseline: { brier: number; logLoss: number }; skillVsBaseline: number; calibration: { meanPred: number; observed: number; n: number }[] };

export default async function ModelPage() {
  await requireAdminPage();
  const db = createAdminClient();
  const settings = await getSettings();
  const [{ data: runs }, { data: leagues }, rows] = await Promise.all([
    db.from("model_runs").select("id, sport_key, league_id, model_version, params, n_matches, metrics, fitted_at").order("fitted_at", { ascending: false }).limit(200),
    db.from("leagues").select("id, name"),
    loadPredictions(db, { sinceDays: 365 }),
  ]);
  const leagueName = new Map((leagues ?? []).map((l) => [l.id, l.name]));
  const latest = new Map<string, NonNullable<typeof runs>[number]>();
  for (const r of runs ?? []) {
    const k = `${r.sport_key}|${r.league_id}`;
    if (!latest.has(k)) latest.set(k, r);
  }
  const withBacktest = Array.from(latest.values()).find((r) => (r.metrics as { backtest?: Backtest } | null)?.backtest);

  return (
    <>
      <PageHeader title="Modelos y rendimiento" subtitle="Último ajuste por competición, validación walk-forward y rendimiento real de las predicciones registradas." />
      <div className="space-y-6">
        <Card title="Modelos activos">
          {latest.size ? (
            <Table>
              <thead>
                <tr>
                  <th className={th}>Competición</th><th className={th}>Familia</th><th className={`${th} text-right`}>Partidos</th><th className={`${th} text-right`}>Brier</th>
                  <th className={`${th} text-right`}>Brier base</th><th className={`${th} text-right`}>Skill</th><th className={`${th} text-right`}>ECE</th><th className={th}>Ajustado</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(latest.values()).map((r) => {
                  const bt = (r.metrics as { backtest?: Backtest } | null)?.backtest;
                  return (
                    <tr key={r.id}>
                      <td className={td}>{r.league_id ? leagueName.get(r.league_id) : SPORTS[r.sport_key as keyof typeof SPORTS]?.name}</td>
                      <td className={`${td} text-ink-2`}>{String((r.params as { family?: string }).family)} · {r.model_version}</td>
                      <td className={`${td} tabular text-right`}>{r.n_matches}</td>
                      <td className={`${td} tabular text-right`}>{bt ? bt.model.brier.toFixed(4) : "—"}</td>
                      <td className={`${td} tabular text-right text-ink-2`}>{bt ? bt.baseline.brier.toFixed(4) : "—"}</td>
                      <td className={`${td} tabular text-right ${bt && bt.skillVsBaseline > 0 ? "text-brand" : ""}`}>{bt ? signedPct(bt.skillVsBaseline) : "—"}</td>
                      <td className={`${td} tabular text-right`}>{bt ? pct(bt.model.ece) : "—"}</td>
                      <td className={`${td} tabular whitespace-nowrap`}>{dateTime(r.fitted_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          ) : (
            <DataUnavailable title="Ningún modelo entrenado aún">Ejecuta la sincronización de calendario (con temporadas históricas) y luego el proceso de predicción.</DataUnavailable>
          )}
          <p className="mt-3 text-xs text-muted">Skill = 1 − Brier(modelo)/Brier(frecuencias base), evaluado sin fuga de información (cada partido se predice solo con datos anteriores).</p>
        </Card>

        {withBacktest && (
          <Card title={`Calibración en backtest · ${withBacktest.league_id ? leagueName.get(withBacktest.league_id) : withBacktest.sport_key}`}>
            <CalibrationChart bins={(withBacktest.metrics as { backtest: Backtest }).backtest.calibration} />
          </Card>
        )}

        <Card title="Rendimiento real por deporte (todas las predicciones registradas)">
          <Table>
            <thead>
              <tr>
                <th className={th}>Deporte</th><th className={`${th} text-right`}>Liquidadas</th><th className={`${th} text-right`}>Win rate</th><th className={`${th} text-right`}>Beneficio</th>
                <th className={`${th} text-right`}>Yield</th><th className={`${th} text-right`}>CLV</th><th className={`${th} text-right`}>Brier</th><th className={`${th} text-right`}>ECE</th>
              </tr>
            </thead>
            <tbody>
              {SPORT_KEYS.map((k) => {
                const s = summarize(rows.filter((r) => r.sport_key === k), settings.model.bankroll_units, false);
                return (
                  <tr key={k}>
                    <td className={td}>{SPORTS[k].name}</td>
                    <td className={`${td} tabular text-right`}>{s.bets}</td>
                    <td className={`${td} tabular text-right`}>{pct(s.winRate)}</td>
                    <td className={`${td} tabular text-right`}>{s.bets ? units(s.profit) : "—"}</td>
                    <td className={`${td} tabular text-right`}>{signedPct(s.yield)}</td>
                    <td className={`${td} tabular text-right`}>{signedPct(s.avgClv)}</td>
                    <td className={`${td} tabular text-right`}>{s.brier == null ? "—" : s.brier.toFixed(4)}</td>
                    <td className={`${td} tabular text-right`}>{pct(s.ece)}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}
