import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import { connectRealtime, disconnectRealtime } from '@devvit/web/client';
import type { JsonValue } from '@devvit/web/shared';
import { PAL } from '../../shared/palette';
import { CATALOG, GRID_SIZE, tierStats } from '../../shared/catalog';
import {
  isClaimable,
  isPlaza,
  isoToScreen,
  parseKey,
  tileKey,
} from '../../shared/logic/grid';
import {
  accrue,
  adjacencyBonus,
  emptyStockpile,
  goodsTotal,
} from '../../shared/logic/economy';
import { isRiver, ringBounds } from '../../shared/logic/expansion';
import type {
  BuildingId,
  CityState,
  TileState,
  VillageMessage,
  VillageTheme,
} from '../../shared/types';
import { BUILDING_ART, roofKeyFor } from '../art/manifest';
import type { SpriteKey } from '../art/manifest';
import {
  addBlock,
  addSurface,
  BASE_DY,
  BG,
  castleParts,
  CASTLE_TOP_DY,
  decorSprinkle,
  isKeepPad,
  isPathRing,
  isTreeDecor,
  LOCKED_ALPHA,
  LOCKED_BAND,
  PATH_HI,
  PATH_LO,
  pathPiece,
  plazaFencePieces,
  riverPiece,
  ROOF_DY,
  THEMES,
  TILE_H,
  TILE_W,
  WELL_TILE,
} from '../art/render';
import { store } from '../state';
import { api } from '../net';
import { toast } from '../ui/dom';
import type { HvTileSelected } from '../events';
import {
  HV_CLEAR_SELECTION,
  HV_FOCUS_TILE,
  HV_TILE_SELECTED,
} from '../events';

// ── Small helpers ───────────────────────────────────────────────────────────

/** '#rrggbb' → 0xrrggbb for Phaser's numeric colour parameters. */
const hexNum = (hex: string): number => parseInt(hex.replace('#', ''), 16);

const C_GLOW = hexNum(PAL.glow);
const C_CREAM = hexNum(PAL.cream);
const C_ACCENT = hexNum(PAL.accent);
const C_INK = hexNum(PAL.ink);
const GOLD = 0xffd700;
const CONFETTI = [
  hexNum(PAL.roofRed),
  hexNum(PAL.roofBlue),
  hexNum(PAL.roofStraw),
  hexNum(PAL.leaf),
  hexNum(PAL.glow),
  hexNum(PAL.accent),
];

// Grand Keep centre (avg of the 2×2 [8,9]² footprint) for celebration effects.
const KEEP_CX = 0;
const KEEP_CY = 17 * (TILE_H / 2); // (8.5+8.5)·32 = 544

// ── Runtime-guards for realtime messages (no casts) ─────────────────────────

const isRecord = (
  v: JsonValue | undefined
): v is { [k: string]: JsonValue } =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isTileState = (v: JsonValue | undefined): boolean =>
  isRecord(v) &&
  typeof v.owner === 'string' &&
  typeof v.ownerName === 'string' &&
  typeof v.tier === 'number' &&
  typeof v.builtAt === 'number' &&
  typeof v.readyAt === 'number' &&
  typeof v.lastCollect === 'number' &&
  typeof v.boostUntil === 'number';

const isCityState = (v: JsonValue | undefined): boolean =>
  isRecord(v) &&
  typeof v.foundedAt === 'number' &&
  typeof v.festival === 'string' &&
  typeof v.festivalDate === 'string' &&
  typeof v.hallLevel === 'number' &&
  typeof v.stagePlanks === 'number' &&
  typeof v.stageBricks === 'number' &&
  typeof v.totalCollected === 'number' &&
  typeof v.totalContributed === 'number';

const isBounds = (v: JsonValue | undefined): boolean =>
  isRecord(v) && typeof v.lo === 'number' && typeof v.hi === 'number';

const isVillageMessage = (v: JsonValue): v is VillageMessage => {
  if (!isRecord(v)) return false;
  switch (v.t) {
    case 'tile':
      return typeof v.key === 'string' && isTileState(v.tile);
    case 'city':
      return isCityState(v.city);
    case 'festival':
      return (
        v.festival === 'coins' ||
        v.festival === 'raw' ||
        v.festival === 'processed' ||
        v.festival === 'decor'
      );
    case 'stage':
      return typeof v.stage === 'number';
    case 'market':
      return isRecord(v.prices) && isRecord(v.stockpile);
    case 'ring':
      return isBounds(v.bounds);
    default:
      return false;
  }
};

// ── Per-tile view bookkeeping ───────────────────────────────────────────────

type TileView = {
  /** Every structural sprite for this tile's building/decor, destroyed together. */
  parts: Phaser.GameObjects.Image[];
  /** Primary sprite used for pop animations + wheatfield growth swaps. */
  primary: Phaser.GameObjects.Image | undefined;
  barBg: Phaser.GameObjects.Rectangle | undefined;
  bar: Phaser.GameObjects.Rectangle | undefined;
  claim: Phaser.GameObjects.Image | undefined;
  goldPip: Phaser.GameObjects.Image | undefined;
  finder: Phaser.GameObjects.Rectangle | undefined;
  pip: Phaser.GameObjects.Image | undefined;
  boostPip: Phaser.GameObjects.Image | undefined;
  growthKey: SpriteKey | undefined;
  /** Ambient (C2): chimney-smoke timer + "alive" work-pulse tween, both bound to
   * this tile's building and torn down in clearStructural when the tile changes. */
  smokeTimer: Phaser.Time.TimerEvent | undefined;
  pulseTween: Phaser.Tweens.Tween | undefined;
  sig: string;
  constructing: boolean;
};

const BAR_W = 60;
const BAR_H = 5;
const EFFECT_DEPTH = 100000;
const PIP_DEPTH = 50000;
/** Drifting cloud shadows sit above the diorama but below pips/effects. */
const CLOUD_DEPTH = 40000;

// ── Ambient life (Task C2) ───────────────────────────────────────────────────

/** Birds glide above absolutely everything, clouds and pip/effect layers alike. */
const BIRD_DEPTH = 200000;
/** Hard cap on live ambient GameObjects (walkers + butterflies + transient
 * smoke puffs + birds). Persistent life (≤10 walkers + ≤5 butterflies) leaves
 * ample head-room for the transient spawns. */
const AMBIENT_CAP = 40;
/** Once-generated soft-circle / chevron textures (see ensureAmbientTextures). */
const SMOKE_TEX = 'hv-smoke';
const BIRD_TEX = 'hv-bird';
/** Six PAL-family cloth colours for villager bodies (deterministic per walker). */
const WALKER_CLOTH: readonly number[] = [
  hexNum(PAL.roofRed),
  hexNum(PAL.roofBlue),
  hexNum(PAL.roofStraw),
  hexNum(PAL.leaf),
  hexNum(PAL.accent),
  hexNum(PAL.wood),
];
/** Three warm skin tones for villager heads. */
const WALKER_SKIN: readonly number[] = [0xf1c9a5, 0xe0a878, 0xc08552];
/** Butterfly wing tints (PAL glow / accent / roofBlue). */
const BUTTERFLY_TINT: readonly number[] = [
  hexNum(PAL.glow),
  hexNum(PAL.accent),
  hexNum(PAL.roofBlue),
];
/** Buildings that puff chimney smoke (producing coin buildings). */
const SMOKE_BUILDINGS: ReadonlySet<string> = new Set(['house', 'bakery', 'manor']);

/** A strolling villager: a `root` container that carries screen position + depth,
 * and an inner `vis` container that bobs/flips independently of the path travel. */
