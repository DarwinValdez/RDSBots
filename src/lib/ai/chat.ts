import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { betLabel } from "@/lib/model/markets";
import { fetchSoccerTopScorers } from "@/lib/providers/apiSports";
import { isSportKey, SPORTS } from "@/lib/sports";
import { analyzeMatch } from "@/lib/services/matchAnalysis";
import { loadPredictions, summarize } from "@/lib/services/performance";
import { getSettings, type Settings } from "@/lib/services/settings";
import { normalizeName, similarity } from "@/lib/services/teams";
import { extractValueBets, priceUpcoming } from "@/lib/services/valueBets";
import { analysisPayload } from "./analysis";
import { claude, claudeModel, ClaudeRefusalError, FALLBACK, GROUNDING_RULES, textOf } from "./claude";

type Tool = Anthropic.Beta.Messages.BetaTool;

const sportEnum = Object.keys(SPORTS);

const TOOLS: Tool[] = [
  {
    name: "list_matches",
    description: "Lista los próximos partidos registrados en la plataforma con probabilidades del modelo y mejor cuota del mercado principal. Úsala para '¿qué partidos hay hoy?' o para encontrar el id de un partido.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        sport: { type: ["string", "null"], description: `Uno de ${sportEnum.join(", ")}, o null para todos` },
        days_ahead: { type: "integer", description: "Días hacia adelante (1-7)" },
        team: { type: ["string", "null"], description: "Filtrar por nombre de equipo/jugador, o null" },
      },
      required: ["sport", "days_ahead", "team"],
    },
  },
  {
    name: "get_value_bets",
    description: "Devuelve las oportunidades de valor actuales (EV positivo tras margen y criterios del modelo), ordenadas por EV.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: { sport: { type: ["string", "null"], description: `Uno de ${sportEnum.join(", ")}, o null para todos` } },
      required: ["sport"],
    },
  },
  {
    name: "analyze_match",
    description: "Análisis completo de un partido por id: modelo, mercados, forma 5/10, local/visitante, descanso, historial directo, movimiento de cuotas.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: { match_id: { type: "integer" } },
      required: ["match_id"],
    },
  },
  {
    name: "compare_odds",
    description: "Cuotas de todas las casas para los mercados principales de un partido, con margen de cada casa.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: { match_id: { type: "integer" } },
      required: ["match_id"],
    },
  },
  {
    name: "model_performance",
    description: "Rendimiento histórico real del modelo: ROI, yield, win rate, CLV, Brier y calibración de predicciones registradas.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: { sport: { type: ["string", "null"], description: `Uno de ${sportEnum.join(", ")}, o null para todos` }, only_value_bets: { type: "boolean" } },
      required: ["sport", "only_value_bets"],
    },
  },
  {
    name: "soccer_player_stats",
    description: "Máximos goleadores de una liga de fútbol configurada (goles, asistencias, partidos, rating) desde API-Football.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: { league_name: { type: "string" } },
      required: ["league_name"],
    },
  },
];

const SYSTEM = `Eres el asistente deportivo de AI Betting Analyst. Respondes preguntas sobre partidos, cuotas, value bets, equipos y jugadores usando las herramientas de la plataforma.

${GROUNDING_RULES}
- Antes de afirmar algo sobre partidos, cuotas o rendimiento, consulta la herramienta correspondiente.
- Si una herramienta devuelve vacío o un error, explica que la información no está disponible en la plataforma (por ejemplo, API no configurada o sin datos) y no la sustituyas con conocimiento general.
- Cuando menciones un partido, incluye su id entre corchetes, p. ej. [#123], para que el usuario pueda abrirlo.`;

