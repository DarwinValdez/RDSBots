import { describe, expect, it } from "vitest";
import { binaryGrid, countGrid, forEachCell, gridSummary, normalGrid } from "./grid";
import { betOutcomeProbs, effectiveWinProb, expectedValue, type Bet } from "./markets";
import { blendProb, devigProportional, devigShin, overround } from "./odds";
import { fitRatings, matchGrid, expectedScores, type HistoricalMatch } from "./ratings";
import { evaluateParlay } from "./parlay";
import { walkForwardBacktest } from "./backtest";
import { fitElo, eloExpected } from "./elo";

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}
function poissonSample(lambda: number, r: () => number) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do {
    k++;
    p *= r();
  } while (p > L);
  return k - 1;
}

function sum(g: ReturnType<typeof countGrid>) {
  let s = 0;
  forEachCell(g, (_h, _a, p) => (s += p));
  return s;
}

describe("score grids", () => {
  it("poisson grid sums to 1 and matches expected goals", () => {
    const g = countGrid({ lambdaHome: 1.6, lambdaAway: 1.1, noDraw: false });
    expect(sum(g)).toBeCloseTo(1, 9);
    const s = gridSummary(g);
    expect(s.expectedHome).toBeCloseTo(1.6, 3);
    expect(s.expectedAway).toBeCloseTo(1.1, 3);
    expect(s.home + s.draw + s.away).toBeCloseTo(1, 9);
  });

  it("dixon-coles with negative rho increases draws 0-0/1-1", () => {
    const a = gridSummary(countGrid({ lambdaHome: 1.3, lambdaAway: 1.1, noDraw: false }));
    const b = gridSummary(countGrid({ lambdaHome: 1.3, lambdaAway: 1.1, rho: -0.1, noDraw: false }));
    expect(b.draw).toBeGreaterThan(a.draw);
  });

  it("normal grid reproduces means", () => {
    const g = normalGrid({ muHome: 114, muAway: 110, sd: 12, corr: 0.2 });
    const s = gridSummary(g);
    expect(s.expectedHome).toBeCloseTo(114, 0);
    expect(s.expectedAway).toBeCloseTo(110, 0);
    expect(s.home).toBeGreaterThan(0.5);
  });
});

describe("markets", () => {
  const g = countGrid({ lambdaHome: 1.5, lambdaAway: 1.2, noDraw: false });

  it("1X2 probabilities sum to one", () => {
    const p = (selection: "home" | "draw" | "away") => betOutcomeProbs(g, { market: "h2h", selection, line: null }).win;
    expect(p("home") + p("draw") + p("away")).toBeCloseTo(1, 9);
  });

  it("over + under complement on half lines; whole lines push", () => {
    const o = betOutcomeProbs(g, { market: "totals", selection: "over", line: 2.5 });
    const u = betOutcomeProbs(g, { market: "totals", selection: "under", line: 2.5 });
    expect(o.win + u.win).toBeCloseTo(1, 9);
    const o3 = betOutcomeProbs(g, { market: "totals", selection: "over", line: 3 });
    expect(o3.push).toBeGreaterThan(0);
  });

  it("asian quarter line splits stake", () => {
    const q = betOutcomeProbs(g, { market: "totals", selection: "over", line: 2.25 });
    expect(q.halfLoss).toBeGreaterThan(0); // total = 2 → half on 2.0 pushes, half on 2.5 loses
    expect(q.win + q.halfLoss + q.loss + q.push + q.halfWin).toBeCloseTo(1, 9);
  });

  it("spread home -0.5 equals home win", () => {
    const s = betOutcomeProbs(g, { market: "spreads", selection: "home", line: -0.5 }).win;
    const h = betOutcomeProbs(g, { market: "h2h", selection: "home", line: null }).win;
    expect(s).toBeCloseTo(h, 9);
  });

  it("EV sign agrees with effective probability vs implied", () => {
    const bets: Bet[] = [
      { market: "totals", selection: "over", line: 2.25 },
      { market: "spreads", selection: "away", line: 0 },
      { market: "h2h", selection: "draw", line: null },
    ];
    for (const bet of bets) {
      const o = betOutcomeProbs(g, bet);
      const p = effectiveWinProb(o);
      for (const price of [1.5, 2, 3.5, 5]) {
        expect(Math.sign(expectedValue(o, price))).toBe(Math.sign(p - 1 / price) || 0);
      }
    }
  });

  it("no-draw sports split regulation ties", () => {
    const ng = countGrid({ lambdaHome: 3.1, lambdaAway: 2.8, noDraw: true });
    const h = betOutcomeProbs(ng, { market: "h2h", selection: "home", line: null }).win;
    const a = betOutcomeProbs(ng, { market: "h2h", selection: "away", line: null }).win;
    expect(h + a).toBeCloseTo(1, 9);
  });
});

