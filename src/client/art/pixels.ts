import type { Scene } from 'phaser';
import { TRANSPARENT, validateGrid } from '../../shared/pixelgrid';
import type { Legend, PixelGrid } from '../../shared/pixelgrid';

export type { Legend, PixelGrid } from '../../shared/pixelgrid';

/** Default nearest-neighbour upscale factor for logical pixels. */
export const SCALE = 3;

/**
 * Turn a declarative {@link PixelGrid} into a Phaser canvas texture.
 *
 * Each logical pixel becomes a `scale × scale` filled rectangle, drawn with
 * image smoothing disabled so the art stays crisp. If a texture with `key`
 * already exists it is left untouched (idempotent registration).
 */
export function drawPixelTexture(
  scene: Scene,
  key: string,
  rows: PixelGrid,
  legend: Legend,
  scale: number = SCALE
): void {
  if (scene.textures.exists(key)) return;

  const { w, h } = validateGrid(rows, legend);

  const tex = scene.textures.createCanvas(key, w * scale, h * scale);
  if (!tex) return;

  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, w * scale, h * scale);

  for (let y = 0; y < h; y++) {
    const row = rows[y] ?? '';
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      if (ch === undefined || ch === TRANSPARENT) continue;
      const hex = legend[ch];
      if (hex === undefined) continue;
      ctx.fillStyle = hex;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }

  tex.refresh();
}

/**
 * A tiny mutable character canvas used to *compose* pixel art declaratively.
 *
 * Building a village of individually-crafted sprites by hand-typing 24×32 grids
 * is error-prone, so the art files stamp rectangles, lines and roofs onto a
 * {@link Painter} and read the finished {@link PixelGrid} out with {@link rows}.
 * The colour semantics still live in each sprite's chosen characters, so every
 * building keeps its own silhouette and details.
 */
export class Painter {
  private readonly cells: string[];

  constructor(
    public readonly w: number,
    public readonly h: number,
    fill: string = TRANSPARENT
  ) {
    this.cells = new Array<string>(w * h).fill(fill);
  }

  private inside(x: number, y: number): boolean {
    return x >= 0 && x < this.w && y >= 0 && y < this.h;
  }

  get(x: number, y: number): string {
    if (!this.inside(x, y)) return TRANSPARENT;
    return this.cells[y * this.w + x] ?? TRANSPARENT;
  }

  /** Paint a single pixel (silently ignores out-of-bounds). */
  set(x: number, y: number, ch: string): this {
    if (this.inside(x, y)) this.cells[y * this.w + x] = ch;
    return this;
  }

  /** Filled rectangle from (x,y) spanning w×h. */
  rect(x: number, y: number, w: number, h: number, ch: string): this {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) this.set(x + i, y + j, ch);
    }
    return this;
  }

  /** 1px-tall horizontal run of length `len`. */
  hline(x: number, y: number, len: number, ch: string): this {
    for (let i = 0; i < len; i++) this.set(x + i, y, ch);
    return this;
  }

  /** 1px-wide vertical run of length `len`. */
  vline(x: number, y: number, len: number, ch: string): this {
    for (let j = 0; j < len; j++) this.set(x, y + j, ch);
    return this;
  }

  /**
   * A centred, symmetric gable/pitched roof.
   *
   * Rows widen linearly from `halfTop` at `yTop` to `halfBase` at `yBase`; the
   * right half is painted with `dark` so light reads as coming from top-left.
   */
  gable(
    cx: number,
    yTop: number,
    yBase: number,
    halfTop: number,
    halfBase: number,
    main: string,
    dark: string
  ): this {
    const span = Math.max(1, yBase - yTop);
    for (let j = 0; j <= span; j++) {
      const t = j / span;
      const half = Math.round(halfTop + (halfBase - halfTop) * t);
      for (let x = cx - half; x <= cx + half; x++) {
        this.set(x, yTop + j, x > cx ? dark : main);
      }
    }
    return this;
  }

  /**
   * Trace a 1px `ink` outline around every opaque region (4-neighbour).
   *
   * This is the cohesion trick: give every silhouette the same crisp outline.
   * Leave a 1px transparent margin around art so the outline has room.
   */
  outline(ink: string): this {
    const snapshot = this.cells.slice();
    const opaque = (i: number, j: number): boolean => {
      if (!this.inside(i, j)) return false;
      const c = snapshot[j * this.w + i] ?? TRANSPARENT;
      return c !== TRANSPARENT && c !== ink;
    };
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const here = snapshot[y * this.w + x] ?? TRANSPARENT;
        if (here !== TRANSPARENT) continue;
        if (
          opaque(x - 1, y) ||
          opaque(x + 1, y) ||
          opaque(x, y - 1) ||
          opaque(x, y + 1)
        ) {
          this.set(x, y, ink);
        }
      }
    }
    return this;
  }

  /** Read out the finished grid as a {@link PixelGrid}. */
  rows(): PixelGrid {
    const out: string[] = [];
    for (let y = 0; y < this.h; y++) {
      let line = '';
      for (let x = 0; x < this.w; x++) line += this.cells[y * this.w + x] ?? TRANSPARENT;
      out.push(line);
    }
    return out;
  }
}
