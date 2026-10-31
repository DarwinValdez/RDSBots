/**
 * Turns a model score distribution plus bookmaker prices into priced
 * selections: estimated probability, implied probability, margin, EV, edge
 * and confidence. Pure and deterministic — used both for live views and for
 * the immutable prediction log.
 */
import type { ScoreGrid } from "./grid";
import { betOutcomeProbs, effectiveWinProb, marketSupported, type Bet, type Market, type Selection } from "./markets";
import { blendProb, devigShin, overround } from "./odds";
import { confidenceLevel, type Confidence } from "./confidence";

export type OddsRow = { bookmaker: string; market: Market; selection: Selection; line: number | null; price: number };

export type EngineSettings = {
  marketBlendWeight: number;
  minEv: number;
  minEdge: number;
  maxOdds: number;
  requiredSample: number;
};

export type PricedSelection = {
  market: Market;
  selection: Selection;
  line: number | null;
  isMainLine: boolean;
  modelProb: number;
  marketProb: number | null;
  finalProb: number;
  bestPrice: number | null;
  bookmaker: string | null;
  impliedProb: number | null;
  bookmakerMargin: number | null;
  avgMargin: number | null;
  ev: number | null;
  edge: number | null;
  /** probability the stake is returned (whole / quarter lines) */
  pushProb: number;
  confidence: Confidence;
  isValue: boolean;
  bookmakers: number;
  prices: { bookmaker: string; price: number }[];
};

type Group = { market: Market; key: string; bets: Bet[] };

function groupsFromOdds(odds: OddsRow[], hasDraw: boolean): Group[] {
  const groups = new Map<string, Group>();
  const put = (market: Market, key: string, bets: Bet[]) => {
    if (!groups.has(`${market}|${key}`)) groups.set(`${market}|${key}`, { market, key, bets });
  };
  for (const o of odds) {
    if (o.market === "h2h") {
      put("h2h", "", (hasDraw ? ["home", "draw", "away"] : ["home", "away"]).map((s) => ({ market: "h2h", selection: s as Selection, line: null })));
    } else if (o.market === "totals" && o.line != null) {
      put("totals", String(o.line), [
        { market: "totals", selection: "over", line: o.line },
        { market: "totals", selection: "under", line: o.line },
      ]);
    } else if (o.market === "spreads" && o.line != null) {
      const homeLine = o.selection === "home" ? o.line : -o.line;
      put("spreads", String(homeLine), [
        { market: "spreads", selection: "home", line: homeLine },
        { market: "spreads", selection: "away", line: -homeLine },
      ]);
    } else if (o.market === "btts") {
      put("btts", "", [
        { market: "btts", selection: "yes", line: null },
        { market: "btts", selection: "no", line: null },
      ]);
    }
  }
  return Array.from(groups.values());
}

const sameBet = (o: OddsRow, b: Bet) => o.market === b.market && o.selection === b.selection && (o.line ?? null) === (b.line ?? null);

