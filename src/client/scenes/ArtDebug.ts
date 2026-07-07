import { Input, Scene } from 'phaser';
import { PAL } from '../../shared/palette';
import { registerBuildings, TIERS } from '../art/buildings';
import { registerLandmark } from '../art/landmark';
import { registerTiles, TILE_H, TILE_W } from '../art/tiles';
import type { BuildingId } from '../../shared/types';

const IDS: BuildingId[] = [
  'cottage',
  'bakery',
  'wheatfield',
  'quarry',
  'sawmill',
  'grove',
  'well',
  'trees',
  'windmill',
  'kiln',
  'manor',
  'fountain',
];

const TILE_KEYS = [
  'tile_grass',
  'tile_grass2',
  'tile_grass3',
  'tile_path',
  'tile_plaza',
  'tile_highlight',
  'tile_claim',
];

/**
 * Developer-only verification surface: registers every runtime texture and
 * lays them all out with labels on a night background so the whole sprite
 * factory can be eyeballed at a glance. Activated via `?artdebug` (see game.ts).
 */
export class ArtDebug extends Scene {
  constructor() {
    super('ArtDebug');
  }

  create(): void {
    registerTiles(this);
    registerBuildings(this);
    registerLandmark(this);

    this.cameras.main.setBackgroundColor(PAL.night);

    const label = (x: number, y: number, text: string, size = 13): void => {
      this.add.text(x, y, text, {
        fontFamily: 'monospace',
        fontSize: `${size}px`,
        color: PAL.cream,
      });
    };

    let y = 16;
    label(16, y, 'HEARTHVALE ART DEBUG — tiles / buildings ×3 tiers / icons / clocktower', 15);
    y += 30;

    // Tiles
    label(16, y, 'tiles', 12);
    y += 14;
    TILE_KEYS.forEach((key, i) => {
      this.add.image(70 + i * (TILE_W + 16), y + TILE_H / 2, key).setOrigin(0.5);
      label(40 + i * (TILE_W + 16), y + TILE_H + 4, key.replace('tile_', ''), 9);
    });
    y += TILE_H + 26;

    // Buildings — one row per id, three tiers + icon
    for (const id of IDS) {
      label(16, y + 6, id, 12);
      TIERS.forEach((tier, i) => {
        this.add.image(150 + i * 96, y + 96, `bld_${id}_${tier}`).setOrigin(0.5, 1);
        label(150 + i * 96 - 8, y + 100, `t${tier}`, 9);
      });
      this.add.image(470, y + 96, `icon_${id}`).setOrigin(0.5, 1);
      label(452, y + 100, 'icon', 9);
      y += 116;
    }

    // Construction + landmark stages
    label(16, y + 6, 'construction', 12);
    this.add.image(150, y + 96, 'bld_construction').setOrigin(0.5, 1);
    label(230, y + 6, 'clocktower stages 0..5', 12);
    for (let s = 0; s < 6; s++) {
      this.add.image(300 + s * 120, y + 96, `landmark_${s}`).setOrigin(0.5, 1);
      label(290 + s * 120, y + 100, `${s}`, 10);
    }
    y += 240;

    const contentHeight = y + 40;

    // Vertical scroll via wheel / drag so the tall layout is fully reachable.
    const maxScroll = Math.max(0, contentHeight - this.scale.height);
    this.input.on(
      'wheel',
      (_p: unknown, _o: unknown, _dx: number, dy: number) => {
        const cam = this.cameras.main;
        cam.scrollY = Math.min(maxScroll, Math.max(0, cam.scrollY + dy * 0.5));
      }
    );
    this.input.on('pointermove', (pointer: Input.Pointer) => {
      if (!pointer.isDown) return;
      const cam = this.cameras.main;
      cam.scrollY = Math.min(maxScroll, Math.max(0, cam.scrollY - pointer.velocity.y * 0.1));
    });
  }
}
