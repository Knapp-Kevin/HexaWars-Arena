import { describe, it, expect } from "bun:test";
import { buildHeuristicPlan } from "../../src/orchestrator/heuristic-planner.ts";
import { createMatch } from "../../src/engine/match.ts";
import { runRound } from "../../src/engine/roundDriver.ts";
import { newBudget } from "../../src/engine/round-state.ts";
import type { MatchState, Unit, HexCell } from "../../src/shared/types.ts";

function makeUnit(
  id: string,
  owner: "A" | "B",
  q: number,
  r: number,
  type: Unit["type"] = "infantry",
  hp = 5,
): Unit {
  return {
    id,
    owner,
    position: { q, r, s: -q - r },
    strength: 3,
    hp,
    type,
    weight: 2,
  };
}

function makeState(units: Unit[]): MatchState {
  const visible: HexCell[] = [];
  for (let q = -4; q <= 4; q++) {
    for (let r = -4; r <= 4; r++) {
      const s = -q - r;
      if (Math.abs(s) > 4) continue;
      const occupant = units.find(
        (u) => u.position.q === q && u.position.r === r,
      );
      visible.push({
        position: { q, r, s },
        terrain: "plain",
        unit: occupant,
      });
    }
  }
  return {
    turn: 0,
    visible,
    units,
    score: { a: 0, b: 0 },
    deadline: 60_000,
    roundCap: 50,
  };
}

describe("heuristic planner", () => {
  it("attacks when an enemy is in range", () => {
    const state = makeState([
      makeUnit("u-a", "A", 0, 0),
      makeUnit("u-b", "B", 1, 0),
    ]);
    const plan = buildHeuristicPlan(state, "A");
    expect(plan.freeAction).toBeDefined();
    expect(plan.freeAction?.type).toBe("attack");
    expect(plan.freeAction?.unitId).toBe("u-a");
    expect(plan.freeAction?.to).toEqual({ q: 1, r: 0, s: -1 });
  });

  it("moves toward the nearest enemy when out of range", () => {
    const state = makeState([
      makeUnit("u-a", "A", -3, 0),
      makeUnit("u-b", "B", 3, 0),
    ]);
    const plan = buildHeuristicPlan(state, "A");
    expect(plan.freeMove).toBeDefined();
    expect(plan.freeMove?.unitId).toBe("u-a");
    expect(plan.freeMove?.to.q).toBeGreaterThan(-3);
  });

  it("side B prioritizes the lowest-hp enemy when distances tie", () => {
    const state = makeState([
      makeUnit("u-b", "B", 0, 0),
      makeUnit("u-a1", "A", 1, 0, "infantry", 5),
      makeUnit("u-a2", "A", -1, 0, "infantry", 1),
    ]);
    const plan = buildHeuristicPlan(state, "B");
    expect(plan.freeAction).toBeDefined();
    expect(plan.freeAction?.to).toEqual({ q: -1, r: 0, s: 1 });
  });

  it("side A and side B pick different targets given asymmetric enemies", () => {
    const stateForA = makeState([
      makeUnit("attacker", "A", 0, 0),
      makeUnit("heavy", "B", 1, 0, "heavy", 8),
      makeUnit("scout", "B", -1, 0, "scout", 3),
    ]);
    const planA = buildHeuristicPlan(stateForA, "A");
    expect(planA.freeAction?.to).toEqual({ q: 1, r: 0, s: -1 });

    const stateForB = makeState([
      makeUnit("attacker", "B", 0, 0),
      makeUnit("heavy", "A", 1, 0, "heavy", 8),
      makeUnit("scout", "A", -1, 0, "scout", 3),
    ]);
    const planB = buildHeuristicPlan(stateForB, "B");
    expect(planB.freeAction?.to).toEqual({ q: -1, r: 0, s: 1 });
  });

  it("returns a no-op when no enemies remain", () => {
    const state = makeState([makeUnit("u-a", "A", 0, 0)]);
    const plan = buildHeuristicPlan(state, "A");
    expect(plan.freeAction).toBeUndefined();
    expect(plan.freeMove).toBeUndefined();
  });

  it("drives a real match to a decisive outcome via the engine", () => {
    let state = createMatch("seed-decisive");
    let budgetA = newBudget();
    let budgetB = newBudget();
    let attacks = 0;

    for (let round = 0; round < 50; round++) {
      const planA = buildHeuristicPlan(state, "A");
      const planB = buildHeuristicPlan(state, "B");
      const result = runRound({
        matchId: "test",
        round,
        state,
        planA,
        planB,
        budgetA,
        budgetB,
      });
      attacks += result.events.filter((e) => e.type === "unit_attacked").length;
      state = result.nextState;
      budgetA = result.nextBudgetA;
      budgetB = result.nextBudgetB;
      if (result.ended) break;
    }

    const aLive = state.units.filter((u) => u.owner === "A" && u.hp > 0).length;
    const bLive = state.units.filter((u) => u.owner === "B" && u.hp > 0).length;
    expect(attacks).toBeGreaterThan(0);
    expect(aLive === 0 || bLive === 0).toBe(true);
  });
});
