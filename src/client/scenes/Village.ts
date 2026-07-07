import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import { connectRealtime, disconnectRealtime } from '@devvit/web/client';
import type { JsonValue } from '@devvit/web/shared';
import { PAL } from '../../shared/palette';
import { CATALOG, GRID_SIZE } from '../../shared/catalog';
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
import type {
  CityState,
  TileState,
  VillageMessage,
} from '../../shared/types';
import { registerBuildings } from '../art/buildings';
import { registerLandmark } from '../art/landmark';
import { registerTiles, TILE_H, TILE_W } from '../art/tiles';
import { store } from '../state';
import { api } from '../net';
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
const CONFETTI = [
  hexNum(PAL.roofRed),
  hexNum(PAL.roofBlue),
  hexNum(PAL.roofStraw),
  hexNum(PAL.leaf),
  hexNum(PAL.glow),
  hexNum(PAL.accent),
];

const RING_LO = 6;
const RING_HI = 11;

/** True for the one-tile dirt ring orthogonally bordering the plaza block. */
const isPathRing = (x: number, y: number): boolean => {
  const onX = x === RING_LO || x === RING_HI;
  const onY = y === RING_LO || y === RING_HI;
  const spanY = y >= RING_LO && y <= RING_HI;
  const spanX = x >= RING_LO && x <= RING_HI;
  return (onX && spanY) || (onY && spanX);
};

const groundTexture = (x: number, y: number): string => {
  if (isPlaza(x, y)) return 'tile_plaza';
  if (isPathRing(x, y)) return 'tile_path';
  const v = (x * 7 + y * 13) % 17;
  if (v === 3 || v === 12) return 'tile_grass2';
  if (v === 7) return 'tile_grass3';
  return 'tile_grass';
};

// Landmark 2×2 footprint centre + its front (bottom) tile, for depth sorting.
const LANDMARK_CX = ((8 - 8 + (9 - 9)) * TILE_W) / 2; // 0
const LANDMARK_CY = (((8 + 8 + 9 + 9) / 2) * TILE_H) / 2; // avg (x+y)=17 → 408
const LANDMARK_DEPTH = ((9 + 9) * TILE_H) / 2; // front tile (9,9) sy = 432

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
  typeof v.landmarkStage === 'number' &&
  typeof v.stagePlanks === 'number' &&
  typeof v.stageBricks === 'number' &&
  typeof v.totalCollected === 'number' &&
  typeof v.totalContributed === 'number';

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
    // TODO(V4): market + ring messages are accepted here but the renderer does
    // not yet react to them (V4 wires the market board + ring-unlock pan-out).
    case 'market':
      return isRecord(v.prices) && isRecord(v.stockpile);
    case 'ring':
      return isRecord(v.bounds);
    default:
      return false;
  }
};

// ── Per-tile view bookkeeping ───────────────────────────────────────────────

type TileView = {
  building: Phaser.GameObjects.Image | undefined;
  barBg: Phaser.GameObjects.Rectangle | undefined;
  bar: Phaser.GameObjects.Rectangle | undefined;
  claim: Phaser.GameObjects.Image | undefined;
  glow: Phaser.GameObjects.Rectangle | undefined;
  pip: Phaser.GameObjects.Rectangle | undefined;
  sig: string;
  constructing: boolean;
};

const BAR_W = 48;
const BAR_H = 4;
const EFFECT_DEPTH = 100000;

export class Village extends Scene {
  private views: Map<string, TileView> = new Map();
  private highlight: Phaser.GameObjects.Image | undefined;
  private landmark: Phaser.GameObjects.Image | undefined;
  private conn: ReturnType<typeof connectRealtime> | undefined;
  private me: string | null = null;

  private pollTimer: number | null = null;
  private lastBarTick = 0;
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
    this.cameras.main.setBackgroundColor(PAL.night);

    // Defensive: art is registered in Preloader, but starting Village directly
    // (e.g. a scene restart before Preloader) should still work. Idempotent —
    // drawPixelTexture early-returns for textures that already exist.
    if (!this.textures.exists('tile_grass')) {
      registerTiles(this);
      registerBuildings(this);
      registerLandmark(this);
    }

