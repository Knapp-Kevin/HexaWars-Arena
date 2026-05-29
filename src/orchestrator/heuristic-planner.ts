// Heuristic Planner — produces strategic round plans for autonomous matches.
// Picks the best (my unit, enemy) pair by distance + enemy fragility, attacks
// when in range, advances toward target otherwise. Same unit can move-then-attack
// since the engine resolves freeMove before freeAction.

import type { CubeCoord, MatchState, RoundPlan, Unit } from "../shared/types.ts";
import { RANGE } from "../engine/constants.ts";

const NEIGHBOR_DIRS: ReadonlyArray<CubeCoord> = [
  { q: 1, r: 0, s: -1 },
  { q: -1, r: 0, s: 1 },
  { q: 0, r: 1, s: -1 },
  { q: 0, r: -1, s: 1 },
  { q: 1, r: -1, s: 0 },
  { q: -1, r: 1, s: 0 },
];

function hexDistance(a: CubeCoord, b: CubeCoord): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.s - b.s)) / 2;
}

function samePos(a: CubeCoord, b: CubeCoord): boolean {
  return a.q === b.q && a.r === b.r && a.s === b.s;
}

function isPassable(state: MatchState, pos: CubeCoord, exceptUnitId?: string): boolean {
  const cell = state.visible.find((c) => samePos(c.position, pos));
  if (!cell) return false;
  if (cell.terrain === "mountain" || cell.terrain === "water") return false;
  const occupant = state.units.find((u) => samePos(u.position, pos));
  if (occupant && occupant.id !== exceptUnitId) return false;
  return true;
}

function bestStepToward(
  state: MatchState,
  unit: Unit,
  target: CubeCoord,
): CubeCoord | null {
  let best: { pos: CubeCoord; dist: number } | null = null;
  for (const dir of NEIGHBOR_DIRS) {
    const candidate: CubeCoord = {
      q: unit.position.q + dir.q,
      r: unit.position.r + dir.r,
      s: unit.position.s + dir.s,
    };
    if (!isPassable(state, candidate, unit.id)) continue;
    const dist = hexDistance(candidate, target);
    if (best === null || dist < best.dist) {
      best = { pos: candidate, dist };
    }
  }
  return best?.pos ?? null;
}

interface Pairing {
  myUnit: Unit;
  enemy: Unit;
  distance: number;
}

// Side A is aggressive: minimize own-unit distance, focus heavies (highest
// strength). Side B is opportunistic: focus the weakest enemy hp first, then
// nearest. The asymmetry breaks mirror-symmetric stalemates so matches reach
// decisive outcomes instead of mutual elimination.
function pairingScore(side: "A" | "B", myUnit: Unit, enemy: Unit, distance: number): number {
  if (side === "A") {
    return distance * 100 + (10 - enemy.strength) * 10 - myUnit.strength;
  }
  return enemy.hp * 100 + distance * 10 - myUnit.strength;
}

function bestPairing(
  side: "A" | "B",
  myUnits: Unit[],
  enemies: Unit[],
): Pairing | null {
  let best: Pairing | null = null;
  let bestScore = Infinity;
  for (const myUnit of myUnits) {
    if (myUnit.hp <= 0) continue;
    for (const enemy of enemies) {
      if (enemy.hp <= 0) continue;
      const distance = hexDistance(myUnit.position, enemy.position);
      const score = pairingScore(side, myUnit, enemy, distance);
      if (score < bestScore) {
        bestScore = score;
        best = { myUnit, enemy, distance };
      }
    }
  }
  return best;
}

export function buildHeuristicPlan(state: MatchState, side: "A" | "B"): RoundPlan {
  const myUnits = state.units.filter((u) => u.owner === side && u.hp > 0);
  const enemies = state.units.filter((u) => u.owner !== side && u.hp > 0);
  if (myUnits.length === 0 || enemies.length === 0) {
    return { bid: 0, extras: [] };
  }

  const pairing = bestPairing(side, myUnits, enemies);
  if (!pairing) return { bid: 0, extras: [] };

  const { myUnit, enemy } = pairing;
  const range = RANGE[myUnit.type] ?? 1;

  if (pairing.distance <= range) {
    return {
      bid: 0,
      extras: [],
      freeAction: {
        unitId: myUnit.id,
        type: "attack",
        from: myUnit.position,
        to: enemy.position,
      },
    };
  }

  const stepTo = bestStepToward(state, myUnit, enemy.position);
  if (!stepTo) return { bid: 0, extras: [] };

  const plan: RoundPlan = {
    bid: 0,
    extras: [],
    freeMove: { unitId: myUnit.id, from: myUnit.position, to: stepTo },
  };

  if (hexDistance(stepTo, enemy.position) <= range) {
    plan.freeAction = {
      unitId: myUnit.id,
      type: "attack",
      from: stepTo,
      to: enemy.position,
    };
  }

  return plan;
}
