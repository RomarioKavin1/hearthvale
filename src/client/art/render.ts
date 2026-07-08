// Sketch Town diorama render geometry + tile-routing helpers (Task V3).
//
// All Kenney Sketch Town block PNGs are 128×176. Empirically (measured from the
// alpha/colour footprint of every sprite — see .superpowers/sdd/task-v3-report.md):
//   • a full block's TOP-FACE diamond centre sits at image row 95 (the widest
//     opaque row); the diamond is ~2:1 and ~62 px tall (top vertex ≈ row 64).
//   • every "rests on a surface" sprite (roofs, trees, rocks, crops, well) has its
//     resting footprint centred at image row ≈ 140 — one block-height step (45 px)
//     below the top-face row.
// So anchoring a block at origin (0.5, 95/176) and placing it at the iso
// projection point (sx, sy) drops the tile's top-face centre exactly on (sx, sy);
// neighbours then tessellate on the decreed pitch TILE_W=128 / TILE_H=64
// (sx=(x−y)·64, sy=(x+y)·32).
//
// CRITICAL (playtest-confirmed): anything sitting ON a terrain tile — building
// base blocks, castle blocks, scaffolds, decor objects, crops — must be lifted a
// full block-height step (BASE_DY = −45) or its walls render inside the terrain
// block and get overdrawn by the front-neighbour ground tiles (only the roof
// poking above ground level stays visible). Roofs then stack at BASE_DY + ROOF_DY
// (= −90 from the ground anchor); castle tower caps at BASE_DY + CASTLE_TOP_DY.
// Verified with the off-Phaser compositing harness (base at 0 reproduces the
// roof-only bug; −45 shows walls flush between grass top and roof).

import type { GameObjects, Scene } from 'phaser';
import type { SpriteKey } from './manifest';
import type { VillageTheme } from '../../shared/types';
import { tileKey } from '../../shared/logic/grid';
import { isRiver } from '../../shared/logic/expansion';

/** Warm ink backdrop behind the diorama (see Task V3 — chosen over near-black
 * PAL.night so the smooth Sketch Town blocks read warmer). */
export const BG = '#322a3d';

/**
 * Per-theme recolouring applied to the diorama's GROUND (grass + dirt + decor)
 * and background — buildings, paths and rivers stay untinted so the art stays
 * readable. Tints are deliberately gentle multiply-style shifts so the base
 * Sketch Town look is still recognizable.
 *
 * - `grassTint` / `dirtTint`: Phaser `setTint` colour on grass / dirt ground
 *   tiles + decor (undefined = leave the sprite's native colour).
 * - `skyBg`: the Phaser camera background colour.
 * - `lockedTint`: the tint for the desaturated locked-land band.
 */
export type ThemeStyle = {
  grassTint?: number;
  dirtTint?: number;
  skyBg: string;
  lockedTint: number;
};

export const THEMES: Record<VillageTheme, ThemeStyle> = {
  // Meadow: the untouched base look (lockedTint mirrors LOCKED_TINT below).
  meadow: { skyBg: BG, lockedTint: 0x3a3550 },
  // Autumn: warm orange wash over the greens, a slightly warmer backdrop.
  autumn: {
    grassTint: 0xffcf8a,
    dirtTint: 0xffcaa0,
    skyBg: '#3a2e33',
    lockedTint: 0x4a3a44,
  },
  // Twilight: cool purple shift over the ground on a darker sky.
  twilight: {
    grassTint: 0xcdc0ff,
    dirtTint: 0xbcaee6,
    skyBg: '#28243a',
    lockedTint: 0x342f4e,
  },
  // Pale: desaturated, brighter ground on a lighter backdrop.
  pale: {
    grassTint: 0xe8f0e0,
    dirtTint: 0xe4e0d4,
    skyBg: '#3c3a46',
    lockedTint: 0x45455a,
  },
};

export const IMG_W = 128;
export const IMG_H = 176;

/** Decreed iso pitch (see module note). */
export const TILE_W = 128;
export const TILE_H = 64;

/** Image row of a full block's top-face diamond centre (all blocks share it). */
export const BLOCK_TOP_CENTER_Y = 95;
/** Origin.y that puts the top-face centre on the placement point. */
export const BLOCK_ORIGIN_Y = BLOCK_TOP_CENTER_Y / IMG_H; // ≈ 0.5398

/** Image row where a sits-on-surface sprite's footprint rests (roofs, trees,
 * rocks, crops, well — all ≈ 140). */
export const REST_ROW_Y = 140;

/** One block-height step: lift for ANYTHING sitting on a terrain tile (building
 * bases, castle blocks, scaffolds, decor objects, crops). Without this lift the
 * piece renders inside the terrain block and front-neighbour ground overdraws it. */
