"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

async function call(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

const btn = "rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs font-medium text-ink hover:border-info disabled:opacity-50";
const input = "rounded-md border border-line bg-surface-2 px-2 py-1 text-sm outline-none focus:border-info";

export function RunJobButton({ job, label, backfill }: { job: string; label: string; backfill?: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      <button
        className={btn}
        disabled={state === "…"}
        onClick={async () => {
          setState("…");
          try {
            const r = await call("/api/admin/jobs", "POST", { job, backfill });
            setState(r.status === "success" ? "OK" : r.status);
          } catch (e) {
            setState(e instanceof Error ? e.message : "error");
          }
          router.refresh();
        }}
      >
        {label}
      </button>
      {state && <span className="text-xs text-muted">{state}</span>}
    </div>
  );
}

export function SportToggle({ sportKey, enabled }: { sportKey: string; enabled: boolean }) {
  const router = useRouter();
  return (
    <input
      type="checkbox"
      checked={enabled}
      aria-label={`Activar ${sportKey}`}
      onChange={async (e) => {
        await call("/api/admin/sports", "PATCH", { key: sportKey, enabled: e.target.checked });
        router.refresh();
      }}
    />
  );
}

type League = { id: number; enabled: boolean; current_season: string | null; history_seasons: string[]; odds_sport_key: string | null; provider_league_id: number | null };

export function LeagueRowEditor({ league }: { league: League }) {
  const router = useRouter();
  const [season, setSeason] = useState(league.current_season ?? "");
  const [history, setHistory] = useState(league.history_seasons.join(","));
  const [oddsKey, setOddsKey] = useState(league.odds_sport_key ?? "");
  const [providerId, setProviderId] = useState(league.provider_league_id?.toString() ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const save = async (extra: Partial<League> = {}) => {
    setMsg(null);
    try {
      await call("/api/admin/leagues", "PATCH", {
        id: league.id,
        current_season: season || null,
        history_seasons: history.split(",").map((s) => s.trim()).filter(Boolean),
        odds_sport_key: oddsKey || null,
        provider_league_id: providerId ? Number(providerId) : null,
        ...extra,
      });
      setMsg("Guardado");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "error");
    }
  };
  return (
    <>
      <td className="px-2 py-2"><input type="checkbox" checked={league.enabled} onChange={(e) => save({ enabled: e.target.checked })} aria-label="Activa" /></td>
      <td className="px-2 py-2"><input className={`${input} w-20`} value={providerId} onChange={(e) => setProviderId(e.target.value)} placeholder="—" /></td>
      <td className="px-2 py-2"><input className={`${input} w-48`} value={oddsKey} onChange={(e) => setOddsKey(e.target.value)} placeholder="—" /></td>
      <td className="px-2 py-2"><input className={`${input} w-24`} value={season} onChange={(e) => setSeason(e.target.value)} /></td>
      <td className="px-2 py-2"><input className={`${input} w-36`} value={history} onChange={(e) => setHistory(e.target.value)} placeholder="2025,2024" /></td>
      <td className="px-2 py-2">
        <button className={btn} onClick={() => save()}>Guardar</button>
        {msg && <span className="ml-2 text-xs text-muted">{msg}</span>}
      </td>
    </>
  );
}

export function NewLeagueForm({ sports }: { sports: { key: string; name: string }[] }) {
  const router = useRouter();
  const [f, setF] = useState({ sport_key: sports[0]?.key ?? "soccer", name: "", country: "", provider_league_id: "", odds_sport_key: "", current_season: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setMsg(null);
        try {
          await call("/api/admin/leagues", "POST", {
            sport_key: f.sport_key,
            name: f.name,
            country: f.country || null,
            provider_league_id: f.provider_league_id ? Number(f.provider_league_id) : null,
            odds_sport_key: f.odds_sport_key || null,
            current_season: f.current_season || null,
          });
          setMsg("Liga creada");
          router.refresh();
        } catch (err) {
          setMsg(err instanceof Error ? err.message : "error");
        }
      }}
    >
      <select className={input} value={f.sport_key} onChange={set("sport_key")}>{sports.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}</select>
      <input className={input} placeholder="Nombre" required value={f.name} onChange={set("name")} />
      <input className={`${input} w-28`} placeholder="País" value={f.country} onChange={set("country")} />
      <input className={`${input} w-28`} placeholder="ID API-Sports" value={f.provider_league_id} onChange={set("provider_league_id")} />
      <input className={`${input} w-48`} placeholder="Clave The Odds API" value={f.odds_sport_key} onChange={set("odds_sport_key")} />
      <input className={`${input} w-28`} placeholder="Temporada" value={f.current_season} onChange={set("current_season")} />
      <button className={btn}>Añadir liga</button>
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </form>
  );
}

const LABELS: Record<string, string> = {
  dashboard: "Dashboard", value_bets: "Value Bets", parlays: "Parlays", history: "Historial", chat: "Chat IA", ai_analysis: "Análisis IA de partidos",
  time_decay_half_life_days: "Vida media del decaimiento temporal (días)",
  market_blend_weight: "Peso del consenso de mercado (0 = solo modelo, 1 = solo mercado)",
  min_ev: "EV mínimo para value bet (0.02 = 2%)",
  min_edge: "Diferencia mínima prob. estimada − implícita",
  min_matches_per_team: "Partidos efectivos mínimos por equipo",
  prediction_window_hours: "Registrar predicciones con antelación de (horas)",
  max_odds: "Cuota máxima para value bets",
  bankroll_units: "Bankroll de referencia para ROI (unidades)",
  sync_fixtures_minutes: "Sincronizar calendario/resultados cada (min)",
  sync_odds_minutes: "Sincronizar cuotas cada (min)",
  predict_minutes: "Reentrenar y registrar predicciones cada (min)",
  settle_minutes: "Liquidar predicciones cada (min)",
  odds_regions: "Regiones de casas (The Odds API)",
  odds_markets: "Mercados (The Odds API)",
};

export function SettingsForm({ settingKey, value }: { settingKey: string; value: Record<string, unknown> }) {
  const router = useRouter();
  const [v, setV] = useState(value);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setMsg(null);
        try {
          await call("/api/admin/settings", "PUT", { key: settingKey, value: v });
          setMsg("Guardado");
          router.refresh();
        } catch (err) {
          setMsg(err instanceof Error ? err.message : "error");
        }
      }}
    >
      {Object.entries(v).map(([k, val]) => (
        <label key={k} className="flex items-center justify-between gap-4 text-sm">
          <span className="text-ink-2">{LABELS[k] ?? k}</span>
          {typeof val === "boolean" ? (
            <input type="checkbox" checked={val} onChange={(e) => setV({ ...v, [k]: e.target.checked })} />
          ) : typeof val === "number" ? (
            <input type="number" step="any" className={`${input} w-28 text-right`} value={String(val)} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} />
          ) : (
            <input className={`${input} w-48`} value={String(val)} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
          )}
        </label>
      ))}
      <div className="flex items-center gap-3">
        <button className={btn}>Guardar</button>
        {msg && <span className="text-xs text-muted">{msg}</span>}
      </div>
    </form>
  );
}
