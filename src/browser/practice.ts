/**
 * Offline, unranked HexaWars practice. Uses the repository's real round
 * resolver, validator, victory rules and territory evaluator. Nothing here
 * writes to a leaderboard or claims server authority.
 */
import type { AgentRoundBudget, CubeCoord, EngineEvent, HexCell, MatchState, RoundPlan, Unit } from "../shared/types.ts";
import { createMatch } from "../engine/match.ts";
import { runRound } from "../engine/roundDriver.ts";
import { newBudget } from "../engine/round-state.ts";
import { checkVictory } from "../engine/victory.ts";
import { updateTerritory } from "../engine/territory.ts";
import { validateRoundPlan } from "../gateway/validator.ts";
import { projectSeatObservation } from "../gateway/observation.ts";
import { MOVE_POINTS, RANGE } from "../engine/constants.ts";

export type Side = "A" | "B";
export type PlayerAction = "move" | "attack";
export type MatchResult = ReturnType<typeof checkVictory>;
export const PASS: RoundPlan = { bid: 0, extras: [] };

export function distance(a: CubeCoord, b: CubeCoord): number {
  return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.s - b.s));
}

export function samePosition(a: CubeCoord, b: CubeCoord): boolean {
  return a.q === b.q && a.r === b.r && a.s === b.s;
}

function cellKey(pos: CubeCoord): string {
  return `${pos.q}/${pos.r}/${pos.s}`;
}

function preparedState(state: MatchState): MatchState {
  // Refresh embedded unit snapshots from the authoritative unit array after
  // combat. A destroyed unit must never retain territory from a stale cell.
  const units = new Map(state.units.map(u => [cellKey(u.position), u]));
  const byRow = new Map<number, HexCell[]>();
  for (const cell of state.visible) {
    const row = byRow.get(cell.position.r) ?? [];
    row.push({
      position: { ...cell.position },
      terrain: cell.terrain,
      controlledBy: cell.controlledBy,
      unit: units.get(cellKey(cell.position)),
    });
    byRow.set(cell.position.r, row);
  }
  const board = [...byRow.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, row]) => row.sort((a, b) => a.position.q - b.position.q));
  const visible = updateTerritory(board).flat();
  return {
    ...state,
    visible,
    score: {
      a: visible.filter(cell => cell.controlledBy === "A").length,
      b: visible.filter(cell => cell.controlledBy === "B").length,
    },
  };
}

function planFor(unit: Unit, action: PlayerAction, target: CubeCoord): RoundPlan {
  if (action === "move") {
    return {
      ...PASS,
      freeMove: {
        unitId: unit.id,
        from: { ...unit.position },
        to: { ...target },
      },
    };
  }
  return {
    ...PASS,
    freeAction: {
      unitId: unit.id,
      type: "attack",
      from: { ...unit.position },
      to: { ...target },
    },
  };
}

function visibleTargets(
  state: MatchState,
  budget: AgentRoundBudget,
  side: Side,
  unitId: string,
  action: PlayerAction,
): CubeCoord[] {
  const observed = projectSeatObservation(state, side);
  const unit = state.units.find(u => u.id === unitId && u.owner === side);
  if (!unit) return [];

  return observed.visible.filter((cell) => {
    const occupant = cell.unit;
    if (action === "move") {
      if (occupant || cell.terrain === "mountain" || cell.terrain === "water") return false;
      if (distance(unit.position, cell.position) !== MOVE_POINTS[unit.type]) return false;
    } else {
      if (!occupant || occupant.owner === side) return false;
      if (distance(unit.position, cell.position) > RANGE[unit.type]) return false;
    }
    return validateRoundPlan(planFor(unit, action, cell.position), side, state, budget).ok;
  }).map(cell => ({ ...cell.position }));
}

