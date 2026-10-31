import { describe, expect, it } from "vitest";
import { countGrid } from "./grid";
import { priceSelections, type OddsRow } from "./engine";

const settings = { marketBlendWeight: 0.5, minEv: 0.02, minEdge: 0.01, maxOdds: 10, requiredSample: 6 };

function book(name: string, h: number, d: number, a: number, over: number, under: number): OddsRow[] {
  return [
    { bookmaker: name, market: "h2h", selection: "home", line: null, price: h },
    { bookmaker: name, market: "h2h", selection: "draw", line: null, price: d },
    { bookmaker: name, market: "h2h", selection: "away", line: null, price: a },
    { bookmaker: name, market: "totals", selection: "over", line: 2.5, price: over },
    { bookmaker: name, market: "totals", selection: "under", line: 2.5, price: under },
  ];
}

describe("priceSelections", () => {
  const grid = countGrid({ lambdaHome: 1.7, lambdaAway: 1.0, rho: -0.05, noDraw: false });
  const odds = [
    ...book("A", 1.95, 3.5, 4.2, 1.95, 1.9),
    ...book("B", 1.9, 3.6, 4.1, 1.92, 1.92),
    ...book("C", 2.1, 3.3, 3.9, 1.9, 1.95), // generous on home
    { bookmaker: "A", market: "totals", selection: "over", line: 3.5, price: 3.1 } as OddsRow,
    { bookmaker: "A", market: "totals", selection: "under", line: 3.5, price: 1.36 } as OddsRow,
  ];
  const out = priceSelections({ sport: "soccer", grid, odds, hasDraw: true, minTeamSample: 20, settings, modelOnlyMarkets: ["btts"] });

  it("produces a probability-coherent 1X2", () => {
    const h2h = out.filter((s) => s.market === "h2h");
    expect(h2h).toHaveLength(3);
    expect(h2h.reduce((s, x) => s + x.finalProb, 0)).toBeCloseTo(1, 9);
    expect(h2h.every((x) => x.bookmakers === 3 && x.bookmakerMargin! > 0)).toBe(true);
  });

  it("takes the best price and flags value only when EV clears the threshold", () => {
    const home = out.find((s) => s.market === "h2h" && s.selection === "home")!;
    expect(home.bestPrice).toBe(2.1);
    expect(home.bookmaker).toBe("C");
    expect(home.ev).toBeCloseTo(home.finalProb * 2.1 - 1, 9);
    expect(home.isValue).toBe(home.ev! >= 0.02 && home.edge! >= 0.01);
  });

  it("chooses the most-quoted line as main line and adds model-only BTTS", () => {
    const main = out.filter((s) => s.market === "totals" && s.isMainLine);
    expect(main.every((s) => s.line === 2.5)).toBe(true);
    const btts = out.filter((s) => s.market === "btts");
    expect(btts).toHaveLength(2);
    expect(btts[0].bestPrice).toBeNull();
    expect(btts[0].isValue).toBe(false);
  });

  it("never marks low-confidence selections as value", () => {
    const thin = priceSelections({ sport: "soccer", grid, odds, hasDraw: true, minTeamSample: 2, settings });
    expect(thin.some((s) => s.isValue)).toBe(false);
  });
});
