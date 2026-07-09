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
import { GRID_SIZE } from '../../shared/catalog';
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

// ── Decor identity ───────────────────────────────────────────────────────────

/** Decor sprite keys that are trees — the scene gives these a gentle idle sway
 * and hangs butterflies off them. Typed as `string` so the scene can test the
 * live texture key of a placed decor sprite without a cast. */
export const TREE_DECOR: ReadonlySet<string> = new Set<string>([
  'tree-single',
  'tree-multiple',
  'tree-pine',
  'tree-pine-large',
]);

export const isTreeDecor = (key: string): boolean => TREE_DECOR.has(key);

// ── Seeded per-village terrain ───────────────────────────────────────────────
//
// Every village gets its own terrain from a single stable seed — city.foundedAt
// (identical for every viewer of that village, unique per subreddit install).
// The functions here are PURE (seed + coords in → terrain out), so the same
// village always regenerates the same landscape and it only ever changes when
// the seed changes (never mid-session).

/** mulberry32: a compact, well-distributed seedable PRNG. Same seed → same
 * stream. Exposed for any future seeded sequence (and unit-tested for stability). */
export const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Hash three integers (seed + tile coords) to a uint32. */
const hash3 = (s: number, x: number, y: number): number => {
  let h =
    (Math.imul(s | 0, 0x27d4eb2d) ^
      Math.imul(x, 73856093) ^
      Math.imul(y, 19349663)) >>>
    0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
};

/** A stable [0,1) value at an integer lattice point for this seed. */
const latticeVal = (s: number, gx: number, gy: number): number =>
  hash3(s, gx, gy) / 4294967296;

/** Smooth value noise at (x,y) on a given cell size: bilinear blend of the four
 * surrounding lattice values with a smoothstep fade. */
const valueNoise = (s: number, x: number, y: number, cell: number): number => {
  const fx = x / cell;
  const fy = y / cell;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const v00 = latticeVal(s, x0, y0);
  const v10 = latticeVal(s, x0 + 1, y0);
  const v01 = latticeVal(s, x0, y0 + 1);
  const v11 = latticeVal(s, x0 + 1, y0 + 1);
  const a = v00 + (v10 - v00) * sx;
  const b = v01 + (v11 - v01) * sx;
  return a + (b - a) * sy;
};

/** Two-octave fractal value noise in [0,1]. */
const fractalNoise = (s: number, x: number, y: number): number => {
  const n =
    valueNoise(s, x, y, 3.1) * 0.64 +
    valueNoise(s ^ 0x9e3779b9, x, y, 1.6) * 0.36;
  return Math.min(1, Math.max(0, n));
};

export type Terrain = {
  /** Quantized elevation 0/1/2 (the value-noise height field). The scene applies
   * this ONLY to the decorative locked band / void edge so the surrounding land
   * reads as rolling hills — the claimable playfield is kept flat so hit-testing
   * (which assumes flat ground) stays pixel-exact. */
  height: number;
  /** Ground surface for an open playfield grass tile (a sprinkle of worn dirt). */
  patch: 'grass' | 'dirt';
  /** Seeded decor sprite for an open, unclaimed tile (null = bare grass). */
  decor: SpriteKey | null;
};

const TREE_PICKS: readonly SpriteKey[] = [
  'tree-single',
  'tree-single',
  'tree-multiple',
  'tree-pine',
];
const ROCK_PICKS: readonly SpriteKey[] = ['rocks-grass', 'rocks-dirt'];

/** Tiles this close to the outer frame of the map are where rock clusters gather. */
const NEAR_EDGE = 3;
const isNearEdge = (x: number, y: number): boolean =>
  x < NEAR_EDGE ||
  y < NEAR_EDGE ||
  x >= GRID_SIZE - NEAR_EDGE ||
  y >= GRID_SIZE - NEAR_EDGE;

/**
 * The seeded terrain for one tile: a rolling height field (applied by the scene
 * only to the outer band), an occasional worn-dirt patch, and a density-zoned
 * decor sprinkle (lush groves inland, clustered rocks along the wild edges).
 * Purely cosmetic — never consulted by hit-testing.
 */
export const terrainFor = (seed: number, x: number, y: number): Terrain => {
  const h = fractalNoise(seed, x, y);
  const height = h > 0.72 ? 2 : h > 0.5 ? 1 : 0;

  const cell = hash3(seed ^ 0x51ed270b, x, y);
  const patch: 'grass' | 'dirt' = cell % 100 < 6 ? 'dirt' : 'grass';

  let decor: SpriteKey | null = null;
  if (patch === 'grass') {
    const r = cell >>> 8;
    const rockZone = valueNoise(seed ^ 0x1b56c4e9, x, y, 2.3);
    if (isNearEdge(x, y) && rockZone > 0.62) {
      // A coarse rock-zone along the map frame — rocks gather in loose clusters.
      decor = r % 100 < 40 ? (ROCK_PICKS[r % ROCK_PICKS.length] ?? null) : null;
    } else {
      // Inland: a low-frequency density zone makes some meadows groves, others open.
      const zone = valueNoise(seed ^ 0x2545f491, x, y, 4.3);
      const density = 4 + Math.round(zone * 22); // ~4%..26%
      if (r % 100 < density) {
        decor =
          r % 9 === 0
            ? (ROCK_PICKS[(r >>> 3) % ROCK_PICKS.length] ?? null)
            : (TREE_PICKS[(r >>> 3) % TREE_PICKS.length] ?? null);
      }
    }
  }
  return { height, patch, decor };
};

