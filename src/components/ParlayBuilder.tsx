"use client";
import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Card, DataUnavailable, Notice, Stat } from "@/components/ui";
import { dateTime, odds, pct, signedPct } from "@/lib/format";

export type ParlayOption = {
  matchId: number;
  match: string;
  league: string;
  sport: string;
  kickoff: string;
  market: "h2h" | "totals" | "spreads" | "btts";
  selection: "home" | "draw" | "away" | "over" | "under" | "yes" | "no";
  line: number | null;
  label: string;
  price: number;
  prob: number;
};

type Result = {
  combinedPrice: number;
  jointProb: number;
  jointProbModel: number;
  independentProbModel: number;
  correlationFactor: number;
  ev: number;
  evModel: number;
  impliedProb: number;
  groups: { eventId: string; legs: number; factor: number }[];
  warnings: string[];
};

const key = (o: Pick<ParlayOption, "matchId" | "market" | "selection" | "line">) => `${o.matchId}|${o.market}|${o.selection}|${o.line ?? ""}`;

export function ParlayBuilder({ options }: { options: ParlayOption[] }) {
  const [legs, setLegs] = useState<ParlayOption[]>([]);
  const [q, setQ] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return options.filter((o) => !s || o.match.toLowerCase().includes(s) || o.league.toLowerCase().includes(s));
  }, [q, options]);
  const byMatch = useMemo(() => {
    const m = new Map<number, ParlayOption[]>();
    for (const o of filtered) m.set(o.matchId, [...(m.get(o.matchId) ?? []), o]);
    return Array.from(m.values()).slice(0, 40);
  }, [filtered]);

  const toggle = (o: ParlayOption) => {
    setResult(null);
    setLegs((ls) => (ls.some((l) => key(l) === key(o)) ? ls.filter((l) => key(l) !== key(o)) : ls.length >= 12 ? ls : [...ls, o]));
  };

  async function evaluate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/parlay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ legs: legs.map(({ matchId, market, selection, line }) => ({ matchId, market, selection, line })) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error");
      setResult(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <Card title="Selecciones disponibles">
          <input
            placeholder="Buscar equipo o liga…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="mb-4 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-info"
          />
          {byMatch.length ? (
            <div className="space-y-4">
              {byMatch.map((group) => (
                <div key={group[0].matchId}>
                  <div className="mb-1.5 text-sm font-medium">{group[0].match}</div>
                  <div className="mb-2 text-xs text-muted">{group[0].league} · {dateTime(group[0].kickoff)}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {group.map((o) => {
                      const on = legs.some((l) => key(l) === key(o));
                      return (
                        <button
                          key={key(o)}
                          onClick={() => toggle(o)}
                          className={`tabular rounded-md border px-2 py-1 text-xs ${on ? "border-brand bg-brand/10 text-brand" : "border-line text-ink-2 hover:border-ink-2/40"}`}
                        >
                          {o.label} <span className="text-ink">{odds(o.price)}</span> <span className="text-muted">({pct(o.prob, 0)})</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <DataUnavailable title="No hay selecciones con cuota y modelo disponibles" />
          )}
        </Card>
      </div>
      <div className="space-y-6 lg:col-span-2">
        <Card title={`Tu combinada (${legs.length})`}>
          {legs.length ? (
            <ul className="space-y-2">
              {legs.map((l) => (
                <li key={key(l)} className="flex items-start justify-between gap-2 text-sm">
                  <div>
                    <div className="font-medium">{l.label}</div>
                    <div className="text-xs text-muted">{l.match}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="tabular">{odds(l.price)}</span>
                    <button aria-label="Quitar" onClick={() => toggle(l)} className="text-muted hover:text-bad"><Trash2 className="size-4" /></button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Selecciona al menos dos selecciones.</p>
          )}
          <button
            disabled={legs.length < 2 || loading}
            onClick={evaluate}
            className="mt-4 w-full rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-black hover:bg-brand-2 disabled:opacity-50"
          >
            {loading ? "Calculando…" : "Calcular probabilidad conjunta"}
          </button>
          {error && <p className="mt-3 text-sm text-bad">{error}</p>}
        </Card>

        {result && (
          <Card title="Resultado">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Cuota combinada" value={odds(result.combinedPrice)} hint={`implícita ${pct(result.impliedProb)}`} />
              <Stat label="Prob. conjunta" value={pct(result.jointProb, 2)} hint={`si fueran independientes: ${pct(result.correlationFactor > 0 ? result.jointProb / result.correlationFactor : 0, 2)}`} />
              <Stat label="Valor esperado" value={signedPct(result.ev)} tone={result.ev >= 0 ? "good" : "bad"} hint={`modelo exacto (con devoluciones) ${signedPct(result.evModel)}`} />
              <Stat label="Riesgo de perder" value={pct(1 - result.jointProb, 1)} tone="bad" hint="probabilidad de que falle al menos una" />
            </div>
            <div className="mt-4 space-y-2 text-sm text-ink-2">
              <p>
                Factor de correlación: <strong className="tabular text-ink">{result.correlationFactor.toFixed(3)}</strong>{" "}
                {result.correlationFactor > 1.02 ? "(las selecciones tienden a cumplirse juntas)" : result.correlationFactor < 0.98 ? "(las selecciones se perjudican entre sí)" : "(prácticamente independientes)"}.
              </p>
              {result.groups.filter((g) => g.legs > 1).map((g) => (
                <p key={g.eventId} className="text-xs">
                  Evento #{g.eventId}: {g.legs} selecciones evaluadas conjuntamente sobre la distribución de marcadores del modelo → factor <Badge>{g.factor.toFixed(3)}</Badge>
                </p>
              ))}
              {result.warnings.map((w, i) => <Notice key={i}>{w}</Notice>)}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
