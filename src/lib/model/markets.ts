import { forEachCell, type ScoreGrid } from "./grid";

export type Market = "h2h" | "totals" | "spreads" | "btts";
export type Selection = "home" | "draw" | "away" | "over" | "under" | "yes" | "no";

export type Bet = { market: Market; selection: Selection; line: number | null };

/** Fractions of a cell that settle as each outcome (remainder = full loss). */
export type CellOutcome = { win: number; push: number; halfWin: number; halfLoss: number };

const LOSS: CellOutcome = { win: 0, push: 0, halfWin: 0, halfLoss: 0 };
const WIN: CellOutcome = { win: 1, push: 0, halfWin: 0, halfLoss: 0 };
const PUSH: CellOutcome = { win: 0, push: 1, halfWin: 0, halfLoss: 0 };

/** Settles a margin d (selection's score minus line threshold) for whole/half lines. */
function settleMargin(d: number): CellOutcome {
  if (d > 1e-9) return WIN;
  if (d < -1e-9) return LOSS;
  return PUSH;
}

/**
 * Asian quarter lines (x.25 / x.75) are half stake on each neighbouring line.
 * `marginAt(line)` returns the settlement margin for a given line.
 */
function settleLine(line: number, marginAt: (l: number) => number): CellOutcome {
  const frac = Math.abs(line * 4) % 2; // 1 for quarter lines
  if (Math.abs(frac - 1) > 1e-9) return settleMargin(marginAt(line));
  const a = settleMargin(marginAt(line - 0.25));
  const b = settleMargin(marginAt(line + 0.25));
  const parts = [a, b];
  const out = { ...LOSS };
  const wins = parts.filter((x) => x.win === 1).length;
  const pushes = parts.filter((x) => x.push === 1).length;
  // Adjacent half-lines on integer scores: never one win and one loss.
  if (wins === 2) out.win = 1;
  else if (wins === 1 && pushes === 1) out.halfWin = 1;
  else if (pushes === 1) out.halfLoss = 1;
  return out;
}

/**
 * Outcome of a bet for final score (h, a). `tieShareHome` is the probability
 * the home side wins a regulation tie in overtime (no-draw sports).
 */
export function cellOutcome(bet: Bet, h: number, a: number, grid: ScoreGrid, tieShareHome: number): CellOutcome {
  const { market, selection, line } = bet;
  switch (market) {
    case "h2h": {
      if (h === a) {
        if (!grid.noDraw) return selection === "draw" ? WIN : LOSS;
        if (selection === "home") return { ...LOSS, win: tieShareHome };
        if (selection === "away") return { ...LOSS, win: 1 - tieShareHome };
        return LOSS;
      }
      if (selection === "home") return h > a ? WIN : LOSS;
      if (selection === "away") return a > h ? WIN : LOSS;
      return LOSS;
    }
    case "totals": {
      if (line == null) return LOSS;
      const total = h + a;
      return settleLine(line, (l) => (selection === "over" ? total - l : l - total));
    }
    case "spreads": {
      if (line == null) return LOSS;
      const diff = selection === "home" ? h - a : a - h;
      return settleLine(line, (l) => diff + l);
    }
    case "btts": {
      const both = h > 0 && a > 0;
      return (selection === "yes") === both ? WIN : LOSS;
    }
  }
}

export function tieShareHome(grid: ScoreGrid): number {
  let hw = 0, aw = 0;
  forEachCell(grid, (h, a, p) => {
    if (h > a) hw += p;
    else if (a > h) aw += p;
  });
  return hw + aw > 0 ? hw / (hw + aw) : 0.5;
}

export type OutcomeProbs = { win: number; push: number; halfWin: number; halfLoss: number; loss: number };

export function betOutcomeProbs(grid: ScoreGrid, bet: Bet): OutcomeProbs {
  const share = tieShareHome(grid);
  const acc = { win: 0, push: 0, halfWin: 0, halfLoss: 0 };
  forEachCell(grid, (h, a, p) => {
    const o = cellOutcome(bet, h, a, grid, share);
    acc.win += p * o.win;
    acc.push += p * o.push;
    acc.halfWin += p * o.halfWin;
    acc.halfLoss += p * o.halfLoss;
  });
  const loss = Math.max(0, 1 - acc.win - acc.push - acc.halfWin - acc.halfLoss);
  return { ...acc, loss };
}

/**
 * Single "win probability" used for display, edge and calibration. A half-win
 * is half win + half push; a half-loss is half loss + half push. Excluding the
 * push mass makes this directly comparable with 1/price: EV > 0 ⇔ p > 1/price.
 */
export function effectiveWinProb(o: OutcomeProbs): number {
  const winMass = o.win + 0.5 * o.halfWin;
  const lossMass = o.loss + 0.5 * o.halfLoss;
  const live = winMass + lossMass;
  return live <= 1e-12 ? 0 : winMass / live;
}

/** Expected profit per 1 unit staked at decimal `price`. */
export function expectedValue(o: OutcomeProbs, price: number): number {
  return o.win * (price - 1) + o.halfWin * ((price - 1) / 2) - o.halfLoss * 0.5 - o.loss;
}

export function marketSupported(sport: string, market: Market): boolean {
  if (sport === "tennis") return market === "h2h";
  if (market === "btts") return sport === "soccer";
  return true;
}

export function betLabel(bet: Bet, home: string, away: string): string {
  const l = bet.line;
  switch (bet.market) {
    case "h2h":
      return bet.selection === "home" ? home : bet.selection === "away" ? away : "Empate";
    case "totals":
      return `${bet.selection === "over" ? "Más de" : "Menos de"} ${l}`;
    case "spreads":
      return `${bet.selection === "home" ? home : away} ${l != null && l > 0 ? "+" : ""}${l}`;
    case "btts":
      return `Ambos anotan: ${bet.selection === "yes" ? "Sí" : "No"}`;
  }
}

export const MARKET_LABELS: Record<Market, string> = {
  h2h: "Ganador",
  totals: "Over/Under",
  spreads: "Hándicap",
  btts: "Ambos anotan",
};
