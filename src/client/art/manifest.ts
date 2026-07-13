// Art asset manifest — Kenney Sketch Town + Sketch Town Expansion + Game Icons (CC0, kenney.nl).
// Generated for Task V0 of the v2 rework (docs/plans/2026-07-08-hearthvale-v2.md).
// Nothing imports this file yet — it is wired up in Task V3 (renderer) and Task V4 (HUD).

import type { BuildingId, RoofColor, Tier } from '../../shared/types';

/** All bundled sprite + icon keys. File name (kebab-case, no extension) is the key. */
export type SpriteKey =
  // terrain: grass path routing set (full)
  | 'grass-path'
  | 'grass-path-bend'
  | 'grass-path-corner'
  | 'grass-path-crossing'
  | 'grass-path-end'
  | 'grass-path-end-square'
  | 'grass-path-slope'
  | 'grass-path-split'
  // terrain: grass river routing set (full)
  | 'grass-river'
  | 'grass-river-bend'
  | 'grass-river-bridge'
  | 'grass-river-corner'
  | 'grass-river-crossing'
  | 'grass-river-end'
  | 'grass-river-end-square'
  | 'grass-river-slope'
  | 'grass-river-split'
  // terrain: grass/dirt centers + edges
  | 'grass-center'
  | 'grass-corner'
  | 'grass-block'
  | 'dirt-center'
  | 'dirt-low'
  | 'dirt-corner'
  // terrain: slopes + cliffs (ring boundary / locked tiles)
  | 'grass-slope'
  | 'grass-slope-convex'
  | 'grass-slope-concave'
  | 'cliff'
  | 'cliff-corner'
  | 'cliff-entrance'
  | 'cliff-top'
  // terrain: water + bridge
  | 'water-center'
  | 'water-fall'
  | 'grass-water'
  | 'bridge'
  // building bases (center/corner/door/doorWindows/window/windows x2 colors + stack x2)
  | 'building-center'
  | 'building-center-beige'
  | 'building-corner'
  | 'building-corner-beige'
  | 'building-door'
  | 'building-door-beige'
  | 'building-door-windows'
  | 'building-door-windows-beige'
  | 'building-window'
  | 'building-window-beige'
  | 'building-windows'
  | 'building-windows-beige'
  | 'building-stack'
  | 'building-stack-beige'
  // roofs: 6 shapes x 4 colors (24)
  | 'roof-gable-beige'
  | 'roof-gable-brown'
  | 'roof-gable-green'
  | 'roof-gable-purple'
  | 'roof-point-beige'
  | 'roof-point-brown'
  | 'roof-point-green'
  | 'roof-point-purple'
  | 'roof-round-beige'
  | 'roof-round-brown'
  | 'roof-round-green'
  | 'roof-round-purple'
  | 'roof-rounded-beige'
  | 'roof-rounded-brown'
  | 'roof-rounded-green'
  | 'roof-rounded-purple'
  | 'roof-slant-beige'
  | 'roof-slant-brown'
  | 'roof-slant-green'
  | 'roof-slant-purple'
  | 'roof-church-beige'
  | 'roof-church-brown'
  | 'roof-church-green'
  | 'roof-church-purple'
  // castle set (Grand Keep stages)
  | 'castle-center'
  | 'castle-corner'
  | 'castle-bend'
  | 'castle-wall'
  | 'castle-gate'
  | 'castle-gate-open'
  | 'castle-window'
  | 'castle-slope'
  | 'castle-tower'
  | 'castle-tower-base'
  | 'castle-tower-top'
  | 'castle-tower-center'
  // decor: trees, rocks, well, fences
  | 'tree-single'
  | 'tree-multiple'
  | 'tree-pine'
  | 'tree-pine-large'
  | 'rocks-dirt'
  | 'rocks-grass'
  | 'well'
  | 'fence-wood'
  | 'fence-wood-corner'
  | 'fence-wood-end'
  // furrow / crops (wheat field growth states)
  | 'furrow'
  | 'furrow-crop'
  | 'furrow-crop-wheat'
  | 'furrow-end'
  // construction scaffolds + misc structures
  | 'structure-arch'
  | 'structure-high'
  | 'structure-low'
  | 'balcony-wood'
  // H1 pack additions: a clean round stone mill tower (windmill body) + the four
  // colored crest towers + a stone pedestal (crest flag v2). (The bases-pack crop
  // plates were evaluated and dropped — see Village.drawCropBase — as their round,
  // wooden-rimmed render clashes with the flat Sketch Town furrow at map zoom.)
  | 'mill-tower-base'
  | 'crest-tower-beige'
  | 'crest-tower-brown'
  | 'crest-tower-green'
  | 'crest-tower-purple'
  | 'base-stone-detail'
  // desert biome (E2): Kenney Sketch Desert — a full sand terrain family + palms,
  // domes, tents, broken walls that reskins the world when the theme is 'desert'.
  | 'sand-center'
  | 'sand-corner'
  | 'sand-dirt-center'
  | 'sand-path'
  | 'sand-path-bend'
  | 'sand-path-corner'
  | 'sand-path-crossing'
  | 'sand-path-end'
  | 'sand-path-split'
  | 'sand-river'
  | 'sand-river-bend'
  | 'sand-river-corner'
  | 'sand-river-bridge'
  | 'sand-river-end'
  | 'sand-water'
  | 'desert-water-center'
  | 'desert-water-fall'
  | 'palm'
  | 'palms'
  | 'rocks-sand'
  | 'desert-dome'
  | 'desert-dome-small'
  | 'desert-tent'
  | 'desert-tent-slant'
  | 'desert-wall-broken'
  | 'desert-wall-corner'
  | 'desert-wall-end'
  | 'desert-tiles-decorated'
  // UI icons (white, tintable via CSS filter)
  | 'icon-coin'
  | 'icon-star'
  | 'icon-home'
  | 'icon-hammer'
  | 'icon-cart'
  | 'icon-scroll'
  | 'icon-streak'
  | 'icon-arrow-up'
  | 'icon-arrow-down'
  | 'icon-check'
  | 'icon-cross'
  | 'icon-gear'
  | 'icon-trophy'
  | 'icon-question';

