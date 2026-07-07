import { describe, expect, it } from 'vitest';
import {
  RIVER_TILES,
  isRiver,
  isUnlocked,
  nextThreshold,
  ringBounds,
} from './expansion';

describe('ringBounds', () => {
  it('starts at the innermost ring below 3 owners', () => {
    expect(ringBounds(0)).toEqual({ lo: 5, hi: 11 });
    expect(ringBounds(2)).toEqual({ lo: 5, hi: 11 });
  });

  it('opens each ring at its population threshold', () => {
    expect(ringBounds(3)).toEqual({ lo: 4, hi: 13 });
    expect(ringBounds(5)).toEqual({ lo: 4, hi: 13 });
    expect(ringBounds(6)).toEqual({ lo: 3, hi: 14 });
    expect(ringBounds(11)).toEqual({ lo: 3, hi: 14 });
    expect(ringBounds(12)).toEqual({ lo: 1, hi: 16 });
    expect(ringBounds(20)).toEqual({ lo: 0, hi: 17 });
    expect(ringBounds(50)).toEqual({ lo: 0, hi: 17 });
  });
});

describe('isUnlocked', () => {
  it('always unlocks the plaza block regardless of population', () => {
    expect(isUnlocked(8, 8, 0)).toBe(true);
    expect(isUnlocked(9, 9, 0)).toBe(true);
  });

  it('gates tiles outside the current ring', () => {
    expect(isUnlocked(5, 5, 0)).toBe(true);
    expect(isUnlocked(11, 11, 0)).toBe(true);
    expect(isUnlocked(4, 4, 0)).toBe(false);
    expect(isUnlocked(12, 5, 0)).toBe(false);
  });

  it('opens the next ring as population grows', () => {
    expect(isUnlocked(4, 4, 3)).toBe(true);
    expect(isUnlocked(13, 13, 3)).toBe(true);
    expect(isUnlocked(3, 3, 3)).toBe(false);
    expect(isUnlocked(0, 0, 20)).toBe(true);
    expect(isUnlocked(17, 17, 20)).toBe(true);
  });
});

describe('nextThreshold', () => {
  it('returns the next population that unlocks land, or null at the max ring', () => {
    expect(nextThreshold(0)).toBe(3);
    expect(nextThreshold(2)).toBe(3);
    expect(nextThreshold(3)).toBe(6);
    expect(nextThreshold(6)).toBe(12);
    expect(nextThreshold(12)).toBe(20);
    expect(nextThreshold(19)).toBe(20);
    expect(nextThreshold(20)).toBeNull();
    expect(nextThreshold(50)).toBeNull();
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

  it('every river tile is locked at 6 owners and unlocked at 12', () => {
    for (const t of RIVER_TILES) {
      expect(isUnlocked(t.x, t.y, 6)).toBe(false);
      expect(isUnlocked(t.x, t.y, 12)).toBe(true);
    }
  });

  it('isRiver matches exactly the listed tiles', () => {
    expect(isRiver(RIVER_TILES[0]!.x, RIVER_TILES[0]!.y)).toBe(true);
    expect(isRiver(8, 8)).toBe(false);
    expect(isRiver(5, 5)).toBe(false);
  });
});
