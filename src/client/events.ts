import type { TileState } from '../shared/types';

/**
 * DOM CustomEvent payloads exchanged between the Phaser village scene and the
 * DOM HUD layer (Task 6). Declared here so both sides share one typed contract
 * and `new CustomEvent<T>(name, { detail })` stays type-checked with no casts.
 */

/** Fired by the scene when the player taps a tile. */
export type HvTileSelected = {
  key: string;
  x: number;
  y: number;
  tile: TileState | null;
  mine: boolean;
  claimable: boolean;
};

/** Fired by the HUD to ask the scene to pan the camera onto a tile. */
export type HvFocusTile = {
  x: number;
  y: number;
};

export const HV_TILE_SELECTED = 'hv:tileSelected';
export const HV_CLEAR_SELECTION = 'hv:clearSelection';
export const HV_FOCUS_TILE = 'hv:focusTile';

/**
 * A viewport-space pixel position (relative to the top-left of the window),
 * used by the walkthrough to point a coach mark at a scene tile.
 */
export type ScreenPoint = { x: number; y: number };

/**
 * Scene→DOM bridge for the walkthrough. The Village scene registers a provider
 * that maps a tile's grid (x,y) to its on-screen pixel centre — accounting for
 * camera scroll, zoom and the canvas's page offset — so the coach-mark overlay
 * can track the map as it pans. Null before the scene mounts (or when the tile
 * would fall outside the canvas). Kept here so both sides share one contract
 * without the DOM layer importing Phaser.
 */
type TileToScreen = (x: number, y: number) => ScreenPoint | null;

let tileToScreenProvider: TileToScreen | null = null;

/** The scene calls this once its camera is ready (and null on shutdown). */
export const setTileToScreen = (fn: TileToScreen | null): void => {
  tileToScreenProvider = fn;
};

/** Resolve a tile's screen point, or null when no scene is registered. */
export const tileToScreen = (x: number, y: number): ScreenPoint | null =>
  tileToScreenProvider ? tileToScreenProvider(x, y) : null;

/**
 * Scene→DOM bridge for the walkthrough's candidate-tile highlights. The Village
 * scene registers a provider that draws pulsing top-face diamonds over the given
 * tile keys (`"x,y"`), or clears them when passed null. Kept here so the DOM
 * walkthrough can point at "any of these open tiles — your choice" without
 * importing Phaser.
 */
type HighlightTiles = (keys: string[] | null) => void;

let highlightTilesProvider: HighlightTiles | null = null;
/** The most recent request, kept so a scene that registers AFTER the walkthrough
 * asked for highlights (the scene builds its world well after the HUD mounts)
 * still draws them — the registration replays the pending keys. */
let pendingHighlightKeys: string[] | null = null;

/** The scene calls this once its world is built (and null on shutdown). */
export const setHighlightTiles = (fn: HighlightTiles | null): void => {
  highlightTilesProvider = fn;
  if (fn && pendingHighlightKeys !== null) fn(pendingHighlightKeys);
};

/** Ask the scene to highlight (or clear, with null) a set of candidate tiles. */
export const highlightTiles = (keys: string[] | null): void => {
  pendingHighlightKeys = keys;
  highlightTilesProvider?.(keys);
};

/**
 * Scene→HUD bridge for the collapsible top-left objectives column. The HUD owns
 * the column and registers a collapse callback here; the Village scene calls
 * `requestCollapseObjectives()` from its canvas `pointerdown` handler (a genuine
 * map drag/tap), so the column collapses ONLY on a real canvas press — never via
 * a window-level listener that could race a chip/banner/pill click. Idle-timeout
 * collapse is handled entirely inside the HUD.
 */
type CollapseFn = () => void;

let collapseObjectivesFn: CollapseFn | null = null;

/** The HUD registers its collapse handler once (null on teardown). */
export const setCollapseObjectives = (fn: CollapseFn | null): void => {
  collapseObjectivesFn = fn;
};

/** The scene calls this on a canvas pointerdown to collapse the objectives column. */
export const requestCollapseObjectives = (): void => {
  collapseObjectivesFn?.();
};