export const BASE_DY = -(REST_ROW_Y - BLOCK_TOP_CENTER_Y); // −45

/** Roof offset relative to the BASE it caps (not the ground anchor). A roof over
 * a lifted base therefore renders at BASE_DY + ROOF_DY = −90 from the ground. */
export const ROOF_DY = BASE_DY; // −45 (same one-block step)

/** Tower-top cap offset relative to the castle tower it caps (nests into the
 * crenellation ring). From the ground anchor: BASE_DY + CASTLE_TOP_DY = −70. */
export const CASTLE_TOP_DY = -25;

/** Locked land renders only this many tiles beyond the unlocked ring; deeper
 * locked tiles are left as background void. */
export const LOCKED_BAND = 2;

/** Tint + alpha for the locked-band grass (heavy dark desaturation). */
export const LOCKED_TINT = 0x3a3550;
export const LOCKED_ALPHA = 0.4;

/** Path ring: the 12 tiles on the border of [7,10]² immediately surrounding the
 * keep pad [8,9]² (shrunk from the v1 [6,11] ring — playtest: the old 36-tile
 * dirt centre read as an orange pit, not a village green). */
export const PATH_LO = 7;
export const PATH_HI = 10;

/** The keep pad: only these 2×2 tiles render as dirt. The rest of the shared
 * `isPlaza` [7,10]² footprint renders as grass but stays unclaimable. */
export const isKeepPad = (x: number, y: number): boolean =>
  x >= 8 && x <= 9 && y >= 8 && y <= 9;

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

/** Place anything resting ON a tile's top face (decor object, crop, rock pile):
 * block-anchored and lifted one block step so it stands on the surface. */
export const addSurface = (
  scene: Scene,
  key: SpriteKey,
  sx: number,
  sy: number
): GameObjects.Image => addBlock(scene, key, sx, sy, BASE_DY);

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

/** Weighted decor palette (trees ~4:1 over rocks) for a lusher village green.
 * Repeats bias the pick; a plain modulo over the array does the weighting. */
const DECOR_WEIGHTED: readonly SpriteKey[] = [
  'tree-single',
  'tree-single',
  'tree-multiple',
  'tree-multiple',
  'tree-pine',
  'tree-pine',
  'tree-single',
  'tree-multiple',
  'rocks-grass',
  'rocks-dirt',
];

/** Decor sprite keys that are trees — the scene gives these a gentle idle sway. */
export const TREE_DECOR: ReadonlySet<SpriteKey> = new Set<SpriteKey>([
  'tree-single',
  'tree-multiple',
  'tree-pine',
  'tree-pine-large',
]);

export const isTreeDecor = (key: SpriteKey): boolean => TREE_DECOR.has(key);

/**
 * Deterministic decoration (~14%) for unowned open grass tiles, weighted toward
 * trees with a rock here and there. Purely cosmetic — never affects hit-testing
 * (the scene hit-tests by maths, not sprite picking).
 */
export const decorSprinkle = (x: number, y: number): SpriteKey | null => {
  const h = hash2(x, y);
  if (h % 100 >= 14) return null;
  return DECOR_WEIGHTED[(h >>> 7) % DECOR_WEIGHTED.length] ?? null;
};

// ── Plaza dressing: village-square fence + well ──────────────────────────────

/** The single fixed plaza-adjacent tile the decorative well stands on (a corner
 * of the path ring). Non-claimable already (it's inside the plaza block). */
export const WELL_TILE: { x: number; y: number } = { x: PATH_LO, y: PATH_LO };

export type FencePiece = { x: number; y: number; key: SpriteKey };

/**
 * A low wooden fence hugging the outer edge of the path ring — the 12 border
 * tiles of the [7,10]² plaza block, corners as `fence-wood-corner`, edges as
 * `fence-wood`. The well's corner (WELL_TILE) is skipped so the two don't stack.
 * Deterministic + decorative; these tiles never take a building (plaza block).
 */
export const plazaFencePieces = (): FencePiece[] => {
  const pieces: FencePiece[] = [];
  for (let x = PATH_LO; x <= PATH_HI; x++) {
    for (let y = PATH_LO; y <= PATH_HI; y++) {
      const onBorder = x === PATH_LO || x === PATH_HI || y === PATH_LO || y === PATH_HI;
      if (!onBorder) continue;
      if (x === WELL_TILE.x && y === WELL_TILE.y) continue;
      const corner =
        (x === PATH_LO || x === PATH_HI) && (y === PATH_LO || y === PATH_HI);
      pieces.push({ x, y, key: corner ? 'fence-wood-corner' : 'fence-wood' });
    }
  }
  return pieces;
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
