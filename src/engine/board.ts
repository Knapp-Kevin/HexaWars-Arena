import type { CubeCoord, HexCell } from "../shared/types.ts";
import { equals } from "./coords.ts";

/**
 * Seeded 32-bit xorshift PRNG.
 * Given the same seed and position, it always produces the same sequence of values.
 */
function makePrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // xorshift32
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff;
  };
}

/**
 * Hash a seed and cube coord into a single 32-bit integer for PRNG initialization.
 */
function hashSeed(seed: number, c: CubeCoord): number {
  // Simple hash: mix seed with coord components using prime multipliers
  const h = (seed * 2654435761) ^ (c.q * 2246822519) ^ (c.r * 3266489917) ^ (c.s * 668265263);
  // Final mixing fold
  let x = h ^ (h >>> 16);
  x *= 0x85ebca6b;
  x ^= x >>> 13;
  x *= 0xc2b2ae35;
  x ^= x >>> 16;
  return x >>> 0;
}

/**
 * Deterministic terrain assignment for a single cell.
 * Uses a per-cell PRNG so terrain is stable across calls with same seed.
 *
 * Distribution targets:
 *   plain    70%  (≈57 cells on 81-cell board)
 *   forest   15%  (≈12 cells)
 *   mountain 10%  (≈8 cells)
 *   water     5%  (≈4 cells)
 */
export function terrainFor(
  seed: number,
  c: CubeCoord,
): "plain" | "forest" | "mountain" | "water" {
  const prng = makePrng(hashSeed(seed, c));
  const r = prng();
  if (r < 0.70) return "plain";
  if (r < 0.85) return "forest";
  if (r < 0.95) return "mountain";
  return "water";
}

/**
 * Create a 2-D HexCell array of the given size.
 * All cells are initialized with deterministic terrain derived from `seed`.
 *
 * The board is a flat list of rows, indexed board[row][col].
 * Row i corresponds to cube coord {q: col - offset, r: i - offset, s: offset - col - i}
 * where offset = floor(size / 2), so the board is centred on the origin (0,0,0).
 *
 * NOTE: because q+r+s=0 must hold, the board is topologically a hex diamond,
 * not a square grid. Cell (row, col) maps to a cube coord; out-of-bounds
 * coords are simply omitted so `cellAt` returns `undefined` for them.
 */
export function initBoard(
  size: number = 9,
  seed: number = 0,
): HexCell[][] {
  const board: HexCell[][] = [];
  const half = Math.floor(size / 2);

  for (let r = 0; r < size; r++) {
    const row: HexCell[] = [];
    for (let q = 0; q < size; q++) {
      // Cube coord for this axial address (q_col, r_row)
      // col q -> cube q = q - half
      // row r -> cube r = r - half
      // s is derived: s = -(q + r) to satisfy q+r+s=0
      const cubeQ = q - half;
      const cubeR = r - half;
      const cubeS = -(cubeQ + cubeR);
      const coord: CubeCoord = { q: cubeQ, r: cubeR, s: cubeS };

      row.push({
        position: coord,
        terrain: terrainFor(seed, coord),
      });
    }
    board.push(row);
  }

  return board;
}

/**
 * Experimental, VERSIONED hexagonal-disk topology for unranked practice.
 * The default initBoard(9) rhombus remains unchanged for historical matches.
 *
 * This is a real cube-distance disk, not a clipped rendering of an 81-cell
 * game. The reflection (q,r,s) -> (s,r,q) preserves q+r+s=0 and is a hex
 * isometry; paired terrain is assigned from the same seed+canonical coord.
 * Starting corridors at q=±1,2,3/r=0 are plain on both sides by design.
 *
 * Version: balanced61-v1 (radius=4), can only be promoted to ranked after
 * independent match fairness and historical replay qualification (#12).
 */
export function initHexDiskBoard(radius: number = 4, seed: number = 0): HexCell[][] {
  if(!Number.isInteger(radius)||radius<3||radius>8){
    throw new Error("Hex disk radius must be an integer from 3 to 8");
  }
  const board: HexCell[][]=[];
  for(let r=-radius;r<=radius;r++){
    const row:HexCell[]=[];
    const minimum=Math.max(-radius,-radius-r);
    const maximum=Math.min(radius,radius-r);
    for(let q=minimum;q<=maximum;q++){
      const coord:CubeCoord={q,r,s:-q-r};
      const mirror:CubeCoord={q:coord.s,r,s:coord.q};
      // Lexicographic representative makes reflected terrain byte-identical.
      const representative=(coord.q<mirror.q ||
        (coord.q===mirror.q&&coord.s<=mirror.s)) ? coord : mirror;
      const spawn=(r===0&&Math.abs(q)>=1&&Math.abs(q)<=3);
      row.push({
        position:coord,
        terrain:spawn?"plain":terrainFor(seed,representative),
      });
    }
    board.push(row);
  }
  return board;
}