/** The block sprite used for a raised locked-band tile at a given seeded height:
 * a chunky grass block for a low rise, a rocky cap at the highest step. */
export const bandBlockFor = (height: number): SpriteKey =>
  height >= 2 ? 'cliff-top' : height >= 1 ? 'grass-block' : 'grass-center';

// ── Plaza dressing: village-square well ──────────────────────────────────────

/** The single fixed plaza-adjacent tile the decorative well stands on (a corner
 * of the path ring). Non-claimable already (it's inside the plaza block).
 *
 * Fences removed (playtest, twice): Kenney ships `fence-wood` in a single `_N`
 * orientation only, so at map scale even a proven-correct two-edge railing still
 * read as randomly scattered posts. The well alone dresses the plaza now. */
export const WELL_TILE: { x: number; y: number } = { x: PATH_LO, y: PATH_LO };

// ── Floating-world void background (islets + starfield) ───────────────────────
//
// The space around the island is flat dark purple; these deterministic layers
// (seeded from the same city.foundedAt as terrainFor) fill it. All PURE — the
// scene turns them into cheap sprites parked well outside the map bounds, behind
// every gameplay depth. The map's iso footprint spans roughly sx ∈ [-1088,1088],
// sy ∈ [0,1088] around the centre (0, 544); every islet is pushed clear of it.

/** The screen-space centre of the diorama (matches the scene's KEEP centre). */
const VOID_CX = 0;
const VOID_CY = ((GRID_SIZE - 1) * TILE_H) / 2; // 544

export type BgIslet = {
  /** Screen position of the islet's ground block (well outside the map). */
  sx: number;
  sy: number;
  /** Uniform scale (~0.5–0.65) and a gentle alpha fade. */
  scale: number;
  alpha: number;
  /** A grass block plus one tree/rock sprite resting on it. */
  ground: SpriteKey;
  decor: SpriteKey;
  /** Slow vertical bob: amplitude (px), period (ms) and a per-islet phase (ms). */
  bobDy: number;
  bobDur: number;
  phase: number;
};

/** 4 tiny floating background islets ringing the void at varied distances, each
 * a grass block + a tree/rock, with an offset slow bob. Deterministic per seed. */
export const backgroundIslets = (seed: number): BgIslet[] => {
  const rnd = mulberry32((seed ^ 0x1e1a5c0d) >>> 0);
  const count = 4;
  const out: BgIslet[] = [];
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + (rnd() - 0.5) * 0.8;
    const rx = 1500 + rnd() * 760; // horizontal reach (iso is wide)
    const ry = 1040 + rnd() * 500; // vertical reach
    const sx = VOID_CX + Math.cos(ang) * rx;
    const sy = VOID_CY + Math.sin(ang) * ry;
    const scale = 0.5 + rnd() * 0.15;
    const decor =
      rnd() < 0.35
        ? (ROCK_PICKS[Math.floor(rnd() * ROCK_PICKS.length)] ?? 'rocks-grass')
        : (TREE_PICKS[Math.floor(rnd() * TREE_PICKS.length)] ?? 'tree-single');
    const bobDy = 8 + rnd() * 4; // 8–12px
    const bobDur = 6000 + rnd() * 3000; // 6–9s
    const phase = rnd() * bobDur;
    out.push({ sx, sy, scale, alpha: 0.85, ground: 'grass-block', decor, bobDy, bobDur, phase });
  }
  return out;
};

export type BgStar = {
  sx: number;
  sy: number;
  /** Base opacity (0.25–0.5). */
  alpha: number;
  /** A third of the field slowly twinkles. */
  twinkle: boolean;
};

/** ~24 tiny soft dots scattered across the void, a third of them twinkling.
 * Deterministic per seed. */
export const backgroundStars = (seed: number): BgStar[] => {
  const rnd = mulberry32((seed ^ 0x57a12b93) >>> 0);
  const count = 24;
  const out: BgStar[] = [];
  for (let i = 0; i < count; i++) {
    const sx = (rnd() - 0.5) * 3600; // −1800..1800
    const sy = VOID_CY + (rnd() - 0.5) * 2600; // spread around the centre
    const alpha = 0.25 + rnd() * 0.25; // 0.25–0.5
    out.push({ sx, sy, alpha, twinkle: i % 3 === 0 });
  }
  return out;
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