export function priceSelections(opts: {
  sport: string;
  grid: ScoreGrid;
  odds: OddsRow[];
  hasDraw: boolean;
  minTeamSample: number;
  settings: EngineSettings;
  /** add model-only selections for these markets when no odds exist */
  modelOnlyMarkets?: Market[];
}): PricedSelection[] {
  const { sport, grid, odds, hasDraw, settings } = opts;
  const groups = groupsFromOdds(odds.filter((o) => marketSupported(sport, o.market)), hasDraw);
  for (const m of opts.modelOnlyMarkets ?? []) {
    if (!marketSupported(sport, m) || groups.some((g) => g.market === m)) continue;
    if (m === "btts") groups.push({ market: "btts", key: "", bets: [{ market: "btts", selection: "yes", line: null }, { market: "btts", selection: "no", line: null }] });
    if (m === "h2h") groups.push({ market: "h2h", key: "", bets: (hasDraw ? ["home", "draw", "away"] : ["home", "away"]).map((s) => ({ market: "h2h" as Market, selection: s as Selection, line: null })) });
  }

  const out: PricedSelection[] = [];
  const groupStats: { market: Market; key: string; books: number; balance: number; items: PricedSelection[] }[] = [];

  for (const g of groups) {
    const outcome = g.bets.map((b) => betOutcomeProbs(grid, b));
    const modelProbs = outcome.map(effectiveWinProb);

    // bookmakers quoting the complete group → margin and de-vigged probabilities
    const books = Array.from(new Set(odds.filter((o) => g.bets.some((b) => sameBet(o, b))).map((o) => o.bookmaker)));
    const fair: number[][] = [];
    const margins: Record<string, number> = {};
    for (const book of books) {
      const prices = g.bets.map((b) => odds.find((o) => o.bookmaker === book && sameBet(o, b))?.price);
      if (prices.some((p) => p == null)) continue;
      margins[book] = overround(prices as number[]);
      fair.push(devigShin(prices as number[]));
    }
    const consensus = fair.length ? g.bets.map((_, i) => fair.reduce((s, f) => s + f[i], 0) / fair.length) : null;

    // logarithmic pool per outcome, renormalised within the group
    let final = modelProbs.map((p, i) => blendProb(p, consensus ? consensus[i] : null, settings.marketBlendWeight));
    const s = final.reduce((a, b) => a + b, 0);
    final = final.map((p) => p / s);

    const marginVals = Object.values(margins);
    const avgMargin = marginVals.length ? marginVals.reduce((a, b) => a + b, 0) / marginVals.length : null;
    const items: PricedSelection[] = g.bets.map((bet, i) => {
      const quotes = odds.filter((o) => sameBet(o, bet)).map((o) => ({ bookmaker: o.bookmaker, price: o.price }));
      quotes.sort((a, b) => b.price - a.price);
      const best = quotes[0] ?? null;
      const o = outcome[i];
      const live = o.win + 0.5 * o.halfWin + o.loss + 0.5 * o.halfLoss;
      const p = final[i];
      const ev = best ? live * (p * best.price - 1) : null; // exact with pushes / half results
      const implied = best ? 1 / best.price : null;
      const edge = implied != null ? p - implied : null;
      const confidence = confidenceLevel({
        minTeamSample: opts.minTeamSample,
        requiredSample: settings.requiredSample,
        modelProb: modelProbs[i],
        marketProb: consensus ? consensus[i] : null,
        bookmakers: fair.length,
      });
      const isValue =
        best != null && ev != null && edge != null &&
        ev >= settings.minEv && edge >= settings.minEdge && best.price <= settings.maxOdds && confidence !== "low";
      return {
        market: bet.market,
        selection: bet.selection,
        line: bet.line,
        isMainLine: false,
        modelProb: modelProbs[i],
        marketProb: consensus ? consensus[i] : null,
        finalProb: p,
        bestPrice: best?.price ?? null,
        bookmaker: best?.bookmaker ?? null,
        impliedProb: implied,
        bookmakerMargin: best ? (margins[best.bookmaker] ?? null) : null,
        avgMargin,
        ev,
        edge,
        pushProb: o.push + 0.5 * o.halfWin + 0.5 * o.halfLoss,
        confidence,
        isValue,
        bookmakers: fair.length,
        prices: quotes,
      };
    });
    const balance = consensus ? Math.abs(consensus[0] - 0.5) : 1;
    groupStats.push({ market: g.market, key: g.key, books: fair.length, balance, items });
    out.push(...items);
  }

  // main line per market: most bookmakers, then most balanced
  for (const market of ["h2h", "totals", "spreads", "btts"] as Market[]) {
    const gs = groupStats.filter((g) => g.market === market);
    gs.sort((a, b) => b.books - a.books || a.balance - b.balance);
    if (gs[0]) gs[0].items.forEach((i) => (i.isMainLine = true));
  }
  return out;
}