const ICON_KEYS = new Set<SpriteKey>([
  'icon-coin',
  'icon-star',
  'icon-home',
  'icon-hammer',
  'icon-cart',
  'icon-scroll',
  'icon-streak',
  'icon-arrow-up',
  'icon-arrow-down',
  'icon-check',
  'icon-cross',
  'icon-gear',
  'icon-trophy',
  'icon-question',
]);

/**
 * Note on icon substitutions (game-icons pack has no literal coin/dollar/gem or
 * flame/fire asset): `icon-coin` uses the closest circular token shape
 * (`medal1.png`), `icon-streak` uses the second medal shape (`medal2.png`) as
 * the closest available stand-in for a fire/flame streak icon, and
 * `icon-hammer` uses `wrench.png` (explicitly allowed by the V0 spec).
 */
export const SPRITES: Record<SpriteKey, string> = {
  'grass-path': '/sprites/grass-path.png',
  'grass-path-bend': '/sprites/grass-path-bend.png',
  'grass-path-corner': '/sprites/grass-path-corner.png',
  'grass-path-crossing': '/sprites/grass-path-crossing.png',
  'grass-path-end': '/sprites/grass-path-end.png',
  'grass-path-end-square': '/sprites/grass-path-end-square.png',
  'grass-path-slope': '/sprites/grass-path-slope.png',
  'grass-path-split': '/sprites/grass-path-split.png',
  'grass-river': '/sprites/grass-river.png',
  'grass-river-bend': '/sprites/grass-river-bend.png',
  'grass-river-bridge': '/sprites/grass-river-bridge.png',
  'grass-river-corner': '/sprites/grass-river-corner.png',
  'grass-river-crossing': '/sprites/grass-river-crossing.png',
  'grass-river-end': '/sprites/grass-river-end.png',
  'grass-river-end-square': '/sprites/grass-river-end-square.png',
  'grass-river-slope': '/sprites/grass-river-slope.png',
  'grass-river-split': '/sprites/grass-river-split.png',
  'grass-center': '/sprites/grass-center.png',
  'grass-corner': '/sprites/grass-corner.png',
  'grass-block': '/sprites/grass-block.png',
  'dirt-center': '/sprites/dirt-center.png',
  'dirt-low': '/sprites/dirt-low.png',
  'dirt-corner': '/sprites/dirt-corner.png',
  'grass-slope': '/sprites/grass-slope.png',
  'grass-slope-convex': '/sprites/grass-slope-convex.png',
  'grass-slope-concave': '/sprites/grass-slope-concave.png',
  cliff: '/sprites/cliff.png',
  'cliff-corner': '/sprites/cliff-corner.png',
  'cliff-entrance': '/sprites/cliff-entrance.png',
  'cliff-top': '/sprites/cliff-top.png',
  'water-center': '/sprites/water-center.png',
  'water-fall': '/sprites/water-fall.png',
  'grass-water': '/sprites/grass-water.png',
  bridge: '/sprites/bridge.png',
  'building-center': '/sprites/building-center.png',
  'building-center-beige': '/sprites/building-center-beige.png',
  'building-corner': '/sprites/building-corner.png',
  'building-corner-beige': '/sprites/building-corner-beige.png',
  'building-door': '/sprites/building-door.png',
  'building-door-beige': '/sprites/building-door-beige.png',
  'building-door-windows': '/sprites/building-door-windows.png',
  'building-door-windows-beige': '/sprites/building-door-windows-beige.png',
  'building-window': '/sprites/building-window.png',
  'building-window-beige': '/sprites/building-window-beige.png',
  'building-windows': '/sprites/building-windows.png',
  'building-windows-beige': '/sprites/building-windows-beige.png',
  'building-stack': '/sprites/building-stack.png',
  'building-stack-beige': '/sprites/building-stack-beige.png',
  'roof-gable-beige': '/sprites/roof-gable-beige.png',
  'roof-gable-brown': '/sprites/roof-gable-brown.png',
  'roof-gable-green': '/sprites/roof-gable-green.png',
  'roof-gable-purple': '/sprites/roof-gable-purple.png',
  'roof-point-beige': '/sprites/roof-point-beige.png',
  'roof-point-brown': '/sprites/roof-point-brown.png',
  'roof-point-green': '/sprites/roof-point-green.png',
  'roof-point-purple': '/sprites/roof-point-purple.png',
  'roof-round-beige': '/sprites/roof-round-beige.png',
  'roof-round-brown': '/sprites/roof-round-brown.png',
  'roof-round-green': '/sprites/roof-round-green.png',
  'roof-round-purple': '/sprites/roof-round-purple.png',
  'roof-rounded-beige': '/sprites/roof-rounded-beige.png',
  'roof-rounded-brown': '/sprites/roof-rounded-brown.png',
  'roof-rounded-green': '/sprites/roof-rounded-green.png',
  'roof-rounded-purple': '/sprites/roof-rounded-purple.png',
  'roof-slant-beige': '/sprites/roof-slant-beige.png',
  'roof-slant-brown': '/sprites/roof-slant-brown.png',
  'roof-slant-green': '/sprites/roof-slant-green.png',
  'roof-slant-purple': '/sprites/roof-slant-purple.png',
  'roof-church-beige': '/sprites/roof-church-beige.png',
  'roof-church-brown': '/sprites/roof-church-brown.png',
  'roof-church-green': '/sprites/roof-church-green.png',
  'roof-church-purple': '/sprites/roof-church-purple.png',
  'castle-center': '/sprites/castle-center.png',
  'castle-corner': '/sprites/castle-corner.png',
  'castle-bend': '/sprites/castle-bend.png',
  'castle-wall': '/sprites/castle-wall.png',
  'castle-gate': '/sprites/castle-gate.png',
  'castle-gate-open': '/sprites/castle-gate-open.png',
  'castle-window': '/sprites/castle-window.png',
  'castle-slope': '/sprites/castle-slope.png',
  'castle-tower': '/sprites/castle-tower.png',
  'castle-tower-base': '/sprites/castle-tower-base.png',
  'castle-tower-top': '/sprites/castle-tower-top.png',
  'castle-tower-center': '/sprites/castle-tower-center.png',
  'tree-single': '/sprites/tree-single.png',
  'tree-multiple': '/sprites/tree-multiple.png',
  'tree-pine': '/sprites/tree-pine.png',
  'tree-pine-large': '/sprites/tree-pine-large.png',
  'rocks-dirt': '/sprites/rocks-dirt.png',
  'rocks-grass': '/sprites/rocks-grass.png',
  well: '/sprites/well.png',
  'fence-wood': '/sprites/fence-wood.png',
  'fence-wood-corner': '/sprites/fence-wood-corner.png',
  'fence-wood-end': '/sprites/fence-wood-end.png',
  furrow: '/sprites/furrow.png',
  'furrow-crop': '/sprites/furrow-crop.png',
  'furrow-crop-wheat': '/sprites/furrow-crop-wheat.png',
  'furrow-end': '/sprites/furrow-end.png',
  'structure-arch': '/sprites/structure-arch.png',
  'structure-high': '/sprites/structure-high.png',
  'structure-low': '/sprites/structure-low.png',
  'balcony-wood': '/sprites/balcony-wood.png',
  'mill-tower-base': '/sprites/mill-tower-base.png',
  'crest-tower-beige': '/sprites/crest-tower-beige.png',
  'crest-tower-brown': '/sprites/crest-tower-brown.png',
  'crest-tower-green': '/sprites/crest-tower-green.png',
  'crest-tower-purple': '/sprites/crest-tower-purple.png',
  'base-stone-detail': '/sprites/base-stone-detail.png',
  'sand-center': '/sprites/sand-center.png',
  'sand-corner': '/sprites/sand-corner.png',
  'sand-dirt-center': '/sprites/sand-dirt-center.png',
  'sand-path': '/sprites/sand-path.png',
  'sand-path-bend': '/sprites/sand-path-bend.png',
  'sand-path-corner': '/sprites/sand-path-corner.png',
  'sand-path-crossing': '/sprites/sand-path-crossing.png',
  'sand-path-end': '/sprites/sand-path-end.png',
  'sand-path-split': '/sprites/sand-path-split.png',
  'sand-river': '/sprites/sand-river.png',
  'sand-river-bend': '/sprites/sand-river-bend.png',
  'sand-river-corner': '/sprites/sand-river-corner.png',
  'sand-river-bridge': '/sprites/sand-river-bridge.png',
  'sand-river-end': '/sprites/sand-river-end.png',
  'sand-water': '/sprites/sand-water.png',
  'desert-water-center': '/sprites/desert-water-center.png',
  'desert-water-fall': '/sprites/desert-water-fall.png',
  palm: '/sprites/palm.png',
  palms: '/sprites/palms.png',
  'rocks-sand': '/sprites/rocks-sand.png',
  'desert-dome': '/sprites/desert-dome.png',
  'desert-dome-small': '/sprites/desert-dome-small.png',
  'desert-tent': '/sprites/desert-tent.png',
  'desert-tent-slant': '/sprites/desert-tent-slant.png',
  'desert-wall-broken': '/sprites/desert-wall-broken.png',
  'desert-wall-corner': '/sprites/desert-wall-corner.png',
  'desert-wall-end': '/sprites/desert-wall-end.png',
  'desert-tiles-decorated': '/sprites/desert-tiles-decorated.png',
  'icon-coin': '/icons/icon-coin.png',
  'icon-star': '/icons/icon-star.png',
  'icon-home': '/icons/icon-home.png',
  'icon-hammer': '/icons/icon-hammer.png',
  'icon-cart': '/icons/icon-cart.png',
  'icon-scroll': '/icons/icon-scroll.png',
  'icon-streak': '/icons/icon-streak.png',
  'icon-arrow-up': '/icons/icon-arrow-up.png',
  'icon-arrow-down': '/icons/icon-arrow-down.png',
  'icon-check': '/icons/icon-check.png',
  'icon-cross': '/icons/icon-cross.png',
  'icon-gear': '/icons/icon-gear.png',
  'icon-trophy': '/icons/icon-trophy.png',
  'icon-question': '/icons/icon-question.png',
};

