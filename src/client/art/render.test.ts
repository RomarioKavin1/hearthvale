import { describe, expect, it } from 'vitest';
import { GRID_SIZE } from '../../shared/catalog';
import {
  backgroundIslets,
  backgroundStars,
  bandBlockFor,
  mulberry32,
  terrainFor,
} from './render';

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });

  it('produces values in [0,1) and differs across seeds', () => {
    const r = mulberry32(999);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe('terrainFor', () => {
  it('is pure — same seed + coords yield identical terrain', () => {
    const seed = 1_700_000_000_000;
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        expect(terrainFor(seed, x, y)).toEqual(terrainFor(seed, x, y));
      }
    }
  });

  it('quantizes height to 0, 1 or 2', () => {
    const seed = 42;
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const { height } = terrainFor(seed, x, y);
        expect([0, 1, 2]).toContain(height);
      }
    }
  });

  it('varies the landscape between two different village seeds', () => {
    const sig = (seed: number): string => {
      let s = '';
      for (let y = 0; y < GRID_SIZE; y++)
        for (let x = 0; x < GRID_SIZE; x++) {
          const t = terrainFor(seed, x, y);
          s += `${t.height}${t.patch[0]}${t.decor ?? '-'}|`;
        }
      return s;
    };
    expect(sig(111)).not.toBe(sig(222));
  });

  it('only ever emits known ground/decor kinds', () => {
    const seed = 7;
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const t = terrainFor(seed, x, y);
        expect(['grass', 'dirt']).toContain(t.patch);
        if (t.decor !== null) {
          expect(t.decor).toMatch(/^(tree-|rocks-)/);
        }
        // Dirt patches never carry a decor sprite (they are worn ground).
        if (t.patch === 'dirt') expect(t.decor).toBeNull();
      }
    }
  });
});

describe('bandBlockFor', () => {
  it('maps seeded height to a raised block sprite', () => {
    expect(bandBlockFor(0)).toBe('grass-center');
    expect(bandBlockFor(1)).toBe('grass-block');
    expect(bandBlockFor(2)).toBe('cliff-top');
  });
});

describe('void background layers', () => {
  it('are deterministic per seed and parked well outside the map bounds', () => {
    // The map's iso footprint is roughly sx ∈ [−1088,1088], sy ∈ [0,1088];
    // require every islet clear of a padded box around it.
    const seed = 1_700_000_000_000;
    const isletsA = backgroundIslets(seed);
    const isletsB = backgroundIslets(seed);
    expect(isletsA).toEqual(isletsB);
    expect(isletsA).toHaveLength(4);
    for (const isl of isletsA) {
      expect(isl.ground).toBe('grass-block');
      expect(isl.decor).toMatch(/^(tree-|rocks-)/);
      expect(isl.scale).toBeGreaterThanOrEqual(0.5);
      expect(isl.scale).toBeLessThanOrEqual(0.65);
      expect(isl.alpha).toBeCloseTo(0.85);
      // Outside the padded island box (|sx| or offset-sy beyond the footprint).
      const outside = Math.abs(isl.sx) > 1200 || Math.abs(isl.sy - 544) > 700;
      expect(outside).toBe(true);
    }

    const starsA = backgroundStars(seed);
    expect(starsA).toEqual(backgroundStars(seed));
    expect(starsA).toHaveLength(24);
    const twinkles = starsA.filter((s) => s.twinkle).length;
    expect(twinkles).toBe(8); // exactly a third
    for (const s of starsA) {
      expect(s.alpha).toBeGreaterThanOrEqual(0.25);
      expect(s.alpha).toBeLessThanOrEqual(0.5);
    }

    // A different village seed yields a different layout.
    expect(backgroundIslets(222)).not.toEqual(backgroundIslets(111));
  });
});