describe("odds", () => {
  it("removes margin", () => {
    const prices = [1.9, 3.6, 4.2];
    expect(overround(prices)).toBeGreaterThan(0);
    for (const fn of [devigProportional, devigShin]) {
      const p = fn(prices);
      expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    }
    // Shin shifts probability from the longshot toward the favourite
    expect(devigShin(prices)[0]).toBeGreaterThan(devigProportional(prices)[0]);
  });

  it("blend is between model and market", () => {
    const b = blendProb(0.6, 0.5, 0.5);
    expect(b).toBeGreaterThan(0.5);
    expect(b).toBeLessThan(0.6);
    expect(blendProb(0.6, null, 0.5)).toBe(0.6);
  });
});

function simulateLeague(seed: number, seasons = 2) {
  const r = rng(seed);
  const n = 12;
  const att = Array.from({ length: n }, (_, i) => 0.7 + (0.6 * i) / (n - 1));
  const def = Array.from({ length: n }, (_, i) => 1.3 - (0.6 * i) / (n - 1));
  const matches: HistoricalMatch[] = [];
  let day = 0;
  for (let s = 0; s < seasons; s++) {
    for (let rep = 0; rep < 2; rep++) {
      for (let h = 0; h < n; h++) {
        for (let a = 0; a < n; a++) {
          if (h === a) continue;
          day += 0.5;
          matches.push({
            home: h + 1, away: a + 1,
            homeScore: poissonSample(1.5 * att[h] * def[a], r),
            awayScore: poissonSample(1.1 * att[a] * def[h], r),
            date: new Date(Date.UTC(2024, 0, 1) + day * 86_400_000),
          });
        }
      }
    }
  }
  return { matches, att, def };
}

describe("ratings", () => {
  it("recovers the strength ordering from simulated data", () => {
    const { matches } = simulateLeague(7);
    const asOf = new Date(matches[matches.length - 1].date.getTime() + 1);
    const m = fitRatings(matches, { family: "poisson_dc", halfLifeDays: 10_000, asOf });
    expect(m.muHome).toBeGreaterThan(m.muAway);
    expect(m.teams["12"].att).toBeGreaterThan(m.teams["1"].att);
    expect(m.teams["12"].def).toBeLessThan(m.teams["1"].def);
    const [eh, ea] = expectedScores(m, 12, 1)!;
    expect(eh).toBeGreaterThan(ea);
    expect(matchGrid(m, 12, 1, false, false)).not.toBeNull();
  });

  it("walk-forward backtest beats base rates on structured data", () => {
    const { matches } = simulateLeague(11, 3);
    const rep = walkForwardBacktest(matches, { family: "poisson_dc", halfLifeDays: 365, hasDraw: true, refitDays: 30 });
    expect(rep).not.toBeNull();
    expect(rep!.skillVsBaseline).toBeGreaterThan(0);
  });
});

describe("parlay", () => {
  it("captures same-event correlation exactly", () => {
    const g = countGrid({ lambdaHome: 1.8, lambdaAway: 0.9, noDraw: false });
    const grids = new Map([["e1", g]]);
    const home = betOutcomeProbs(g, { market: "h2h", selection: "home", line: null }).win;
    const over = betOutcomeProbs(g, { market: "totals", selection: "over", line: 2.5 }).win;
    const res = evaluateParlay(
      [
        { eventId: "e1", bet: { market: "h2h", selection: "home", line: null }, price: 1.7, finalProb: home },
        { eventId: "e1", bet: { market: "totals", selection: "over", line: 2.5 }, price: 1.9, finalProb: over },
      ],
      grids,
    );
    expect(res.correlationFactor).toBeGreaterThan(1); // home win and goals are positively related
    expect(res.combinedPrice).toBeCloseTo(3.23, 6);
  });

  it("flags mutually exclusive legs", () => {
    const g = countGrid({ lambdaHome: 1.4, lambdaAway: 1.2, noDraw: false });
    const res = evaluateParlay(
      [
        { eventId: "e", bet: { market: "h2h", selection: "home", line: null }, price: 2.2, finalProb: 0.45 },
        { eventId: "e", bet: { market: "h2h", selection: "away", line: null }, price: 3.1, finalProb: 0.3 },
      ],
      new Map([["e", g]]),
    );
    expect(res.jointProb).toBe(0);
  });

  it("independent events multiply", () => {
    const a = binaryGrid(0.6), b = binaryGrid(0.5);
    const res = evaluateParlay(
      [
        { eventId: "a", bet: { market: "h2h", selection: "home", line: null }, price: 1.8, finalProb: 0.6 },
        { eventId: "b", bet: { market: "h2h", selection: "away", line: null }, price: 2.1, finalProb: 0.5 },
      ],
      new Map([["a", a], ["b", b]]),
    );
    expect(res.jointProbModel).toBeCloseTo(0.3, 9);
    expect(res.correlationFactor).toBeCloseTo(1, 9);
  });
});

describe("elo", () => {
  it("rates the consistent winner higher", () => {
    const ms = Array.from({ length: 20 }, (_, i) => ({ winner: 1, loser: 2, date: new Date(2025, 0, i + 1) }));
    const r = fitElo(ms, new Date(2026, 0, 1));
    expect(eloExpected(r["1"].rating, r["2"].rating)).toBeGreaterThan(0.8);
  });
});
