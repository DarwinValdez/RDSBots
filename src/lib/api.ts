import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { HttpError } from "@/lib/auth";
import { NotConfiguredError } from "@/lib/env";
import { ClaudeRefusalError } from "@/lib/ai/claude";
import { logError } from "@/lib/services/logging";

/** Uniform error handling for route handlers (no internals leaked to clients). */
export function handler<A extends unknown[]>(source: string, fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      if (e instanceof ZodError) return NextResponse.json({ error: "Datos inválidos", issues: e.issues.map((i) => i.message) }, { status: 400 });
      if (e instanceof NotConfiguredError)
        return NextResponse.json({ error: `${e.provider} no está configurado`, notConfigured: e.provider }, { status: 503 });
      if (e instanceof ClaudeRefusalError) return NextResponse.json({ error: e.message }, { status: 422 });
      await logError(source, e);
      return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
  };
}
