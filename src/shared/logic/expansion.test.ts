import { describe, expect, it } from 'vitest';
import { RIVER_TILES, isRiver, isUnlocked, ringBounds } from './expansion';

describe('ringBounds', () => {
  it('opens one ring per Village Hall level', () => {
    expect(ringBounds(0)).toEqual({ lo: 4, hi: 13 });
    expect(ringBounds(1)).toEqual({ lo: 3, hi: 14 });
    expect(ringBounds(2)).toEqual({ lo: 2, hi: 15 });
    expect(ringBounds(3)).toEqual({ lo: 1, hi: 16 });
    expect(ringBounds(4)).toEqual({ lo: 0, hi: 17 });
  });

  it('clamps: levels 4 and 5 share the max ring, negatives fall back to level 0', () => {
    expect(ringBounds(5)).toEqual({ lo: 0, hi: 17 });
    expect(ringBounds(50)).toEqual({ lo: 0, hi: 17 });
    expect(ringBounds(-3)).toEqual({ lo: 4, hi: 13 });
  });
});

describe('isUnlocked', () => {
  it('always unlocks the plaza block regardless of Hall level', () => {
    expect(isUnlocked(8, 8, 0)).toBe(true);
    expect(isUnlocked(9, 9, 0)).toBe(true);
  });

  it('gates tiles outside the current ring', () => {
    expect(isUnlocked(4, 4, 0)).toBe(true);
    expect(isUnlocked(13, 13, 0)).toBe(true);
    expect(isUnlocked(3, 3, 0)).toBe(false);
    expect(isUnlocked(14, 5, 0)).toBe(false);
  });

  it('opens the next ring as the Hall levels up', () => {
    expect(isUnlocked(3, 3, 1)).toBe(true);
    expect(isUnlocked(14, 14, 1)).toBe(true);
    expect(isUnlocked(2, 2, 1)).toBe(false);
    expect(isUnlocked(0, 0, 4)).toBe(true);
    expect(isUnlocked(17, 17, 4)).toBe(true);
  });
});

describe('RIVER_TILES / isRiver', () => {
  it('is a hand-picked path of ~14 tiles', () => {
    expect(RIVER_TILES.length).toBeGreaterThanOrEqual(12);
    expect(RIVER_TILES.length).toBeLessThanOrEqual(16);
  });

  it('has no duplicate tiles', () => {
    const keys = new Set(RIVER_TILES.map((t) => `${t.x},${t.y}`));
    expect(keys.size).toBe(RIVER_TILES.length);
  });

  it('places every river tile outside the [3,14] band and inside [0,17]', () => {
    for (const t of RIVER_TILES) {
      const outsideInner = t.x < 3 || t.x > 14 || t.y < 3 || t.y > 14;
      expect(outsideInner).toBe(true);
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThanOrEqual(17);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeLessThanOrEqual(17);
    }
  });

  it('never overlaps the plaza block [8,9]^2', () => {
    for (const t of RIVER_TILES) {
      const inPlaza = t.x >= 8 && t.x <= 9 && t.y >= 8 && t.y <= 9;
      expect(inPlaza).toBe(false);
    }
  });

  it('every river tile is locked at Hall level 2 and unlocked at level 3', () => {
    for (const t of RIVER_TILES) {
      expect(isUnlocked(t.x, t.y, 2)).toBe(false);
      expect(isUnlocked(t.x, t.y, 3)).toBe(true);
    }
  });

  it('isRiver matches exactly the listed tiles', () => {
    expect(isRiver(RIVER_TILES[0]!.x, RIVER_TILES[0]!.y)).toBe(true);
    expect(isRiver(8, 8)).toBe(false);
    expect(isRiver(5, 5)).toBe(false);
  });
});
