import { CheckCircle2, XCircle } from "lucide-react";
import { RunJobButton } from "@/components/admin/client";
import { Badge, Card, DataUnavailable, PageHeader, Table, td, th } from "@/components/ui";
import { providerStatus } from "@/lib/env";
import { dateTime } from "@/lib/format";
import { requireAdminPage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/services/modelRuns";

export const metadata = { title: "Administración" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requireAdminPage();
  const db = await createClient();
  const status = providerStatus();
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [usage, { data: jobs }, { count: users }, { count: matches }, { count: predictions }] = await Promise.all([
    fetchAll<{ provider: string; status: number | null; latency_ms: number | null; quota_remaining: number | null; created_at: string }>((from, to) =>
      db.from("api_usage").select("provider, status, latency_ms, quota_remaining, created_at").gte("created_at", since).order("created_at", { ascending: false }).range(from, to),
    ),
    db.from("job_runs").select("id, job, status, details, started_at, finished_at").neq("status", "skipped").order("started_at", { ascending: false }).limit(15),
    db.from("profiles").select("id", { count: "exact", head: true }),
    db.from("matches").select("id", { count: "exact", head: true }),
    db.from("predictions").select("id", { count: "exact", head: true }),
  ]);

  const dayAgo = Date.now() - 86_400_000;
  const byProvider = new Map<string, { calls24: number; calls7: number; errors: number; latency: number; quota: number | null }>();
  for (const u of usage) {
    const p = byProvider.get(u.provider) ?? { calls24: 0, calls7: 0, errors: 0, latency: 0, quota: null };
    p.calls7++;
    if (new Date(u.created_at).getTime() > dayAgo) p.calls24++;
    if (u.status == null || u.status >= 400) p.errors++;
    p.latency += u.latency_ms ?? 0;
    if (p.quota == null && u.quota_remaining != null) p.quota = u.quota_remaining; // newest first
    byProvider.set(u.provider, p);
  }

  const providers = [
    ["Supabase", status.supabase && status.supabaseService],
    ["API-Sports", status.apiSports],
    ["The Odds API", status.oddsApi],
    ["Claude API", status.anthropic],
    ["Cron secret", status.cron],
  ] as const;

  return (
    <>
      <PageHeader title="Panel de administración" subtitle={`${users ?? 0} usuarios · ${matches ?? 0} partidos · ${predictions ?? 0} predicciones registradas`} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Configuración de APIs">
          <ul className="space-y-2 text-sm">
            {providers.map(([name, ok]) => (
              <li key={name} className="flex items-center gap-2">
                {ok ? <CheckCircle2 className="size-4 text-brand" /> : <XCircle className="size-4 text-bad" />}
                {name}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted">
            Las claves se gestionan como variables de entorno del servidor (Vercel → Settings → Environment Variables) y nunca se almacenan en la base de datos ni se envían al navegador. Regiones y mercados de cuotas: pestaña Configuración.
          </p>
        </Card>

        <Card title="Ejecutar procesos" className="lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <RunJobButton job="sync-fixtures" label="Sincronizar calendario y resultados" />
            <RunJobButton job="sync-fixtures" label="Importar temporadas históricas" backfill />
            <RunJobButton job="sync-odds" label="Sincronizar cuotas" />
            <RunJobButton job="predict" label="Entrenar modelos y registrar predicciones" />
            <RunJobButton job="settle" label="Liquidar predicciones" />
          </div>
          <p className="mt-4 text-xs text-muted">Los procesos programados (Vercel Cron) respetan la frecuencia configurada; la ejecución manual la ignora.</p>
        </Card>

        <Card title="Consumo de APIs (7 días)" className="lg:col-span-3">
          {byProvider.size ? (
            <Table>
              <thead>
                <tr>
                  <th className={th}>Proveedor</th><th className={`${th} text-right`}>Llamadas 24 h</th><th className={`${th} text-right`}>Llamadas 7 d</th>
                  <th className={`${th} text-right`}>Errores</th><th className={`${th} text-right`}>Latencia media</th><th className={`${th} text-right`}>Cuota restante</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(byProvider.entries()).map(([name, p]) => (
                  <tr key={name}>
                    <td className={td}>{name}</td>
                    <td className={`${td} tabular text-right`}>{p.calls24}</td>
                    <td className={`${td} tabular text-right`}>{p.calls7}</td>
                    <td className={`${td} tabular text-right ${p.errors ? "text-bad" : ""}`}>{p.errors}</td>
                    <td className={`${td} tabular text-right`}>{Math.round(p.latency / Math.max(1, p.calls7))} ms</td>
                    <td className={`${td} tabular text-right`}>{p.quota ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <DataUnavailable title="Sin llamadas registradas en los últimos 7 días" />
          )}
        </Card>

        <Card title="Últimas ejecuciones" className="lg:col-span-3">
          {jobs?.length ? (
            <Table>
              <thead><tr><th className={th}>Proceso</th><th className={th}>Estado</th><th className={th}>Inicio</th><th className={th}>Detalle</th></tr></thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td className={td}>{j.job}</td>
                    <td className={td}><Badge tone={j.status === "success" ? "green" : j.status === "error" ? "red" : "blue"}>{j.status}</Badge></td>
                    <td className={`${td} tabular whitespace-nowrap`}>{dateTime(j.started_at)}</td>
                    <td className={`${td} max-w-xl`}><code className="line-clamp-3 break-all text-xs text-muted">{JSON.stringify(j.details)}</code></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <DataUnavailable title="Aún no se ha ejecutado ningún proceso" />
          )}
        </Card>
      </div>
    </>
  );
}
