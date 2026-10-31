import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { NotConfiguredError, serverEnv } from "@/lib/env";

let client: Anthropic | null = null;

export function claude(): Anthropic {
  const apiKey = serverEnv.anthropicKey();
  if (!apiKey) throw new NotConfiguredError("Claude API");
  client ??= new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  return client;
}

export const claudeModel = () => serverEnv.claudeModel();

/**
 * Common request options: server-side refusal fallback ("default" routes by
 * refusal category so no fallback model list has to be maintained).
 */
export const FALLBACK = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
} as const satisfies Pick<Anthropic.Beta.Messages.MessageCreateParamsNonStreaming, "betas" | "fallbacks">;

export const GROUNDING_RULES = `Reglas obligatorias:
- Usa EXCLUSIVAMENTE los datos proporcionados por la plataforma (JSON o resultados de herramientas). No inventes estadísticas, lesiones, resultados, cuotas ni probabilidades.
- Las probabilidades provienen del modelo estadístico de la plataforma (Dixon–Coles/Poisson, binomial negativa, normal bivariada o Elo según el deporte, combinado con el consenso del mercado sin margen). No generes probabilidades propias ni las ajustes; puedes interpretarlas y compararlas.
- Si un dato no está disponible (por ejemplo, lesiones o estadísticas individuales), dilo explícitamente en lugar de suponerlo.
- Ninguna predicción es segura. Expresa la incertidumbre y el nivel de confianza indicado por el modelo.
- No animes a apostar ni prometas ganancias. Si procede, recuerda que el juego debe ser responsable y solo para mayores de edad.
- Responde en español, con formato Markdown claro y conciso.`;

export function textOf(msg: Anthropic.Beta.Messages.BetaMessage): string {
  return msg.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export class ClaudeRefusalError extends Error {
  constructor() {
    super("El modelo declinó responder a esta solicitud.");
  }
}
