import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MatchAnalysis } from "@/lib/services/matchAnalysis";
import { betLabel } from "@/lib/model/markets";
import { claude, claudeModel, ClaudeRefusalError, FALLBACK, GROUNDING_RULES, textOf } from "./claude";

const SYSTEM = `Eres el analista cuantitativo de AI Betting Analyst, una plataforma profesional de inteligencia deportiva.
Recibes el análisis estructurado de un encuentro calculado por el motor estadístico y debes explicarlo a un usuario.

${GROUNDING_RULES}

Estructura de la respuesta:
1. **Resumen** (2–3 frases): qué espera el modelo y con qué confianza.
2. **Factores principales**: forma reciente (últimos 5 y 10), rendimiento local/visitante, ataque/defensa del modelo, descanso y calendario, historial directo, movimiento de cuotas. Cita los números.
3. **Mercados**: para los mercados con cuota, compara probabilidad estimada vs implícita, margen y EV. Explica por qué existe (o no) valor.
4. **Riesgos e incertidumbre**: tamaño de muestra, discrepancia con el mercado, datos no disponibles.
No uses más de 350 palabras.`;

/** Compact, model-facing view of the analysis (only real platform data). */
export function analysisPayload(a: MatchAnalysis) {
  const home = a.match.home?.name ?? "Local";
  const away = a.match.away?.name ?? "Visitante";
  const pct = (x: number | null | undefined) => (x == null ? null : Math.round(x * 1000) / 10);
  return {
    partido: { local: home, visitante: away, competicion: a.match.league?.name, deporte: a.match.sport_key, inicio: a.match.commence_time, sede: a.match.venue },
    modelo: a.model.available
      ? {
          version: a.model.version,
          entrenado: a.model.fittedAt,
          marcador_esperado: a.model.expectedScore?.map((x) => Math.round(x * 100) / 100) ?? null,
          probabilidades_1x2_pct: a.model.outcome ? { local: pct(a.model.outcome.home), empate: pct(a.model.outcome.draw), visitante: pct(a.model.outcome.away) } : null,
          parametros_equipos: a.model.detail,
          validacion_backtest: a.model.backtest ?? "no disponible",
        }
      : { disponible: false, motivo: a.model.reason },
    mercados: a.selections
      .filter((s) => s.isMainLine)
      .map((s) => ({
        seleccion: betLabel(s, home, away),
        mercado: s.market,
        prob_modelo_pct: pct(s.modelProb),
        prob_mercado_sin_margen_pct: pct(s.marketProb),
        prob_final_pct: pct(s.finalProb),
        mejor_cuota: s.bestPrice,
        casa: s.bookmaker,
        prob_implicita_pct: pct(s.impliedProb),
        margen_casa_pct: pct(s.bookmakerMargin),
        ev_pct: pct(s.ev),
        diferencia_pct: pct(s.edge),
        confianza: s.confidence,
        value_bet: s.isValue,
        casas_cotizando: s.bookmakers,
      })),
    cuotas_disponibles: a.oddsAvailable,
    forma: { [home]: a.features.home, [away]: a.features.away },
    historial_directo: a.features.headToHead.length ? a.features.headToHead : "sin enfrentamientos registrados",
    movimiento_cuotas: a.lineMovement.length ? a.lineMovement : "sin histórico suficiente",
    lesiones: a.injuries?.length ? a.injuries : a.injuries ? "sin bajas reportadas por el proveedor" : "no disponible para este deporte/partido",
  };
}

/** Explains a match analysis with Claude; cached per identical input. */
export async function explainMatch(db: SupabaseClient, analysis: MatchAnalysis, userId: string | null) {
  const payload = analysisPayload(analysis);
  const json = JSON.stringify(payload);
  const model = claudeModel();
  const hash = createHash("sha256").update(model + json).digest("hex");

  const { data: cached } = await db.from("ai_analyses").select("content, created_at").eq("match_id", analysis.match.id).eq("input_hash", hash).maybeSingle();
  if (cached) return { content: cached.content as string, cached: true, createdAt: cached.created_at as string };

  const msg = await claude().beta.messages.create({
    model,
    max_tokens: 8000,
    ...FALLBACK,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system: SYSTEM,
    messages: [{ role: "user", content: `Datos del encuentro (JSON generado por la plataforma):\n\n${json}\n\nRedacta el análisis.` }],
  });
  if (msg.stop_reason === "refusal") throw new ClaudeRefusalError();
  const content = textOf(msg);
  await db.from("ai_analyses").upsert(
    { match_id: analysis.match.id, input_hash: hash, model, content, created_by: userId },
    { onConflict: "match_id,input_hash", ignoreDuplicates: true },
  );
  return { content, cached: false, createdAt: new Date().toISOString() };
}
