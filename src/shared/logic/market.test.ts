import { describe, expect, it } from 'vitest';
import { buyValue, priceFor, pricesFor, sellValue } from './market';
import { emptyStockpile } from './economy';

describe('priceFor', () => {
  it('clamps the multiplier to 1.8 when the stockpile is empty', () => {
    // 1.9 - 0/120 = 1.9 -> clamped to 1.8; wheat base 3 -> 3 * 1.8 = 5.4 -> 5.
    expect(priceFor(0, 'wheat')).toBe(5);
    // planks base 12 -> 12 * 1.8 = 21.6 -> 22.
    expect(priceFor(0, 'planks')).toBe(22);
    // bricks base 15 -> 15 * 1.8 = 27.
    expect(priceFor(0, 'bricks')).toBe(27);
  });

  it('prices at 0.9x the base when stock sits exactly on target', () => {
    // wheat target 120: 1.9 - 1 = 0.9; 3 * 0.9 = 2.7 -> 3.
    expect(priceFor(120, 'wheat')).toBe(3);
    // planks target 60: 12 * 0.9 = 10.8 -> 11.
    expect(priceFor(60, 'planks')).toBe(11);
    // bricks target 60: 15 * 0.9 = 13.4999… (IEEE754) -> rounds to 13.
    expect(priceFor(60, 'bricks')).toBe(13);
  });

  it('clamps the multiplier to 0.6 at twice the target stock', () => {
    // 1.9 - 2 = -0.1 -> clamped to 0.6; wheat 3 * 0.6 = 1.8 -> 2.
    expect(priceFor(240, 'wheat')).toBe(2);
    // planks 12 * 0.6 = 7.2 -> 7.
    expect(priceFor(120, 'planks')).toBe(7);
  });

  it('interpolates between the clamps at partial stock', () => {
    // planks stock 30 of target 60: 1.9 - 0.5 = 1.4; 12 * 1.4 = 16.8 -> 17.
    expect(priceFor(30, 'planks')).toBe(17);
  });
});

describe('sellValue (marginal per-unit pricing)', () => {
  it('sums flat unit prices when the price plateau does not move', () => {
    // wheat stocks 0..9 all sit on the 1.8x clamp -> 10 units x 5 = 50.
    expect(sellValue(10, 0, 'wheat')).toBe(50);
  });

  it('prices each unit at the marginal stock as the market floods', () => {
    // bricks: priceFor(8) = round(15x1.7667) = round(26.5) = 27,
    // priceFor(9) = round(26.25) = 26, priceFor(10) = round(26.0) = 26.
    expect(sellValue(3, 8, 'bricks')).toBe(27 + 26 + 26);
  });

  it('hand-computed: 3 wheat from stock 118', () => {
    // priceFor(118) = round(2.75) = 3, priceFor(119) = round(2.725) = 3,
    // priceFor(120) = round(2.7) = 3 -> total 9.
    expect(sellValue(3, 118, 'wheat')).toBe(9);
  });
});

describe('buyValue (marginal per-unit pricing, 1.25x markup)', () => {
  it('prices each unit at the post-removal stock as the market drains', () => {
    // bricks from stock 10: unit 1 at stock 9 -> ceil(26 x 1.25) = 33,
    // unit 2 at stock 8 -> ceil(27 x 1.25) = 34 -> total 67.
    expect(buyValue(2, 10, 'bricks')).toBe(33 + 34);
  });

  it('sums flat unit prices on a plateau', () => {
    // planks from stock 60: units at stocks 59 and 58 both price 11;
    // ceil(13.75) = 14 each -> 28.
    expect(buyValue(2, 60, 'planks')).toBe(28);
  });
});

describe('sell->buyback arbitrage regression', () => {
  it('a full round trip (sell N then buy the same N back) never mints coins', () => {
    const goods = ['wheat', 'logs', 'stone', 'flour', 'planks', 'bricks'] as const;
    const stocks = [0, 8, 30, 60, 118, 120, 240];
    const qtys = [1, 3, 7, 50, 120];
    for (const good of goods) {
      for (const stock of stocks) {
        for (const qty of qtys) {
          const earned = sellValue(qty, stock, good);
          const paidBack = buyValue(qty, stock + qty, good);
          // Buying back sweeps the SAME marginal stock levels the sale did,
          // each with a >=1.25x ceil markup -> net must be <= 0.
          expect(earned - paidBack, `${good} stock ${stock} qty ${qty}`).toBeLessThanOrEqual(0);
        }
      }
    }
  });
});

describe('pricesFor', () => {
  it('maps every good to its current price', () => {
    const prices = pricesFor(emptyStockpile());
    expect(prices.wheat).toBe(5);
    expect(prices.planks).toBe(22);
    expect(prices.bricks).toBe(27);
  });
});