/**
 * The larger human battlefield uses FIVE deployed squads per side. This
 * versioned formation is deliberately separate from legacy 3-squad matches.
 * The original five distinct combat roles are not restored by this roster:
 * scout/infantry/heavy remain the currently executable ruleset.
 *
 * Coordinates are deliberately spread over the left flank, with exact
 * 180-degree counterpart positions for the opponent.
 */
export const FRONTIER_STARTS_A = [
  { q: -5, r: 0, s: 5, type: "scout" },
  { q: -4, r: -1, s: 5, type: "infantry" },
  { q: -4, r: 1, s: 3, type: "infantry" },
  { q: -3, r: -2, s: 5, type: "scout" },
  { q: -3, r: 2, s: 1, type: "heavy" },
] as const;

/**
 * Frontier127-v1: a 127-cell hex disk with strategic, seed-stable features.
 *
 * Random terrain is paired under exact 180-degree rotation, not generated
 * independently on each flank. Center passage, two covered flank routes,
 * impassable northern/southern obstacles and deployable start zones are
 * deliberately authored. This is a NEW topology, not an alteration of the
 * 61-cell or 81-cell historical board and seed/replay contracts.
 */
export function initFrontierBoard(seed: number = 0): HexCell[][] {
  const board = initHexDiskBoard(6, seed);
  for (const row of board) {
    for (const cell of row) {
      const { q, r, s } = cell.position;
      const canonical = q < 0 || (q === 0 && r <= 0)
        ? cell.position : { q: -q, r: -r, s: -s };
      let terrain: HexCell["terrain"] = terrainFor(seed, canonical);
      // Safe openings and a central lane guarantee both sides can advance.
      if (r === 0 || (Math.abs(q) >= 3 && Math.abs(r) <= 2) ||
          (Math.abs(r) === 2 && Math.abs(q) <= 4)) terrain = "plain";
      // Symmetric cover on the two flank routes and central approach.
      if ((Math.abs(q) === 2 && Math.abs(r) === 2) ||
          (Math.abs(q) === 1 && Math.abs(r) === 1)) terrain = "forest";
      // Obstacles shape tactical approaches without blocking either lane.
      if (q === 0 && Math.abs(r) === 4) terrain = "mountain";
      if (Math.abs(q) === 1 && Math.abs(r) === 4) terrain = "water";
      cell.terrain = terrain;
    }
  }
  return board;
}

/**
 * Look up a cell by cube coordinate.
 * Returns `undefined` if the coord is outside the board bounds.
 *
 * NOTE: board is indexed by axial address, not by cube q/r directly.
 * We scan (expensive but correct for now — board is small at size≤9).
 */
export function cellAt(
  board: HexCell[][],
  coord: CubeCoord,
): HexCell | undefined {
  for (const row of board) {
    for (const cell of row) {
      if (equals(cell.position, coord)) return cell;
    }
  }
  return undefined;
}

/**
 * Shallow-update fields on an existing cell in place.
 * Only defined fields from `partial` are applied.
 * Returns the updated cell (for chaining convenience).
 */
export function setCell(
  board: HexCell[][],
  coord: CubeCoord,
  partial: Partial<HexCell>,
): HexCell {
  const cell = cellAt(board, coord);
  if (!cell) throw new Error(`setCell: no cell at (${coord.q},${coord.r},${coord.s})`);
  Object.assign(cell, partial);
  return cell;
}

/**
 * Compute terrain distribution statistics for a board.
 * Returns cell counts per terrain type.
 */
export function boardTerrainStats(board: HexCell[][]): Record<string, number> {
  const stats: Record<string, number> = {
    plain: 0,
    forest: 0,
    mountain: 0,
    water: 0,
  };
  for (const row of board) {
    for (const cell of row) {
      stats[cell.terrain]++;
    }
  }
  return stats;
}