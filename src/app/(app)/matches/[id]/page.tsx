import { notFound } from "next/navigation";
import { AiAnalysis } from "@/components/AiAnalysis";
import { Badge, Card, ConfidenceBadge, DataUnavailable, Notice, PageHeader, ProbBar, Stat, Table, td, th } from "@/components/ui";
import { date, dateTime, odds, pct, signedPct } from "@/lib/format";
import { betLabel, MARKET_LABELS, type Market } from "@/lib/model/markets";
import type { PricedSelection } from "@/lib/model/engine";
import { analyzeMatch, type FormLine, type TeamFeatures } from "@/lib/services/matchAnalysis";
import { getSettings } from "@/lib/services/settings";
import { SPORTS } from "@/lib/sports";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Backtest = { matchesEvaluated: number; model: { brier: number; logLoss: number; ece: number }; baseline: { brier: number }; skillVsBaseline: number; from: string | null; to: string | null };

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const db = await createClient();
  const settings = await getSettings();
  const a = await analyzeMatch(db, id, settings);
  if (!a) notFound();
  const { match: m } = a;
  const home = m.home?.name ?? "Local", away = m.away?.name ?? "Visitante";
  const cfg = SPORTS[m.sport_key];
  const main = a.selections.filter((s) => s.isMainLine);
  const others = a.selections.filter((s) => !s.isMainLine && s.bestPrice != null);
  const backtest = a.model.backtest as Backtest | undefined;
  const started = new Date(m.commence_time) <= new Date();

  return (
    <>
      <PageHeader
        title={`${home} vs ${away}`}
        subtitle={`${m.league?.name ?? cfg.name} · ${dateTime(m.commence_time)}${m.venue ? ` · ${m.venue}` : ""}${m.round ? ` · ${m.round}` : ""}`}
        actions={
          m.status === "finished" ? (
            <div className="tabular text-2xl font-semibold">{m.home_score} – {m.away_score}</div>
          ) : (
            <Badge tone={m.status === "live" ? "red" : "blue"}>{m.status === "live" ? "En vivo" : m.status === "scheduled" ? "Programado" : m.status}</Badge>
          )
        }
      />

      {!a.model.available && (
        <div className="mb-6">
          <Notice>Modelo no disponible para este encuentro: {a.model.reason ?? "sin datos"}. No se muestran probabilidades estimadas.</Notice>
        </div>
      )}
      {!a.oddsAvailable && (
        <div className="mb-6">
          <DataUnavailable title="Sin cuotas registradas para este encuentro">Requiere The Odds API configurada y el evento listado por las casas.</DataUnavailable>
        </div>
      )}

      {a.model.outcome && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={home} value={pct(a.model.outcome.home)} hint="prob. modelo" />
          {cfg.hasDraw && <Stat label="Empate" value={pct(a.model.outcome.draw)} hint="prob. modelo" />}
          <Stat label={away} value={pct(a.model.outcome.away)} hint="prob. modelo" />
          {a.model.expectedScore && (
            <Stat label={`Marcador esperado (${cfg.scoreUnit})`} value={`${a.model.expectedScore[0].toFixed(2)} – ${a.model.expectedScore[1].toFixed(2)}`} hint={`modelo ${a.model.version} · ${a.model.fittedAt ? date(a.model.fittedAt) : ""}`} />
          )}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Predicciones por mercado">
            {main.length ? <SelectionTable rows={main} home={home} away={away} /> : <DataUnavailable title="Sin mercados evaluables" />}
            {started && <p className="mt-3 text-xs text-muted">El evento ya comenzó: las cuotas mostradas son las últimas registradas antes o durante el evento.</p>}
          </Card>

          {others.length > 0 && (
            <Card title="Otras líneas">
              <SelectionTable rows={others} home={home} away={away} />
            </Card>
          )}

          <Card title="Comparador de cuotas">
            {main.some((s) => s.prices.length) ? (
              <Table>
                <thead>
                  <tr><th className={th}>Selección</th><th className={th}>Casas (mejor primero)</th><th className={`${th} text-right`}>Margen medio</th></tr>
                </thead>
                <tbody>
                  {main.filter((s) => s.prices.length).map((s, i) => (
                    <tr key={i}>
                      <td className={td}>{betLabel(s, home, away)}</td>
                      <td className={td}>
                        <div className="flex flex-wrap gap-1.5">
                          {s.prices.slice(0, 10).map((p, j) => (
                            <span key={j} className={`tabular rounded-md border px-2 py-0.5 text-xs ${j === 0 ? "border-brand/50 text-brand" : "border-line text-ink-2"}`}>
                              {p.bookmaker} {odds(p.price)}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className={`${td} tabular text-right text-ink-2`}>{pct(s.avgMargin)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <DataUnavailable title="Sin cuotas para comparar" />
            )}
          </Card>

          <Card title="Análisis explicado (IA)">
            <AiAnalysis matchId={m.id} enabled={settings.modules.ai_analysis} />
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Forma reciente">
            <FormBlock name={home} f={a.features.home} venue="local" hasDraw={cfg.hasDraw} />
            <div className="my-4 border-t border-line" />
            <FormBlock name={away} f={a.features.away} venue="visitante" hasDraw={cfg.hasDraw} />
          </Card>

          <Card title="Historial directo">
            {a.features.headToHead.length ? (
              <ul className="space-y-1.5 text-sm">
                {a.features.headToHead.map((h, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="truncate text-ink-2">{h.home} vs {h.away}</span>
                    <span className="tabular shrink-0">{h.score} <span className="text-xs text-muted">· {date(h.date)}</span></span>
                  </li>
                ))}
              </ul>
            ) : (
              <DataUnavailable title="Sin enfrentamientos registrados" />
            )}
          </Card>

          <Card title="Movimiento de cuotas">
            {a.lineMovement.length ? (
              <ul className="space-y-2 text-sm">
                {a.lineMovement.map((l, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="text-ink-2">{betLabel({ market: l.market, selection: l.selection as never, line: l.line }, home, away)}</span>
                    <span className="tabular">
                      {odds(l.opening)} → {odds(l.current)}{" "}
                      <span className={l.changePct < 0 ? "text-bad" : "text-brand"}>({signedPct(l.changePct)})</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <DataUnavailable title="Sin histórico de cuotas suficiente" />
            )}
          </Card>

          <Card title="Lesiones y ausencias">
            <DataUnavailable title={m.sport_key === "soccer" ? "Se consultan a API-Football al generar el análisis IA" : "No disponible para este deporte"} />
          </Card>

          <Card title="Validación del modelo">
            {backtest ? (
              <dl className="tabular grid grid-cols-2 gap-y-1.5 text-sm">
                <dt className="text-muted">Partidos evaluados</dt><dd className="text-right">{backtest.matchesEvaluated}</dd>
                <dt className="text-muted">Brier modelo</dt><dd className="text-right">{backtest.model.brier.toFixed(4)}</dd>
                <dt className="text-muted">Brier base</dt><dd className="text-right">{backtest.baseline.brier.toFixed(4)}</dd>
                <dt className="text-muted">Skill vs base</dt><dd className="text-right">{signedPct(backtest.skillVsBaseline)}</dd>
                <dt className="text-muted">Log loss</dt><dd className="text-right">{backtest.model.logLoss.toFixed(4)}</dd>
                <dt className="text-muted">Error calibración</dt><dd className="text-right">{pct(backtest.model.ece)}</dd>
              </dl>
            ) : (
              <DataUnavailable title="Backtest no disponible todavía" />
            )}
            <p className="mt-3 text-xs text-muted">Walk-forward: cada predicción usa solo partidos anteriores a su fecha.</p>
          </Card>
        </div>
      </div>
    </>
  );
}

function SelectionTable({ rows, home, away }: { rows: PricedSelection[]; home: string; away: string }) {
  const order: Market[] = ["h2h", "spreads", "totals", "btts"];
  const sorted = [...rows].sort((a, b) => order.indexOf(a.market) - order.indexOf(b.market) || (a.line ?? 0) - (b.line ?? 0));
  return (
    <Table>
      <thead>
        <tr>
          <th className={th}>Selección</th>
          <th className={`${th} w-40`}>Prob. estimada</th>
          <th className={`${th} text-right`}>Cuota</th>
          <th className={`${th} text-right`}>Implícita</th>
          <th className={`${th} text-right`}>Margen</th>
          <th className={`${th} text-right`}>Diferencia</th>
          <th className={`${th} text-right`}>EV</th>
          <th className={th}>Confianza</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((s, i) => (
          <tr key={i} className={s.isValue ? "bg-brand/5" : undefined}>
            <td className={td}>
              <div className="font-medium">{betLabel(s, home, away)}</div>
              <div className="text-xs text-muted">
                {MARKET_LABELS[s.market]} · modelo {pct(s.modelProb)}{s.marketProb != null ? ` · mercado ${pct(s.marketProb)}` : ""}
                {s.pushProb > 0.001 ? ` · devolución ${pct(s.pushProb)}` : ""}
              </div>
            </td>
            <td className={td}>
              <div className="tabular mb-1 text-sm">{pct(s.finalProb)}</div>
              <ProbBar estimated={s.finalProb} implied={s.impliedProb} />
            </td>
            <td className={`${td} tabular text-right font-semibold`}>{odds(s.bestPrice)}<div className="text-xs font-normal text-muted">{s.bookmaker ?? ""}</div></td>
            <td className={`${td} tabular text-right text-ink-2`}>{pct(s.impliedProb)}</td>
            <td className={`${td} tabular text-right text-ink-2`}>{pct(s.bookmakerMargin)}</td>
            <td className={`${td} tabular text-right`}>{signedPct(s.edge)}</td>
            <td className={`${td} tabular text-right font-semibold ${s.ev != null && s.ev > 0 ? "text-brand" : "text-ink-2"}`}>{signedPct(s.ev)}</td>
            <td className={td}>
              <div className="flex flex-col items-start gap-1">
                <ConfidenceBadge level={s.confidence} />
                {s.isValue && <Badge tone="green">Value</Badge>}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function FormBlock({ name, f, venue, hasDraw }: { name: string; f: TeamFeatures; venue: string; hasDraw: boolean }) {
  const line = (label: string, x: FormLine) => (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-muted">{label}</span>
      <span className="tabular text-right">
        {x.matches ? `${x.wins}V ${hasDraw ? `${x.draws}E ` : ""}${x.losses}D · ${x.avgScored?.toFixed(2)} / ${x.avgConceded?.toFixed(2)}` : "sin datos"}
      </span>
    </div>
  );
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="font-medium">{name}</span>
        <span className="font-mono text-xs tracking-widest">
          {f.last5.sequence.split("").map((c, i) => (
            <span key={i} className={c === "W" ? "text-brand" : c === "L" ? "text-bad" : "text-ink-2"}>{c === "W" ? "V" : c === "L" ? "D" : "E"}</span>
          ))}
        </span>
      </div>
      {line("Últimos 5", f.last5)}
      {line("Últimos 10", f.last10)}
      {line(`Como ${venue} (10)`, f.venueForm)}
      <div className="flex justify-between text-sm"><span className="text-muted">Descanso</span><span className="tabular">{f.restDays != null ? `${f.restDays} días` : "—"} · {f.matchesLast14Days} partidos/14d</span></div>
      <p className="text-xs text-muted">V/E/D · a favor / en contra por partido</p>
    </div>
  );
}
