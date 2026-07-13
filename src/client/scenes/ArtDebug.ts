import { Input, Scene } from 'phaser';
import { PAL } from '../../shared/palette';
import type { BuildingId, Tier } from '../../shared/types';
import { BUILDING_ART, SPRITES } from '../art/manifest';
import type { SpriteKey } from '../art/manifest';
import {
  addBlock,
  addSurface,
  bandBlockFor,
  BASE_DY,
  BG,
  castleParts,
  CASTLE_TOP_DY,
  LOCKED_ALPHA,
  LOCKED_TINT,
  MONUMENT_ART,
  ROOF_DY,
  terrainFor,
  themedKey,
  TILE_H,
  TILE_W,
} from '../art/render';
import type { TerrainFamily } from '../art/render';
import { MONUMENT_TEMPLATES, TEMPLATE_BY_ID } from '../../shared/logic/monuments';
import type { MonumentId } from '../../shared/logic/monuments';

const IDS: BuildingId[] = [
  'house',
  'wheatfield',
  'grove',
  'quarry',
  'windmill',
  'sawmill',
  'kiln',
  'bakery',
  'well',
  'trees',
  'fountain',
  'manor',
];

const TIERS: Tier[] = [1, 2, 3];

/**
 * Developer-only verification surface (`?artdebug`): loads the Kenney atlas and
 * lays out terrain samples, path/river routing pieces, every BUILDING_ART
 * composition at each tier (stacked base+roof / flat decor), the Grand Keep stages,
 * and the locked-tile treatment — the tuning surface for the anchor constants in
 * art/render.ts and the reviewer's visual evidence.
 */
export class ArtDebug extends Scene {
  constructor() {
    super('ArtDebug');
  }

  preload(): void {
    this.cameras.main.setBackgroundColor(BG);
    for (const key of Object.keys(SPRITES) as SpriteKey[]) {
      this.load.image(key, SPRITES[key]);
    }
  }

  private label(x: number, y: number, text: string, size = 12): void {
    this.add.text(x, y, text, {
      fontFamily: 'monospace',
      fontSize: `${size}px`,
      color: PAL.cream,
    });
  }

  /** A faint grass tile under a cell so compositions read against ground. */
  private ground(cx: number, cy: number): void {
    addBlock(this, 'grass-center', cx, cy).setDepth(cy);
  }

  private composeBuilding(id: BuildingId, tier: Tier, cx: number, cy: number): void {
    this.ground(cx, cy);
    const art = BUILDING_ART[id];
    if (art.kind === 'stacked') {
      addBlock(this, art.base, cx, cy, BASE_DY).setDepth(cy + 1);
      addBlock(this, art.roofByTier[tier], cx, cy, BASE_DY + ROOF_DY).setDepth(cy + 2);
    } else {
      let d = cy + 1;
      for (const k of art.byTier[tier]) {
        const img = addSurface(this, k, cx, cy);
        img.setDepth(d);
        d += 0.1;
      }
    }
  }

  private tile(key: SpriteKey, cx: number, cy: number, flipX = false): void {
    addBlock(this, key, cx, cy).setDepth(cy).setFlipX(flipX);
  }

  /** Render one seeded monument's composition (a biome family) on its footprint's
   * ground tiles, centred at (ox, oy) — the reviewer's silhouette check. */
  private monument(id: MonumentId, family: TerrainFamily, ox: number, oy: number): void {
    const groundKey = themedKey(family, 'grass-center');
    for (const [dx, dy] of TEMPLATE_BY_ID[id].footprint) {
      const px = ox + (dx - dy) * TILE_H;
      const py = oy + (dx + dy) * (TILE_H / 2);
      addBlock(this, groundKey, px, py).setDepth(py);
    }
    for (const piece of MONUMENT_ART[id][family]) {
      const px = ox + (piece.dx - piece.dy) * TILE_H;
      const py = oy + (piece.dx + piece.dy) * (TILE_H / 2);
      const dy = piece.layer === 'cap' ? BASE_DY + ROOF_DY : BASE_DY;
      const boost = piece.layer === 'cap' ? 2 : piece.layer === 'base' ? 1 : 0.5;
      const img = addBlock(this, piece.key, px, py, dy)
        .setFlipX(piece.flipX ?? false)
        .setDepth(py + boost);
      if (piece.angle !== undefined) img.setAngle(piece.angle);
      if (piece.tint !== undefined) img.setTint(piece.tint);
    }
  }

