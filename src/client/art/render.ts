// Sketch Town diorama render geometry + tile-routing helpers (Task V3).
//
// All Kenney Sketch Town block PNGs are 128×176. Empirically (measured from the
// alpha/colour footprint of every sprite — see .superpowers/sdd/task-v3-report.md):
//   • a full block's TOP-FACE diamond centre sits at image row 95 (the widest
//     opaque row); the diamond is ~2:1 and ~62 px tall (top vertex ≈ row 64).
//   • every roof PNG's own base "footprint" diamond centre sits at image row 140.
// So anchoring a block at origin (0.5, 95/176) and placing it at the iso
// projection point (sx, sy) drops the tile's top-face centre exactly on (sx, sy);
// neighbours then tessellate on the decreed pitch TILE_W=128 / TILE_H=64
// (sx=(x−y)·64, sy=(x+y)·32). A roof lifted by ROOF_DY = −(140−95) = −45 lands its
// footprint on the base's top face.

import type { GameObjects, Scene } from 'phaser';
import type { SpriteKey } from './manifest';
import { tileKey } from '../../shared/logic/grid';
import { isRiver } from '../../shared/logic/expansion';

/** Warm ink backdrop behind the diorama (see Task V3 — chosen over near-black
 * PAL.night so the smooth Sketch Town blocks read warmer). */
export const BG = '#322a3d';

export const IMG_W = 128;
export const IMG_H = 176;

/** Decreed iso pitch (see module note). */
export const TILE_W = 128;
export const TILE_H = 64;

/** Image row of a full block's top-face diamond centre (all blocks share it). */
export const BLOCK_TOP_CENTER_Y = 95;
/** Origin.y that puts the top-face centre on the placement point. */
export const BLOCK_ORIGIN_Y = BLOCK_TOP_CENTER_Y / IMG_H; // ≈ 0.5398

/** Image row of a roof PNG's own footprint diamond centre. */
export const ROOF_FOOTPRINT_Y = 140;
/** Lift a roof so its footprint aligns with the base block's top face. */
export const ROOF_DY = -(ROOF_FOOTPRINT_Y - BLOCK_TOP_CENTER_Y); // −45

/** Nest a castle tower-top cap into the tower's crenellation ring. */
export const CASTLE_TOP_DY = -25;

/**
 * Standing objects (trees / rocks / well / crops) are bottom-anchored; this drops
 * their base onto the tile's top-face so they read as "planted". Tuned in ArtDebug.
 */
export const OBJECT_FOOT_DY = 8;

/** Plaza path ring lives on the border of the [6,11]² square (one tile out from
 * the [7,10]² plaza block). */
export const PATH_LO = 6;
export const PATH_HI = 11;

// ── Placement helpers (shared by Village + ArtDebug) ────────────────────────

/** Place a full-height block/base/roof sprite: origin at its top-face centre. */
export const addBlock = (
  scene: Scene,
  key: SpriteKey,
  sx: number,
  sy: number,
  dy = 0
): GameObjects.Image =>
  scene.add.image(sx, sy + dy, key).setOrigin(0.5, BLOCK_ORIGIN_Y);

/** Place a standing object sprite: bottom-centre anchored onto the tile face. */
export const addObject = (
  scene: Scene,
  key: SpriteKey,
  sx: number,
  sy: number,
  dy = OBJECT_FOOT_DY
): GameObjects.Image =>
  scene.add.image(sx, sy + dy, key).setOrigin(0.5, 1);

/** Sprites that carry a full block footprint even inside a `flat` composition,
 * so they must be block-anchored (not bottom-anchored) when stacked. */
const BLOCK_FOOTPRINT_KEYS: ReadonlySet<SpriteKey> = new Set<SpriteKey>([
  'structure-low',
  'structure-high',
  'structure-arch',
]);

export const isBlockFootprint = (key: SpriteKey): boolean =>
  BLOCK_FOOTPRINT_KEYS.has(key);

// ── Ground routing ──────────────────────────────────────────────────────────

/** True for the one-tile path ring bordering the plaza block. */
export const isPathRing = (x: number, y: number): boolean => {
  const onX = x === PATH_LO || x === PATH_HI;
  const onY = y === PATH_LO || y === PATH_HI;
  const spanY = y >= PATH_LO && y <= PATH_HI;
  const spanX = x >= PATH_LO && x <= PATH_HI;
  return (onX && spanY) || (onY && spanX);
};

export type Piece = { key: SpriteKey; flipX: boolean };