/** Sanity guard (used by ArtDebug in Task V3): true if `key` is a UI icon rather than a diorama sprite. */
export function isIconKey(key: SpriteKey): boolean {
  return ICON_KEYS.has(key);
}

/**
 * Composition for one catalog v2 building's art:
 * - `stacked`: a terrain-block "base" sprite topped with a tier-colored roof sprite
 *   (two sprites layered in a container — see Task V3 renderer).
 * - `flat`: one or more ground-level sprites laid directly on the tile, varying by tier
 *   (no roof layer — used for crops/trees/rocks/decor that aren't wall+roof buildings).
 */
export type BuildingArt =
  | {
      kind: 'stacked';
      base: SpriteKey;
      /** The roof silhouette shape (one of the six); a painted roof keeps this
       * shape but swaps the colour. */
      shape: RoofShape;
      roofByTier: Record<Tier, SpriteKey>;
    }
  | { kind: 'flat'; byTier: Record<Tier, SpriteKey[]> };

// ── House style pool (H1 deliverable 1) ──────────────────────────────────────
//
// Every player's House renders a DETERMINISTIC style from a hash of the owner's
// id, so a map full of houses reads as a real village of individual homes rather
// than one cloned cottage. The pool is CURATED: each combo is a modest wall +
// pitched roof that reads "home", and none reuses a special building's reserved
// grammar (windmill's round stone tower + point roof; bakery's round roof +
// awning; manor's stack-beige + church roof). So a house can never be mistaken
// for a producer, and vice-versa.
//
// Tier progression is shown by the per-tier ACCENTS (dormer at t2, gold eave
// trim at t3 — see accents.ts), not by the roof colour, so a levelled home still
// reads as grander while keeping its owner's signature style. A painted roof
// (tile.roofColor) overrides the pool's roof hue but keeps the pool's SHAPE; the
// golden-roof cosmetic still overrides everything.

