import { describe, expect, it } from 'vitest';
import { GRID_SIZE } from '../../shared/catalog';
import {
  bandBlockFor,
  mulberry32,
  plazaFencePieces,
  terrainFor,
  PATH_HI,
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

describe('plazaFencePieces', () => {
  it('lines only the two front edges of the plaza ring, near corner left open', () => {
    const pieces = plazaFencePieces();
    // 3 tiles per front edge (PATH_LO..PATH_HI-1), two edges → 6 pieces.
    expect(pieces).toHaveLength(6);
    for (const p of pieces) {
      expect(p.key).toBe('fence-wood');
      const onFrontEdge = p.y === PATH_HI || p.x === PATH_HI;
      expect(onFrontEdge).toBe(true);
      // The shared near corner is intentionally skipped (plaza entrance).
      expect(p.x === PATH_HI && p.y === PATH_HI).toBe(false);
    }
    // The x=PATH_HI edge is flipped to run along y (matches pathPiece routing).
    const yEdge = pieces.filter((p) => p.x === PATH_HI);
    expect(yEdge.every((p) => p.flipX)).toBe(true);
    const xEdge = pieces.filter((p) => p.y === PATH_HI && p.x !== PATH_HI);
    expect(xEdge.every((p) => !p.flipX)).toBe(true);
  });
});