type Walker = {
  root: Phaser.GameObjects.Container;
  vis: Phaser.GameObjects.Container;
  tx: number;
  ty: number;
  moveTween: Phaser.Tweens.Tween | undefined;
  bobTween: Phaser.Tweens.Tween | undefined;
  idle: Phaser.Time.TimerEvent | undefined;
};

/** A butterfly fluttering a lazy figure-eight around a tree. `anchorKey` is the
 * tree tile it circles, so it can be destroyed if that tile is built over. */
type Butterfly = {
  root: Phaser.GameObjects.Container;
  anchorKey: string;
  path: Phaser.Tweens.Tween | undefined;
  flap: Phaser.Tweens.Tween | undefined;
};

export class Village extends Scene {
  private views: Map<string, TileView> = new Map();
  private groundImgs: Map<string, Phaser.GameObjects.Image> = new Map();
  private decorImgs: Map<string, Phaser.GameObjects.Image> = new Map();
  private landmarkParts: Phaser.GameObjects.Image[] = [];
  private dressingParts: Phaser.GameObjects.Image[] = [];
  private clouds: Phaser.GameObjects.Ellipse[] = [];
  /** Ambient life (C2): every walker / butterfly / smoke puff / bird lives in this
   * group so it can be counted (cap) and destroyed wholesale on cleanup. */
  private ambient: Phaser.GameObjects.Group | undefined;
  private walkers: Walker[] = [];
  private butterflies: Butterfly[] = [];
  private birdTimer: Phaser.Time.TimerEvent | undefined;
  private reducedMotion =
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches;
  private highlight: Phaser.GameObjects.Graphics | undefined;
  private conn: ReturnType<typeof connectRealtime> | undefined;
  private me: string | null = null;
  /** The village theme the ground + background were last painted with, so a
   * {t:'city'} theme change repaints exactly once. */
  private paintedTheme: VillageTheme = 'meadow';

  private pollTimer: number | null = null;
  private lastBarTick = 0;
  /** Ring bounds the ground was last painted with. repaintRing() compares the
   * store's current ring against this so both delivery paths (realtime message
   * AND poll/visibility refresh) repaint exactly once — double delivery is safe. */
  private paintedRing: { lo: number; hi: number } = { lo: -1, hi: -1 };
  /** True once initWorld() has run — guards the build-once ensureWorld() path. */
  private worldBuilt = false;
  /** The "Loading village…" / retry text, removed once the world is built. */
  private loading: Phaser.GameObjects.Text | undefined;
  /** Tile keys with a collect POST currently in flight (double-tap guard). */
  private collecting: Set<string> = new Set();

  private dragging = false;
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastY = 0;
  private pinchDist = 0;

  private onStoreChange: () => void = () => {};
  private onVisibility: () => void = () => {};
  private onFocusTile: (e: Event) => void = () => {};
  private onClearSelection: () => void = () => {};

  constructor() {
    super('Village');
  }

  create(): void {
    // Register cleanup up-front so a shutdown during the initial load still tidies.
    this.events.once('shutdown', () => this.cleanup());
    this.cameras.main.setBackgroundColor(BG);

    this.loading = this.add
      .text(this.scale.width / 2, this.scale.height / 2, 'Loading village…', {
        fontFamily: 'Fredoka, ui-rounded, system-ui, sans-serif',
        fontSize: '16px',
        color: PAL.cream,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(EFFECT_DEPTH);

    // Any successful refresh — the initial load, a retry, a poll tick, or a
    // visibilitychange refresh — emits 'change'. ensureWorld() builds the world
    // once (and reconciles thereafter), so a first load that failed and later
    // recovers via polling still comes alive instead of staying a black canvas.
    this.onStoreChange = () => this.ensureWorld();
    store.on('change', this.onStoreChange);

    void store
      .refresh()
      .then(() => this.ensureWorld())
      .catch(() => {
        this.loading?.setText('Could not reach the village. Retrying…');
        this.startPolling();
      });
  }

  // ── World construction ────────────────────────────────────────────────────

  /**
   * Build the world exactly once, then reconcile on every later change. Called
   * from the store 'change' subscription and the initial-load success path, so
   * a first load that fails (and only later recovers via polling / visibility)
   * still initialises the map instead of leaving a dead canvas under the HUD.
   */
  private ensureWorld(): void {
    if (this.worldBuilt) {
      this.reconcileAll();
      return;
    }
    if (!store.data) return;
    this.loading?.destroy();
    this.loading = undefined;
    this.initWorld();
    this.worldBuilt = true;
  }

  private initWorld(): void {
    const data = store.data;
    if (!data) return;
    this.me = data.me?.id ?? null;

    this.buildGround();
    this.buildLandmark();
    this.buildDressing();
    this.buildClouds();
    // Ambient group + shared textures must exist before reconcileAll(), since
    // buildBuilding() attaches per-building smoke/pulse as tiles are composed.
    this.initAmbient();

    // Selection highlight (a glowing top-face diamond, hidden until a tile is tapped).
    this.highlight = this.add
      .graphics()
      .setDepth(PIP_DEPTH - 1)
      .setVisible(false);

    this.reconcileAll();
    this.updatePips();

    // Walkers, butterflies and the bird scheduler read the now-composed world.
    this.spawnWalkers();
    this.spawnButterflies();
    this.scheduleBirds();

    this.setupCamera();
    this.setupInput();
    this.setupDomBridge();
    this.setupRealtime();

    this.time.addEvent({
      delay: 2000,
      loop: true,
      callback: () => this.updatePips(),
    });
  }

  // ── Ring / unlock helpers ───────────────────────────────────────────────────

  private population(): number {
    const data = store.data;
    return data?.ring.population ?? data?.city.population ?? 0;
  }

  private hallLevel(): number {
    return store.data?.city.hallLevel ?? 0;
  }

  private ringLoHi(): { lo: number; hi: number } {
    const r = store.data?.ring;
    if (r) return { lo: r.lo, hi: r.hi };
    return ringBounds(this.hallLevel());
  }

  private isUnlockedTile(x: number, y: number): boolean {
    const { lo, hi } = this.ringLoHi();
    return x >= lo && x <= hi && y >= lo && y <= hi;
  }

  /** The current village theme (from the store), defaulting to meadow. */
  private theme(): VillageTheme {
    return store.data?.city.theme ?? 'meadow';
  }

  // ── Ground ──────────────────────────────────────────────────────────────────

  private buildGround(): void {
    this.paintedRing = this.ringLoHi();
    this.paintedTheme = this.theme();
    this.cameras.main.setBackgroundColor(THEMES[this.paintedTheme].skyBg);
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        this.paintGround(x, y);
      }
    }
  }