async function runTool(db: SupabaseClient, settings: Settings, name: string, input: Record<string, unknown>): Promise<unknown> {
  const pct = (x: number | null | undefined) => (x == null ? null : Math.round(x * 1000) / 10);
  switch (name) {
    case "list_matches": {
      const sport = typeof input.sport === "string" && isSportKey(input.sport) ? input.sport : undefined;
      const days = Math.min(7, Math.max(1, Number(input.days_ahead) || 1));
      const priced = await priceUpcoming(db, settings, { sport, to: new Date(Date.now() + days * 86_400_000), limit: 150 });
      const team = typeof input.team === "string" && input.team ? normalizeName(input.team) : null;
      return priced
        .filter((p) => !team || [p.match.home?.name, p.match.away?.name].some((n) => n && similarity(normalizeName(n), team) > 0.6))
        .slice(0, 40)
        .map((p) => ({
          id: p.match.id,
          deporte: p.match.sport_key,
          competicion: p.match.league?.name,
          partido: `${p.match.home?.name} vs ${p.match.away?.name}`,
          inicio: p.match.commence_time,
          cuotas: p.hasOdds,
          modelo: p.modelReason ?? "ok",
          ganador: p.selections
            .filter((s) => s.market === "h2h")
            .map((s) => ({ sel: betLabel(s, p.match.home?.name ?? "", p.match.away?.name ?? ""), prob_pct: pct(s.finalProb), cuota: s.bestPrice, ev_pct: pct(s.ev) })),
        }));
    }
    case "get_value_bets": {
      const sport = typeof input.sport === "string" && isSportKey(input.sport) ? input.sport : undefined;
      const bets = extractValueBets(await priceUpcoming(db, settings, { sport }));
      return bets.slice(0, 15).map((b) => ({
        id: b.match.id,
        partido: `${b.match.home?.name} vs ${b.match.away?.name}`,
        inicio: b.match.commence_time,
        seleccion: betLabel(b, b.match.home?.name ?? "", b.match.away?.name ?? ""),
        cuota: b.bestPrice,
        casa: b.bookmaker,
        prob_final_pct: pct(b.finalProb),
        prob_modelo_pct: pct(b.modelProb),
        prob_mercado_pct: pct(b.marketProb),
        prob_implicita_pct: pct(b.impliedProb),
        ev_pct: pct(b.ev),
        confianza: b.confidence,
      }));
    }
    case "analyze_match": {
      const a = await analyzeMatch(db, Number(input.match_id), settings);
      return a ? analysisPayload(a) : { error: "Partido no encontrado" };
    }
    case "compare_odds": {
      const a = await analyzeMatch(db, Number(input.match_id), settings);
      if (!a) return { error: "Partido no encontrado" };
      if (!a.oddsAvailable) return { error: "No hay cuotas registradas para este partido" };
      return a.selections
        .filter((s) => s.isMainLine && s.prices.length)
        .map((s) => ({
          seleccion: betLabel(s, a.match.home?.name ?? "", a.match.away?.name ?? ""),
          margen_medio_pct: pct(s.avgMargin),
          cuotas: s.prices,
        }));
    }
    case "model_performance": {
      const sport = typeof input.sport === "string" && isSportKey(input.sport) ? input.sport : undefined;
      const rows = await loadPredictions(db, { sport });
      const s = summarize(rows, settings.model.bankroll_units, !!input.only_value_bets);
      const { cumulative: _c, calibration, ...rest } = s;
      void _c;
      return { ...rest, calibracion: calibration.filter((b) => b.n > 0) };
    }
    case "soccer_player_stats": {
      const { data: leagues } = await db.from("leagues").select("name, provider_league_id, current_season").eq("sport_key", "soccer");
      const q = normalizeName(String(input.league_name ?? ""));
      const league = (leagues ?? []).map((l) => ({ l, s: similarity(normalizeName(l.name), q) })).sort((a, b) => b.s - a.s)[0];
      if (!league || league.s < 0.5 || !league.l.provider_league_id) return { error: "Liga no configurada en la plataforma" };
      try {
        return { liga: league.l.name, temporada: league.l.current_season, jugadores: await fetchSoccerTopScorers(league.l.provider_league_id, league.l.current_season) };
      } catch (e) {
        return { error: `Estadísticas de jugadores no disponibles: ${e instanceof Error ? e.message : "error"}` };
      }
    }
  }
  return { error: `Herramienta desconocida: ${name}` };
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

/** Agentic loop over platform tools; returns the final answer text. */
export async function chat(db: SupabaseClient, history: ChatTurn[]): Promise<{ answer: string; toolsUsed: string[] }> {
  const settings = await getSettings();
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = history.map((t) => ({ role: t.role, content: t.content }));
  const toolsUsed: string[] = [];

  for (let i = 0; i < 8; i++) {
    const res = await claude().beta.messages.create({
      model: claudeModel(),
      max_tokens: 8000,
      ...FALLBACK,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system: SYSTEM,
      tools: TOOLS,
      tool_choice: { type: "auto" },
      messages,
    });
    if (res.stop_reason === "refusal") throw new ClaudeRefusalError();
    messages.push({ role: "assistant", content: res.content as Anthropic.Beta.Messages.BetaContentBlockParam[] });
    if (res.stop_reason !== "tool_use") return { answer: textOf(res), toolsUsed };

    const calls = res.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use");
    const results = await Promise.all(
      calls.map(async (c) => {
        toolsUsed.push(c.name);
        try {
          const out = await runTool(db, settings, c.name, (c.input ?? {}) as Record<string, unknown>);
          return { type: "tool_result" as const, tool_use_id: c.id, content: JSON.stringify(out).slice(0, 60_000) };
        } catch (e) {
          return { type: "tool_result" as const, tool_use_id: c.id, is_error: true, content: e instanceof Error ? e.message : "Error" };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }
  return { answer: "No pude completar la consulta en un número razonable de pasos. Intenta una pregunta más específica.", toolsUsed };
}
