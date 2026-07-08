import { describe, expect, it } from 'vitest';
import {
  CATALOG,
  HALL_POPULATION,
  MAX_VILLAGE_NAME,
  RING_BY_LEVEL,
  hallPerks,
  houseBonus,
  isValidVillageName,
} from './catalog';

describe('isValidVillageName', () => {
  it('accepts an ordinary name', () => {
    expect(isValidVillageName('Hearthvale')).toBe(true);
  });

  it('accepts the empty string (clears the name → fallback)', () => {
    expect(isValidVillageName('')).toBe(true);
  });

  it('accepts numbers, spaces, apostrophes and hyphens', () => {
    expect(isValidVillageName("King's-Landing 2")).toBe(true);
  });

  it('accepts unicode letters', () => {
    expect(isValidVillageName('Zürich')).toBe(true);
    expect(isValidVillageName('Élan Café')).toBe(true);
    expect(isValidVillageName('東京')).toBe(true);
  });

  it('accepts a name at exactly the length limit', () => {
    expect(isValidVillageName('a'.repeat(MAX_VILLAGE_NAME))).toBe(true);
  });

  it('rejects a name longer than the length limit', () => {
    expect(isValidVillageName('a'.repeat(MAX_VILLAGE_NAME + 1))).toBe(false);
  });

  it('rejects disallowed characters', () => {
    expect(isValidVillageName('<script>')).toBe(false);
    expect(isValidVillageName('bad@name')).toBe(false);
    expect(isValidVillageName('semi;colon')).toBe(false);
  });
});

describe('house building', () => {
  it('is a free homestead anchor: coins role, special house, base cost 60', () => {
    expect(CATALOG.house.role).toBe('coins');
    expect(CATALOG.house.special).toBe('house');
    expect(CATALOG.house.cost).toBe(60);
    expect(CATALOG.house.ratePerMin).toBe(1);
    expect(CATALOG.house.cap).toBe(60);
    expect(CATALOG.house.buildSeconds).toBe(10);
  });

  it('has retired the cottage id', () => {
    expect('cottage' in CATALOG).toBe(false);
  });
});

describe('hallPerks', () => {
  it('grants cumulative perks per Village Hall level', () => {
    expect(hallPerks(0)).toEqual({
      productionPct: 0,
      traderOffers: 3,
      sellCap: 500,
      bonusPlot: 0,
      boostLimit: 5,
    });
    expect(hallPerks(1)).toEqual({
      productionPct: 3,
      traderOffers: 4,
      sellCap: 500,
      bonusPlot: 0,
      boostLimit: 5,
    });
    expect(hallPerks(2).sellCap).toBe(750);
    expect(hallPerks(3).bonusPlot).toBe(1);
    expect(hallPerks(4).boostLimit).toBe(7);
    expect(hallPerks(5).productionPct).toBe(15);
  });

  it('clamps out-of-range levels', () => {
    expect(hallPerks(-2).productionPct).toBe(0);
    expect(hallPerks(99).productionPct).toBe(15);
  });
});

describe('houseBonus', () => {
  it('is +2 percentage points per house tier, floored at 0', () => {
    expect(houseBonus(0)).toBe(0);
    expect(houseBonus(1)).toBe(2);
    expect(houseBonus(2)).toBe(4);
    expect(houseBonus(3)).toBe(6);
    expect(houseBonus(-1)).toBe(0);
  });
});

describe('progression constants', () => {
  it('HALL_POPULATION is the spec ladder', () => {
    expect(HALL_POPULATION).toEqual([2, 4, 8, 14, 22]);
  });

  it('RING_BY_LEVEL opens the spec rings per level', () => {
    expect(RING_BY_LEVEL).toEqual([
      { lo: 5, hi: 11 },
      { lo: 4, hi: 13 },
      { lo: 3, hi: 14 },
      { lo: 1, hi: 16 },
      { lo: 0, hi: 17 },
    ]);
  });
});