    this.loading = this.add
      .text(this.scale.width / 2, this.scale.height / 2, 'Loading village…', {
        fontFamily: 'monospace',
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

    // Selection highlight (hidden until a tile is tapped).
    this.highlight = this.add
      .image(0, 0, 'tile_highlight')
      .setOrigin(0.5)
      .setDepth(3)
      .setVisible(false);

    this.reconcileAll();
    this.updatePips();

    this.setupCamera();
    this.setupInput();
    this.setupDomBridge();
    this.setupRealtime();

    // The 'change' subscription (→ ensureWorld → reconcileAll once built) is
    // registered in create(), so it also catches the recover-after-outage case.

    this.time.addEvent({
      delay: 2000,
      loop: true,
      callback: () => this.updatePips(),
    });
  }

  private buildGround(): void {
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const { sx, sy } = isoToScreen(x, y, TILE_W, TILE_H);
        this.add.image(sx, sy, groundTexture(x, y)).setOrigin(0.5).setDepth(0);
      }
    }
  }

  private buildLandmark(): void {
    const stage = store.data?.city.landmarkStage ?? 0;
    this.landmark = this.add
      .image(LANDMARK_CX, LANDMARK_CY + TILE_H / 2, `landmark_${stage}`)
      .setOrigin(0.5, 1)
      .setDepth(LANDMARK_DEPTH);
  }

  private updateLandmark(): void {
    const stage = store.data?.city.landmarkStage ?? 0;
    this.landmark?.setTexture(`landmark_${stage}`);
  }

  // ── Incremental reconciliation ────────────────────────────────────────────

  private reconcileAll(): void {
    const data = store.data;
    if (!data) return;
    // Add / update tiles present in the grid.
    for (const [key, tile] of Object.entries(data.grid)) {
      this.syncTile(key, tile);
    }
    // Remove views whose tile vanished (rare — tiles are not usually deleted).
    for (const key of [...this.views.keys()]) {
      if (!data.grid[key]) {
        this.destroyView(key);
      }
    }
  }

  private syncTile(key: string, tile: TileState): void {
    const { x, y } = parseKey(key);
    const { sx, sy } = isoToScreen(x, y, TILE_W, TILE_H);

    let view = this.views.get(key);
    if (!view) {
      view = {
        building: undefined,
        barBg: undefined,
        bar: undefined,
        claim: undefined,
        glow: undefined,
        pip: undefined,
        sig: '',
        constructing: false,
      };
      this.views.set(key, view);
    }

    const mine = tile.owner === this.me;
    const hasBuilding = tile.buildingId !== undefined;
    const constructing = hasBuilding && this.now() < tile.readyAt;
    const sig = `${tile.buildingId ?? '-'}|${tile.tier}|${constructing ? 'c' : 'd'}|${mine ? 'm' : 'o'}`;

    if (sig !== view.sig) {
      this.clearStructural(view);

      if (tile.buildingId !== undefined) {
        const texKey = constructing
          ? 'bld_construction'
          : `bld_${tile.buildingId}_${tile.tier}`;
        view.building = this.add
          .image(sx, sy + TILE_H / 2, texKey)
          .setOrigin(0.5, 1)
          .setDepth(sy);

        if (constructing) {
          view.barBg = this.add
            .rectangle(sx, sy - TILE_H, BAR_W + 2, BAR_H + 2, C_INK)
            .setDepth(sy + 1);
          view.bar = this.add
            .rectangle(sx - BAR_W / 2, sy - TILE_H, BAR_W, BAR_H, C_GLOW)
            .setOrigin(0, 0.5)
            .setDepth(sy + 2);
        }
      } else {
        // Claimed but empty — subtle claim outline.
        view.claim = this.add
          .image(sx, sy, 'tile_claim')
          .setOrigin(0.5)
          .setDepth(1);
      }

      // Own-tile finder glow (small pulsing pip near the tile corner).
      if (mine && !view.glow) {
        view.glow = this.add
          .rectangle(sx - TILE_W * 0.26, sy + TILE_H * 0.14, 6, 6, C_GLOW)
          .setDepth(sy + 3)
          .setAlpha(0.85);
        this.tweens.add({
          targets: view.glow,
          alpha: 0.35,
          duration: 900,
          yoyo: true,
          repeat: -1,
        });
      } else if (!mine && view.glow) {
        this.tweens.killTweensOf(view.glow);
        view.glow.destroy();
        view.glow = undefined;
      }

      view.constructing = constructing;
      view.sig = sig;
    }
  }

  private clearStructural(view: TileView): void {
    view.building?.destroy();
    view.barBg?.destroy();
    view.bar?.destroy();
    view.claim?.destroy();
    view.building = undefined;
    view.barBg = undefined;
    view.bar = undefined;
    view.claim = undefined;
  }

  private destroyView(key: string): void {
    const view = this.views.get(key);
    if (!view) return;
    this.clearStructural(view);
    if (view.glow) {
      this.tweens.killTweensOf(view.glow);
      view.glow.destroy();
    }
    if (view.pip) {
      this.tweens.killTweensOf(view.pip);
      view.pip.destroy();
    }
    this.views.delete(key);
  }

  // ── Pending-production pips ────────────────────────────────────────────────

  private updatePips(): void {
    const data = store.data;
    if (!data) return;
    const now = this.now();
    const fest = data.city.festival;

    for (const [key, tile] of Object.entries(data.grid)) {
      const view = this.views.get(key);
      if (!view) continue;

      let show = false;
      if (tile.owner === this.me && tile.buildingId !== undefined && now >= tile.readyAt) {
        const { x, y } = parseKey(key);
        const adj = adjacencyBonus(data.grid, x, y, fest, now);
        // TODO(V4): thread the real stockpile in for accurate processor pips.
        const { gained } = accrue(tile, now, fest, adj, data.city.weather, emptyStockpile());
        show = gained.coins + goodsTotal(gained.goods) > 0;
      }

      if (show && !view.pip) {
        const { x, y } = parseKey(key);
        const { sx, sy } = isoToScreen(x, y, TILE_W, TILE_H);
        const pip = this.add
          .rectangle(sx, sy - TILE_H * 0.95, 6, 6, C_ACCENT)
          .setDepth(sy + 500);
        this.tweens.add({
          targets: pip,
          y: sy - TILE_H * 0.95 - 6,
          duration: 620,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.inOut',
        });
        view.pip = pip;
      } else if (!show && view.pip) {
        this.tweens.killTweensOf(view.pip);
        view.pip.destroy();
        view.pip = undefined;
      }
    }
  }

  // ── Camera ─────────────────────────────────────────────────────────────────

  private setupCamera(): void {
    const cam = this.cameras.main;
    const half = TILE_W;
    const spanX = (GRID_SIZE - 1) * TILE_W; // full horizontal extent
    cam.setBounds(
      -spanX / 2 - half,
      -220,
      spanX + half * 2,
      (GRID_SIZE - 1) * TILE_H + 340
    );
    cam.setZoom(1);

    // Centre on the player's first owned tile, else the plaza centre.
    let cx = 0;
    let cy = LANDMARK_CY;
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

    const key = tileKey(x, y);
    const tile = data.grid[key] ?? null;
    const mine = tile !== null && tile.owner === this.me;
    const claimable = isClaimable(x, y) && tile === null;

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
    this.highlight.setPosition(sx, sy).setVisible(true);
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
          if (view?.building) this.dustPop(view.building);
          this.floatLabel(msg.key, CATALOG[bid].name);
        }
        break;
      }
      case 'city': {
        store.patchCity(msg.city);
        this.updateLandmark();
        break;
      }
      case 'stage': {
        const cur = store.data?.city;
        if (cur) {
          const next: CityState = { ...cur, landmarkStage: msg.stage };
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
    }
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
        .rectangle(sx, oy, 6, 6, C_GLOW)
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
    const cx = LANDMARK_CX;
    const cy = LANDMARK_CY - TILE_H * 2;
    for (let i = 0; i < 12; i++) {
      const color = CONFETTI[i % CONFETTI.length] ?? C_GLOW;
      const bit = this.add
        .rectangle(
          cx + Phaser.Math.Between(-40, 40),
          cy,
          5,
          5,
          color
        )
        .setDepth(EFFECT_DEPTH);
      this.tweens.add({
        targets: bit,
        y: cy + Phaser.Math.Between(60, 130),
        x: bit.x + Phaser.Math.Between(-24, 24),
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
        fontFamily: 'monospace',
        fontSize: '11px',
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
        if (rebuilt?.building) this.dustPop(rebuilt.building);
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
