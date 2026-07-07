import { describe, expect, it } from 'vitest';
import {
  isClaimable,
  isoToScreen,
  isPlaza,
  neighbors,
  parseKey,
  tileKey,
} from './grid';

describe('tileKey / parseKey', () => {
  it('formats as "x,y"', () => {
    expect(tileKey(3, 5)).toBe('3,5');
    expect(tileKey(0, 0)).toBe('0,0');
  });

  it('parses back to the original coordinates', () => {
    expect(parseKey('3,5')).toEqual({ x: 3, y: 5 });
    expect(parseKey(tileKey(12, 7))).toEqual({ x: 12, y: 7 });
  });
});

describe('isPlaza', () => {
  it('is true for every cell in the center 4x4 block [7,10]x[7,10]', () => {
    expect(isPlaza(7, 7)).toBe(true);
    expect(isPlaza(10, 10)).toBe(true);
    expect(isPlaza(8, 9)).toBe(true);
    expect(isPlaza(9, 7)).toBe(true);
  });

  it('is false just outside the plaza block', () => {
    expect(isPlaza(6, 7)).toBe(false);
    expect(isPlaza(11, 10)).toBe(false);
    expect(isPlaza(8, 6)).toBe(false);
    expect(isPlaza(8, 11)).toBe(false);
  });
});

describe('isClaimable', () => {
  it('is true for in-bounds, non-plaza cells', () => {
    expect(isClaimable(0, 0)).toBe(true);
    expect(isClaimable(17, 17)).toBe(true);
  });

  it('is false for plaza cells', () => {
    expect(isClaimable(8, 8)).toBe(false);
  });

  it('is false for out-of-bounds cells', () => {
    expect(isClaimable(-1, 0)).toBe(false);
    expect(isClaimable(0, -1)).toBe(false);
    expect(isClaimable(18, 5)).toBe(false);
    expect(isClaimable(5, 18)).toBe(false);
  });
});

describe('neighbors', () => {
  it('returns all 4 orthogonal neighbors when fully in bounds', () => {
    expect(neighbors(5, 5)).toEqual([
      { x: 4, y: 5 },
      { x: 6, y: 5 },
      { x: 5, y: 4 },
      { x: 5, y: 6 },
    ]);
  });

  it('drops neighbors that fall out of bounds at the corner', () => {
    expect(neighbors(0, 0)).toEqual([
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ]);
  });

  it('drops neighbors that fall out of bounds at the far edge', () => {
    expect(neighbors(17, 17)).toEqual([
      { x: 16, y: 17 },
      { x: 17, y: 16 },
    ]);
  });
});

describe('isoToScreen', () => {
  it('projects grid coordinates onto an isometric screen position', () => {
    expect(isoToScreen(2, 3, 64, 32)).toEqual({ sx: -32, sy: 80 });
    expect(isoToScreen(0, 0, 64, 32)).toEqual({ sx: 0, sy: 0 });
    expect(isoToScreen(4, 0, 64, 32)).toEqual({ sx: 128, sy: 64 });
  });
});
