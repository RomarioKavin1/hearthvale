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
