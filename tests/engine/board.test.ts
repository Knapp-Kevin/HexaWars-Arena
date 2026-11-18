import { describe, it, expect } from "bun:test";
import { initBoard, initHexDiskBoard, cellAt, setCell } from "../../src/engine/board.ts";
import { placeStartingUnits, getAllUnits } from "../../src/engine/units.ts";
import { distance } from "../../src/engine/coords.ts";

describe("board", () => {
  describe("initBoard", () => {
    it("produces identical boards across calls with same seed", () => {
      const boardA = initBoard(9, 42);
      const boardB = initBoard(9, 42);
      expect(boardA).toEqual(boardB);
    });

    it("produces different boards for different seeds", () => {
      const boardA = initBoard(9, 42);
      const boardB = initBoard(9, 99);
      expect(boardA).not.toEqual(boardB);
    });

    it("board has correct dimensions (size x size)", () => {
      const board = initBoard(9, 0);
      expect(board.length).toBe(9);
      for (const row of board) {
        expect(row.length).toBe(9);
      }
    });

    it("board of size 5 has 5 rows of 5 cells", () => {
      const board = initBoard(5, 0);
      expect(board.length).toBe(5);
      for (const row of board) {
        expect(row.length).toBe(5);
      }
    });

    it("each cell has a valid terrain type", () => {
      const board = initBoard(9, 0);
      const validTerrains = new Set(["plain", "forest", "mountain", "water"]);
      for (const row of board) {
        for (const cell of row) {
          expect(validTerrains.has(cell.terrain)).toBe(true);
        }
      }
    });

    it("seed produces deterministic terrain distribution", () => {
      const boardA = initBoard(9, 12345);
      const boardB = initBoard(9, 12345);
      expect(boardA).toEqual(boardB);
    });
  });

  describe("versioned symmetric radius-four hex arena",()=>{
    it("has exactly 61 unique cube hexes in a regular hex disk",()=>{
      const board=initHexDiskBoard(4,42);
      expect(board.length).toBe(9);
      expect(board.map(row=>row.length)).toEqual([5,6,7,8,9,8,7,6,5]);
      const cells=board.flat();
      expect(cells.length).toBe(61);
      const coords=new Set(cells.map(c=>JSON.stringify(c.position)));
      expect(coords.size).toBe(61);
      for(const {position:p} of cells){
        expect(p.q+p.r+p.s).toBe(0);
        expect(Math.max(Math.abs(p.q),Math.abs(p.r),Math.abs(p.s))).toBeLessThanOrEqual(4);
      }
    });
    it("reflects every terrain cell exactly across the two starting sides",()=>{
      for(const seed of [0,42,3251,98765]){
        const board=initHexDiskBoard(4,seed);
        for(const cell of board.flat()){
          const {q,r,s}=cell.position;
          const counterpart=cellAt(board,{q:s,r,s:q});
          expect(counterpart).toBeDefined();
          expect(counterpart!.terrain).toBe(cell.terrain);
        }
      }
    });
    it("provides equally safe spawn corridors and symmetric unit types",()=>{
      const board=initHexDiskBoard(4,42);
      placeStartingUnits(board,42);
      const units=getAllUnits(board);
      expect(units.length).toBe(6);
      expect(units.filter(u=>u.owner==="A").length).toBe(3);
      expect(units.filter(u=>u.owner==="B").length).toBe(3);
      for(const u of units){
        const opposite=units.find(v=>v.owner!==u.owner &&
          v.position.q===u.position.s&&v.position.r===u.position.r&&
          v.position.s===u.position.q);
        expect(opposite).toBeDefined();
        expect(opposite!.type).toBe(u.type);
        expect(cellAt(board,u.position)?.terrain).toBe("plain");
        expect(distance(u.position,{q:0,r:0,s:0})).toBeLessThanOrEqual(3);
      }
    });
    it("rejects malformed radii and is deterministic without altering legacy boards",()=>{
      expect(()=>initHexDiskBoard(2,0)).toThrow();
      expect(()=>initHexDiskBoard(4.5,0)).toThrow();
      expect(()=>initHexDiskBoard(9,0)).toThrow();
      expect(initHexDiskBoard(4,420)).toEqual(initHexDiskBoard(4,420));
      expect(initBoard(9,420).flat().length).toBe(81);
    });
  });

  describe("cellAt", () => {
    it("returns correct cell for center coord", () => {
      const board = initBoard(9, 0);
      const center = { q: 0, r: 0, s: 0 };
      const cell = cellAt(board, center);
      expect(cell).toBeDefined();
      expect(cell!.position.q).toBe(center.q);
      expect(cell!.position.r).toBe(center.r);
    });

    it("returns undefined for out-of-bounds coord", () => {
      const board = initBoard(9, 0);
      const far = { q: 100, r: -100, s: 0 };
      expect(cellAt(board, far)).toBeUndefined();
    });

    it("returns correct cell at corner position", () => {
      const board = initBoard(9, 0);
      const corner = { q: -4, r: -4, s: 8 };
      const cell = cellAt(board, corner);
      expect(cell).toBeDefined();
      expect(cell!.position.q).toBe(corner.q);
      expect(cell!.position.r).toBe(corner.r);
    });

    it("cellAt is referentially stable across calls", () => {
      const board = initBoard(9, 0);
      const center = { q: 0, r: 0, s: 0 };
      const cell1 = cellAt(board, center);
      const cell2 = cellAt(board, center);
      expect(cell1).toBe(cell2);
    });
  });

  describe("setCell", () => {
    it("setCell updates the cell in place and returns it", () => {
      const board = initBoard(9, 0);
      const coord = { q: 0, r: 0, s: 0 };
      const originalTerrain = cellAt(board, coord)!.terrain;
      const newTerrain = originalTerrain === "plain" ? "forest" : "plain";

      const result = setCell(board, coord, { terrain: newTerrain });

      expect(result.terrain).toBe(newTerrain);
      expect(cellAt(board, coord)!.terrain).toBe(newTerrain);
    });

    it("setCell on one cell does not affect other cells", () => {
      const board = initBoard(9, 0);
      const coordA = { q: 0, r: 0, s: 0 };
      const coordB = { q: 1, r: -1, s: 0 };
      const originalB = cellAt(board, coordB)!.terrain;

      setCell(board, coordA, { terrain: "forest" });

      expect(cellAt(board, coordB)!.terrain).toBe(originalB);
    });

    it("setCell throws for invalid coord", () => {
      const board = initBoard(9, 0);
      const bad = { q: 999, r: -999, s: 0 };
      expect(() => setCell(board, bad, { terrain: "water" })).toThrow();
    });

    it("setCell applies partial update (preserves other fields)", () => {
      const board = initBoard(9, 0);
      const coord = { q: 0, r: 0, s: 0 };
      const originalPos = cellAt(board, coord)!.position;

      setCell(board, coord, { terrain: "mountain" });

      const updated = cellAt(board, coord)!;
      expect(updated.position.q).toBe(originalPos.q);
      expect(updated.position.r).toBe(originalPos.r);
    });
  });
});
