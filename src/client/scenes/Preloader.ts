import { Scene } from 'phaser';
import { PAL } from '../../shared/palette';
import { SPRITES } from '../art/manifest';
import type { SpriteKey } from '../art/manifest';

const BG = '#322a3d';
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
    this.add
      .text(cx, cy - 26, 'Hearthvale', {
        fontFamily: 'Georgia, serif',
        fontSize: '22px',
        color: PAL.cream,
      })
      .setOrigin(0.5);

    const frame = this.add
      .rectangle(cx, cy + 12, BAR_W + 4, BAR_H + 4, 0x000000, 0.35)
      .setOrigin(0.5);
    const bar = this.add
      .rectangle(cx - BAR_W / 2, cy + 12, 1, BAR_H, 0xffd98a)
      .setOrigin(0, 0.5);
    void frame;

    this.load.on('progress', (p: number) => {
      bar.width = Math.max(1, BAR_W * p);
    });

    for (const key of Object.keys(SPRITES) as SpriteKey[]) {
      this.load.image(key, SPRITES[key]);
    }
  }

  create(): void {
    this.scene.start('Village');
  }
}
