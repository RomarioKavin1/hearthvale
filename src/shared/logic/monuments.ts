// Seeded monuments (E2): a pool of pre-built multi-tile set pieces scattered
// deterministically around every village — ruined watchtowers, stone circles,
// abandoned homesteads, ancient gates, wild orchards and wayfarer camps. Each is
// purely decorative flavour (tap → a warm modal, no claim button) but its tiles
// are NON-CLAIMABLE, so this module is the single source of truth used by BOTH
// the renderer (which draws them) AND server claim validation (which rejects
// building on them). Pure + deterministic: the same village seed
// (`city.foundedAt`) always yields the same monuments for every viewer.

import { GRID_SIZE } from '../catalog';
import { isRiver } from './expansion';
import { tileKey } from './grid';

/** The six monument templates. Meadow + desert sprite compositions live in the
 * renderer (art/render.ts MONUMENT_ART); this shared module owns only the tile
 * FOOTPRINT (identical across biomes) and the flavour copy, so claim validation
 * stays biome-independent. */
// H1 deliverable 4: the distinctive CASTLE compositions (ruined watchtower =
// castle-tower + top; ancient gate = castle-wall + arch) were retired from the
// monument pool — that art now goes to REAL buildings — and the monuments are
// demoted to humble ruins that never compete with a player's structures.
export type MonumentId =
  | 'broken-wall'
  | 'stone-circle'
  | 'homestead'
  | 'fence-rubble'
  | 'orchard'
  | 'dry-well';

export type MonumentTemplate = {
  id: MonumentId;
  /** Modal title. */
  name: string;
  /** One or two warm sentences shown in the flavour modal. */
  flavor: string;
  /** Tile offsets `[dx, dy]` the footprint occupies, anchored at (0, 0). 1–4
   * tiles each; the same footprint is used in every biome. */
  footprint: ReadonlyArray<readonly [number, number]>;
};

export const MONUMENT_TEMPLATES: readonly MonumentTemplate[] = [
  {
    id: 'broken-wall',
    name: 'Crumbled Wall',
    flavor:
      'A short run of broken stonework, half-swallowed by grass — the last of a boundary the village long ago outgrew. Children dare each other to walk its length.',
    footprint: [
      [0, 0],
      [1, 0],
    ],
  },
  {
    id: 'stone-circle',
    name: 'Old Stone Circle',
    flavor:
      'A ring of weathered standing stones, older than anyone can remember. On midsummer nights the whole village gathers here to share stories.',
    footprint: [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ],
  },
  {
    id: 'homestead',
    name: 'Abandoned Homestead',
    flavor:
      'The tilted roof of a long-abandoned farmhouse. Wildflowers have reclaimed the doorway, and swallows nest in its eaves each spring.',
    footprint: [[0, 0]],
  },
  {
    id: 'fence-rubble',
    name: 'Fallen Fence',
    flavor:
      'A collapsed length of old fencing gone to rubble, leaning where the wind left it. Nobody remembers whose field it once kept.',
    footprint: [
      [0, 0],
      [1, 0],
    ],
  },
  {
    id: 'orchard',
    name: 'Wild Orchard',
    flavor:
      'A tangle of old fruit trees gone wild, planted by settlers generations ago. Come autumn the children fill their baskets here.',
    footprint: [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ],
  },
  {
    id: 'dry-well',
    name: 'Dry Well',
    flavor:
      'An old well run dry, its bucket rope frayed to nothing and its stones furred with moss. Villagers toss a pebble in and make a wish all the same.',
    footprint: [[0, 0]],
  },
];

const TEMPLATE_BY_ID: Record<MonumentId, MonumentTemplate> = {
  'broken-wall': MONUMENT_TEMPLATES[0]!,
  'stone-circle': MONUMENT_TEMPLATES[1]!,
  homestead: MONUMENT_TEMPLATES[2]!,
  'fence-rubble': MONUMENT_TEMPLATES[3]!,
  orchard: MONUMENT_TEMPLATES[4]!,
  'dry-well': MONUMENT_TEMPLATES[5]!,
};

/** mulberry32 PRNG (same family as the renderer's terrain seed) — a compact,
 * well-distributed stream so the same seed always lays out the same monuments. */
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// Placement guard rails: monuments sit in the central band [3, GRID_SIZE-4] (so
// every footprint is visible inside the level-0 ring and never spills off the
// map), clear of the plaza block + a one-tile buffer, clear of the two central
// spoke lanes (x/y 8 or 9, where the seeded path network radiates), and off the
// fixed river.
const PLAZA_BUF_LO = 6;
const PLAZA_BUF_HI = 11;
const BAND_LO = 3;
const BAND_HI = GRID_SIZE - 4; // 14 on the 18-wide grid