export type HouseStyle = { base: SpriteKey; shape: RoofShape; roof: RoofColor };

/** Twelve curated modest-home combos over {door, door-windows, window, windows}
 * × {red plaster, beige} walls × {gable, slant, rounded} roofs × roof colour.
 * Deliberately excludes round/point/church roofs and the stack walls (all
 * reserved to special buildings). */
export const HOUSE_STYLES: readonly HouseStyle[] = [
  { base: 'building-door', shape: 'gable', roof: 'brown' },
  { base: 'building-door-beige', shape: 'gable', roof: 'green' },
  { base: 'building-window', shape: 'slant', roof: 'brown' },
  { base: 'building-window-beige', shape: 'rounded', roof: 'beige' },
  { base: 'building-windows', shape: 'gable', roof: 'purple' },
  { base: 'building-windows-beige', shape: 'slant', roof: 'green' },
  { base: 'building-door-windows', shape: 'rounded', roof: 'brown' },
  { base: 'building-door-windows-beige', shape: 'gable', roof: 'beige' },
  { base: 'building-door', shape: 'slant', roof: 'green' },
  { base: 'building-window', shape: 'gable', roof: 'beige' },
  { base: 'building-windows-beige', shape: 'rounded', roof: 'purple' },
  { base: 'building-door-beige', shape: 'slant', roof: 'brown' },
];

