import Link from "next/link";
import { requireAdminPage } from "@/lib/auth";

const TABS = [
  ["/admin", "Resumen y APIs"],
  ["/admin/users", "Usuarios"],
  ["/admin/leagues", "Deportes y ligas"],
  ["/admin/settings", "Configuración"],
  ["/admin/model", "Modelos y rendimiento"],
  ["/admin/logs", "Errores y actividad"],
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage();
  return (
    <>
      <nav className="mb-6 flex flex-wrap gap-1 border-b border-line pb-3">
        {TABS.map(([href, label]) => (
          <Link key={href} href={href} className="rounded-lg px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink">{label}</Link>
        ))}
      </nav>
      {children}
    </>
  );
}
