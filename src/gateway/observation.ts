import type { CubeCoord, HexCell, MatchState, Unit } from "../shared/types.ts";
import { visibleCells } from "../engine/fog.ts";
import { visibleCellsSymmetric } from "../engine/fog-corrected.ts";

function coordKey(pos: CubeCoord): string {
  return `${pos.q},${pos.r},${pos.s}`;
}

/**
 * Build the observation delivered to exactly one competitor.
 * Never clone/spread the raw MatchState: it contains both armies, the full
 * terrain map, and potentially unrevealed stance/reserve records.
 */
export function projectSeatObservation(
  state: MatchState,
  side: "A" | "B",
  vision: "legacy-v1" | "cube-symmetric-v1" = "legacy-v1",
): MatchState {
  const unitsByCoord = new Map<string, Unit>();
  for (const unit of state.units) {
    unitsByCoord.set(coordKey(unit.position), unit);
  }

  // The authoritative unit list, not a stale embedded cell.unit snapshot,
  // decides which units may be seen through fog.
  const board: HexCell[] = state.visible.map((cell) => ({
    position: { ...cell.position },
    terrain: cell.terrain,
    controlledBy: cell.controlledBy,
    unit: unitsByCoord.get(coordKey(cell.position)),
  }));
  const see=vision==="cube-symmetric-v1"?visibleCellsSymmetric:visibleCells;
  const shown = new Set(see([board], side).map(coordKey));
  const friendly = state.units.filter((unit) => unit.owner === side);

  return {
    turn: state.turn,
    visible: board.filter((cell) => shown.has(coordKey(cell.position))).map((cell) => ({
      ...cell,
      unit: cell.unit ? { ...cell.unit, position: { ...cell.unit.position } } : undefined,
    })),
    units: friendly.map((unit) => ({ ...unit, position: { ...unit.position } })),
    score: { ...state.score },
    deadline: state.deadline,
    roundCap: state.roundCap,
    // Hidden enemy prepared actions are never part of a seat observation.
    stances: state.stances?.filter((entry) => friendly.some((u) => u.id === entry.unitId))
      .map((entry) => ({ ...entry })),
    reserves: state.reserves?.filter((entry) => entry.ownerId === side)
      .map((entry) => ({ ...entry })),
  };
}
