import type {
  FestivalCategory,
  CityState,
  PlayerState,
  StateResponse,
  TileState,
} from '../shared/types';
import { api } from './net';

/**
 * A minimal event-emitter store holding the single shared village snapshot.
 *
 * The scene and the DOM HUD both read `store.data` and subscribe to `'change'`.
 * `refresh()` pulls a fresh snapshot and records the server/client clock skew so
 * `serverNow()` can drive client-side production/countdown maths that agree with
 * the server. Every mutation helper emits `'change'` so subscribers reconcile.
 */

type ChangeListener = () => void;

/** A subset of a mutation response merged back into the snapshot. `key` locates
 * a single `tile` in the grid (mutation responses omit coordinates). */
export type Mutation = {
  key?: string;
  tile?: TileState;
  tiles?: Array<{ key: string; tile: TileState }>;
  me?: PlayerState;
  city?: CityState;
};

const listeners = new Set<ChangeListener>();
let data: StateResponse | null = null;
let clockSkew = 0;

const emit = (): void => {
  for (const cb of listeners) cb();
};

export const store = {
  get data(): StateResponse | null {
    return data;
  },

  get clockSkew(): number {
    return clockSkew;
  },

  /** Server-authoritative "now" in ms, corrected for client clock drift. */
  serverNow(): number {
    return Date.now() + clockSkew;
  },

  async refresh(): Promise<void> {
    const fresh = await api.state();
    data = fresh;
    clockSkew = fresh.now - Date.now();
    emit();
  },

  patchTile(key: string, tile: TileState): void {
    if (!data) return;
    data.grid[key] = tile;
    emit();
  },

  patchCity(city: CityState): void {
    if (!data) return;
    data.city = city;
    emit();
  },

  setFestival(festival: FestivalCategory): void {
    if (!data) return;
    data.city = { ...data.city, festival };
    emit();
  },

  /** Merge a POST mutation response into the snapshot and emit one change. */
  applyMutation(m: Mutation): void {
    if (!data) return;
    if (m.tile && m.key) data.grid[m.key] = m.tile;
    if (m.tiles) {
      for (const { key, tile } of m.tiles) data.grid[key] = tile;
    }
    if (m.me) data.me = m.me;
    if (m.city) data.city = m.city;
    emit();
  },

  on(evt: 'change', cb: ChangeListener): void {
    if (evt === 'change') listeners.add(cb);
  },

  off(evt: 'change', cb: ChangeListener): void {
    if (evt === 'change') listeners.delete(cb);
  },
};
