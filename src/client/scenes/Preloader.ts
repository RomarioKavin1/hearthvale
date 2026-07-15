import { Scene } from 'phaser';
import { PAL } from '../../shared/palette';
import { renderScale } from '../dpr';
import { SPRITES } from '../art/manifest';
import type { SpriteKey } from '../art/manifest';
import { BG } from '../art/render';

/** CSS-feel sizes — multiplied by the HiDPI render scale at draw time (H8). */
const BAR_W = 260;
const BAR_H = 8;

/**
 * Loads every Kenney Sketch Town sprite + UI icon named in the manifest, showing a
 * slim progress bar, then hands off to the Village scene. Assets persist on the
 * game's TextureManager so any scene can reference them by their manifest key.
 */
export class Preloader extends Scene {
  constructor() {
    super('Preloader');
  }

  preload(): void {
    this.cameras.main.setBackgroundColor(BG);

    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    // Game px are device px (H8 HiDPI) — scale the CSS-feel sizes by dpr.
    const dpr = renderScale();
    const barW = BAR_W * dpr;
    const barH = BAR_H * dpr;
    this.add
      .text(cx, cy - 26 * dpr, 'Hearthvale', {
        fontFamily: 'Fredoka, ui-rounded, system-ui, sans-serif',
        fontSize: `${Math.round(22 * dpr)}px`,
        color: PAL.cream,
      })
      .setOrigin(0.5);

    const frame = this.add
      .rectangle(cx, cy + 12 * dpr, barW + 4, barH + 4, 0x000000, 0.35)
      .setOrigin(0.5);
    const bar = this.add
      .rectangle(cx - barW / 2, cy + 12 * dpr, 1, barH, 0xffd98a)
      .setOrigin(0, 0.5);
    void frame;

    this.load.on('progress', (p: number) => {
      bar.width = Math.max(1, barW * p);
    });

    for (const key of Object.keys(SPRITES) as SpriteKey[]) {
      this.load.image(key, SPRITES[key]);
    }
  }

  create(): void {
    this.scene.start('Village');
  }
}
