import { Card, DataUnavailable, PageHeader, Table, td, th } from "@/components/ui";
import { requireAdminPage } from "@/lib/auth";
import { dateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function LogsPage() {
  await requireAdminPage();
  const db = await createClient();
  const [{ data: errors }, { data: activity }] = await Promise.all([
    db.from("error_logs").select("id, source, message, context, created_at").order("created_at", { ascending: false }).limit(100),
    db.from("activity_logs").select("id, user_id, action, details, ip, created_at").order("created_at", { ascending: false }).limit(100),
  ]);
  const ids = Array.from(new Set((activity ?? []).map((a) => a.user_id).filter(Boolean)));
  const { data: profiles } = ids.length ? await db.from("profiles").select("id, email").in("id", ids) : { data: [] };
  const email = new Map((profiles ?? []).map((p) => [p.id, p.email]));
  return (
    <>
      <PageHeader title="Errores y actividad" />
      <div className="space-y-6">
        <Card title="Errores recientes">
          {errors?.length ? (
            <Table>
              <thead><tr><th className={th}>Fecha</th><th className={th}>Origen</th><th className={th}>Mensaje</th></tr></thead>
              <tbody>
                {errors.map((e) => (
                  <tr key={e.id}>
                    <td className={`${td} tabular whitespace-nowrap`}>{dateTime(e.created_at)}</td>
                    <td className={`${td} font-mono text-xs`}>{e.source}</td>
                    <td className={td}><div className="text-sm">{e.message}</div>{e.context && <code className="text-xs text-muted">{JSON.stringify(e.context)}</code>}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <DataUnavailable title="Sin errores registrados" />
          )}
        </Card>
        <Card title="Registro de actividad">
          {activity?.length ? (
            <Table>
              <thead><tr><th className={th}>Fecha</th><th className={th}>Usuario</th><th className={th}>Acción</th><th className={th}>Detalle</th><th className={th}>IP</th></tr></thead>
              <tbody>
                {activity.map((a) => (
                  <tr key={a.id}>
                    <td className={`${td} tabular whitespace-nowrap`}>{dateTime(a.created_at)}</td>
                    <td className={td}>{a.user_id ? email.get(a.user_id) ?? a.user_id : "sistema"}</td>
                    <td className={`${td} font-mono text-xs`}>{a.action}</td>
                    <td className={td}><code className="break-all text-xs text-muted">{JSON.stringify(a.details)}</code></td>
                    <td className={`${td} text-xs text-muted`}>{a.ip ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <DataUnavailable title="Sin actividad registrada" />
          )}
        </Card>
      </div>
    </>
  );
}
