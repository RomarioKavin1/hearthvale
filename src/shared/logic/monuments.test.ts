import { describe, expect, it } from 'vitest';
import { GRID_SIZE } from '../catalog';
import { isRiver } from './expansion';
import {
  MONUMENT_TEMPLATES,
  isMonument,
  monumentAt,
  monumentTiles,
  monuments,
} from './monuments';

const SEEDS = [1, 7, 42, 1111, 9999, 123456, 2_000_000_000];

describe('MONUMENT_TEMPLATES', () => {
  it('has six templates, each with a 1–4 tile footprint and flavour copy', () => {
    expect(MONUMENT_TEMPLATES.length).toBe(6);
    for (const t of MONUMENT_TEMPLATES) {
      expect(t.footprint.length).toBeGreaterThanOrEqual(1);
      expect(t.footprint.length).toBeLessThanOrEqual(4);
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.flavor.length).toBeGreaterThan(0);
    }
  });
});

describe('monuments', () => {
  it('places 2–4 monuments per village', () => {
    for (const seed of SEEDS) {
      const m = monuments(seed);
      expect(m.length).toBeGreaterThanOrEqual(2);
      expect(m.length).toBeLessThanOrEqual(4);
    }
  });

  it('is deterministic for a given seed', () => {
    for (const seed of SEEDS) {
      const a = monuments(seed);
      const b = monuments(seed);
      expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    }
  });

  it('keeps every footprint tile inside the central band and off plaza / lanes / river', () => {
    for (const seed of SEEDS) {
      for (const m of monuments(seed)) {
        for (const t of m.tiles) {
          // Inside the level-0 ring band [3,14] (visible + on-map).
          expect(t.x).toBeGreaterThanOrEqual(3);
          expect(t.x).toBeLessThanOrEqual(GRID_SIZE - 4);
          expect(t.y).toBeGreaterThanOrEqual(3);
          expect(t.y).toBeLessThanOrEqual(GRID_SIZE - 4);
          // Not in the plaza block + one-tile buffer [6,11]^2.
          const inPlazaBuffer =
            t.x >= 6 && t.x <= 11 && t.y >= 6 && t.y <= 11;
          expect(inPlazaBuffer).toBe(false);
          // Off the two central spoke lanes.
          expect(t.x === 8 || t.x === 9 || t.y === 8 || t.y === 9).toBe(false);
          // Off the fixed river.
          expect(isRiver(t.x, t.y)).toBe(false);
        }
      }
    }
  });

  it('never lets two monuments touch or overlap (one-tile separation)', () => {
    for (const seed of SEEDS) {
      const placed = monuments(seed);
      const occupied = new Set<string>();
      for (const m of placed) {
        for (const t of m.tiles) {
          // No footprint tile is shared, and none is adjacent to another
          // monument's already-recorded tile.
          for (let gx = -1; gx <= 1; gx++) {
            for (let gy = -1; gy <= 1; gy++) {
              if (gx === 0 && gy === 0) continue;
              expect(occupied.has(`${t.x + gx},${t.y + gy}`)).toBe(false);
            }
          }
        }
        for (const t of m.tiles) occupied.add(`${t.x},${t.y}`);
      }
    }
  });
});

describe('monumentTiles / isMonument / monumentAt', () => {
  it('monumentTiles enumerates exactly the placed footprint tiles', () => {
    for (const seed of SEEDS) {
      const set = monumentTiles(seed);
      const expected = new Set(
        monuments(seed).flatMap((m) => m.tiles.map((t) => `${t.x},${t.y}`))
      );
      expect(set.size).toBe(expected.size);
      for (const k of expected) expect(set.has(k)).toBe(true);
    }
  });

  it('isMonument agrees with monumentTiles', () => {
    for (const seed of SEEDS) {
      const set = monumentTiles(seed);
      for (let x = 0; x < GRID_SIZE; x++) {
        for (let y = 0; y < GRID_SIZE; y++) {
          expect(isMonument(seed, x, y)).toBe(set.has(`${x},${y}`));
        }
      }
    }
  });

  it('monumentAt returns the containing monument, or null off a monument', () => {
    const seed = 1111;
    for (const m of monuments(seed)) {
      for (const t of m.tiles) {
        const hit = monumentAt(seed, t.x, t.y);
        expect(hit).not.toBeNull();
        expect(hit?.template.id).toBe(m.template.id);
      }
    }
    // The plaza centre is never a monument.
    expect(monumentAt(seed, 8, 8)).toBeNull();
  });

  it('produces different layouts for different seeds', () => {
    const a = JSON.stringify(monuments(1));
    const b = JSON.stringify(monuments(9999));
    expect(a).not.toEqual(b);
  });
});