/** FNV-1a hash of a string → uint32 (same family as catalog.defaultOutfit). */
const hashStr = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/** The deterministic house style for a plot owner — stable per owner id, so a
 * player's homes always look the same and neighbours' homes visibly differ. */
export const houseStyle = (ownerId: string): HouseStyle =>
  HOUSE_STYLES[hashStr(ownerId) % HOUSE_STYLES.length] ?? HOUSE_STYLES[0]!;

/** The colored crest tower flown as the village standard, indexed by the city's
 * crestColor (0..3 → Sand/Rustic/Forest/Royal). Pack art — no drawn pennant. */
export const CREST_TOWER: readonly SpriteKey[] = [
  'crest-tower-beige',
  'crest-tower-brown',
  'crest-tower-green',
  'crest-tower-purple',
];

/** The six roof silhouette shapes shared across stacked buildings. */
export type RoofShape =
  | 'gable'
  | 'point'
  | 'round'
  | 'rounded'
  | 'slant'
  | 'church';

/** Every roof sprite keyed by shape then colour — the full 6×4 grid. Used by
 * `roofKeyFor` to swap a painted roof's colour while keeping its shape. */
export const ROOF_SHAPE: Record<RoofShape, Record<RoofColor, SpriteKey>> = {
  gable: {
    brown: 'roof-gable-brown',
    green: 'roof-gable-green',
    purple: 'roof-gable-purple',
    beige: 'roof-gable-beige',
  },
  point: {
    brown: 'roof-point-brown',
    green: 'roof-point-green',
    purple: 'roof-point-purple',
    beige: 'roof-point-beige',
  },
  round: {
    brown: 'roof-round-brown',
    green: 'roof-round-green',
    purple: 'roof-round-purple',
    beige: 'roof-round-beige',
  },
  rounded: {
    brown: 'roof-rounded-brown',
    green: 'roof-rounded-green',
    purple: 'roof-rounded-purple',
    beige: 'roof-rounded-beige',
  },
  slant: {
    brown: 'roof-slant-brown',
    green: 'roof-slant-green',
    purple: 'roof-slant-purple',
    beige: 'roof-slant-beige',
  },
  church: {
    brown: 'roof-church-brown',
    green: 'roof-church-green',
    purple: 'roof-church-purple',
    beige: 'roof-church-beige',
  },
};

