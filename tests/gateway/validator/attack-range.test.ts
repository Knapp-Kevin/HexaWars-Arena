import { test, expect } from "bun:test";
import { validateAttackRange } from "../../../src/gateway/validator/attack-range";
import type { RoundPlan, MatchState } from "../../../src/shared/types";

function makeState(units: MatchState["units"]): Pick<MatchState, "units" | "visible"> {
  const visible = Array.from({ length: 9 }, (_, ri) =>
    Array.from({ length: 9 }, (_, qi) => {
      const q = qi - 4, r = ri - 4;
      return { position: { q, r, s: -q - r }, terrain: "plain" as const };
    }),
  ).flat();
  return { units, visible };
}

test("attack-range: pass plan is valid", () => {
  const state = makeState([
    { id: "u1", owner: "A", position: { q: 0, r: 0, s: 0 }, strength: 1, hp: 1, type: "infantry" },
  ]);
  expect(validateAttackRange({ bid: 0, extras: [] }, "A", state)).toEqual({ ok: true });
});

test("attack-range: infantry attack adjacent valid", () => {
  const state = makeState([
    { id: "u1", owner: "A", position: { q: 0, r: 0, s: 0 }, strength: 1, hp: 1, type: "infantry" },
    { id: "u2", owner: "B", position: { q: 1, r: 0, s: -1 }, strength: 1, hp: 1, type: "infantry" },
  ]);
  const plan: RoundPlan = {
    bid: 0,
    freeAction: { unitId: "u1", type: "attack", from: { q: 0, r: 0, s: 0 }, to: { q: 1, r: 0, s: -1 } },
    extras: [],
  };
  expect(validateAttackRange(plan, "A", state)).toEqual({ ok: true });
});

test("attack-range: infantry attack dist 2 out of range", () => {
  const state = makeState([
    { id: "u1", owner: "A", position: { q: 0, r: 0, s: 0 }, strength: 1, hp: 1, type: "infantry" },
    { id: "u2", owner: "B", position: { q: 3, r: 0, s: -3 }, strength: 1, hp: 1, type: "infantry" },
  ]);
  const plan: RoundPlan = {
    bid: 0,
    freeAction: { unitId: "u1", type: "attack", from: { q: 0, r: 0, s: 0 }, to: { q: 3, r: 0, s: -3 } },
    extras: [],
  };
  expect(validateAttackRange(plan, "A", state)).toEqual({ ok: false, reason: "attack_out_of_range:dist3max1" });
});

test("attack-range: heavy attack dist 2 valid", () => {
  const state = makeState([
    { id: "u1", owner: "A", position: { q: 0, r: 0, s: 0 }, strength: 1, hp: 1, type: "heavy" },
    { id: "u2", owner: "B", position: { q: 2, r: 0, s: -2 }, strength: 1, hp: 1, type: "infantry" },
  ]);
  const plan: RoundPlan = {
    bid: 0,
    freeAction: { unitId: "u1", type: "attack", from: { q: 0, r: 0, s: 0 }, to: { q: 2, r: 0, s: -2 } },
    extras: [],
  };
  expect(validateAttackRange(plan, "A", state)).toEqual({ ok: true });
});

test("attack-range: extra attack out of range", () => {
  const state = makeState([
    { id: "u1", owner: "A", position: { q: 0, r: 0, s: 0 }, strength: 1, hp: 1, type: "infantry" },
    { id: "u2", owner: "B", position: { q: 3, r: 0, s: -3 }, strength: 1, hp: 1, type: "infantry" },
  ]);
  const plan: RoundPlan = {
    bid: 0,
    extras: [{ kind: "second_attack", unitId: "u1", to: { q: 3, r: 0, s: -3 } }],
  };
  expect(validateAttackRange(plan, "A", state)).toEqual({ ok: false, reason: "extra_attack_out_of_range:u1dist3" });
});
test("attack-range: forged origin cannot claim a legal shot", () => {
  const state = makeState([
    { id: "u1", owner: "A", position: { q: 0, r: 0, s: 0 }, strength: 2, hp: 3, type: "scout" },
    { id: "b1", owner: "B", position: { q: 1, r: 0, s: -1 }, strength: 2, hp: 3, type: "scout" },
  ]);
  const plan: RoundPlan = { bid: 0, extras: [], freeAction: {
    unitId: "u1", type: "attack", from: { q: 2, r: 0, s: -2 }, to: { q: 1, r: 0, s: -1 },
  } };
  expect(validateAttackRange(plan, "A", state)).toEqual({ ok: false, reason: "attack_from_mismatch" });
});

test("attack-range: only the real staged destination gives same-unit move then attack range", () => {
  const state = makeState([
    { id: "u1", owner: "A", position: { q: 0, r: 0, s: 0 }, strength: 2, hp: 3, type: "scout" },
    { id: "b1", owner: "B", position: { q: 4, r: 0, s: -4 }, strength: 2, hp: 3, type: "scout" },
  ]);
  const plan: RoundPlan = { bid: 0, extras: [],
    freeMove: { unitId: "u1", from: { q: 0, r: 0, s: 0 }, to: { q: 3, r: 0, s: -3 } },
    freeAction: { unitId: "u1", type: "attack", from: { q: 0, r: 0, s: 0 }, to: { q: 4, r: 0, s: -4 } },
  };
  expect(validateAttackRange(plan, "A", state)).toEqual({ ok: true });
});

test("attack-range: old-position legal strike becomes illegal after same-unit move", () => {
  const state = makeState([
    { id: "u1", owner: "A", position: { q: 0, r: 0, s: 0 }, strength: 2, hp: 3, type: "scout" },
    { id: "b1", owner: "B", position: { q: 1, r: 0, s: -1 }, strength: 2, hp: 3, type: "scout" },
  ]);
  const plan: RoundPlan = { bid: 0, extras: [],
    freeMove: { unitId: "u1", from: { q: 0, r: 0, s: 0 }, to: { q: 0, r: 3, s: -3 } },
    freeAction: { unitId: "u1", type: "attack", from: { q: 0, r: 0, s: 0 }, to: { q: 1, r: 0, s: -1 } },
  };
  expect(validateAttackRange(plan, "A", state)).toEqual({ ok: false, reason: "attack_out_of_range:dist3max1" });
});

test("attack-range: refuses invalid cube origins and targets outside actual board", () => {
  const state = makeState([
    { id: "u1", owner: "A", position: { q: 0, r: 0, s: 0 }, strength: 1, hp: 3, type: "heavy" },
  ]);
  const attack = (from: {q:number;r:number;s:number}, to: {q:number;r:number;s:number}): RoundPlan =>
    ({ bid: 0, extras: [], freeAction: { unitId: "u1", type: "attack", from, to } });
  const zero = {q:0,r:0,s:0};
  expect(validateAttackRange(attack({q:0,r:0,s:1},zero), "A", state))
    .toEqual({ok:false,reason:"attack_from_malformed"});
  expect(validateAttackRange(attack(zero,{q:NaN,r:0,s:0}), "A", state))
    .toEqual({ok:false,reason:"attack_to_off_board"});
  expect(validateAttackRange(attack(zero,{q:7,r:0,s:-7}), "A", state))
    .toEqual({ok:false,reason:"attack_to_off_board"});
});
