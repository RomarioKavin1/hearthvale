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
