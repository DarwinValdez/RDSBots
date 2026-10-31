"use client";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { Markdown } from "./Markdown";

export function AiAnalysis({ matchId, enabled }: { matchId: number; enabled: boolean }) {
  const [state, setState] = useState<{ loading: boolean; content?: string; error?: string; cached?: boolean }>({ loading: false });
  async function run() {
    setState({ loading: true });
    try {
      const res = await fetch(`/api/matches/${matchId}/analysis`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error");
      setState({ loading: false, content: json.content, cached: json.cached });
    } catch (e) {
      setState({ loading: false, error: e instanceof Error ? e.message : "Error" });
    }
  }
  if (!enabled) return <p className="text-sm text-muted">El módulo de análisis IA está desactivado.</p>;
  return (
    <div>
      {!state.content && (
        <button
          onClick={run}
          disabled={state.loading}
          className="inline-flex items-center gap-2 rounded-lg bg-info px-3 py-2 text-sm font-medium text-white hover:bg-info/90 disabled:opacity-60"
        >
          <Sparkles className="size-4" /> {state.loading ? "Analizando datos…" : "Generar explicación con Claude"}
        </button>
      )}
      {state.error && <p className="mt-3 text-sm text-bad">{state.error}</p>}
      {state.content && (
        <div>
          <Markdown text={state.content} />
          <p className="mt-3 text-xs text-muted">
            Generado por Claude a partir de los datos y probabilidades del modelo de la plataforma{state.cached ? " (en caché)" : ""}. No es una garantía de resultado.
          </p>
        </div>
      )}
    </div>
  );
}
