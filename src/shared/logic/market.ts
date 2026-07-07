import type { Good, Prices, Stockpile } from '../types';
import { MARKET } from '../catalog';
import { GOODS } from './economy';

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(Math.max(v, lo), hi);

/**
 * Current market price of a good given the village stockpile level:
 * `round(base × clamp(1.9 − stock/target, 0.6, 1.8))`. Scarcity (low stock)
 * pushes the price up to 1.8× base; a glut (2× target) drops it to 0.6×.
 */
export const priceFor = (stock: number, good: Good): number => {
  const m = MARKET[good];
  return Math.round(m.base * clamp(1.9 - stock / m.target, 0.6, 1.8));
};

/**
 * Coins earned selling `qty` of a good into the stockpile, priced MARGINALLY:
 * unit i sells at `priceFor(stockBefore + i, good)`, so the price falls as the
 * seller floods the market. Marginal pricing (paired with `buyValue` below)
 * closes the sell-then-buy-back arbitrage a single batch price allowed: a full
 * round trip sweeps the same marginal stock levels in both directions, with the
 * buy side carrying a 1.25x ceil markup, so the net is always <= 0 coins.
 * O(qty) — callers cap qty (the API rejects trades above 500 units).
 */
export const sellValue = (
  qty: number,
  stockBefore: number,
  good: Good
): number => {
  let total = 0;
  for (let i = 0; i < qty; i += 1) {
    total += priceFor(stockBefore + i, good);
  }
  return total;
};

/**
 * Coins it costs to buy `qty` of a good from the stockpile — marginal per-unit
 * pricing with a 25% markup, rounded up per unit: unit i costs
 * `ceil(priceFor(stockBefore − 1 − i, good) × 1.25)`, so the price rises as the
 * buyer drains the market. Requires `stockBefore >= qty` (validated by the
 * server before quoting). See `sellValue` for the no-arbitrage rationale.
 */
export const buyValue = (
  qty: number,
  stockBefore: number,
  good: Good
): number => {
  let total = 0;
  for (let i = 0; i < qty; i += 1) {
    total += Math.ceil(priceFor(stockBefore - 1 - i, good) * 1.25);
  }
  return total;
};

/** The full current price list derived from a stockpile. */
export const pricesFor = (stockpile: Stockpile): Prices => {
  const prices: Prices = {
    wheat: 0,
    logs: 0,
    stone: 0,
    flour: 0,
    planks: 0,
    bricks: 0,
  };
  for (const g of GOODS) prices[g] = priceFor(stockpile[g], g);
  return prices;
};
