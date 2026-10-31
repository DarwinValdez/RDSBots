import Link from "next/link";
import { Badge } from "@/components/ui";
import { dateTime, odds, pct } from "@/lib/format";
import type { PricedMatch } from "@/lib/services/valueBets";

export function MatchCard({ item }: { item: PricedMatch }) {
  const { match: m, selections } = item;
  const h2h = selections.filter((s) => s.market === "h2h");
  const values = selections.filter((s) => s.isValue).length;
  const label = (sel: string) => (sel === "home" ? "1" : sel === "draw" ? "X" : "2");
  const finished = m.status === "finished";
  return (
    <Link href={`/matches/${m.id}`} className="block rounded-xl border border-line bg-surface p-4 transition-colors hover:border-ink-2/30 hover:bg-surface-2">
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span className="truncate">{m.league?.name ?? m.sport_key}</span>
        <span className="tabular shrink-0">{m.status === "live" ? <Badge tone="red">En vivo</Badge> : dateTime(m.commence_time)}</span>
      </div>
      <div className="mt-3 space-y-1.5">
        {[m.home, m.away].map((t, i) => (
          <div key={i} className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {t?.logo_url ? <img src={t.logo_url} alt="" className="size-5 shrink-0 object-contain" /> : <span className="size-5 shrink-0 rounded-full bg-surface-3" />}
              <span className="truncate text-sm font-medium">{t?.name ?? "—"}</span>
            </div>
            {finished && <span className="tabular text-sm font-semibold">{i === 0 ? m.home_score : m.away_score}</span>}
          </div>
        ))}
      </div>
      <div className="mt-4">
        {h2h.length ? (
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${h2h.length}, minmax(0, 1fr))` }}>
            {h2h.map((s) => (
              <div key={s.selection} className={`rounded-lg border px-2 py-1.5 text-center ${s.isValue ? "border-brand/50 bg-brand/5" : "border-line bg-surface-2"}`}>
                <div className="text-[10px] text-muted">{label(s.selection)}</div>
                <div className="tabular text-sm font-semibold">{pct(s.finalProb, 0)}</div>
                <div className="tabular text-[11px] text-ink-2">{odds(s.bestPrice)}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-muted">{item.modelReason ?? "Sin cuotas disponibles"}</div>
        )}
      </div>
      {(values > 0 || !item.hasOdds) && (
        <div className="mt-3 flex gap-2">
          {values > 0 && <Badge tone="green">{values} value bet{values > 1 ? "s" : ""}</Badge>}
          {!item.hasOdds && <Badge>Sin cuotas</Badge>}
        </div>
      )}
    </Link>
  );
}
