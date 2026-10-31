import { LeagueRowEditor, NewLeagueForm, SportToggle } from "@/components/admin/client";
import { Card, PageHeader } from "@/components/ui";
import { requireAdminPage } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function LeaguesPage() {
  await requireAdminPage();
  const db = await createClient();
  const [{ data: sports }, { data: leagues }] = await Promise.all([
    db.from("sports").select("key, name, enabled").order("sort_order"),
    db.from("leagues").select("*").order("sport_key").order("name"),
  ]);
  const h = "px-2 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted";
  return (
    <>
      <PageHeader title="Deportes y ligas" subtitle="Activa deportes y competiciones, y configura los identificadores de cada proveedor." />
      <div className="space-y-6">
        <Card title="Deportes">
          <div className="flex flex-wrap gap-6">
            {(sports ?? []).map((s) => (
              <label key={s.key} className="flex items-center gap-2 text-sm"><SportToggle sportKey={s.key} enabled={s.enabled} /> {s.name}</label>
            ))}
          </div>
        </Card>
        <Card title="Ligas y torneos">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className={h}>Liga</th><th className={h}>Activa</th><th className={h}>ID API-Sports</th><th className={h}>Clave The Odds API</th><th className={h}>Temporada</th><th className={h}>Históricas</th><th className={h} />
                </tr>
              </thead>
              <tbody>
                {(leagues ?? []).map((l) => (
                  <tr key={l.id} className="border-b border-line/60">
                    <td className="px-2 py-2"><div className="font-medium">{l.name}</div><div className="text-xs text-muted">{l.sport_key}{l.country ? ` · ${l.country}` : ""}</div></td>
                    <LeagueRowEditor league={l} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted">Temporada en formato del proveedor: fútbol/MLB/NFL/NHL «2026», NBA «2026-2027». Los torneos de tenis se añaden automáticamente desde The Odds API.</p>
        </Card>
        <Card title="Añadir competición">
          <NewLeagueForm sports={(sports ?? []).map((s) => ({ key: s.key, name: s.name }))} />
        </Card>
      </div>
    </>
  );
}
