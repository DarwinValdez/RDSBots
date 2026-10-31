import { UserControls } from "@/components/admin/client";
import { Badge, Card, PageHeader, Table, td, th } from "@/components/ui";
import { requireAdminPage } from "@/lib/auth";
import { date } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const me = await requireAdminPage();
  const db = await createClient();
  const { data: users } = await db.from("profiles").select("id, email, display_name, role, is_active, age_confirmed_at, created_at").order("created_at", { ascending: false }).limit(500);
  return (
    <>
      <PageHeader title="Usuarios" subtitle="Roles y estado de acceso. Los cambios quedan registrados en el log de actividad." />
      <Card>
        <Table>
          <thead><tr><th className={th}>Usuario</th><th className={th}>Rol</th><th className={th}>Estado</th><th className={th}>+18</th><th className={th}>Alta</th><th className={th}>Acciones</th></tr></thead>
          <tbody>
            {(users ?? []).map((u) => (
              <tr key={u.id}>
                <td className={td}><div className="font-medium">{u.display_name}</div><div className="text-xs text-muted">{u.email}</div></td>
                <td className={td}><Badge tone={u.role === "admin" ? "blue" : "gray"}>{u.role}</Badge></td>
                <td className={td}><Badge tone={u.is_active ? "green" : "red"}>{u.is_active ? "Activo" : "Desactivado"}</Badge></td>
                <td className={td}>{u.age_confirmed_at ? "Sí" : "No"}</td>
                <td className={`${td} tabular`}>{date(u.created_at)}</td>
                <td className={td}>{u.id === me.id ? <span className="text-xs text-muted">Tu cuenta</span> : <UserControls id={u.id} role={u.role} active={u.is_active} />}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