function chooseBotPlan(state: MatchState, budget: AgentRoundBudget): RoundPlan {
  const friends = state.units.filter(u => u.owner === "B").sort((a, b) => a.id.localeCompare(b.id));
  const observed = projectSeatObservation(state, "B");
  const knownEnemies = observed.visible.flatMap(c => c.unit?.owner === "A" ? [c.unit] : []);
  const chosen: RoundPlan = { ...PASS };

  // Prioritize a legal attack on the weakest currently visible opponent.
  const attacks = friends.flatMap(unit => visibleTargets(state, budget, "B", unit.id, "attack")
    .flatMap(pos => knownEnemies.filter(enemy => samePosition(enemy.position, pos))
      .map(enemy => ({ unit, pos, hp: enemy.hp }))));
  attacks.sort((a, b) => a.hp - b.hp || a.unit.id.localeCompare(b.unit.id));
  if (attacks[0]) {
    chosen.freeAction = planFor(attacks[0].unit, "attack", attacks[0].pos).freeAction;
  }

  // Advance toward a known opponent; otherwise press toward the center.
  const moves = friends
    .filter(unit => unit.id !== chosen.freeAction?.unitId)
    .flatMap(unit => visibleTargets(state, budget, "B", unit.id, "move").map(pos => ({
      unit, pos,
      priority: knownEnemies.length
        ? Math.min(...knownEnemies.map(enemy => distance(pos, enemy.position)))
        : Math.abs(pos.q) + Math.abs(pos.r) / 4,
    })));
  moves.sort((a, b) => a.priority - b.priority ||
    a.unit.id.localeCompare(b.unit.id) ||
    a.pos.q - b.pos.q || a.pos.r - b.pos.r);
  if (moves[0]) {
    chosen.freeMove = planFor(moves[0].unit, "move", moves[0].pos).freeMove;
  }

  // An agent never bypasses the same validator applied to human plans.
  return validateRoundPlan(chosen, "B", state, budget).ok ? chosen : PASS;
}

export class LocalPractice {
  state: MatchState;
  budgetA: AgentRoundBudget = newBudget();
  budgetB: AgentRoundBudget = newBudget();
  staged: RoundPlan = { ...PASS };
  readonly seed: string;
  readonly matchId: string;
  result: MatchResult;
  events: EngineEvent[] = [];

  constructor(seed = `local-${Date.now().toString(36)}`) {
    this.seed = seed;
    this.matchId = `practice-${seed}`;
    this.state = preparedState(createMatch(seed));
    this.result = checkVictory(this.state);
  }

  get observation(): MatchState {
    return projectSeatObservation(this.state, "A");
  }

  get complete(): boolean { return this.result.winner !== null; }

  targets(unitId: string, action: PlayerAction): CubeCoord[] {
    if (this.complete) return [];
    return visibleTargets(this.state, this.budgetA, "A", unitId, action);
  }

  queue(unitId: string, action: PlayerAction, target: CubeCoord): { ok: true } | { ok: false; reason: string } {
    if (this.complete) return { ok: false, reason: "Match already finished" };
    if (!this.targets(unitId, action).some(p => samePosition(p, target))) {
      return { ok: false, reason: "Illegal or unseen target" };
    }
    const unit = this.state.units.find(u => u.id === unitId && u.owner === "A");
    if (!unit) return { ok: false, reason: "Select a blue unit first" };
    const next = { ...this.staged, ...(action === "move"
      ? { freeMove: planFor(unit, action, target).freeMove }
      : { freeAction: planFor(unit, action, target).freeAction }) };
    const valid = validateRoundPlan(next, "A", this.state, this.budgetA);
    if (!valid.ok) return { ok: false, reason: valid.reason };
    this.staged = next;
    return { ok: true };
  }

  clear(): void { this.staged = { ...PASS }; }

  advance(): { events: EngineEvent[]; result: MatchResult; botPlan: RoundPlan } {
    if (this.complete) throw new Error("This practice match has ended");
    const valid = validateRoundPlan(this.staged, "A", this.state, this.budgetA);
    if (!valid.ok) throw new Error(`Invalid human plan: ${valid.reason}`);
    const botPlan = chooseBotPlan(this.state, this.budgetB);
    const round = runRound({
      matchId: this.matchId,
      round: this.state.turn,
      state: this.state,
      planA: this.staged,
      planB: botPlan,
      budgetA: this.budgetA,
      budgetB: this.budgetB,
    });
    this.state = preparedState(round.nextState);
    this.budgetA = round.nextBudgetA;
    this.budgetB = round.nextBudgetB;
    this.events = round.events;
    this.result = checkVictory(this.state);
    this.clear();
    return { events: this.events, result: this.result, botPlan };
  }
}
