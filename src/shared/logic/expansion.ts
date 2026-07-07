import { RING_THRESHOLDS } from '../catalog';

/**
 * Inclusive ring bounds `[lo, hi]` (same on both axes) unlocked at a given
 * distinct-owner population. The village starts as the innermost ring and grows
 * outward as more villagers join.
 */
export const ringBounds = (population: number): { lo: number; hi: number } => {
  let lo = RING_THRESHOLDS[0]!.lo;
  let hi = RING_THRESHOLDS[0]!.hi;
  for (const t of RING_THRESHOLDS) {
    if (population >= t.pop) {
      lo = t.lo;
      hi = t.hi;
    }
  }
  return { lo, hi };
};

/** True if tile `(x, y)` is inside the ring unlocked at `population`. The plaza
 * block sits inside every ring, so a plain bounds check suffices. */
export const isUnlocked = (
  x: number,
  y: number,
  population: number
): boolean => {
  const { lo, hi } = ringBounds(population);
  return x >= lo && x <= hi && y >= lo && y <= hi;
};

/** The next population that unlocks more land, or null once fully expanded. */
export const nextThreshold = (population: number): number | null => {
  for (const t of RING_THRESHOLDS) {
    if (t.pop > population) return t.pop;
  }
  return null;
};

/**
 * A hand-picked serpentine river of 14 tiles down the west edge of the map. All
 * tiles sit outside the `[3,14]` band (x < 3), so they only become visible once
 * the `>=12` ring `[1,16]` opens — giving outer-ring land real location value
 * (raw producers built beside a river get +0.5). None touch the plaza or paths.
 */
export const RIVER_TILES: ReadonlyArray<{ x: number; y: number }> = [
  { x: 1, y: 4 },
  { x: 2, y: 4 },
  { x: 2, y: 5 },
  { x: 2, y: 6 },
  { x: 1, y: 6 },
  { x: 1, y: 7 },
  { x: 1, y: 8 },
  { x: 2, y: 8 },
  { x: 2, y: 9 },
  { x: 2, y: 10 },
  { x: 1, y: 10 },
  { x: 1, y: 11 },
  { x: 1, y: 12 },
  { x: 2, y: 12 },
];

const RIVER_KEYS: ReadonlySet<string> = new Set(
  RIVER_TILES.map((t) => `${t.x},${t.y}`)
);

/** True if `(x, y)` is one of the fixed river tiles. */
export const isRiver = (x: number, y: number): boolean =>
  RIVER_KEYS.has(`${x},${y}`);
