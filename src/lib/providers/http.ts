import "server-only";
import { logApiUsage } from "@/lib/services/logging";

export class ProviderError extends Error {
  constructor(public provider: string, public status: number | null, message: string) {
    super(`${provider}: ${message}`);
    this.name = "ProviderError";
  }
}

/**
 * fetch + JSON with timeout, retry on 429/5xx and usage logging.
 * `redact` removes secrets from the endpoint before it is logged.
 */
export async function fetchJson<T>(opts: {
  provider: string;
  url: string;
  headers?: Record<string, string>;
  quotaHeader?: string;
  redact?: (url: string) => string;
  timeoutMs?: number;
  retries?: number;
}): Promise<{ data: T; quotaRemaining: number | null }> {
  const { provider, url, headers, quotaHeader, timeoutMs = 15_000, retries = 2 } = opts;
  const endpoint = (opts.redact ? opts.redact(url) : url).slice(0, 500);
  let attempt = 0;
  for (;;) {
    const started = Date.now();
    let status: number | null = null;
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
      status = res.status;
      const q = quotaHeader ? res.headers.get(quotaHeader) : null;
      const quotaRemaining = q != null && q !== "" && Number.isFinite(Number(q)) ? Math.floor(Number(q)) : null;
      await logApiUsage({ provider, endpoint, status, latencyMs: Date.now() - started, quotaRemaining });
      if ((status === 429 || status >= 500) && attempt < retries) {
        attempt++;
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new ProviderError(provider, status, `HTTP ${status} ${body.slice(0, 200)}`);
      }
      return { data: (await res.json()) as T, quotaRemaining };
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      if (status == null) await logApiUsage({ provider, endpoint, status: null, latencyMs: Date.now() - started, quotaRemaining: null });
      if (attempt < retries) {
        attempt++;
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        continue;
      }
      throw new ProviderError(provider, status, e instanceof Error ? e.message : String(e));
    }
  }
}