  create(): void {
    const COL = 128;
    // Compositions are now a full block-step taller (BASE_DY lift), so rows
    // need extra breathing room to avoid overlap.
    const ROW = 200;
    let y = 40;

    this.label(16, y - 24, 'HEARTHVALE ART DEBUG — Sketch Town diorama renderer', 15);

    // Terrain + routing samples.
    this.label(16, y - 4, 'terrain / routing', 12);
    const terrain: Array<[string, SpriteKey, boolean]> = [
      ['grass', 'grass-center', false],
      ['dirt', 'dirt-center', false],
      ['locked', 'grass-center', false],
      ['path', 'grass-path', false],
      ['path/flip', 'grass-path', true],
      ['cross', 'grass-path-crossing', false],
      ['river', 'grass-river', true],
      ['riverBend', 'grass-river-bend', false],
      ['riverEnd', 'grass-river-end', false],
    ];
    terrain.forEach(([name, key, flip], i) => {
      const cx = 90 + i * COL;
      if (name === 'locked') {
        addBlock(this, key, cx, y + 60)
          .setDepth(y)
          .setAlpha(LOCKED_ALPHA)
          .setTint(LOCKED_TINT);
      } else {
        this.tile(key, cx, y + 60, flip);
      }
      this.label(cx - 40, y + 96, name, 10);
    });
    y += ROW + 10;

    // Grand Keep stages 0..5 first — the primary tuning surface for the growing
    // Village Hall (T1) — composed on the 2×2 footprint, offset per cell.
    this.label(16, y + 20, 'keep stages 0..5', 12);
    for (let stage = 0; stage <= 5; stage++) {
      const ox = 140 + stage * (2 * COL + 20);
      const oy = y + 110;
      // Four dirt tiles as the plaza footprint.
      for (const t of [
        { dx: 0, dy: -TILE_H / 2 },
        { dx: -TILE_H, dy: 0 },
        { dx: TILE_H, dy: 0 },
        { dx: 0, dy: TILE_H / 2 },
      ]) {
        addBlock(this, 'dirt-center', ox + t.dx, oy + t.dy).setDepth(oy + t.dy);
      }
      for (const part of castleParts(stage)) {
        // Map keep tile (8..9) to a local offset around (ox,oy).
        const lx = (part.x - 8) - (part.y - 8);
        const ly = (part.x - 8) + (part.y - 8);
        const px = ox + lx * TILE_H;
        const py = oy + ly * (TILE_H / 2);
        const dy = (part.roof ? BASE_DY + CASTLE_TOP_DY : BASE_DY) - part.lift;
        let depthOffset = part.roof ? 2 : 1;
        if (part.lift > 0) depthOffset += 3;
        const img = addBlock(this, part.key, px, py, dy).setDepth(py + depthOffset);
        if (part.tint !== undefined) img.setTint(part.tint);
      }
      this.label(ox - 6, y + 190, `${stage}`, 11);
    }
    y += ROW + 90;

    // Buildings — one row per id, three tiers.
    for (const id of IDS) {
      this.label(16, y + 40, id, 12);
      TIERS.forEach((tier, i) => {
        const cx = 150 + i * COL;
        this.composeBuilding(id, tier, cx, y + 60);
        this.label(cx - 8, y + 100, `t${tier}`, 10);
      });
      y += ROW;
    }

    // Wheatfield growth states + construction scaffold + golden roof.
    this.label(16, y + 40, 'states', 12);
    this.ground(150, y + 60);
    addSurface(this, 'furrow-crop', 150, y + 60).setDepth(y + 61);
    this.label(120, y + 100, 'growing', 10);
    this.ground(150 + COL, y + 60);
    addSurface(this, 'furrow-crop-wheat', 150 + COL, y + 60).setDepth(y + 61);
    this.label(120 + COL, y + 100, 'ripe', 10);
    this.ground(150 + 2 * COL, y + 60);
    addBlock(this, 'structure-low', 150 + 2 * COL, y + 60, BASE_DY).setDepth(y + 61);
    this.label(120 + 2 * COL, y + 100, 'building', 10);
    // Golden-roof cottage.
    const gx = 150 + 3 * COL;
    this.ground(gx, y + 60);
    addBlock(this, 'building-door', gx, y + 60, BASE_DY).setDepth(y + 61);
    addBlock(this, 'roof-gable-brown', gx, y + 60, BASE_DY + ROOF_DY)
      .setDepth(y + 62)
      .setTint(0xffd700);
    this.label(gx - 30, y + 100, 'golden-roof', 10);
    y += ROW + 45;

    // Seeded terrain: a raised locked-band strip for two different village seeds.
    this.label(16, y + 20 + 190, 'seeded band (two seeds)', 12);
    [1111, 9999].forEach((seed, si) => {
      const ox = 240 + si * 360;
      const oy = y + 90 + 190;
      for (let gx = 0; gx < 6; gx++) {
        const sx = ox + gx * (TILE_W / 2);
        const sy = oy + gx * (TILE_H / 2) * 0;
        const { height } = terrainFor(seed, gx, si + 3);
        addBlock(this, bandBlockFor(height), sx, sy, -16 * height)
          .setDepth(sy + gx)
          .setAlpha(LOCKED_ALPHA)
          .setTint(LOCKED_TINT);
      }
      this.label(ox - 20, oy + 70, `seed ${seed}`, 10);
    });
    y += ROW + 220;

    // Desert biome terrain strip (E2) — the sand family the 'desert' theme swaps in.
    this.label(16, y - 4, 'desert biome terrain', 12);
    const desert: Array<[string, SpriteKey, boolean]> = [
      ['sand', 'sand-center', false],
      ['sand-dirt', 'sand-dirt-center', false],
      ['sand-path', 'sand-path', false],
      ['sand-cross', 'sand-path-crossing', false],
      ['sand-river', 'sand-river', true],
      ['des-water', 'desert-water-center', false],
      ['palm', 'palm', false],
      ['palms', 'palms', false],
      ['rocks-sand', 'rocks-sand', false],
    ];
    desert.forEach(([name, key, flip], i) => {
      const cx = 90 + i * COL;
      if (key === 'palm' || key === 'palms' || key === 'rocks-sand') {
        addBlock(this, 'sand-center', cx, y + 60).setDepth(y);
        addSurface(this, key, cx, y + 60).setDepth(y + 1);
      } else {
        this.tile(key, cx, y + 60, flip);
      }
      this.label(cx - 40, y + 96, name, 10);
    });
    y += ROW + 20;

    // Seeded monuments (E2) — each template in both biome families, side by side,
    // so the reviewer can confirm silhouettes read (grass = Sketch Town, sand =
    // Sketch Desert swap).
    this.label(16, y - 4, 'monuments — grass | desert', 12);
    MONUMENT_TEMPLATES.forEach((tpl, i) => {
      const rowY = y + 80 + i * 180;
      this.label(16, rowY - 30, tpl.name, 11);
      this.monument(tpl.id, 'grass', 300, rowY);
      this.monument(tpl.id, 'sand', 620, rowY);
    });
    y += 80 + MONUMENT_TEMPLATES.length * 180 + 40;

    const contentHeight = y + 40;
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
      cam.scrollY = Math.min(
        maxScroll,
        Math.max(0, cam.scrollY - pointer.velocity.y * 0.1)
      );
    });
  }
}