/**
 * The roof sprite for a stacked building: its painted colour at any tier when
 * `roofColor` is set, otherwise the default tier colour progression. Returns
 * null for flat buildings (no roof sprite to paint).
 */
export const roofKeyFor = (
  buildingId: BuildingId,
  tier: Tier,
  roofColor?: RoofColor
): SpriteKey | null => {
  const art = BUILDING_ART[buildingId];
  if (art.kind !== 'stacked') return null;
  if (roofColor) return ROOF_SHAPE[art.shape][roofColor];
  return art.roofByTier[tier];
};

/**
 * Tier color progression used across every stacked building for a consistent read at a
 * glance: tier1 = brown roof, tier2 = green roof, tier3 = purple roof.
 */
export const BUILDING_ART: Record<BuildingId, BuildingArt> = {
  // House: door base + gable roof — the archetypal small homestead silhouette.
  house: {
    kind: 'stacked',
    base: 'building-door',
    shape: 'gable',
    roofByTier: { 1: 'roof-gable-brown', 2: 'roof-gable-green', 3: 'roof-gable-purple' },
  },
  // Windmill = STONE TOWER MILL (H1): a clean round tapering stone tower body
  // (mill-tower-base, NOT a house wall) capped with a point roof and redesigned
  // sails (see accents.ts). The round-stone-tower + point-roof grammar is
  // reserved to the windmill — unmistakable against any house.
  windmill: {
    kind: 'stacked',
    base: 'mill-tower-base',
    shape: 'point',
    roofByTier: { 1: 'roof-point-brown', 2: 'roof-point-green', 3: 'roof-point-purple' },
  },
  // Sawmill = DENSE LUMBER YARD (H2): NO house base — the tall open timber frame
  // (structure-high) is the canopy's visible posts, and the accents pack the tile
  // as a working yard: a slant-roof canopy, a BIG stacked log pile, a saw table
  // with the blade half-buried mid-cut in a log (the storytelling detail), a
  // plank lean-to and a sawdust mound. Tier growth (bigger stacks / a second
  // canopy / a gold saw) lives in accents.ts. A yard, never a cottage.
  sawmill: {
    kind: 'flat',
    byTier: {
      1: ['structure-high'],
      2: ['structure-high'],
      3: ['structure-high'],
    },
  },
  // Mason's Kiln = OVEN DOME (H1): NO house base — a desert oven dome body with a
  // chimney stub + subtle ember (accents.ts). The dome silhouette can't be
  // confused with a walled house.
  kiln: {
    kind: 'flat',
    byTier: {
      1: ['desert-dome-small'],
      2: ['desert-dome-small'],
      3: ['desert-dome-small'],
    },
  },
  // Bakery = SHOP (H1): windows base + ROUND roof + a big striped awning + hanging
  // sign board (accents.ts). The round-roof + awning grammar is reserved to the
  // bakery alone (no house in the style pool uses a round roof).
  bakery: {
    kind: 'stacked',
    base: 'building-windows',
    shape: 'round',
    roofByTier: { 1: 'roof-round-brown', 2: 'roof-round-green', 3: 'roof-round-purple' },
  },
  // Manor: stack-beige base (grandest wall) + church roof (most ornate shape) — prestige tier.
  manor: {
    kind: 'stacked',
    base: 'building-stack-beige',
    shape: 'church',
    roofByTier: { 1: 'roof-church-brown', 2: 'roof-church-green', 3: 'roof-church-purple' },
  },
  // Wheat Field: furrow crop growth-state progression, no base/roof (flat crop tile).
  wheatfield: {
    kind: 'flat',
    byTier: {
      1: ['furrow-crop'],
      2: ['furrow-crop-wheat'],
      3: ['furrow-crop-wheat'],
    },
  },
  // Forester's Grove: tree density/species progression (production building).
  grove: {
    kind: 'flat',
    byTier: {
      1: ['tree-single'],
      2: ['tree-multiple'],
      3: ['tree-pine-large'],
    },
  },
  // Quarry: rock-pile progression, tier3 adds a low structure to suggest a dig site.
  quarry: {
    kind: 'flat',
    byTier: {
      1: ['rocks-dirt'],
      2: ['rocks-grass'],
      3: ['rocks-dirt', 'structure-low'],
    },
  },
  // Old Well: single decor sprite at every tier (decor buildings don't visually upgrade).
  well: {
    kind: 'flat',
    byTier: { 1: ['well'], 2: ['well'], 3: ['well'] },
  },
  // Tree Grove (decor): a distinct tree-species ordering from `grove` above so the two
  // tree-based buildings still read as different pieces when placed near each other.
  trees: {
    kind: 'flat',
    byTier: {
      1: ['tree-multiple'],
      2: ['tree-pine'],
      3: ['tree-pine-large'],
    },
  },
  // Stone Fountain: single decor sprite at every tier (no fountain sprite in-pack; the
  // stone archway is the closest ornamental "plaza monument" silhouette available).
  fountain: {
    kind: 'flat',
    byTier: { 1: ['structure-arch'], 2: ['structure-arch'], 3: ['structure-arch'] },
  },
};
