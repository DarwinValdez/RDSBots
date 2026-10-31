"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Option = { value: string; label: string };
const select = "rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink outline-none focus:border-info";

/** One row of URL-driven filters (sport / league / date range / custom). */
export function Filters({ sports, leagues, showSport = true, showDate = true, extra }: {
  sports?: Option[];
  leagues?: (Option & { sport: string })[];
  showSport?: boolean;
  showDate?: boolean;
  extra?: { name: string; label: string; options: Option[] }[];
}) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    if (k === "sport") p.delete("league");
    router.push(`${path}?${p.toString()}`);
  };
  const sport = params.get("sport") ?? "";
  const visibleLeagues = (leagues ?? []).filter((l) => !sport || l.sport === sport);
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      {showSport && sports && (
        <select aria-label="Deporte" className={select} value={sport} onChange={(e) => set("sport", e.target.value)}>
          <option value="">Todos los deportes</option>
          {sports.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      )}
      {leagues && (
        <select aria-label="Liga" className={select} value={params.get("league") ?? ""} onChange={(e) => set("league", e.target.value)}>
          <option value="">Todas las ligas</option>
          {visibleLeagues.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
      )}
      {showDate && (
        <>
          <select aria-label="Rango" className={select} value={params.get("range") ?? ""} onChange={(e) => set("range", e.target.value)}>
            <option value="">Próximos 7 días</option>
            <option value="today">Hoy</option>
            <option value="tomorrow">Mañana</option>
            <option value="48h">Próximas 48 h</option>
          </select>
          <input aria-label="Fecha" type="date" className={select} value={params.get("date") ?? ""} onChange={(e) => set("date", e.target.value)} />
        </>
      )}
      {extra?.map((f) => (
        <select key={f.name} aria-label={f.label} className={select} value={params.get(f.name) ?? ""} onChange={(e) => set(f.name, e.target.value)}>
          {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ))}
    </div>
  );
}

