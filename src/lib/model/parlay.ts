/**
 * Parlay evaluation. Legs on the same event are evaluated jointly on that
 * event's score grid (exact correlation); legs on different events are
 * treated as independent, which is stated to the user.
 */
import { forEachCell, type ScoreGrid } from "./grid";
import { betOutcomeProbs, cellOutcome, tieShareHome, type Bet } from "./markets";

export type ParlayLeg = { eventId: string; bet: Bet; price: number; finalProb: number };

export type ParlayResult = {
  combinedPrice: number;
  /** P(every leg wins) under the model grids */
  jointProbModel: number;
  /** product of each leg's model marginals (what independence would give) */
  independentProbModel: number;
  /** jointModel / independentModel per event group (1 = no correlation) */
  correlationFactor: number;
  /** final (blended) marginals adjusted by the model's correlation factor */
  jointProb: number;
  /** expected profit per unit with final probabilities (pushes counted as losses → conservative) */
  ev: number;
  /** exact expected profit per unit under the model grids, including pushes/half results */
  evModel: number;
  impliedProb: number;
  groups: { eventId: string; legs: number; jointModel: number; independentModel: number; factor: number }[];
  warnings: string[];
};

function legMultiplier(o: { win: number; push: number; halfWin: number; halfLoss: number }, price: number) {
  return o.win * price + o.push + o.halfWin * ((price + 1) / 2) + o.halfLoss * 0.5;
}

export function evaluateParlay(legs: ParlayLeg[], grids: Map<string, ScoreGrid>): ParlayResult {
  const warnings: string[] = [];
  const byEvent = new Map<string, ParlayLeg[]>();
  for (const l of legs) byEvent.set(l.eventId, [...(byEvent.get(l.eventId) ?? []), l]);

  let jointModel = 1, indepModel = 1, finalProduct = 1, expectedPayout = 1;
  const groups: ParlayResult["groups"] = [];

  for (const [eventId, group] of byEvent) {
    const grid = grids.get(eventId);
    if (!grid) throw new Error(`Missing model distribution for event ${eventId}`);
    const share = tieShareHome(grid);
    let gJoint = 0, gPayout = 0;
    forEachCell(grid, (h, a, p) => {
      let allWin = 1, payout = 1;
      for (const leg of group) {
        const o = cellOutcome(leg.bet, h, a, grid, share);
        allWin *= o.win;
        payout *= legMultiplier(o, leg.price);
      }
      gJoint += p * allWin;
      gPayout += p * payout;
    });
    const gIndep = group.reduce((s, l) => s * betOutcomeProbs(grid, l.bet).win, 1);
    const gFinal = group.reduce((s, l) => s * l.finalProb, 1);
    const factor = gIndep > 1e-12 ? gJoint / gIndep : 0;
    groups.push({ eventId, legs: group.length, jointModel: gJoint, independentModel: gIndep, factor });
    jointModel *= gJoint;
    indepModel *= gIndep;
    finalProduct *= gFinal;
    expectedPayout *= gPayout;
    if (group.length > 1) {
      if (gJoint < 1e-9) warnings.push("Hay selecciones mutuamente excluyentes en el mismo evento.");
      else if (Math.abs(factor - 1) > 0.05)
        warnings.push(
          `Selecciones correlacionadas en un mismo evento (factor ${factor.toFixed(2)}). Muchas casas no permiten combinarlas o ajustan la cuota.`,
        );
    }
  }
  if (byEvent.size > 1) warnings.push("Selecciones de eventos distintos se tratan como independientes.");

  const combinedPrice = legs.reduce((s, l) => s * l.price, 1);
  const correlationFactor = indepModel > 1e-12 ? jointModel / indepModel : 0;
  const jointProb = Math.min(1, Math.max(0, finalProduct * correlationFactor));
  const ev = jointProb * combinedPrice - 1;
  const evModel = expectedPayout - 1;
  return {
    combinedPrice,
    jointProbModel: jointModel,
    independentProbModel: indepModel,
    correlationFactor,
    jointProb,
    ev,
    evModel,
    impliedProb: 1 / combinedPrice,
    groups,
    warnings,
  };
}
