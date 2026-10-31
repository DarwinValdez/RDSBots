import Link from "next/link";
import { Sidebar } from "@/components/Sidebar";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/services/settings";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const settings = await getSettings();
  const supabase = await createClient();
  const { data: sports } = await supabase.from("sports").select("key").eq("enabled", true);
  return (
    <div className="min-h-dvh">
      <Sidebar isAdmin={user.role === "admin"} email={user.email} modules={settings.modules} enabledSports={(sports ?? []).map((s) => s.key)} />
      <div className="lg:pl-64">
        <main className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">{children}</main>
        <footer className="mx-auto max-w-7xl px-4 pb-8 text-xs text-muted md:px-8">
          Herramienta de análisis estadístico. Las probabilidades son estimaciones, no certezas; no garantizamos resultados. +18. Juega con
          responsabilidad. <Link href="/legal" className="underline">Aviso legal</Link>
        </footer>
      </div>
    </div>
  );
}