/**
 * Path routing for the plaza ring. Kenney ships one straight (`grass-path`,
 * oriented along the SE↔NW / "x-run" diagonal) and one 4-way (`grass-path-crossing`).
 * Corners use the crossing (block stays upright — a vertical flip would invert the
 * block's shading, so only flipX is safe here); edges use the straight, flipped for
 * the perpendicular "y-run" run.
 */
export const pathPiece = (x: number, y: number): Piece => {
  const corner = (x === PATH_LO || x === PATH_HI) && (y === PATH_LO || y === PATH_HI);
  if (corner) return { key: 'grass-path-crossing', flipX: false };
  // y=const edges run along x (native straight); x=const edges run along y (flipX).
  if (y === PATH_LO || y === PATH_HI) return { key: 'grass-path', flipX: false };
  return { key: 'grass-path', flipX: true };
};

// ── River routing ───────────────────────────────────────────────────────────

const orthoRiverNeighbors = (
  x: number,
  y: number
): Array<{ x: number; y: number }> =>
  [
    { x: x - 1, y },
    { x: x + 1, y },
    { x, y: y - 1 },
    { x, y: y + 1 },
  ].filter((n) => isRiver(n.x, n.y));

/**
 * River routing from the fixed serpentine list: straight where two collinear
 * neighbours line up, an end sprite at a terminus, otherwise a bend. All straight
 * runs in the hardcoded river are vertical (y-run), so they take the flipped
 * straight; bend orientation is approximate (see report — flipX only).
 */
export const riverPiece = (x: number, y: number): Piece => {
  const n = orthoRiverNeighbors(x, y);
  if (n.length <= 1) {
    const only = n[0];
    // Point the end's mouth roughly toward its single neighbour.
    const flipX = only ? only.x < x || only.y < y : false;
    return { key: 'grass-river-end', flipX };
  }
  const [a, b] = [n[0]!, n[1]!];
  const sameCol = a.x === x && b.x === x; // both vertical → y-run straight
  const sameRow = a.y === y && b.y === y; // both horizontal → x-run straight
  if (sameCol) return { key: 'grass-river', flipX: true };
  if (sameRow) return { key: 'grass-river', flipX: false };
  // Bend: flip toward whichever side the horizontal neighbour sits.
  const horiz = [a, b].find((p) => p.y === y);
  const flipX = horiz ? horiz.x < x : false;
  return { key: 'grass-river-bend', flipX };
};

// ── Deterministic decor sprinkle ────────────────────────────────────────────

const hash2 = (x: number, y: number): number => {
  let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
};

/**
 * Sparse (~7%) deterministic decoration for unowned open grass tiles. Returns a
 * standing-object sprite key or null. Purely cosmetic — never affects hit-testing
 * (the scene hit-tests by maths, not sprite picking).
 */
export const decorSprinkle = (x: number, y: number): SpriteKey | null => {
  const h = hash2(x, y);
  if (h % 100 >= 7) return null;
  return (h >>> 7) % 2 === 0 ? 'tree-single' : 'rocks-grass';
};

// ── Castle (Grand Keep) composition ─────────────────────────────────────────

/** The 2×2 keep footprint inside the plaza. */
export const KEEP_TILES: ReadonlyArray<{ x: number; y: number }> = [
  { x: 8, y: 8 }, // back
  { x: 8, y: 9 }, // left
  { x: 9, y: 8 }, // right
  { x: 9, y: 9 }, // front
];

export type CastlePart = { x: number; y: number; key: SpriteKey; roof: boolean };

/**
 * Cumulative Grand Keep silhouette per stage (0 bare … 5 full towers + caps):
 *  1 wall ring · 2 + front gate · 3 + back & right towers · 4 + left tower ·
 *  5 + tower-top caps on every tower.
 */
export const castleParts = (stage: number): CastlePart[] => {
  if (stage <= 0) return [];
  const base: Record<string, SpriteKey> = {
    '8,8': 'castle-wall',
    '8,9': 'castle-wall',
    '9,8': 'castle-wall',
    '9,9': 'castle-wall',
  };
  if (stage >= 2) base['9,9'] = 'castle-gate';
  if (stage >= 3) {
    base['8,8'] = 'castle-tower';
    base['9,8'] = 'castle-tower';
  }
  if (stage >= 4) base['8,9'] = 'castle-tower';

  const parts: CastlePart[] = [];
  for (const t of KEEP_TILES) {
    const key = base[tileKey(t.x, t.y)];
    if (key) parts.push({ x: t.x, y: t.y, key, roof: false });
  }
  if (stage >= 5) {
    for (const t of KEEP_TILES) {
      if (base[tileKey(t.x, t.y)] === 'castle-tower') {
        parts.push({ x: t.x, y: t.y, key: 'castle-tower-top', roof: true });
      }
    }
  }
  return parts;
};