  /**
   * Repaint the whole ground + background when the store's theme differs from
   * what was last painted (mod changed the theme via {t:'city'}). Idempotent —
   * the paintedTheme guard makes realtime + poll double-delivery a no-op.
   */
  private repaintTheme(): void {
    const theme = this.theme();
    if (theme === this.paintedTheme) return;
    this.paintedTheme = theme;
    this.cameras.main.setBackgroundColor(THEMES[theme].skyBg);
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        this.paintGround(x, y);
      }
    }
  }

  /** Paint (or repaint) one ground tile per the current ring + routing rules.
   * Returns undefined for deep-locked tiles, which render as background void. */
  private paintGround(x: number, y: number): Phaser.GameObjects.Image | undefined {
    const key = tileKey(x, y);
    this.groundImgs.get(key)?.destroy();
    this.groundImgs.delete(key);
    const oldDecor = this.decorImgs.get(key);
    if (oldDecor) {
      this.tweens.killTweensOf(oldDecor);
      oldDecor.destroy();
      this.decorImgs.delete(key);
    }

    const { sx, sy } = isoToScreen(x, y, TILE_W, TILE_H);
    const style = THEMES[this.theme()];
    let img: Phaser.GameObjects.Image;

    if (!this.isUnlockedTile(x, y)) {
      // Locked land: a soft desaturated grass band just beyond the ring; deeper
      // locked tiles are not rendered at all (background void). Not interactive.
      const { lo, hi } = this.ringLoHi();
      const inBand =
        x >= lo - LOCKED_BAND &&
        x <= hi + LOCKED_BAND &&
        y >= lo - LOCKED_BAND &&
        y <= hi + LOCKED_BAND;
      if (!inBand) return undefined;
      img = addBlock(this, 'grass-center', sx, sy)
        .setAlpha(LOCKED_ALPHA)
        .setTint(style.lockedTint);
    } else if (isRiver(x, y)) {
      // Rivers untinted — water stays readable across themes.
      const p = riverPiece(x, y);
      img = addBlock(this, p.key, sx, sy).setFlipX(p.flipX);
    } else if (isKeepPad(x, y)) {
      // Dirt only under the keep 2×2 — the rest of the plaza square is grass.
      img = addBlock(this, 'dirt-center', sx, sy);
      if (style.dirtTint !== undefined) img.setTint(style.dirtTint);
    } else if (isPathRing(x, y)) {
      // Paths untinted — kept readable per the theme spec.
      const p = pathPiece(x, y);
      img = addBlock(this, p.key, sx, sy).setFlipX(p.flipX);
    } else {
      img = addBlock(this, 'grass-center', sx, sy);
      if (style.grassTint !== undefined) img.setTint(style.grassTint);
      // Sparse deterministic decor on unowned, non-plaza open tiles.
      if (store.data?.grid[key] === undefined && !isPlaza(x, y)) {
        const d = decorSprinkle(x, y);
        if (d) {
          const sprite = addSurface(this, d, sx, sy).setDepth(sy + 0.5);
          if (style.grassTint !== undefined) sprite.setTint(style.grassTint);
          this.decorImgs.set(key, sprite);
          if (isTreeDecor(d) && !this.reducedMotion) {
            this.tweens.add({
              targets: sprite,
              angle: { from: -1.2, to: 1.2 },
              duration: 3000,
              delay: this.swayPhase(x, y),
              yoyo: true,
              repeat: -1,
              ease: 'Sine.inOut',
            });
          }
        }
      }
    }

    img.setDepth(sy);
    this.groundImgs.set(key, img);
    return img;
  }

  /** Deterministic per-tile tween phase (ms) so trees don't sway in lockstep. */
  private swayPhase(x: number, y: number): number {
    const h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0;
    return h % 3000;
  }

  // ── Grand Keep (castle composition) ─────────────────────────────────────────

  private buildLandmark(): void {
    this.renderCastle();
  }

  private renderCastle(): void {
    for (const p of this.landmarkParts) p.destroy();
    this.landmarkParts = [];
    const stage = store.data?.city.hallLevel ?? 0;
    for (const part of castleParts(stage)) {
      const { sx, sy } = isoToScreen(part.x, part.y, TILE_W, TILE_H);
      const img = part.roof
        ? addBlock(this, part.key, sx, sy, BASE_DY + CASTLE_TOP_DY)
        : addBlock(this, part.key, sx, sy, BASE_DY);
      img.setDepth(sy + (part.roof ? 2 : 1));
      this.landmarkParts.push(img);
    }
  }

  private updateLandmark(): void {
    this.renderCastle();
  }

  // ── World dressing (fence ring, well, drifting cloud shadows) ────────────────

  /** Static plaza dressing: a wooden fence hugging the path ring + a corner well.
   * Plaza tiles are always unlocked and never take a building, so these are built
   * once and never reconciled. */
  private buildDressing(): void {
    for (const p of plazaFencePieces()) {
      const { sx, sy } = isoToScreen(p.x, p.y, TILE_W, TILE_H);
      this.dressingParts.push(
        addSurface(this, p.key, sx, sy).setDepth(sy + 0.4)
      );
    }
    const w = isoToScreen(WELL_TILE.x, WELL_TILE.y, TILE_W, TILE_H);
    this.dressingParts.push(
      addSurface(this, 'well', w.sx, w.sy).setDepth(w.sy + 0.4)
    );
  }

  /** 3 soft dark ellipses sweeping across the map on slow loops — subtle life.
   * Above the diorama but below pips; standing still under reduced motion. */
  private buildClouds(): void {
    const spanX = (GRID_SIZE - 1) * TILE_W;
    const midY = ((GRID_SIZE - 1) * TILE_H) / 2;
    const travel = spanX * 1.8;
    const defs = [
      { startX: -spanX, y: midY - 190, w: 300, h: 132, dur: 66000 },
      { startX: -spanX * 0.35, y: midY + 30, w: 360, h: 150, dur: 84000 },
      { startX: spanX * 0.3, y: midY + 250, w: 260, h: 118, dur: 74000 },
    ];
    for (const d of defs) {
      const cloud = this.add
        .ellipse(d.startX, d.y, d.w, d.h, C_INK, 0.06)
        .setDepth(CLOUD_DEPTH);
      this.clouds.push(cloud);
      if (this.reducedMotion) continue;
      this.tweens.add({
        targets: cloud,
        x: { from: d.startX, to: d.startX + travel },
        duration: d.dur,
        repeat: -1,
        ease: 'Linear',
      });
    }
  }

  // ── Incremental reconciliation ────────────────────────────────────────────

  private reconcileAll(): void {
    const data = store.data;
    if (!data) return;
    // Ring bounds can also change via the poll/refresh path (a dropped realtime
    // {t:'ring'} message) — repaint the ground whenever they differ.
    this.repaintRing();
    // A theme change (mod form) can also arrive via poll — repaint if it differs.
    this.repaintTheme();
    for (const [key, tile] of Object.entries(data.grid)) {
      this.syncTile(key, tile);
    }
    for (const key of [...this.views.keys()]) {
      if (!data.grid[key]) {
        this.destroyView(key);
      }
    }
  }

  private newView(): TileView {
    return {
      parts: [],
      primary: undefined,
      barBg: undefined,
      bar: undefined,
      claim: undefined,
      goldPip: undefined,
      finder: undefined,
      pip: undefined,
      boostPip: undefined,
      growthKey: undefined,
      smokeTimer: undefined,
      pulseTween: undefined,
      sig: '',
      constructing: false,
    };
  }

  private syncTile(key: string, tile: TileState): void {
    const { x, y } = parseKey(key);
    const { sx, sy } = isoToScreen(x, y, TILE_W, TILE_H);

    let view = this.views.get(key);
    if (!view) {
      view = this.newView();
      this.views.set(key, view);
    }

    const mine = tile.owner === this.me;
    const hasBuilding = tile.buildingId !== undefined;
    const constructing = hasBuilding && this.now() < tile.readyAt;
    const cosmetic = tile.cosmetic ?? '-';
    const roofColor = tile.roofColor ?? '-';
    const sig = `${tile.buildingId ?? '-'}|${tile.tier}|${constructing ? 'c' : 'd'}|${mine ? 'm' : 'o'}|${cosmetic}|${roofColor}`;

    // A claimed tile never keeps a loose decor sprinkle beneath it.
    const decor = this.decorImgs.get(key);
    if (decor) {
      this.tweens.killTweensOf(decor);
      decor.destroy();
      this.decorImgs.delete(key);
    }

    if (sig !== view.sig) {
      this.clearStructural(view);
      this.killButterfliesAt(key);

      if (hasBuilding) {
        this.buildBuilding(view, tile, x, y, sx, sy, constructing);
        if (!constructing && tile.buildingId !== undefined) {
          this.attachTileAmbient(view, tile.buildingId, x, y, sx, sy);
        }
      } else {
        // Claimed but empty — a small staked fence marker.
        view.claim = addSurface(this, 'fence-wood', sx, sy)
          .setDepth(sy + 0.5)
          .setAlpha(0.9);
      }

      // Own-tile finder glow (small pulsing pip near the tile corner).
      if (mine && !view.finder) {
        view.finder = this.add
          .rectangle(sx - TILE_W * 0.24, sy + TILE_H * 0.1, 6, 6, C_GLOW)
          .setDepth(PIP_DEPTH)
          .setAlpha(0.85);
        this.tweens.add({
          targets: view.finder,
          alpha: 0.35,
          duration: 900,
          yoyo: true,
          repeat: -1,
        });
      } else if (!mine && view.finder) {
        this.tweens.killTweensOf(view.finder);
        view.finder.destroy();
        view.finder = undefined;
      }

      view.constructing = constructing;
      view.sig = sig;
    }
  }

  /** Compose a tile's building sprites (stacked base+roof, flat decor, or scaffold). */
  private buildBuilding(
    view: TileView,
    tile: TileState,
    x: number,
    y: number,
    sx: number,
    sy: number,
    constructing: boolean
  ): void {
    if (constructing || tile.buildingId === undefined) {
      const scaffold = addBlock(this, 'structure-low', sx, sy, BASE_DY).setDepth(
        sy + 1
      );
      view.primary = scaffold;
      view.parts.push(scaffold);
      view.barBg = this.add
        .rectangle(sx, sy - TILE_H * 1.5, BAR_W + 2, BAR_H + 2, C_INK)
        .setDepth(sy + 3);
      view.bar = this.add
        .rectangle(sx - BAR_W / 2, sy - TILE_H * 1.5, BAR_W, BAR_H, C_GLOW)
        .setOrigin(0, 0.5)
        .setDepth(sy + 4);
      return;
    }

    const art = BUILDING_ART[tile.buildingId];
    if (art.kind === 'stacked') {
      // Base lifted one block step onto the tile face; roof one more step up.
      const base = addBlock(this, art.base, sx, sy, BASE_DY).setDepth(sy + 1);
      // Painted roofs keep the building's shape but swap colour; fall back to the
      // default tier colour progression when unpainted.
      const roofKey =
        roofKeyFor(tile.buildingId, tile.tier, tile.roofColor) ??
        art.roofByTier[tile.tier];
      const roof = addBlock(
        this,
        roofKey,
        sx,
        sy,
        BASE_DY + ROOF_DY
      ).setDepth(sy + 2);
      if (tile.cosmetic === 'golden-roof') {
        roof.setTint(GOLD);
        view.goldPip = this.add
          .image(sx, sy - TILE_H * 2.1, 'icon-star')
          .setScale(0.18)
          .setTint(C_GLOW)
          .setDepth(sy + 3);
        this.tweens.add({
          targets: view.goldPip,
          alpha: 0.4,
          duration: 850,
          yoyo: true,
          repeat: -1,
        });
      }
      view.primary = base;
      view.parts.push(base, roof);
      return;
    }

    // Flat composition (crops / trees / rocks / decor). Wheatfields use a growth
    // state chosen from accrual instead of the static tier sprite.
    let keys: SpriteKey[];
    if (tile.buildingId === 'wheatfield') {
      const gk = this.wheatGrowthKey(tile, x, y);
      view.growthKey = gk;
      keys = [gk];
    } else {
      keys = art.byTier[tile.tier];
    }
    let d = sy + 1;
    for (const k of keys) {
      const img = addSurface(this, k, sx, sy);
      img.setDepth(d);
      d += 0.1;
      view.parts.push(img);
      if (!view.primary) view.primary = img;
    }
  }

  /** furrow-crop while under half the tier cap, furrow-crop-wheat once ripening. */
  private wheatGrowthKey(tile: TileState, x: number, y: number): SpriteKey {
    const data = store.data;
    if (!data) return 'furrow-crop';
    const now = this.now();
    const adj = adjacencyBonus(data.grid, x, y, data.city.festival, now);
    const { gained } = accrue(
      tile,
      now,
      data.city.festival,
      adj,
      data.city.weather,
      emptyStockpile()
    );
    const cap = tierStats(CATALOG.wheatfield, tile.tier).cap;
    const wheat = gained.goods.wheat ?? 0;
    return wheat >= cap * 0.5 ? 'furrow-crop-wheat' : 'furrow-crop';
  }

  private clearStructural(view: TileView): void {
    for (const p of view.parts) p.destroy();
    view.parts = [];
    view.primary = undefined;
    view.barBg?.destroy();
    view.bar?.destroy();
    view.claim?.destroy();
    view.barBg = undefined;
    view.bar = undefined;
    view.claim = undefined;
    if (view.goldPip) {
      this.tweens.killTweensOf(view.goldPip);
      view.goldPip.destroy();
      view.goldPip = undefined;
    }
    // Ambient bound to this building — stop before the sprites are replaced so a
    // rebuild/upgrade never leaves an orphaned smoke timer or pulse tween running.
    if (view.smokeTimer) {
      view.smokeTimer.remove(false);
      view.smokeTimer = undefined;
    }
    if (view.pulseTween) {
      view.pulseTween.remove();
      view.pulseTween = undefined;
    }
    view.growthKey = undefined;
  }

  private destroyView(key: string): void {
    const view = this.views.get(key);
    if (!view) return;
    this.clearStructural(view);
    this.killButterfliesAt(key);
    for (const pip of [view.finder, view.pip, view.boostPip]) {
      if (pip) {
        this.tweens.killTweensOf(pip);
        pip.destroy();
      }
    }
    this.views.delete(key);
  }

  // ── Pending-production + boost pips ──────────────────────────────────────────

  private updatePips(): void {
    const data = store.data;
    if (!data) return;
    const now = this.now();
    const fest = data.city.festival;

    for (const [key, tile] of Object.entries(data.grid)) {
      const view = this.views.get(key);
      if (!view) continue;
      const { x, y } = parseKey(key);
      const { sx, sy } = isoToScreen(x, y, TILE_W, TILE_H);

      // Wheatfield growth state can change over time — refresh its sprite.
      if (
        tile.buildingId === 'wheatfield' &&
        !view.constructing &&
        view.primary
      ) {
        const gk = this.wheatGrowthKey(tile, x, y);
        if (gk !== view.growthKey) {
          view.growthKey = gk;
          view.primary.setTexture(gk);
        }
      }

      // Ready-to-collect coin pip (own producing tiles with pending output).
      let ready = false;
      if (tile.owner === this.me && tile.buildingId !== undefined && now >= tile.readyAt) {
        const adj = adjacencyBonus(data.grid, x, y, fest, now);
        const { gained } = accrue(tile, now, fest, adj, data.city.weather, emptyStockpile());
        ready = gained.coins + goodsTotal(gained.goods) > 0;
      }
      if (ready && !view.pip) {
        view.pip = this.spawnPip(sx, sy - TILE_H * 1.7, 'icon-coin', C_GLOW);
      } else if (!ready && view.pip) {
        this.tweens.killTweensOf(view.pip);
        view.pip.destroy();
        view.pip = undefined;
      }

      // Boost pip (any boosted tile shows an up-arrow).
      const boosted = tile.boostUntil > now && tile.buildingId !== undefined;
      if (boosted && !view.boostPip) {
        view.boostPip = this.spawnPip(sx, sy - TILE_H * 2.0, 'icon-arrow-up', C_ACCENT);
      } else if (!boosted && view.boostPip) {
        this.tweens.killTweensOf(view.boostPip);
        view.boostPip.destroy();
        view.boostPip = undefined;
      }
    }
  }

  private spawnPip(
    x: number,
    y: number,
    key: SpriteKey,
    tint: number
  ): Phaser.GameObjects.Image {
    const pip = this.add
      .image(x, y, key)
      .setScale(0.2)
      .setTint(tint)
      .setDepth(PIP_DEPTH);
    this.tweens.add({
      targets: pip,
      y: y - 7,
      duration: 620,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });
    return pip;
  }

  // ── Camera ─────────────────────────────────────────────────────────────────

  private setupCamera(): void {
    const cam = this.cameras.main;
    const half = TILE_W;
    const spanX = (GRID_SIZE - 1) * TILE_W;
    cam.setBounds(
      -spanX / 2 - half,
      -260,
      spanX + half * 2,
      (GRID_SIZE - 1) * TILE_H + 460
    );
    cam.setZoom(1);

    let cx = KEEP_CX;
    let cy = KEEP_CY;
    const data = store.data;
    if (data && this.me) {
      for (const [key, tile] of Object.entries(data.grid)) {
        if (tile.owner === this.me) {
          const { x, y } = parseKey(key);
          const p = isoToScreen(x, y, TILE_W, TILE_H);
          cx = p.sx;
          cy = p.sy;
          break;
        }
      }
    }
    cam.centerOn(cx, cy);
  }

  // ── Input: pan / zoom / tap ─────────────────────────────────────────────────

  private setupInput(): void {
    this.input.addPointer(1); // allow a second touch for pinch

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.dragging = true;
      this.startX = p.x;
      this.startY = p.y;
      this.lastX = p.x;
      this.lastY = p.y;
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const p1 = this.input.pointer1;
      const p2 = this.input.pointer2;
      if (p1.isDown && p2.isDown) {
        const d = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
        if (this.pinchDist > 0) {
          const cam = this.cameras.main;
          cam.setZoom(
            Phaser.Math.Clamp((cam.zoom * d) / this.pinchDist, 0.5, 2)
          );
        }
        this.pinchDist = d;
        this.dragging = false;
        return;
      }
      this.pinchDist = 0;
      if (!p.isDown || !this.dragging) return;
      const cam = this.cameras.main;
      cam.scrollX -= (p.x - this.lastX) / cam.zoom;
      cam.scrollY -= (p.y - this.lastY) / cam.zoom;
      this.lastX = p.x;
      this.lastY = p.y;
    });

    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      const wasPinch = this.pinchDist > 0;
      const wasDrag = this.dragging;
      this.pinchDist = 0;
      this.dragging = false;
      if (wasPinch || !wasDrag) return;
      const moved = Math.abs(p.x - this.startX) + Math.abs(p.y - this.startY);
      if (moved < 8) this.handleTap(p);
    });

    this.input.on(
      'wheel',
      (_p: unknown, _o: unknown, _dx: number, dy: number) => {
        const cam = this.cameras.main;
        cam.setZoom(
          Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), 0.5, 2)
        );
      }
    );
  }

  private handleTap(p: Phaser.Input.Pointer): void {
    const data = store.data;
    if (!data) return;
    const world = this.cameras.main.getWorldPoint(p.x, p.y);
    const a = world.x / (TILE_W / 2);
    const b = world.y / (TILE_H / 2);
    const x = Math.round((a + b) / 2);
    const y = Math.round((b - a) / 2);
    if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) return;

    // Locked land rejects interaction: this land opens when the Village Hall
    // levels up (its ring unlock), not by raw villager count.
    if (!this.isUnlockedTile(x, y)) {
      toast('Upgrade the Village Hall to unlock this land.', 'info');
      return;
    }

    // The river runs through the outer ring — it can't be settled or built on.
    if (isRiver(x, y)) {
      toast('The river flows here', 'info');
      return;
    }

    const key = tileKey(x, y);
    const tile = data.grid[key] ?? null;
    const mine = tile !== null && tile.owner === this.me;
    const claimable = isClaimable(x, y) && tile === null && !isRiver(x, y);

    // Fast path: tapping your own ready, producing tile collects immediately.
    if (mine && tile !== null && tile.buildingId !== undefined) {
      const now = this.now();
      if (now >= tile.readyAt) {
        const adj = adjacencyBonus(data.grid, x, y, data.city.festival, now);
        const { gained } = accrue(tile, now, data.city.festival, adj, data.city.weather, emptyStockpile());
        if (gained.coins + goodsTotal(gained.goods) > 0) {
          this.collectTile(x, y);
          return;
        }
      }
    }

    this.setSelection(key, x, y);
    this.dispatchSelected({ key, x, y, tile, mine, claimable });
  }

  private collectTile(x: number, y: number): void {
    const key = tileKey(x, y);
    if (this.collecting.has(key)) return; // a collect is already in flight
    this.collecting.add(key);
    void api
      .collect(x, y)
      .then((res) => {
        store.applyMutation({ key, tile: res.tile, me: res.me });
        this.coinBurst(x, y);
      })
      .catch(() => {
        // Collection failed (e.g. nothing ready yet after a race) — ignore;
        // the next refresh reconciles the true state.
      })
      .finally(() => {
        this.collecting.delete(key);
      });
  }

  private setSelection(key: string, x: number, y: number): void {
    if (!this.highlight) return;
    const { sx, sy } = isoToScreen(x, y, TILE_W, TILE_H);
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;
    this.highlight.clear();
    this.highlight.lineStyle(3, C_GLOW, 0.9);
    this.highlight.beginPath();
    this.highlight.moveTo(sx, sy - hh);
    this.highlight.lineTo(sx + hw, sy);
    this.highlight.lineTo(sx, sy + hh);
    this.highlight.lineTo(sx - hw, sy);
    this.highlight.closePath();
    this.highlight.strokePath();
    this.highlight.setVisible(true);
    void key;
  }

  private dispatchSelected(detail: HvTileSelected): void {
    window.dispatchEvent(
      new CustomEvent<HvTileSelected>(HV_TILE_SELECTED, { detail })
    );
  }

  // ── DOM bridge ──────────────────────────────────────────────────────────────

  private setupDomBridge(): void {
    this.onFocusTile = (e: Event) => {
      if (!(e instanceof CustomEvent)) return;
      const d = e.detail;
      if (typeof d?.x !== 'number' || typeof d?.y !== 'number') return;
      const { sx, sy } = isoToScreen(d.x, d.y, TILE_W, TILE_H);
      this.cameras.main.pan(sx, sy, 350, 'Sine.inOut');
    };
    this.onClearSelection = () => {
      this.highlight?.setVisible(false);
    };
    window.addEventListener(HV_FOCUS_TILE, this.onFocusTile);
    window.addEventListener(HV_CLEAR_SELECTION, this.onClearSelection);

    this.onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void store.refresh().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  // ── Realtime ────────────────────────────────────────────────────────────────

  private setupRealtime(): void {
    this.conn = connectRealtime<JsonValue>({
      channel: 'village',
      onConnect: () => this.stopPolling(),
      onDisconnect: () => this.startPolling(),
      onMessage: (msg) => this.onRealtime(msg),
    });
  }

  private onRealtime(msg: JsonValue): void {
    if (!isVillageMessage(msg)) return;
    switch (msg.t) {
      case 'tile': {
        const prev = store.data?.grid[msg.key];
        const wasEmpty = prev === undefined || prev.buildingId === undefined;
        const bid = msg.tile.buildingId;
        const brandNew = wasEmpty && bid !== undefined;
        store.patchTile(msg.key, msg.tile);
        if (brandNew && bid !== undefined && msg.tile.owner !== this.me) {
          const view = this.views.get(msg.key);
          if (view?.primary) this.dustPop(view.primary);
          this.floatLabel(msg.key, CATALOG[bid].name);
        }
        break;
      }
      case 'city': {
        store.patchCity(msg.city);
        this.updateLandmark();
        // Mod may have changed the theme — repaint ground + background if so.
        this.repaintTheme();
        break;
      }
      case 'stage': {
        const cur = store.data?.city;
        if (cur) {
          const next: CityState = { ...cur, hallLevel: msg.stage };
          store.patchCity(next);
        }
        this.updateLandmark();
        this.confetti();
        break;
      }
      case 'festival': {
        store.setFestival(msg.festival);
        break;
      }
      case 'market': {
        store.patchMarket(msg.prices, msg.stockpile);
        break;
      }
      case 'ring': {
        this.onRingUnlock(msg.bounds.lo, msg.bounds.hi);
        break;
      }
    }
  }

  /** Realtime ring message: widen the store's bounds, then repaint/celebrate.
   * Population + nextThreshold aren't in the message, so a refresh is kicked
   * off to keep the "N more villagers" copy honest. */
  private onRingUnlock(lo: number, hi: number): void {
    const data = store.data;
    if (!data) return;
    // Only ever widen — ignore stale/out-of-order messages.
    if (lo < data.ring.lo || hi > data.ring.hi) {
      data.ring.lo = Math.min(lo, data.ring.lo);
      data.ring.hi = Math.max(hi, data.ring.hi);
      void store.refresh().catch(() => {});
    }
    this.repaintRing();
  }

  /**
   * Repaint the ground when the store's ring bounds differ from what was last
   * painted, with the unlock celebration (zoom-out, staggered pop-in, confetti).
   * Idempotent — the paintedRing guard makes realtime + poll double-delivery a
   * no-op on the second arrival.
   */
  private repaintRing(): void {
    const { lo, hi } = this.ringLoHi();
    const old = this.paintedRing;
    if (lo === old.lo && hi === old.hi) return;
    this.paintedRing = { lo, hi };

    // Visual state per tile: unlocked (2) / locked band (1) / void (0). Repaint
    // every tile whose state changed; animate only freshly-unlocked ones.
    const state = (
      x: number,
      y: number,
      b: { lo: number; hi: number }
    ): number => {
      if (x >= b.lo && x <= b.hi && y >= b.lo && y <= b.hi) return 2;
      if (
        b.lo !== -1 &&
        x >= b.lo - LOCKED_BAND &&
        x <= b.hi + LOCKED_BAND &&
        y >= b.lo - LOCKED_BAND &&
        y <= b.hi + LOCKED_BAND
      ) {
        return 1;
      }
      return 0;
    };

    const fresh: Array<{ x: number; y: number }> = [];
    const now = { lo, hi };
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const s = state(x, y, now);
        if (s === state(x, y, old)) continue;
        if (s === 2) {
          fresh.push({ x, y });
        } else {
          this.paintGround(x, y); // band appears / void clears, no fanfare
        }
      }
    }
    if (fresh.length === 0) return;

    // Only celebrate genuine growth (skip the initial paint from -1/-1 bounds).
    if (old.lo !== -1) toast('New land unlocked!', 'celebrate');

    // Gentle zoom-out to reveal the bigger village.
    const cam = this.cameras.main;
    this.tweens.add({
      targets: cam,
      zoom: Math.max(0.55, cam.zoom * 0.82),
      duration: 700,
      ease: 'Sine.inOut',
    });

    // Staggered pop-in of the freshly-unlocked terrain.
    fresh.forEach((t, i) => {
      this.time.delayedCall(i * 20, () => {
        const img = this.paintGround(t.x, t.y);
        if (!img) return;
        img.setScale(0);
        this.tweens.add({
          targets: img,
          scale: 1,
          duration: 320,
          ease: 'Back.out',
        });
      });
    });

    this.ringConfetti(fresh.length);
  }

  private startPolling(): void {
    if (this.pollTimer !== null) return;
    this.pollTimer = window.setInterval(() => {
      void store.refresh().catch(() => {});
    }, 45000);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // ── Cosmetic effects ─────────────────────────────────────────────────────────

  private dustPop(target: Phaser.GameObjects.Image): void {
    target.setScale(0.6);
    this.tweens.add({
      targets: target,
      scale: 1,
      duration: 320,
      ease: 'Back.out',
    });
    const x = target.x;
    const y = target.y - TILE_H / 2;
    for (let i = 0; i < 5; i++) {
      const puff = this.add
        .rectangle(x, y, 5, 5, C_CREAM)
        .setDepth(EFFECT_DEPTH)
        .setAlpha(0.9);
      this.tweens.add({
        targets: puff,
        x: x + Phaser.Math.Between(-24, 24),
        y: y - Phaser.Math.Between(8, 26),
        alpha: 0,
        duration: 460,
        ease: 'Quad.out',
        onComplete: () => puff.destroy(),
      });
    }
  }

  private coinBurst(x: number, y: number): void {
    const { sx, sy } = isoToScreen(x, y, TILE_W, TILE_H);
    const oy = sy - TILE_H * 0.7;
    for (let i = 0; i < 7; i++) {
      const coin = this.add
        .image(sx, oy, 'icon-coin')
        .setScale(0.16)
        .setTint(C_GLOW)
        .setDepth(EFFECT_DEPTH);
      this.tweens.add({
        targets: coin,
        x: sx + Phaser.Math.Between(-30, 30),
        y: oy - Phaser.Math.Between(28, 52),
        alpha: 0,
        duration: 620,
        ease: 'Quad.out',
        onComplete: () => coin.destroy(),
      });
    }
  }

  private confetti(): void {
    this.burstConfetti(KEEP_CX, KEEP_CY - TILE_H * 2, 14);
  }

  private ringConfetti(count: number): void {
    const cam = this.cameras.main;
    this.burstConfetti(
      cam.midPoint.x,
      cam.midPoint.y - 40,
      Math.min(24, 8 + count)
    );
  }

  private burstConfetti(cx: number, cy: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const color = CONFETTI[i % CONFETTI.length] ?? C_GLOW;
      const bit = this.add
        .rectangle(cx + Phaser.Math.Between(-50, 50), cy, 5, 5, color)
        .setDepth(EFFECT_DEPTH);
      this.tweens.add({
        targets: bit,
        y: cy + Phaser.Math.Between(60, 150),
        x: bit.x + Phaser.Math.Between(-30, 30),
        alpha: 0,
        angle: Phaser.Math.Between(-180, 180),
        duration: 1200,
        ease: 'Quad.in',
        onComplete: () => bit.destroy(),
      });
    }
  }

  private floatLabel(key: string, text: string): void {
    const { x, y } = parseKey(key);
    const { sx, sy } = isoToScreen(x, y, TILE_W, TILE_H);
    const label = this.add
      .text(sx, sy - TILE_H, text, {
        fontFamily: 'Fredoka, ui-rounded, system-ui, sans-serif',
        fontSize: '12px',
        color: PAL.cream,
        backgroundColor: PAL.ink,
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5, 1)
      .setDepth(EFFECT_DEPTH);
    this.tweens.add({
      targets: label,
      y: sy - TILE_H - 22,
      alpha: 0,
      duration: 1600,
      ease: 'Quad.out',
      onComplete: () => label.destroy(),
    });
  }

  // ── Ambient life (walkers, smoke, butterflies, birds, work pulse) ────────────

  /** Create the dedicated ambient group + the two shared generated textures (a
   * soft smoke puff, a dark bird chevron). Idempotent on the textures. */
  private initAmbient(): void {
    this.ambient = this.add.group();
    if (!this.textures.exists(SMOKE_TEX)) {
      const g = this.add.graphics();
      g.fillStyle(0xd8d8d8, 1).fillCircle(8, 8, 8);
      g.generateTexture(SMOKE_TEX, 16, 16);
      g.destroy();
    }
    if (!this.textures.exists(BIRD_TEX)) {
      const g = this.add.graphics();
      g.lineStyle(2, 0xffffff, 1);
      g.beginPath();
      g.moveTo(0, 4);
      g.lineTo(6, 0);
      g.lineTo(12, 4);
      g.strokePath();
      g.generateTexture(BIRD_TEX, 12, 6);
      g.destroy();
    }
  }

  /** Live ambient GameObject count (group auto-drops destroyed members). */
  private ambientCount(): number {
    return this.ambient?.getLength() ?? 0;
  }

  /** Coordinate hash → a stable pseudo-random value, for per-tile pulse phase and
   * deterministic walker spawns (visual only — not shared game logic). */
  private hash(a: number, b: number): number {
    let h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663)) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995) >>> 0;
    return (h ^ (h >>> 15)) >>> 0;
  }

  /** A tile a villager may stand on: unlocked, not river, not the keep pad, and
   * not occupied by a building (bare claimed plots are fine to cross). Consulted
   * live at every step, so a building appearing mid-stroll simply steers the
   * next pick away — walkers never choose to clip through houses. */
  private isWalkable(x: number, y: number): boolean {
    if (!this.isUnlockedTile(x, y) || isRiver(x, y) || isKeepPad(x, y)) {
      return false;
    }
    return store.data?.grid[tileKey(x, y)]?.buildingId === undefined;
  }

  // ── Villager walkers ─────────────────────────────────────────────────────────

  /** Spawn strolling villagers on the plaza path ring. Count scales with the
   * village population, clamped to [2,10]; positions are deterministic (seeded by
   * index). Under reduced motion they stand idle (no tweens) rather than roam. */
  private spawnWalkers(): void {
    const ring: Array<{ x: number; y: number }> = [];
    for (let y = PATH_LO; y <= PATH_HI; y++) {
      for (let x = PATH_LO; x <= PATH_HI; x++) {
        if (isPathRing(x, y)) ring.push({ x, y });
      }
    }
    if (ring.length === 0) return;
    const count = Phaser.Math.Clamp(
      2 + Math.floor(this.population() * 1.5),
      2,
      10
    );
    for (let i = 0; i < count; i++) {
      const tile = ring[(i * 7 + 1) % ring.length];
      if (!tile) continue;
      this.makeWalker(i, tile.x, tile.y);
    }
  }

  private makeWalker(index: number, tx: number, ty: number): void {
    const cloth = WALKER_CLOTH[index % WALKER_CLOTH.length] ?? hexNum(PAL.roofRed);
    const skin =
      WALKER_SKIN[this.hash(index, tx + ty) % WALKER_SKIN.length] ??
      WALKER_SKIN[0]!;
    // Contact point at local y=0 (feet on the tile face); the figure rises upward.
    const outline = this.add.graphics();
    outline.fillStyle(hexNum(PAL.ink), 0.9).fillRoundedRect(-6, -18, 12, 16, 4);
    const body = this.add.graphics();
    body.fillStyle(cloth, 1).fillRoundedRect(-5, -17, 10, 14, 3);
    const feet = this.add.rectangle(0, -2, 7, 3, hexNum(PAL.woodDark));
    const head = this.add.circle(0, -19, 3.5, skin);
    const vis = this.add.container(0, 0, [outline, body, feet, head]);

    const { sx, sy } = isoToScreen(tx, ty, TILE_W, TILE_H);
    const root = this.add.container(sx, sy, [vis]).setDepth(sy + 0.6);
    this.ambient?.add(root);

    const walker: Walker = {
      root,
      vis,
      tx,
      ty,
      moveTween: undefined,
      bobTween: undefined,
      idle: undefined,
    };
    this.walkers.push(walker);

    if (this.reducedMotion) return; // stand idle — no bob, no roaming
    walker.bobTween = this.tweens.add({
      targets: vis,
      y: -2,
      duration: 320,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });
    this.walkerStep(walker);
  }

  /** Pick an adjacent walkable tile (path preferred) and stroll there with a
   * depth-tracking tween, then idle 1–3s and repeat. */
  private walkerStep(w: Walker): void {
    const neigh = [
      { x: w.tx - 1, y: w.ty },
      { x: w.tx + 1, y: w.ty },
      { x: w.tx, y: w.ty - 1 },
      { x: w.tx, y: w.ty + 1 },
    ].filter((n) => this.isWalkable(n.x, n.y));
    if (neigh.length === 0) {
      w.idle = this.time.delayedCall(1500, () => this.walkerStep(w));
      return;
    }
    const onPath = neigh.filter((n) => isPathRing(n.x, n.y));
    const pool = onPath.length > 0 && Math.random() < 0.7 ? onPath : neigh;
    const target = pool[Math.floor(Math.random() * pool.length)] ?? neigh[0]!;
    const { sx, sy } = isoToScreen(target.x, target.y, TILE_W, TILE_H);
    w.vis.scaleX = sx < w.root.x ? -1 : 1;
    w.moveTween = this.tweens.add({
      targets: w.root,
      x: sx,
      y: sy,
      duration: Phaser.Math.Between(2500, 4000),
      ease: 'Sine.inOut',
      onUpdate: () => w.root.setDepth(w.root.y + 0.6),
      onComplete: () => {
        w.tx = target.x;
        w.ty = target.y;
        w.root.setDepth(sy + 0.6);
        w.idle = this.time.delayedCall(Phaser.Math.Between(1000, 3000), () =>
          this.walkerStep(w)
        );
      },
    });
  }

  // ── Butterflies ────────────────────────────────────────────────────────────

  /** One butterfly per ~4 trees (grove/tree buildings + tree sprinkle decor),
   * capped at 5, each looping a lazy figure-eight around its tree. Skipped
   * entirely under reduced motion. */
  private spawnButterflies(): void {
    if (this.reducedMotion) return;
    const trees: Array<{ key: string; sx: number; sy: number }> = [];
    for (const [key] of this.decorImgs) {
      const { x, y } = parseKey(key);
      const d = decorSprinkle(x, y);
      if (d && isTreeDecor(d)) {
        const p = isoToScreen(x, y, TILE_W, TILE_H);
        trees.push({ key, sx: p.sx, sy: p.sy });
      }
    }
    const grid = store.data?.grid ?? {};
    for (const [key, tile] of Object.entries(grid)) {
      if (tile.buildingId === 'grove' || tile.buildingId === 'trees') {
        const { x, y } = parseKey(key);
        const p = isoToScreen(x, y, TILE_W, TILE_H);
        trees.push({ key, sx: p.sx, sy: p.sy });
      }
    }
    const n = Math.min(5, Math.floor(trees.length / 4));
    for (let i = 0; i < n; i++) {
      const t = trees[Math.floor((i / Math.max(1, n)) * trees.length)];
      if (t) this.makeButterfly(i, t.key, t.sx, t.sy);
    }
  }

  private makeButterfly(
    index: number,
    anchorKey: string,
    cx: number,
    cy: number
  ): void {
    if (this.ambientCount() >= AMBIENT_CAP) return;
    const tint = BUTTERFLY_TINT[index % BUTTERFLY_TINT.length] ?? hexNum(PAL.glow);
    const left = this.add.triangle(0, 0, 0, 0, -4, -3, -4, 3, tint);
    const right = this.add.triangle(0, 0, 0, 0, 4, -3, 4, 3, tint);
    const root = this.add.container(cx, cy - 30, [left, right]).setDepth(cy);
    this.ambient?.add(root);
    const bf: Butterfly = { root, anchorKey, path: undefined, flap: undefined };
    this.butterflies.push(bf);

    bf.flap = this.tweens.add({
      targets: root,
      scaleX: 0.3,
      duration: 120,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });
    const state = { t: index * 1.7 };
    const r = 20;
    bf.path = this.tweens.add({
      targets: state,
      t: state.t + Math.PI * 2,
      duration: 6000,
      repeat: -1,
      ease: 'Linear',
      onUpdate: () => {
        root.x = cx + Math.sin(state.t) * r;
        root.y = cy - 30 + Math.sin(state.t * 2) * (r * 0.5);
        root.setDepth(root.y);
      },
    });
  }

  /** Destroy any butterflies anchored to `key` — called alongside clearStructural
   * from both tile-change paths, so a tree tile that gets built over (or a
   * grove/tree building that changes) doesn't leave butterflies circling air. */
  private killButterfliesAt(key: string): void {
    const keep: Butterfly[] = [];
    for (const b of this.butterflies) {
      if (b.anchorKey !== key) {
        keep.push(b);
        continue;
      }
      b.path?.remove();
      b.flap?.remove();
      b.root.destroy();
    }
    this.butterflies = keep;
  }

  // ── Birds ────────────────────────────────────────────────────────────────────

  /** Schedule the next high-flying flock 25–45s out (reschedules itself). */
  private scheduleBirds(): void {
    if (this.reducedMotion) return;
    this.birdTimer = this.time.addEvent({
      delay: Phaser.Math.Between(25000, 45000),
      callback: () => {
        this.spawnFlock();
        this.scheduleBirds();
      },
    });
  }

  private spawnFlock(): void {
    if (this.reducedMotion) return;
    const spanX = (GRID_SIZE - 1) * TILE_W;
    const midY = ((GRID_SIZE - 1) * TILE_H) / 2;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const startX = dir > 0 ? -spanX * 0.8 : spanX * 1.8;
    const endX = dir > 0 ? spanX * 1.8 : -spanX * 0.8;
    const y0 = midY - Phaser.Math.Between(240, 360);
    const flock = Phaser.Math.Between(2, 3);
    for (let i = 0; i < flock; i++) {
      if (this.ambientCount() >= AMBIENT_CAP) break;
      const by = y0 + i * 16;
      const bird = this.add
        .image(startX + i * 24 * dir, by, BIRD_TEX)
        .setTint(hexNum(PAL.ink))
        .setScale(1.3)
        .setFlipX(dir < 0)
        .setDepth(BIRD_DEPTH);
      this.ambient?.add(bird);
      this.tweens.add({
        targets: bird,
        x: endX + i * 24 * dir,
        duration: Phaser.Math.Between(8000, 10000),
        ease: 'Linear',
        onComplete: () => bird.destroy(),
      });
      this.tweens.add({
        targets: bird,
        y: by - 8,
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.inOut',
      });
    }
  }

  // ── Per-building ambient: chimney smoke + working pulse ───────────────────────

  /** Bind smoke (coin buildings) and a subtle work-pulse (any non-decor producer)
   * to a freshly-composed, completed building. Both are torn down in
   * clearStructural when the tile's building changes. */
  private attachTileAmbient(
    view: TileView,
    buildingId: BuildingId,
    x: number,
    y: number,
    sx: number,
    sy: number
  ): void {
    if (this.reducedMotion) return;
    const role = CATALOG[buildingId].role;
    if (role !== 'decor' && view.parts.length > 0) {
      // Start after any completion dust-pop (≈320ms) so the two never fight over
      // the primary sprite's scale; phase is deterministic per tile.
      view.pulseTween = this.tweens.add({
        targets: view.parts,
        scale: { from: 1, to: 1.012 },
        duration: 2400,
        delay: 400 + (this.hash(x, y) % 2000),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.inOut',
      });
    }
    if (SMOKE_BUILDINGS.has(buildingId)) {
      view.smokeTimer = this.time.addEvent({
        delay: Phaser.Math.Between(2500, 4000),
        loop: true,
        callback: () => this.puffSmoke(sx, sy),
      });
    }
  }

  private puffSmoke(sx: number, sy: number): void {
    // Phaser timers keep ticking while the tab is hidden — gate spawns so a
    // backgrounded scene doesn't accumulate a burst of puffs on return.
    if (document.visibilityState !== 'visible') return;
    if (this.ambientCount() >= AMBIENT_CAP) return;
    const oy = sy + BASE_DY + ROOF_DY - 6; // just above the roof cap
    const puff = this.add
      .image(sx + Phaser.Math.Between(-3, 3), oy, SMOKE_TEX)
      .setAlpha(0.5)
      .setScale(0.6)
      .setDepth(sy + 5);
    this.ambient?.add(puff);
    this.tweens.add({
      targets: puff,
      y: oy - 25,
      scale: 1.4,
      alpha: 0,
      duration: 2200,
      ease: 'Sine.out',
      onComplete: () => puff.destroy(),
    });
  }

  /** Tear down every ambient object, timer and tween (called from cleanup). */
  private cleanupAmbient(): void {
    for (const w of this.walkers) {
      w.moveTween?.remove();
      w.bobTween?.remove();
      w.idle?.remove(false);
    }
    for (const b of this.butterflies) {
      b.path?.remove();
      b.flap?.remove();
    }
    this.walkers = [];
    this.butterflies = [];
    this.birdTimer?.remove(false);
    this.birdTimer = undefined;
    // Per-tile smoke/pulse bound in TileViews (not yet torn down by a tile change).
    for (const view of this.views.values()) {
      view.smokeTimer?.remove(false);
      view.smokeTimer = undefined;
      view.pulseTween?.remove();
      view.pulseTween = undefined;
    }
    this.ambient?.clear(true, true);
    this.ambient?.destroy(true);
    this.ambient = undefined;
  }

  // ── Per-frame: construction progress bars + completion pops ──────────────────

  override update(time: number, _delta: number): void {
    if (time - this.lastBarTick < 250) return; // throttle to ~4 Hz
    this.lastBarTick = time;

    const data = store.data;
    if (!data) return;
    const now = this.now();

    for (const [key, view] of this.views) {
      if (!view.constructing) continue;
      const tile = data.grid[key];
      if (!tile || tile.buildingId === undefined) continue;

      if (now >= tile.readyAt) {
        this.syncTile(key, tile);
        const rebuilt = this.views.get(key);
        if (rebuilt?.primary) this.dustPop(rebuilt.primary);
        continue;
      }
      if (view.bar) {
        const span = Math.max(1, tile.readyAt - tile.builtAt);
        const frac = Phaser.Math.Clamp((now - tile.builtAt) / span, 0, 1);
        view.bar.width = BAR_W * frac;
      }
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  private now(): number {
    return store.serverNow();
  }

  private cleanup(): void {
    this.cleanupAmbient();
    this.stopPolling();
    if (this.conn) {
      disconnectRealtime('village');
      this.conn = undefined;
    }
    store.off('change', this.onStoreChange);
    window.removeEventListener(HV_FOCUS_TILE, this.onFocusTile);
    window.removeEventListener(HV_CLEAR_SELECTION, this.onClearSelection);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }
}
