import { describe, expect, it } from 'vitest';
import { validateGrid } from './pixelgrid';
import type { Legend, PixelGrid } from './pixelgrid';

const legend: Legend = { W: '#ffffff', R: '#ff0000' };

describe('validateGrid', () => {
  it('accepts a valid rectangular grid and returns its dimensions', () => {
    const rows: PixelGrid = ['WWRR', 'R..W', '.WW.'];
    expect(validateGrid(rows, legend)).toEqual({ w: 4, h: 3 });
  });

  it("always allows '.' even when absent from the legend", () => {
    const rows: PixelGrid = ['W.', '.R'];
    expect(validateGrid(rows, legend)).toEqual({ w: 2, h: 2 });
  });

  it('rejects ragged rows of differing widths', () => {
    const rows: PixelGrid = ['WWRR', 'RW'];
    expect(() => validateGrid(rows, legend)).toThrow(/ragged|width/i);
  });

  it('rejects a character missing from the legend', () => {
    const rows: PixelGrid = ['WWQW'];
    expect(() => validateGrid(rows, legend)).toThrow(/legend|unknown|Q/i);
  });

  it('rejects an empty grid', () => {
    expect(() => validateGrid([], legend)).toThrow();
  });

  it('rejects a grid with zero-width rows', () => {
    expect(() => validateGrid(['', ''], legend)).toThrow();
  });
});
