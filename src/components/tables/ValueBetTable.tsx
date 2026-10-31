import Link from "next/link";
import { ConfidenceBadge, Table, td, th } from "@/components/ui";
import { dateTime, odds, pct, signedPct } from "@/lib/format";
import { betLabel, MARKET_LABELS } from "@/lib/model/markets";
import type { ValueBet } from "@/lib/services/valueBets";

export function justification(b: ValueBet) {
  const parts = [
    `Modelo ${pct(b.modelProb)}`,
    b.marketProb != null ? `mercado sin margen ${pct(b.marketProb)}` : "sin consenso de mercado",
    `final ${pct(b.finalProb)} vs implícita ${pct(b.impliedProb)}`,
    `margen ${pct(b.bookmakerMargin)}`,
    `${b.bookmakers} casas`,
  ];
  return parts.join(" · ");
}

export function ValueBetTable({ bets, compact = false }: { bets: ValueBet[]; compact?: boolean }) {
  return (
    <Table>
      <thead>
        <tr>
          <th className={th}>Partido</th>
          <th className={th}>Mercado</th>
          {!compact && <th className={th}>Casa</th>}
          <th className={`${th} text-right`}>Cuota</th>
          <th className={`${th} text-right`}>Prob. est.</th>
          {!compact && <th className={`${th} text-right`}>Prob. impl.</th>}
          <th className={`${th} text-right`}>EV</th>
          {!compact && <th className={th}>Fecha</th>}
          {!compact && <th className={th}>Justificación estadística</th>}
        </tr>
      </thead>
      <tbody>
        {bets.map((b, i) => (
          <tr key={i} className="hover:bg-surface-2/60">
            <td className={td}>
              <Link href={`/matches/${b.match.id}`} className="font-medium hover:text-info">
                {b.match.home?.name} vs {b.match.away?.name}
              </Link>
              <div className="text-xs text-muted">{b.match.league?.name}</div>
            </td>
            <td className={td}>
              <div>{betLabel(b, b.match.home?.name ?? "Local", b.match.away?.name ?? "Visitante")}</div>
              <div className="text-xs text-muted">{MARKET_LABELS[b.market]}</div>
            </td>
            {!compact && <td className={`${td} text-ink-2`}>{b.bookmaker}</td>}
            <td className={`${td} tabular text-right font-semibold`}>{odds(b.bestPrice)}</td>
            <td className={`${td} tabular text-right`}>{pct(b.finalProb)}</td>
            {!compact && <td className={`${td} tabular text-right text-ink-2`}>{pct(b.impliedProb)}</td>}
            <td className={`${td} tabular text-right font-semibold text-brand`}>{signedPct(b.ev)}</td>
            {!compact && <td className={`${td} tabular whitespace-nowrap text-ink-2`}>{dateTime(b.match.commence_time)}</td>}
            {!compact && (
              <td className={`${td} text-xs text-muted`}>
                <div className="mb-1"><ConfidenceBadge level={b.confidence} /></div>
                {justification(b)}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
