import { SettingsForm } from "@/components/admin/client";
import { Card, PageHeader } from "@/components/ui";
import { requireAdminPage } from "@/lib/auth";
import { getSettings } from "@/lib/services/settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireAdminPage();
  const s = await getSettings();
  return (
    <>
      <PageHeader title="Configuración" subtitle="Modelo estadístico, módulos, frecuencia de actualización y parámetros de proveedores. Los valores se validan en el servidor." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Modelo estadístico"><SettingsForm settingKey="model" value={s.model} /></Card>
        <Card title="Módulos"><SettingsForm settingKey="modules" value={s.modules} /></Card>
        <Card title="Frecuencia de actualización">
          <SettingsForm settingKey="refresh" value={s.refresh} />
          <p className="mt-3 text-xs text-muted">Vercel Cron invoca los procesos según <code>vercel.json</code>; cada proceso se omite si se ejecutó hace menos del intervalo configurado. En el plan Hobby de Vercel los cron solo pueden ejecutarse una vez al día.</p>
        </Card>
        <Card title="Proveedores"><SettingsForm settingKey="providers" value={s.providers} /></Card>
      </div>
    </>
  );
}