const validTile = (x: number, y: number): boolean => {
  if (x < BAND_LO || x > BAND_HI || y < BAND_LO || y > BAND_HI) return false;
  if (x >= PLAZA_BUF_LO && x <= PLAZA_BUF_HI && y >= PLAZA_BUF_LO && y <= PLAZA_BUF_HI) {
    return false;
  }
  if (x === 8 || x === 9 || y === 8 || y === 9) return false;
  if (isRiver(x, y)) return false;
  return true;
};

export type PlacedMonument = {
  template: MonumentTemplate;
  /** Anchor tile (the footprint's (0,0)). */
  x: number;
  y: number;
  /** Absolute tiles this monument occupies (non-claimable). */
  tiles: ReadonlyArray<{ x: number; y: number }>;
};

/**
 * The deterministic set of monuments for a village seed: 2–4 pieces, each a
 * seeded template placed at a seeded anchor that satisfies `validTile` for every
 * footprint tile and keeps a one-tile gap from other monuments. Pure — the same
 * seed always returns the same monuments (order included).
 */
export const monuments = (seed: number): PlacedMonument[] => {
  const rnd = mulberry32((seed ^ 0x4d2f1a3b) >>> 0);
  const count = 2 + Math.floor(rnd() * 3); // 2..4
  const claimed = new Set<string>();
  const out: PlacedMonument[] = [];
  let guard = 0;
  while (out.length < count && guard++ < 400) {
    const tpl =
      MONUMENT_TEMPLATES[Math.floor(rnd() * MONUMENT_TEMPLATES.length)] ??
      MONUMENT_TEMPLATES[0]!;
    const maxDx = Math.max(...tpl.footprint.map(([dx]) => dx));
    const maxDy = Math.max(...tpl.footprint.map(([, dy]) => dy));
    const ax = BAND_LO + Math.floor(rnd() * (BAND_HI - BAND_LO + 1 - maxDx));
    const ay = BAND_LO + Math.floor(rnd() * (BAND_HI - BAND_LO + 1 - maxDy));
    const tiles = tpl.footprint.map(([dx, dy]) => ({ x: ax + dx, y: ay + dy }));

    let ok = true;
    for (const t of tiles) {
      if (!validTile(t.x, t.y)) {
        ok = false;
        break;
      }
      // One-tile separation so two monuments never touch or overlap.
      for (let gx = -1; gx <= 1 && ok; gx++) {
        for (let gy = -1; gy <= 1 && ok; gy++) {
          if (claimed.has(tileKey(t.x + gx, t.y + gy))) ok = false;
        }
      }
    }
    if (!ok) continue;
    for (const t of tiles) claimed.add(tileKey(t.x, t.y));
    out.push({ template: tpl, x: ax, y: ay, tiles });
  }
  return out;
};

// A single-entry memo keeps the hot lookups (`isMonument` per claim, per-tile
// render guards) from re-running the placement loop for the stable village seed.
let memoSeed: number | null = null;
let memoTiles: ReadonlySet<string> = new Set();
let memoPlaced: PlacedMonument[] = [];

const ensureMemo = (seed: number): void => {
  if (memoSeed === seed) return;
  memoPlaced = monuments(seed);
  memoTiles = new Set(
    memoPlaced.flatMap((m) => m.tiles.map((t) => tileKey(t.x, t.y)))
  );
  memoSeed = seed;
};

/** The set of `"x,y"` tile keys occupied by this village's monuments. */
export const monumentTiles = (seed: number): ReadonlySet<string> => {
  ensureMemo(seed);
  return memoTiles;
};

/** True if tile `(x, y)` is part of a monument (and therefore not claimable). */
export const isMonument = (seed: number, x: number, y: number): boolean => {
  ensureMemo(seed);
  return memoTiles.has(tileKey(x, y));
};

/** The monument whose footprint contains `(x, y)`, or null. Used by the tile
 * sheet to show the right flavour modal. */
export const monumentAt = (
  seed: number,
  x: number,
  y: number
): PlacedMonument | null => {
  ensureMemo(seed);
  for (const m of memoPlaced) {
    for (const t of m.tiles) {
      if (t.x === x && t.y === y) return m;
    }
  }
  return null;
};

export { TEMPLATE_BY_ID };
