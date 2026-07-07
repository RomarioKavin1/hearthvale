import { GRID_SIZE } from '../catalog';

export const tileKey = (x: number, y: number): string => `${x},${y}`;

export const parseKey = (key: string): { x: number; y: number } => {
  const [xs, ys] = key.split(',');
  return { x: Number(xs), y: Number(ys) };
};

const inBounds = (x: number, y: number): boolean =>
  x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE;

export const isPlaza = (x: number, y: number): boolean =>
  x >= 7 && x <= 10 && y >= 7 && y <= 10;

export const isClaimable = (x: number, y: number): boolean =>
  inBounds(x, y) && !isPlaza(x, y);

export const neighbors = (
  x: number,
  y: number
): Array<{ x: number; y: number }> => {
  const candidates = [
    { x: x - 1, y },
    { x: x + 1, y },
    { x, y: y - 1 },
    { x, y: y + 1 },
  ];
  return candidates.filter((c) => inBounds(c.x, c.y));
};

export const isoToScreen = (
  x: number,
  y: number,
  tileW: number,
  tileH: number
): { sx: number; sy: number } => ({
  sx: ((x - y) * tileW) / 2,
  sy: ((x + y) * tileH) / 2,
});
