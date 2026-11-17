import { describe, expect, test } from "bun:test";
import { createMatch } from "../../src/engine/match.ts";
import { projectSeatObservation } from "../../src/gateway/observation.ts";
import type { MatchState, Unit } from "../../src/shared/types.ts";

describe("per-seat match observation", () => {
  function makeState(): MatchState {
    return createMatch("seat-isolation-adversarial-seed");
  }

  test("does not reveal the full board or the opponent's hidden units", () => {
    const state = makeState();
    const a = projectSeatObservation(state, "A");
    const b = projectSeatObservation(state, "B");

    expect(a.visible.length).toBeLessThan(state.visible.length);
    expect(b.visible.length).toBeLessThan(state.visible.length);
    expect(a.units.length).toBeGreaterThan(0);
    expect(b.units.length).toBeGreaterThan(0);
    expect(a.units.every((u) => u.owner === "A")).toBe(true);
    expect(b.units.every((u) => u.owner === "B")).toBe(true);

    for (const [seat, observation] of [["A", a], ["B", b]] as const) {
      const visibleKeys = new Set(observation.visible.map(c =>
        `${c.position.q}:${c.position.r}:${c.position.s}`));
      const hiddenEnemies = state.units.filter((u) => u.owner !== seat &&
        !visibleKeys.has(`${u.position.q}:${u.position.r}:${u.position.s}`));
      expect(hiddenEnemies.length).toBeGreaterThan(0);
      for (const enemy of hiddenEnemies) {
        expect(observation.units.some(u => u.id === enemy.id)).toBe(false);
        expect(observation.visible.some(c => c.unit?.id === enemy.id)).toBe(false);
      }
    }
  });

  test("does not trust stale cell.unit snapshots and never mutates server state", () => {
    const state = makeState();
    const before = structuredClone(state);
    const observed = projectSeatObservation(state, "A");

    expect(state).toEqual(before);
    for (const cell of observed.visible) {
      const real = state.units.find((unit) =>
        unit.position.q === cell.position.q &&
        unit.position.r === cell.position.r &&
        unit.position.s === cell.position.s);
      expect(cell.unit?.id).toBe(real?.id);
    }
  });

  test("does not send opponent reserve and stance records", () => {
    const state = makeState();
    const own = state.units.find(u => u.owner === "A") as Unit;
    const enemy = state.units.find(u => u.owner === "B") as Unit;
    state.stances = [
      { unitId: own.id, appliesOnRound: 2 },
      { unitId: enemy.id, appliesOnRound: 2 },
    ];
    state.reserves = [
      { unitId: own.id, ownerId: "A", appliesOnRound: 2, fired: false },
      { unitId: enemy.id, ownerId: "B", appliesOnRound: 2, fired: false },
    ];

    const a = projectSeatObservation(state, "A");
    const b = projectSeatObservation(state, "B");
    expect(a.stances?.map(x => x.unitId)).toEqual([own.id]);
    expect(b.stances?.map(x => x.unitId)).toEqual([enemy.id]);
    expect(a.reserves?.map(x => x.unitId)).toEqual([own.id]);
    expect(b.reserves?.map(x => x.unitId)).toEqual([enemy.id]);
  });
});
