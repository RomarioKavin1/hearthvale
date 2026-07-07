import type {
  BuildingCategory,
  Gained,
  PlayerState,
  TileState,
} from '../types';
import { CATALOG, MAX_LEVEL, PLOT_LEVELS, tierStats } from '../catalog';
import { isClaimable, isPlaza, neighbors, tileKey } from './grid';

export const xpFor = (level: number): number => 75 * level * (level - 1);

export const levelForXp = (xp: number): number => {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpFor(level + 1)) {
    level += 1;
  }
  return level;
};

export const plotsForLevel = (level: number): number =>
  PLOT_LEVELS.filter((l) => l <= level).length;

export const streakReward = (streak: number): number =>
  25 * Math.min(streak, 7);

const noGain = (): Gained => ({ coins: 0, supplies: 0, xp: 0 });

export const accrue = (
  tile: TileState,
  now: number,
  festival: BuildingCategory,
  adjacentDecorBonus: number
): Gained => {
  if (!tile.buildingId) return noGain();
  const spec = CATALOG[tile.buildingId];
  if (spec.category === 'decor') return noGain();
  if (now < tile.readyAt) return noGain();

  const stats = tierStats(spec, tile.tier);
  const start = Math.max(tile.lastCollect, tile.readyAt);
  const elapsed = Math.max(0, now - start);
  if (elapsed <= 0) return noGain();

  // Portion of elapsed time inside the boost window counts double.
  const boostedMs = Math.max(
    0,
    Math.min(now, tile.boostUntil) - Math.min(start, tile.boostUntil)
  );
  const normalMs = elapsed - boostedMs;
  const effectiveMs = boostedMs * 2 + normalMs;

  let amount = (stats.ratePerMin * effectiveMs) / 60000;
  if (festival === spec.category) amount *= 1.5;
  amount *= 1 + adjacentDecorBonus;
  amount = Math.min(Math.floor(amount), stats.cap);
  if (amount <= 0) return noGain();

  if (spec.category === 'coins') {
    return { coins: amount, supplies: 0, xp: Math.ceil(amount / 10) };
  }
  return { coins: 0, supplies: amount, xp: amount };
};

export const adjacencyBonus = (
  grid: Record<string, TileState>,
  x: number,
  y: number,
  festival: BuildingCategory,
  now: number
): number => {
  let sum = 0;
  for (const n of neighbors(x, y)) {
    const t = grid[tileKey(n.x, n.y)];
    if (!t?.buildingId) continue;
    if (CATALOG[t.buildingId].category !== 'decor') continue;
    if (t.readyAt > now) continue;
    sum += 0.1 * t.tier;
  }
  sum = Math.min(sum, 0.6);
  if (festival === 'decor') sum *= 2;
  return sum;
};

export const canClaim = (
  grid: Record<string, TileState>,
  x: number,
  y: number,
  player: PlayerState,
  owned: number
): string | null => {
  if (isPlaza(x, y)) return 'That tile is part of the village plaza.';
  if (!isClaimable(x, y)) return 'That tile is outside the village.';
  if (grid[tileKey(x, y)]) return 'That tile is already claimed.';
  if (owned >= plotsForLevel(player.level)) {
    return 'You have reached your plot limit. Level up to claim more.';
  }
  return null;
};
