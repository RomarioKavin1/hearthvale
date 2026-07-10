import { RING_BY_LEVEL } from '../catalog';

/**
 * Inclusive ring bounds `[lo, hi]` (same on both axes) unlocked at a given
 * Village Hall level. The village starts as the innermost ring (level 0) and
 * grows outward each time the Hall levels up (levels 4 and 5 share the max ring).
 */
export const ringBounds = (hallLevel: number): { lo: number; hi: number } => {
  const i = Math.max(0, Math.min(hallLevel, RING_BY_LEVEL.length - 1));
  return RING_BY_LEVEL[i]!;
};

/** True if tile `(x, y)` is inside the ring unlocked at `hallLevel`. The plaza
 * block sits inside every ring, so a plain bounds check suffices. */
export const isUnlocked = (
  x: number,
  y: number,
  hallLevel: number
): boolean => {
  const { lo, hi } = ringBounds(hallLevel);
  return x >= lo && x <= hi && y >= lo && y <= hi;
};

/**
 * A hand-picked L-shaped river of 16 tiles along the map's north-west: a spring
 * cascade at (6,1) at the foot of the northern rim, a westward run along y=1,
 * one east+south elbow at (1,1), then a southward run down x=1 ending in a pool
 * at (1,11). All tiles sit outside the `[3,14]` band (x < 3 or y < 3), so they
 * only become visible once the Hall-level-3 ring `[1,16]` opens — giving
 * outer-ring land real location value (raw producers built beside a river get
 * +0.5). None touch the plaza or paths.
 *
 * Layout note (see art/render.ts riverPiece): the Kenney Sketch Town pack draws
 * river arcs in ONE orientation (joining the two camera-facing tile edges), so
 * this river uses exactly one such east+south turn — every other tile is a
 * straight or a terminus, all of which route pixel-exactly.
 */
export const RIVER_TILES: ReadonlyArray<{ x: number; y: number }> = [
  { x: 6, y: 1 },
  { x: 5, y: 1 },
  { x: 4, y: 1 },
  { x: 3, y: 1 },
  { x: 2, y: 1 },
  { x: 1, y: 1 },
  { x: 1, y: 2 },
  { x: 1, y: 3 },
  { x: 1, y: 4 },
  { x: 1, y: 5 },
  { x: 1, y: 6 },
  { x: 1, y: 7 },
  { x: 1, y: 8 },
  { x: 1, y: 9 },
  { x: 1, y: 10 },
  { x: 1, y: 11 },
];

const RIVER_KEYS: ReadonlySet<string> = new Set(
  RIVER_TILES.map((t) => `${t.x},${t.y}`)
);

/** True if `(x, y)` is one of the fixed river tiles. */
export const isRiver = (x: number, y: number): boolean =>
  RIVER_KEYS.has(`${x},${y}`);
