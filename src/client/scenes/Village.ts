import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import { connectRealtime, disconnectRealtime } from '@devvit/web/client';
import type { JsonValue } from '@devvit/web/shared';
import { PAL } from '../../shared/palette';
import {
  CATALOG,
  CREST_EMBLEMS,
  GRID_SIZE,
  MURAL_H,
  MURAL_PALETTE,
  MURAL_W,
  defaultOutfit,
  tierStats,
} from '../../shared/catalog';
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
  isGoldenWindow,
} from '../../shared/logic/economy';
import { isRiver, ringBounds } from '../../shared/logic/expansion';
import type {
  BuildingId,
  CityState,
  TileState,
  VillageMessage,
  VillageTheme,
} from '../../shared/types';
import {
  BUILDING_ART,
  CREST_TOWER,
  ROOF_SHAPE,
  houseStyle,
  roofKeyFor,
} from '../art/manifest';
import { buildBuildingAccents } from '../art/accents';
import type { SpriteKey } from '../art/manifest';
import type { Cluster } from '../art/render';
import {
  addBlock,
  addSurface,
  addWell,
  backgroundIslets,
  backgroundStars,
  BASE_DY,
  BG,
  BLOCK_ORIGIN_Y,
  BLOCK_TOP_CENTER_Y,
  IMG_H,
  castleParts,
  CASTLE_TOP_DY,
  decorAt,
  isKeepPad,
  isPathRing,
  isTreeDecor,
  LOCKED_BAND,
  MONUMENT_ART,
  networkPathPiece,
  PATH_HI,
  PATH_LO,
  pathNetwork,
  pathPiece,
  rimPiece,
  riverPieceAt,
  ROOF_DY,
  THEMES,
  themedKey,
  themeFamily,
  TILE_H,
  TILE_W,
  treeClusters,
  WELL_TILE,
} from '../art/render';
import { monuments } from '../../shared/logic/monuments';
import type { PlacedMonument } from '../../shared/logic/monuments';
import { store } from '../state';
import { api } from '../net';
import { toast } from '../ui/dom';
import { openMuralSheet } from '../ui/mural';
import type { HvTileSelected } from '../events';
import {
  HV_CLEAR_SELECTION,
  HV_FOCUS_TILE,
  HV_TILE_SELECTED,
  requestCollapseObjectives,
  setHighlightTiles,
  setTileToScreen,
} from '../events';

// ── Small helpers ───────────────────────────────────────────────────────────

/** '#rrggbb' → 0xrrggbb for Phaser's numeric colour parameters. */
const hexNum = (hex: string): number => parseInt(hex.replace('#', ''), 16);

/** '#rrggbb' + alpha → a CSS `rgba(...)` string (for the vignette gradient). */
const rgbaOf = (hex: string, a: number): string => {
  const n = hexNum(hex);
  return `rgba(${(n >> 16) & 0xff},${(n >> 8) & 0xff},${n & 0xff},${a})`;
};

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

/** The plaza-ring tile the Village Mural board stands on — the NE corner of the
 * ring, opposite the well (which sits at the SW corner [7,10]). Always unlocked,
 * never claimable, so tapping it always opens the mural (see handleTap). */
const MURAL_TILE = { x: 10, y: 7 };
/** Screen pixels per mural pixel on the world board (4× → a 96×64 canvas). */
const MURAL_SCALE = 4;
/** The live mural-board canvas texture key. */
const MURAL_TEX = 'hv-mural-board';
/** The plaza-ring tile the crest standard stands on (H1): the front-right corner
 * of the ring — beside the Hall, in front so it's never occluded by the growing
 * keep, and clear of the well (SW) and mural (NE). */
const CREST_TILE = { x: 10, y: 10 };

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
    case 'mural':
      return (
        typeof v.x === 'number' &&
        typeof v.y === 'number' &&
        typeof v.c === 'number'
      );
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
  /** Perfect-Harvest golden sparkle (S2): pre-created alongside the ready pip and
   * toggled visible during the tile's golden window by a light 300ms timer, so the
   * window's sub-2s resolution costs zero per-frame object churn. */
  sparkle: Phaser.GameObjects.Image | undefined;
  boostPip: Phaser.GameObjects.Image | undefined;
  growthKey: SpriteKey | undefined;
  /** Wheatfield growth-stage base plate (E2): a drawn top-face progress ring under
   * the furrow that fills as the crop ripens (dirt → half-grown → ready). Drawn
   * rather than sprited — the Kenney Isometric Miniature Bases pack shipped with
   * no PNGs, so per deliverable 4's documented fallback this is a vector plate. */
  cropBase: Phaser.GameObjects.Graphics | undefined;
  /** Ambient (C2): chimney-smoke timer + "alive" work-pulse tween, both bound to
   * this tile's building and torn down in clearStructural when the tile changes. */
  smokeTimer: Phaser.Time.TimerEvent | undefined;
  pulseTween: Phaser.Tweens.Tween | undefined;
  /** E3: the building's distinct drawn accents (windmill sails, kiln ember, saw
   * blade, awning, balcony/hedges, quarry pit, house tier trim) + their motion
   * tweens (blade/saw spin, ember pulse). Destroyed together in clearStructural. */
  accents: Phaser.GameObjects.GameObject[];
  accentTweens: Phaser.Tweens.Tween[];
  sig: string;
  constructing: boolean;
};

const BAR_W = 60;
const BAR_H = 5;
const EFFECT_DEPTH = 100000;
const PIP_DEPTH = 50000;
/** Drifting cloud shadows sit above the diorama but below pips/effects. */
const CLOUD_DEPTH = 40000;
/**
 * Ground base depth (Task F1 walker-depth fix): every ground + locked-band block
 * renders at GROUND_DEPTH + sy — an explicitly LOW band (≈ −100000…−98900) far
 * beneath every dynamic object, while the +sy term keeps ground-vs-ground
 * occlusion correct even when single tiles are repainted out of insertion order
 * (ring unlock / theme change). Buildings, decor, walkers, smoke, butterflies
 * and pips all keep their non-negative sy-based depths (sy ≥ 0 everywhere on the
 * grid), so no ground tile can ever draw over a walker anywhere on the map. The
 * void background layers sit lower still.
 */
const GROUND_DEPTH = -100000;
/** Floating background islets: behind the island (ground), above the starfield. */
const ISLET_DEPTH = -300000;
/** Sparse starfield behind the islets. */
const STAR_DEPTH = -400000;
/** The radial vignette sits at the very back of everything. */
const VIGNETTE_DEPTH = -410000;

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
/** The eight outfit cloth colours (mirrors catalog OUTFIT_HEX order, so a walker's
 * `variant` IS its owner's outfit index — the swatch and the shirt match). */
const WALKER_CLOTH: readonly number[] = [
  hexNum(PAL.roofRed),
  hexNum(PAL.roofBlue),
  hexNum(PAL.roofStraw),
  hexNum(PAL.leaf),
  hexNum(PAL.accent),
  hexNum(PAL.wood),
  hexNum(PAL.roofPurple),
  hexNum(PAL.water),
];
/** Three warm skin tones for villager faces. */
const WALKER_SKIN: readonly number[] = [0xf1c9a5, 0xe0a878, 0xc08552];
/** Four hair colours (drawn as a cap over the head). */
const WALKER_HAIR: readonly number[] = [0x4a3728, 0x2b2b2b, 0xcaa15a, 0x7a4a2b];
/** Number of pre-baked villager texture variants (a cloth×skin×hair combo each). */
const VILLAGER_VARIANTS = 8;
/** Villager sprite footprint (px) fed to generateTexture. */
const VILLAGER_W = 16;
const VILLAGER_H = 22;
/** Gait cadence: swap between the idle + step frame this often while moving. */
const GAIT_MS = 180;
/** Hard ceiling on live strolling villagers. */
const MAX_WALKERS = 12;

/** Darken a 0xRRGGBB colour by a factor (for the two-tone shirt hem). */
const shade = (color: number, f: number): number => {
  const r = Math.round(((color >> 16) & 0xff) * f);
  const g = Math.round(((color >> 8) & 0xff) * f);
  const b = Math.round((color & 0xff) * f);
  return (r << 16) | (g << 8) | b;
};
/** Butterfly wing tints (PAL glow / accent / roofBlue). */
const BUTTERFLY_TINT: readonly number[] = [
  hexNum(PAL.glow),
  hexNum(PAL.accent),
  hexNum(PAL.roofBlue),
];
/** Buildings that puff chimney smoke (producing coin buildings). */
const SMOKE_BUILDINGS: ReadonlySet<string> = new Set(['house', 'bakery', 'manor']);

/** A strolling villager: a `root` container carries screen position + depth (and
 * a soft shadow), while an inner `vis` container holds the character sprite and
 * bobs/flips independently of the path travel. The `body` image swaps between the
 * variant's idle + step textures for a 2-frame walk gait. */
type Walker = {
  root: Phaser.GameObjects.Container;
  vis: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Image;
  variant: number;
  frame: 0 | 1;
  tx: number;
  ty: number;
  moveTween: Phaser.Tweens.Tween | undefined;
  bobTween: Phaser.Tweens.Tween | undefined;
  idle: Phaser.Time.TimerEvent | undefined;
  gait: Phaser.Time.TimerEvent | undefined;
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
  /** The live Village Mural board on the plaza ring (frame, posts, canvas). */
  private muralParts: Phaser.GameObjects.GameObject[] = [];
  private muralBoard: Phaser.GameObjects.Image | undefined;
  /** The village crest pennant flying on the Hall (pole, flag, emblem). */
  private crestParts: Phaser.GameObjects.GameObject[] = [];
  private clouds: Phaser.GameObjects.Ellipse[] = [];
  /** Void background (F1): vignette + floating islets + starfield. Their bob /
   * twinkle tweens target these objects, so killing tweens of each on cleanup
   * leaves nothing orphaned. */
  private bgParts: Phaser.GameObjects.GameObject[] = [];
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
  /** Walkthrough candidate-tile highlights: pulsing top-face diamonds drawn over
   * a set of open tiles ("tap any of these — your choice"). */
  private tileHints: Phaser.GameObjects.Graphics | undefined;
  private tileHintTween: Phaser.Tweens.Tween | undefined;
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

    this.buildBackground();
    this.buildGround();
    this.buildLandmark();
    this.buildDressing();
    this.buildMural();
    this.updateCrest();
    this.buildClouds();
    // Ambient group + shared textures must exist before reconcileAll(), since
    // buildBuilding() attaches per-building smoke/pulse as tiles are composed.
    this.initAmbient();

    // Selection highlight (a glowing top-face diamond, hidden until a tile is tapped).
    this.highlight = this.add
      .graphics()
      .setDepth(PIP_DEPTH - 1)
      .setVisible(false);

    // Walkthrough candidate-tile highlights: a separate graphics layer that
    // pulses (alpha yoyo) over the "your choice" open tiles.
    this.tileHints = this.add
      .graphics()
      .setDepth(PIP_DEPTH - 2)
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
    // Golden-window sparkles need finer resolution than the 2s pip timer to catch
    // a 1.8s window — a cheap 300ms visibility sweep over ready tiles.
    this.time.addEvent({
      delay: 300,
      loop: true,
      callback: () => this.updateSparkles(),
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

  /** The stable per-village terrain seed (city.foundedAt): identical for every
   * viewer of this village, unique per subreddit install, and never changes
   * mid-session — so the generated landscape is stable and shared. */
  private seed(): number {
    return store.data?.city.foundedAt ?? 0;
  }

  /** Seeded composed-landscape features (path network + tree clusters), computed
   * once per seed and cached — consulted by every ground repaint and by walker
   * path preference. */
  private landscapeCache:
    | {
        seed: number;
        network: ReadonlySet<string>;
        clusters: Cluster[];
        monuments: PlacedMonument[];
        monumentTiles: ReadonlySet<string>;
      }
    | undefined;

  private landscape(): {
    network: ReadonlySet<string>;
    clusters: Cluster[];
    monuments: PlacedMonument[];
    monumentTiles: ReadonlySet<string>;
  } {
    const seed = this.seed();
    if (!this.landscapeCache || this.landscapeCache.seed !== seed) {
      const placed = monuments(seed);
      this.landscapeCache = {
        seed,
        network: pathNetwork(seed),
        clusters: treeClusters(seed),
        monuments: placed,
        monumentTiles: new Set(
          placed.flatMap((m) => m.tiles.map((t) => tileKey(t.x, t.y)))
        ),
      };
    }
    return this.landscapeCache;
  }

  /** Sprites making up the seeded monuments, destroyed + rebuilt on a biome swap. */
  private monumentImgs: Phaser.GameObjects.Image[] = [];

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
    this.buildMonuments();
  }

  /**
   * (Re)draw the seeded monuments — pre-built set pieces (ruined towers, stone
   * circles, homesteads, gates, orchards, camps) scattered on non-claimable
   * clusters. Their tiles + placement come from shared logic (so claim
   * validation matches); the sprite composition per biome comes from
   * MONUMENT_ART. Rebuilt on a theme change so the desert swaps to its sand
   * variants. Each piece depth-sorts by its own tile row like any structure.
   */
  private buildMonuments(): void {
    for (const img of this.monumentImgs) img.destroy();
    this.monumentImgs = [];
    const family = themeFamily(this.theme());
    const { monuments: placed } = this.landscape();
    for (const m of placed) {
      for (const piece of MONUMENT_ART[m.template.id][family]) {
        const { sx, sy } = isoToScreen(m.x + piece.dx, m.y + piece.dy, TILE_W, TILE_H);
        const dy = piece.layer === 'cap' ? BASE_DY + ROOF_DY : BASE_DY;
        const depthBoost = piece.layer === 'cap' ? 2 : piece.layer === 'base' ? 1 : 0.5;
        const img = addBlock(this, piece.key, sx, sy, dy).setFlipX(piece.flipX ?? false);
        img.setDepth(sy + depthBoost);
        if (piece.angle !== undefined) img.setAngle(piece.angle);
        if (piece.tint !== undefined) img.setTint(piece.tint);
        this.monumentImgs.push(img);
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
    // The biome family may have changed (e.g. meadow → desert) — re-skin the
    // monuments to match so the world re-paints coherently, not just the ground.
    this.buildMonuments();
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
    const theme = this.theme();
    const style = THEMES[theme];
    const family = themeFamily(theme);
    // In the desert biome the whole terrain/decor family swaps to the sand set;
    // grass themes keep their sprites (recoloured by the per-theme tints below).
    const sk = (key: SpriteKey): SpriteKey => themedKey(family, key);
    let img: Phaser.GameObjects.Image;

    const { network, clusters, monumentTiles } = this.landscape();

    if (!this.isUnlockedTile(x, y)) {
      // Locked land: a desaturated frontier band, the SAME grass block as the
      // playfield laid dead flat and flush against the unlocked edge, so it reads
      // as one contiguous island whose darkened rim falls away to the void (never
      // as detached floating blocks). A per-distance alpha ramp gives the falloff.
      // Deeper locked tiles / dropped corners render as background void; the band
      // is non-interactive, so this cosmetic treatment can't skew hit-testing.
      const { lo, hi } = this.ringLoHi();
      const rim = rimPiece(this.seed(), x, y, lo, hi);
      if (!rim) return undefined;
      img = addBlock(this, sk(rim.key), sx, sy, rim.dy)
        .setFlipX(rim.flipX)
        .setAlpha(rim.alpha)
        .setTint(style.lockedTint);
      if (rim.accent) {
        const acc = addBlock(this, sk(rim.accent), sx, sy, rim.accentDy)
          .setAlpha(rim.alpha)
          .setTint(style.lockedTint)
          .setDepth(GROUND_DEPTH + sy + 0.5);
        this.decorImgs.set(key, acc);
      }
    } else if (isRiver(x, y)) {
      // Rivers untinted — water stays readable across themes. Bridged where the
      // path network crosses; a waterfall block at the southern drop.
      const p = riverPieceAt(network, x, y);
      img = addBlock(this, sk(p.key), sx, sy).setFlipX(p.flipX);
    } else if (isKeepPad(x, y)) {
      // Dirt only under the keep 2×2 — the rest of the plaza square is grass.
      img = addBlock(this, sk('dirt-center'), sx, sy);
      if (style.dirtTint !== undefined) img.setTint(style.dirtTint);
    } else if (isPathRing(x, y)) {
      // Paths untinted — kept readable per the theme spec.
      const p = pathPiece(x, y);
      img = addBlock(this, sk(p.key), sx, sy).setFlipX(p.flipX);
    } else if (network.has(key)) {
      // Seeded path network: winding roads radiating from the plaza ring to the
      // map edges. Cosmetic — the tile stays claimable and buildings sit on it.
      const p = networkPathPiece(network, x, y);
      img = addBlock(this, sk(p.key), sx, sy).setFlipX(p.flipX);
    } else {
      // Open grass with COMPOSED decor: dense seeded tree clusters, rocks along
      // the wild frame, sparse lone trees elsewhere (~4%). Monument tiles paint
      // bare ground here — their set-piece sprites are drawn separately (and the
      // loose decor sprinkle is suppressed so nothing overlaps them).
      const open =
        store.data?.grid[key] === undefined &&
        !isPlaza(x, y) &&
        !monumentTiles.has(key);
      img = addBlock(this, sk('grass-center'), sx, sy);
      if (style.grassTint !== undefined) img.setTint(style.grassTint);
      if (open) {
        const d = decorAt(this.seed(), clusters, x, y);
        if (d) {
          const sprite = addSurface(this, sk(d), sx, sy).setDepth(sy + 0.5);
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

    // All ground (open tiles AND raised locked-band blocks) sits in the low
    // ground band: far beneath every dynamic object, still self-ordered by sy so
    // out-of-order repaints (ring unlock) can't break block-wall occlusion.
    img.setDepth(GROUND_DEPTH + sy);
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
      const dy = (part.roof ? BASE_DY + CASTLE_TOP_DY : BASE_DY) - part.lift;
      const img = addBlock(this, part.key, sx, sy, dy);
      // Depth: a constant CASTLE_DEPTH_BOOST (≈1.5 iso rows) plus the part's own
      // pixel lift, added to sy. The constant is uniform across every castle
      // part, so the keep's internal stacking (base<cap<elevated) is preserved,
      // while the boost lifts the whole monument above ambient villagers standing
      // on the plaza ring that hugs it — a walker on an adjacent path tile can no
      // longer draw over the castle wall (Task F8). Genuine buildings sit ≥2
      // tiles out (rows the boost can't reach) so they still occlude correctly.
      const CASTLE_DEPTH_BOOST = TILE_H * 0.75;
      const depthOffset = (part.roof ? 2 : 1) + part.lift;
      img.setDepth(sy + CASTLE_DEPTH_BOOST + depthOffset);
      if (part.tint !== undefined) img.setTint(part.tint);
      this.landmarkParts.push(img);
    }
  }

  private updateLandmark(): void {
    this.renderCastle();
    this.updateCrest();
  }

  // ── World dressing (well, drifting cloud shadows) ────────────────────────────

  /** Static plaza dressing: a single corner well (fences removed — see render.ts).
   * The plaza tile it stands on is always unlocked and never takes a building, so
   * this is built once and never reconciled. */
  private buildDressing(): void {
    const w = isoToScreen(WELL_TILE.x, WELL_TILE.y, TILE_W, TILE_H);
    this.dressingParts.push(addWell(this, w.sx, w.sy).setDepth(w.sy + 0.4));
  }

  // ── Village Mural board (E1) ─────────────────────────────────────────────────

  /** (Re)draw the live mural into its canvas texture: each of the 24×16 pixels is
   * a MURAL_SCALE-square block, parchment where a pixel is unset. Creates the
   * texture on first call, then refreshes it in place so the board image updates
   * without being rebuilt. */
  private drawMuralTexture(): void {
    const w = MURAL_W * MURAL_SCALE;
    const h = MURAL_H * MURAL_SCALE;
    let canvasTex: Phaser.Textures.CanvasTexture | null;
    if (this.textures.exists(MURAL_TEX)) {
      const existing = this.textures.get(MURAL_TEX);
      canvasTex =
        existing instanceof Phaser.Textures.CanvasTexture ? existing : null;
    } else {
      canvasTex = this.textures.createCanvas(MURAL_TEX, w, h);
    }
    if (!canvasTex) return;
    const ctx = canvasTex.getContext();
    if (!ctx) return;
    const mural = store.data?.mural ?? {};
    for (let y = 0; y < MURAL_H; y += 1) {
      for (let x = 0; x < MURAL_W; x += 1) {
        const c = mural[`${x},${y}`] ?? 0;
        ctx.fillStyle = MURAL_PALETTE[c] ?? MURAL_PALETTE[0] ?? '#fff3d9';
        ctx.fillRect(x * MURAL_SCALE, y * MURAL_SCALE, MURAL_SCALE, MURAL_SCALE);
      }
    }
    canvasTex.refresh();
  }

  /** Build the mural board once: an ink frame, two wooden posts, and the live
   * canvas texture on top — anchored on the plaza ring and depth-sorted like a
   * building so villagers pass in front of / behind it correctly. */
  private buildMural(): void {
    for (const p of this.muralParts) p.destroy();
    this.muralParts = [];
    this.drawMuralTexture();

    const { sx, sy } = isoToScreen(MURAL_TILE.x, MURAL_TILE.y, TILE_W, TILE_H);
    const boardW = MURAL_W * MURAL_SCALE; // 96
    const boardH = MURAL_H * MURAL_SCALE; // 64
    const postH = 26;
    const surfaceY = sy + BASE_DY; // the tile's top face
    const boardBottom = surfaceY - postH;
    const boardCx = sx;
    const boardCy = boardBottom - boardH / 2;
    const depth = sy + 8;

    // Two wooden posts holding the frame up.
    for (const dx of [-(boardW / 2) + 5, boardW / 2 - 5]) {
      const post = this.add
        .rectangle(boardCx + dx, boardBottom - postH / 2 + postH, 6, postH * 2, hexNum(PAL.woodDark))
        .setDepth(depth);
      this.muralParts.push(post);
    }
    // Ink frame (a filled rounded rect a few px larger than the canvas).
    const frame = this.add
      .rectangle(boardCx, boardCy, boardW + 8, boardH + 8, C_INK)
      .setDepth(depth + 0.1);
    this.muralParts.push(frame);
    // A parchment mat inside the frame, then the live canvas on top.
    const mat = this.add
      .rectangle(boardCx, boardCy, boardW + 2, boardH + 2, C_CREAM)
      .setDepth(depth + 0.2);
    this.muralParts.push(mat);
    const board = this.add.image(boardCx, boardCy, MURAL_TEX).setDepth(depth + 0.3);
    this.muralBoard = board;
    this.muralParts.push(board);
  }

  /** Refresh the mural board's texture in place (after a paint or full state). */
  private refreshMural(): void {
    if (!this.muralBoard) return;
    this.drawMuralTexture();
  }

  // ── Village crest pennant (E1) ───────────────────────────────────────────────

  /** (Re)build the village crest STANDARD on the plaza (H1 crest flag v2): a
   * carved stone pedestal (bases pack) with the pack's own colored crest tower
   * (Sand/Rustic/Forest/Royal → Beige/Brown/Green/Purple) standing on it as the
   * heraldic flag element — 100% pack art, replacing the old drawn pennant. The
   * mod-chosen emblem still flies as a small cream icon banner on the tower. Sits
   * beside the Hall on the plaza front corner and depth-sorts like a building. */
  private updateCrest(): void {
    for (const p of this.crestParts) p.destroy();
    this.crestParts = [];
    const city = store.data?.city;
    if (!city) return;

    const towerKey = CREST_TOWER[city.crestColor] ?? CREST_TOWER[0]!;
    const emblem = CREST_EMBLEMS[city.crest] ?? CREST_EMBLEMS[0];
    const { sx, sy } = isoToScreen(CREST_TILE.x, CREST_TILE.y, TILE_W, TILE_H);

    // Stone pedestal: the tall bases-pack plate, raised so its top face meets the
    // crest tower's foot (they nest as a single standard).
    const pedestal = this.add
      .image(sx, sy - 15, 'base-stone-detail')
      .setOrigin(0.5, 0.72)
      .setScale(0.72)
      .setDepth(sy + 4);
    this.crestParts.push(pedestal);

    // The colored crest tower standing ON the pedestal (Sketch Town geometry, so
    // it aligns with addSurface); scaled down so it reads as a standard, not a
    // second keep, and nudged down to seat on the plate.
    const tower = addSurface(this, towerKey, sx, sy)
      .setScale(0.56)
      .setY(sy + BASE_DY + 8)
      .setDepth(sy + 5);
    this.crestParts.push(tower);

    // Small cream emblem banner on the tower body — the mod's chosen device.
    if (emblem) {
      const icon = this.add
        .image(sx, sy + BASE_DY - 6, emblem.icon)
        .setDisplaySize(11, 11)
        .setTint(C_CREAM)
        .setDepth(sy + 5.1);
      this.crestParts.push(icon);
    }
  }

  // ── Void background (floating islets + starfield + vignette) ─────────────────

  /** Fill the flat dark-purple void around the island with a "floating world":
   * a soft radial vignette that spot-lights the island, a sparse twinkling
   * starfield, and a handful of slowly-bobbing background islets. All seeded from
   * the same city.foundedAt as the terrain, parked well outside the map bounds,
   * and pinned behind every gameplay depth. Static under reduced motion. */
  private buildBackground(): void {
    const seed = this.seed();
    this.buildVignette();

    for (const isl of backgroundIslets(seed)) {
      const ground = this.add
        .image(0, 0, isl.ground)
        .setOrigin(0.5, BLOCK_ORIGIN_Y);
      const decor = this.add
        .image(0, BASE_DY, isl.decor)
        .setOrigin(0.5, BLOCK_ORIGIN_Y);
      const cont = this.add
        .container(isl.sx, isl.sy, [ground, decor])
        .setScale(isl.scale)
        .setAlpha(isl.alpha)
        .setDepth(ISLET_DEPTH);
      this.bgParts.push(cont);
      if (this.reducedMotion) continue;
      this.tweens.add({
        targets: cont,
        y: isl.sy - isl.bobDy,
        duration: isl.bobDur,
        delay: isl.phase,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.inOut',
      });
    }

    for (const st of backgroundStars(seed)) {
      const tint = st.twinkle ? C_GLOW : C_CREAM;
      const dot = this.add
        .circle(st.sx, st.sy, 1, tint)
        .setAlpha(st.alpha)
        .setDepth(STAR_DEPTH);
      this.bgParts.push(dot);
      if (st.twinkle && !this.reducedMotion) {
        this.tweens.add({
          targets: dot,
          alpha: st.alpha * 0.35,
          duration: Phaser.Math.Between(1600, 2800),
          delay: Phaser.Math.Between(0, 1800),
          yoyo: true,
          repeat: -1,
          ease: 'Sine.inOut',
        });
      }
    }
  }

  /** A large soft-edged radial gradient (generated once into a canvas texture):
   * transparent at the centre, fading to dark at the rim, so the island reads
   * spot-lit against the surrounding void. */
  private buildVignette(): void {
    const key = 'hv-vignette';
    if (!this.textures.exists(key)) {
      const size = 512;
      const tex = this.textures.createCanvas(key, size, size);
      if (tex) {
        const ctx = tex.getContext();
        const grd = ctx.createRadialGradient(
          size / 2,
          size / 2,
          size * 0.14,
          size / 2,
          size / 2,
          size * 0.5
        );
        grd.addColorStop(0, rgbaOf(PAL.night, 0));
        grd.addColorStop(0.65, rgbaOf(PAL.night, 0));
        grd.addColorStop(1, rgbaOf(PAL.night, 0.62));
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, size, size);
        tex.refresh();
      }
    }
    const v = this.add
      .image(KEEP_CX, KEEP_CY, key)
      .setDepth(VIGNETTE_DEPTH);
    v.setDisplaySize(3800, 2700);
    this.bgParts.push(v);
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
    // The mural + crest can change via a paint/broadcast or a dropped realtime
    // message — refresh both from the current snapshot (idempotent).
    this.refreshMural();
    this.updateCrest();
    for (const [key, tile] of Object.entries(data.grid)) {
      this.syncTile(key, tile);
    }
    for (const key of [...this.views.keys()]) {
      if (!data.grid[key]) {
        this.destroyView(key);
      }
    }
    // Keep the villager headcount in step with the population (house count),
    // spawning/despawning only on an actual change — never a random lifecycle.
    this.reconcileWalkers();
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
      sparkle: undefined,
      boostPip: undefined,
      growthKey: undefined,
      cropBase: undefined,
      smokeTimer: undefined,
      pulseTween: undefined,
      accents: [],
      accentTweens: [],
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
      // Houses render a DETERMINISTIC per-owner style (H1) so a village of homes
      // reads as many individual houses, not one cloned cottage. A painted roof
      // overrides the style's colour but keeps its shape; other stacked buildings
      // use their fixed base + tier/painted roof.
      let baseKey = art.base;
      let roofKey: SpriteKey;
      if (tile.buildingId === 'house') {
        const style = houseStyle(tile.owner);
        baseKey = style.base;
        roofKey = ROOF_SHAPE[style.shape][tile.roofColor ?? style.roof];
      } else {
        roofKey =
          roofKeyFor(tile.buildingId, tile.tier, tile.roofColor) ??
          art.roofByTier[tile.tier];
      }
      // Base lifted one block step onto the tile face; roof one more step up.
      const base = addBlock(this, baseKey, sx, sy, BASE_DY).setDepth(sy + 1);
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
      this.addBuildingAccents(view, tile, sx, sy);
      return;
    }

    // Flat composition (crops / trees / rocks / decor). Wheatfields use a growth
    // state chosen from accrual instead of the static tier sprite, and get a
    // drawn growth-stage base plate beneath the furrow (E2).
    let keys: SpriteKey[];
    if (tile.buildingId === 'wheatfield') {
      const g = this.wheatGrowth(tile, x, y);
      view.growthKey = g.key;
      keys = [g.key];
      this.drawCropBase(view, sx, sy, g.frac);
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
    this.addBuildingAccents(view, tile, sx, sy);
  }

  /** Compose the building's distinct drawn accents (E3) and record them on the
   * view so they tear down with the rest of the structure. Motion (blade/saw spin,
   * ember pulse) is suppressed under reduced motion — the accents freeze legibly. */
  private addBuildingAccents(
    view: TileView,
    tile: TileState,
    sx: number,
    sy: number
  ): void {
    if (tile.buildingId === undefined) return;
    const { objects, tweens } = buildBuildingAccents(
      this,
      tile.buildingId,
      tile.tier,
      sx,
      sy,
      !this.reducedMotion
    );
    for (const o of objects) view.accents.push(o);
    for (const t of tweens) view.accentTweens.push(t);
  }

  /** The wheatfield's current growth sprite + fraction (0..1 of the tier cap):
   * furrow-crop while under half the cap, furrow-crop-wheat once ripening. */
  private wheatGrowth(
    tile: TileState,
    x: number,
    y: number
  ): { key: SpriteKey; frac: number } {
    const data = store.data;
    if (!data) return { key: 'furrow-crop', frac: 0 };
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
    const frac = cap > 0 ? Math.min(1, wheat / cap) : 0;
    return { key: wheat >= cap * 0.5 ? 'furrow-crop-wheat' : 'furrow-crop', frac };
  }

  /**
   * The wheatfield growth-stage base plate: a top-face diamond drawn under the
   * furrow whose fill tracks the crop's progress toward its cap — a bare soil
   * plate under ~33%, a half-grown soil/green plate through ~99%, and a full
   * grass plate once ready — with a small progress wedge that sweeps around the
   * diamond as it ripens.
   *
   * H1 deliverable 6 (bonus) re-evaluated the now-available Kenney Isometric
   * Miniature Bases pack (base_dirt/grass plates) for this plate. Verified in
   * ArtDebug: the pack's round, wooden-rimmed, grass-tufted discs render in a
   * softer, higher-detail style that clashes with the flat, ink-lined Sketch Town
   * furrow at real map zoom (and don't tile the square footprint). So — per the
   * deliverable's own "if it clashes, keep the drawn plate and say so" clause —
   * the drawn palette plate is kept. It reads cleanly beside the furrow and can
   * never clash, since it uses the game's own PAL.
   */
  private drawCropBase(
    view: TileView,
    sx: number,
    sy: number,
    frac: number
  ): void {
    view.cropBase?.destroy();
    // Full tile top-face so the plate reads as a coloured plot AROUND the furrow
    // sprite (which covers the tile centre) rather than hiding beneath it.
    const hw = TILE_W / 2 - 3;
    const hh = TILE_H / 2 - 2;
    // Stage colours: bare soil under a third grown, a soil→grass blend through
    // ripening, a full grass plate once ready.
    const dirt = hexNum(PAL.soil);
    const grass = hexNum(PAL.grass);
    const ready = frac >= 1;
    const fill = frac < 0.33 ? dirt : ready ? grass : this.lerpColor(dirt, grass, frac);
    const g = this.add.graphics();
    g.fillStyle(fill, ready ? 0.85 : 0.7);
    g.beginPath();
    g.moveTo(sx, sy - hh);
    g.lineTo(sx + hw, sy);
    g.lineTo(sx, sy + hh);
    g.lineTo(sx - hw, sy);
    g.closePath();
    g.fillPath();
    g.lineStyle(2, hexNum(PAL.soilDark), 0.6);
    g.strokePath();
    // A progress rim along the two front edges that fills as the crop ripens —
    // the "ring" that reads the growth stage at a glance.
    if (frac > 0 && !ready) {
      g.lineStyle(3, grass, 0.9);
      g.beginPath();
      g.moveTo(sx - hw, sy);
      g.lineTo(sx - hw * (1 - frac), sy + hh * frac);
      g.strokePath();
    }
    // Sits just above the ground block, below the furrow sprite.
    g.setDepth(sy + 0.6);
    view.cropBase = g;
  }

  /** Linear blend between two 0xRRGGBB colours at t∈[0,1]. */
  private lerpColor(a: number, b: number, t: number): number {
    const ar = (a >> 16) & 0xff;
    const ag = (a >> 8) & 0xff;
    const ab = a & 0xff;
    const br = (b >> 16) & 0xff;
    const bg = (b >> 8) & 0xff;
    const bb = b & 0xff;
    const r = Math.round(ar + (br - ar) * t);
    const gg = Math.round(ag + (bg - ag) * t);
    const bl = Math.round(ab + (bb - ab) * t);
    return (r << 16) | (gg << 8) | bl;
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
    // E3 building accents (drawn sails/ember/saw/awning/pit + their motion tweens).
    for (const t of view.accentTweens) t.remove();
    view.accentTweens = [];
    for (const a of view.accents) a.destroy();
    view.accents = [];
    view.growthKey = undefined;
    view.cropBase?.destroy();
    view.cropBase = undefined;
  }

  private destroyView(key: string): void {
    const view = this.views.get(key);
    if (!view) return;
    this.clearStructural(view);
    this.killButterfliesAt(key);
    for (const pip of [view.finder, view.pip, view.sparkle, view.boostPip]) {
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

      // Wheatfield growth state can change over time — refresh its sprite and
      // its growth-stage base plate.
      if (
        tile.buildingId === 'wheatfield' &&
        !view.constructing &&
        view.primary
      ) {
        const g = this.wheatGrowth(tile, x, y);
        if (g.key !== view.growthKey) {
          view.growthKey = g.key;
          view.primary.setTexture(g.key);
        }
        this.drawCropBase(view, sx, sy, g.frac);
      }

      // Ready-to-collect coin pip (own producing tiles with pending output).
      let ready = false;
      if (tile.owner === this.me && tile.buildingId !== undefined && now >= tile.readyAt) {
        const adj = adjacencyBonus(data.grid, x, y, fest, now);
        // Use the REAL village stockpile (not an empty one) so processor tiles
        // (windmill/sawmill/kiln/bakery), whose output is capped by available
        // input goods, are recognised as ready — matching the Collect badge's
        // readyCount. An emptyStockpile() here made every processor read as 0
        // output, so its pending-production pip never appeared.
        const { gained } = accrue(tile, now, fest, adj, data.city.weather, data.stockpile, data.me?.wallet);
        ready = gained.coins + goodsTotal(gained.goods) > 0;
      }
      if (ready && !view.pip) {
        view.pip = this.spawnPip(sx, sy - TILE_H * 1.7, 'icon-coin', C_GLOW);
        // Pair the ready pip with a hidden golden sparkle; the 300ms sparkle timer
        // reveals it during the tile's golden window (Perfect Harvest).
        view.sparkle = this.spawnSparkle(sx, sy - TILE_H * 1.75);
      } else if (!ready && view.pip) {
        this.tweens.killTweensOf(view.pip);
        view.pip.destroy();
        view.pip = undefined;
        if (view.sparkle) {
          this.tweens.killTweensOf(view.sparkle);
          view.sparkle.destroy();
          view.sparkle = undefined;
        }
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

  /** A larger golden star that overlays the coin pip during a tile's golden
   * window (~2× the pip, gold tint, gentle scale-pulse). Created hidden; the
   * sparkle timer toggles its visibility. */
  private spawnSparkle(x: number, y: number): Phaser.GameObjects.Image {
    const sparkle = this.add
      .image(x, y, 'icon-star')
      .setScale(0.36)
      .setTint(GOLD)
      .setDepth(PIP_DEPTH + 1)
      .setVisible(false);
    if (!this.reducedMotion) {
      this.tweens.add({
        targets: sparkle,
        scale: 0.46,
        duration: 400,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.inOut',
      });
    }
    return sparkle;
  }

  /**
   * Light 300ms sweep over ready tiles: reveal each tile's golden sparkle (and
   * hide its coin pip) exactly while `isGoldenWindow(key, now)` is true. Pure
   * visibility toggles on pre-created sprites — zero allocation per tick — giving
   * the 1.8s window enough resolution that the ~2s pip timer alone can't.
   */
  private updateSparkles(): void {
    const now = this.now();
    for (const [key, view] of this.views) {
      if (!view.pip || !view.sparkle) continue;
      const golden = isGoldenWindow(key, now);
      if (view.sparkle.visible !== golden) {
        view.sparkle.setVisible(golden);
        view.pip.setVisible(!golden);
      }
    }
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
    this.fitCameraToIsland();
  }

  /**
   * On boot, frame the whole unlocked island (plus one locked-band tile) so a
   * fresh village never opens cramped — critical on Reddit's small ~720px modal.
   * The zoom is fit to the iso bounding box of the ring + 1 band tile, clamped to
   * [0.5, 1.2], and the camera is centred on the hall (the grid centre, which is
   * also where a fresh player's own house sits, so the fallback is a no-op).
   */
  private fitCameraToIsland(): void {
    const cam = this.cameras.main;
    const { lo, hi } = this.ringLoHi();
    const x0 = lo - 1;
    const x1 = hi + 1;

    // Iso bounding box of the framed tiles' full blocks. Width spans the two
    // extreme diamonds; height spans the topmost block's crown to the bottom
    // block's foot (a block's top vertex sits TILE_H above its anchor row, its
    // foot IMG_H − BLOCK_TOP_CENTER_Y below it).
    const crownAbove = BLOCK_TOP_CENTER_Y - TILE_H;
    const footBelow = IMG_H - BLOCK_TOP_CENTER_Y;
    const contentW = (x1 - x0 + 1) * TILE_W;
    const contentH = (x1 - x0) * TILE_H + crownAbove + footBelow;

    const vw = this.scale.width;
    const vh = this.scale.height;
    // Leave room for the top bar + floating action buttons overlaying the canvas.
    const marginX = 48;
    const marginY = 130;
    const zoom = Phaser.Math.Clamp(
      Math.min((vw - marginX) / contentW, (vh - marginY) / contentH),
      0.5,
      1.2
    );
    cam.setZoom(zoom);

    // Centre on the hall: the ring is symmetric so the horizontal centre is 0; the
    // vertical centre is the mid-row plus a small nudge for the taller foot.
    const cx = KEEP_CX;
    const cy = ((x0 + x1) * TILE_H) / 2 + (footBelow - crownAbove) / 2;
    cam.centerOn(cx, cy);
  }

  // ── Input: pan / zoom / tap ─────────────────────────────────────────────────

  private setupInput(): void {
    this.input.addPointer(1); // allow a second touch for pinch

    // The map container — a `is-grabbing` class swaps the cursor to a closed
    // fist while a pan is actually in progress (see game.css).
    const container = document.getElementById('game-container');
    const setGrabbing = (on: boolean): void => {
      container?.classList.toggle('is-grabbing', on);
    };

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.dragging = true;
      this.startX = p.x;
      this.startY = p.y;
      this.lastX = p.x;
      this.lastY = p.y;
      // A genuine press on the game canvas (map drag/tap) collapses the top-left
      // objectives column. This is the ONLY press-driven collapse trigger — the
      // HUD carries no window-level listener that could race a chip click.
      requestCollapseObjectives();
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
      setGrabbing(true);
      const cam = this.cameras.main;
      cam.scrollX -= (p.x - this.lastX) / cam.zoom;
      cam.scrollY -= (p.y - this.lastY) / cam.zoom;
      this.lastX = p.x;
      this.lastY = p.y;
    });

    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      setGrabbing(false);
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

    // The Village Mural board sits on this plaza-ring tile — tapping it opens the
    // mural editor (routed before claim/flavor logic, since the plaza is never
    // claimable and would otherwise show generic square flavour).
    if (x === MURAL_TILE.x && y === MURAL_TILE.y) {
      openMuralSheet();
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
        // Real stockpile (see updatePips): keeps the fast-tap-collect path in step
        // with the ready pip so a tapped processor tile actually collects.
        const { gained } = accrue(tile, now, data.city.festival, adj, data.city.weather, data.stockpile, data.me?.wallet);
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
        this.coinBurst(x, y, res.golden);
        if (res.golden) {
          this.perfectText(x, y);
          this.zoomBump();
        }
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

  /** Draw pulsing top-face diamonds over the walkthrough's candidate tiles, or
   * clear them when passed null/empty. Drawn in world space so the highlights
   * track the camera as the map pans. */
  private drawTileHints(keys: string[] | null): void {
    const g = this.tileHints;
    if (!g) return;
    if (!keys || keys.length === 0) {
      this.tileHintTween?.stop();
      this.tileHintTween = undefined;
      g.clear();
      g.setVisible(false);
      return;
    }
    g.clear();
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;
    for (const key of keys) {
      const [xs, ys] = key.split(',');
      const x = Number(xs);
      const y = Number(ys);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const { sx, sy } = isoToScreen(x, y, TILE_W, TILE_H);
      g.fillStyle(C_GLOW, 0.22);
      g.beginPath();
      g.moveTo(sx, sy - hh);
      g.lineTo(sx + hw, sy);
      g.lineTo(sx, sy + hh);
      g.lineTo(sx - hw, sy);
      g.closePath();
      g.fillPath();
      g.lineStyle(3, C_GLOW, 0.95);
      g.strokePath();
    }
    g.setVisible(true);
    g.setAlpha(1);
    if (!this.reducedMotion && !this.tileHintTween) {
      this.tileHintTween = this.tweens.add({
        targets: g,
        alpha: 0.4,
        duration: 720,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.inOut',
      });
    }
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

    // Walkthrough bridge: map a tile's grid coords to a live viewport pixel
    // point (camera scroll + zoom + the canvas's page offset), so a coach mark
    // can track the tile as the map pans. Returns null when the point falls
    // outside the canvas so the overlay can hide rather than point off-screen.
    setTileToScreen((tx, ty) => {
      const cam = this.cameras.main;
      if (!cam) return null;
      const { sx, sy } = isoToScreen(tx, ty, TILE_W, TILE_H);
      const view = cam.worldView;
      const canvas = this.game.canvas;
      const rect = canvas.getBoundingClientRect();
      const scaleX = cam.width > 0 ? rect.width / cam.width : 1;
      const scaleY = cam.height > 0 ? rect.height / cam.height : 1;
      const px = (sx - view.x) * cam.zoom * scaleX + rect.left;
      const py = (sy - view.y) * cam.zoom * scaleY + rect.top;
      if (
        px < rect.left ||
        px > rect.right ||
        py < rect.top ||
        py > rect.bottom
      ) {
        return null;
      }
      return { x: px, y: py };
    });

    // Walkthrough candidate-tile highlights.
    setHighlightTiles((keys) => this.drawTileHints(keys));

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
      case 'mural': {
        store.patchMuralPixel(msg.x, msg.y, msg.c);
        this.refreshMural();
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

  /** Coin-pop on collect. A Perfect Harvest (`golden`) throws twice the coins in
   * a gold tint for a celebratory double burst. */
  private coinBurst(x: number, y: number, golden = false): void {
    const { sx, sy } = isoToScreen(x, y, TILE_W, TILE_H);
    const oy = sy - TILE_H * 0.7;
    const count = golden ? 14 : 7;
    const tint = golden ? GOLD : C_GLOW;
    for (let i = 0; i < count; i++) {
      const coin = this.add
        .image(sx, oy, 'icon-coin')
        .setScale(0.16)
        .setTint(tint)
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

  /** Gold "PERFECT" text that pops in, floats up and fades (~900ms) over a golden
   * collect. */
  private perfectText(x: number, y: number): void {
    const { sx, sy } = isoToScreen(x, y, TILE_W, TILE_H);
    const label = this.add
      .text(sx, sy - TILE_H * 1.4, 'PERFECT', {
        fontFamily: 'Fredoka, ui-rounded, system-ui, sans-serif',
        fontSize: '20px',
        fontStyle: '700',
        color: '#ffd700',
        stroke: PAL.ink,
        strokeThickness: 4,
      })
      .setOrigin(0.5, 1)
      .setDepth(EFFECT_DEPTH + 1);
    // Hard destroy fallback: guarantee the label is torn down regardless of
    // whether the fade tween runs or completes (see floatText note). Without it,
    // conflicting alpha tweens could leave the object stranded on the scene.
    this.floatTextCleanup(label, 1100);
    if (this.reducedMotion) return; // static hold, destroyed by the fallback timer
    // A single alpha tween owns the fade (no in/out alpha conflict); scale + y
    // ride separate properties, so nothing fights over `alpha`.
    label.setScale(0.5).setAlpha(0);
    this.tweens.add({ targets: label, scale: 1, duration: 180, ease: 'Back.out' });
    this.tweens.add({ targets: label, alpha: 1, duration: 140 });
    this.tweens.add({
      targets: label,
      y: sy - TILE_H * 2.3,
      duration: 900,
      ease: 'Quad.out',
    });
    this.tweens.add({ targets: label, alpha: 0, delay: 620, duration: 380 });
  }

  /** Every floating scene label gets a deterministic `delayedCall` destroy so it
   * can never leak, whatever its fade tween does (playtest: PERFECT text and bot
   * building labels persisted for minutes when their alpha tweens stalled). The
   * timer no-ops if the label was already destroyed. */
  private floatTextCleanup(
    label: Phaser.GameObjects.Text,
    ms: number
  ): void {
    this.time.delayedCall(ms, () => {
      if (label.active) {
        this.tweens.killTweensOf(label);
        label.destroy();
      }
    });
  }

  /** A tiny camera zoom bump (1.00→1.015→1.00, ~150ms) for extra Perfect-Harvest
   * punch. Skipped under reduced motion. */
  private zoomBump(): void {
    if (this.reducedMotion) return;
    const cam = this.cameras.main;
    const base = cam.zoom;
    this.tweens.add({
      targets: cam,
      zoom: base * 1.015,
      duration: 75,
      yoyo: true,
      ease: 'Sine.inOut',
    });
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
    // Deterministic teardown regardless of the tween (see floatTextCleanup).
    this.floatTextCleanup(label, 1800);
    if (this.reducedMotion) return; // static hold, destroyed by the fallback timer
    this.tweens.add({
      targets: label,
      y: sy - TILE_H - 22,
      alpha: 0,
      duration: 1600,
      ease: 'Quad.out',
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
    this.ensureVillagerTextures();
  }

  /** Pre-bake the villager sprite set ONCE: a soft shadow, plus every variant
   * (a cloth×skin×hair combo) in two frames — an idle stance and a mid-step
   * stance — swapped at runtime for a simple two-frame walk gait. */
  private ensureVillagerTextures(): void {
    if (!this.textures.exists('hv-vill-shadow')) {
      const sg = this.add.graphics();
      sg.fillStyle(hexNum(PAL.ink), 0.3).fillEllipse(9, 4, 16, 7);
      sg.generateTexture('hv-vill-shadow', 18, 8);
      sg.destroy();
    }
    for (let v = 0; v < VILLAGER_VARIANTS; v++) {
      this.drawVillager(v, 0);
      this.drawVillager(v, 1);
    }
  }

  /** Draw one villager variant/frame into a texture. A little rounded character:
   * a two-tone shirt over stubby legs, a skin-toned face under a hair cap, all
   * with a soft 1px ink outline. Frame 1 lifts one leg for the walk cycle. */
  private drawVillager(variant: number, frame: 0 | 1): void {
    const key = `hv-vill-${variant}-${frame}`;
    if (this.textures.exists(key)) return;
    const cloth = WALKER_CLOTH[variant % WALKER_CLOTH.length] ?? hexNum(PAL.roofRed);
    const clothDark = shade(cloth, 0.78);
    const skin = WALKER_SKIN[variant % WALKER_SKIN.length] ?? WALKER_SKIN[0]!;
    const hair = WALKER_HAIR[variant % WALKER_HAIR.length] ?? WALKER_HAIR[0]!;
    const ink = hexNum(PAL.ink);
    const legCol = hexNum(PAL.woodDark);
    const g = this.add.graphics();

    // Legs (behind the torso). Frame 1 strides: left leg forward + up, right back.
    const legs =
      frame === 0
        ? [
            { x: 4.5, y: 17 },
            { x: 9, y: 17 },
          ]
        : [
            { x: 3.5, y: 16 },
            { x: 9.5, y: 17 },
          ];
    for (const l of legs) {
      g.fillStyle(ink, 1).fillRect(l.x - 1, l.y - 1, 4.5, 6);
      g.fillStyle(legCol, 1).fillRect(l.x, l.y, 2.5, 4);
    }

    // Torso — rounded, two-tone (shirt over a darker hem).
    g.fillStyle(ink, 1).fillRoundedRect(3, 8, 10, 11, 4);
    g.fillStyle(cloth, 1).fillRoundedRect(4, 9, 8, 9, 3);
    g.fillStyle(clothDark, 1).fillRoundedRect(4, 14, 8, 4, {
      tl: 0,
      tr: 0,
      bl: 3,
      br: 3,
    });

    // Head — hair cap sits above a slightly-lower face circle for a peeking rim.
    g.fillStyle(ink, 1).fillCircle(8, 6, 5);
    g.fillStyle(hair, 1).fillCircle(8, 5.2, 4.2);
    g.fillStyle(skin, 1).fillCircle(8, 6.9, 3.4);

    g.generateTexture(key, VILLAGER_W, VILLAGER_H);
    g.destroy();
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

  /** The plaza path-ring tiles villagers spawn onto (deterministic order). */
  private walkerRing(): Array<{ x: number; y: number }> {
    const ring: Array<{ x: number; y: number }> = [];
    for (let y = PATH_LO; y <= PATH_HI; y++) {
      for (let x = PATH_LO; x <= PATH_HI; x++) {
        if (isPathRing(x, y)) ring.push({ x, y });
      }
    }
    return ring;
  }

  /** First spawn — just reconcile to the current population. */
  private spawnWalkers(): void {
    this.reconcileWalkers();
  }

  /** House owners, sorted for a stable walker→owner mapping (E1). Walker k dresses
   * as the k-th house owner's outfit. */
  private houseOwners(): string[] {
    const grid = store.data?.grid ?? {};
    const owners: string[] = [];
    for (const tile of Object.values(grid)) {
      if (tile.buildingId === 'house') owners.push(tile.owner);
    }
    return owners.sort();
  }

  /** The outfit index (→ walker variant) for the k-th house owner: their chosen
   * outfit from the state's `outfits` map, else a stable hash of their id, else
   * the plain index scheme. Pure lookup. */
  private walkerVariant(owners: string[], index: number): number {
    const owner = owners[index];
    if (owner === undefined) return index % VILLAGER_VARIANTS;
    const chosen = store.data?.outfits[owner];
    if (chosen !== undefined) return chosen % VILLAGER_VARIANTS;
    return defaultOutfit(owner) % VILLAGER_VARIANTS;
  }

  /** Keep exactly min(population, 12) villagers alive, spawning/despawning only
   * to close the gap when the house count changes — no random lifecycle. Each
   * walker dresses as the k-th house owner's outfit; a changed outfit re-dresses
   * the existing walker in place. New ones start on a stable ring tile. */
  private reconcileWalkers(): void {
    if (!this.ambient) return;
    const ring = this.walkerRing();
    if (ring.length === 0) return;
    const owners = this.houseOwners();
    const target = Math.min(this.population(), MAX_WALKERS);
    while (this.walkers.length > target) {
      this.removeWalker(this.walkers.length - 1);
    }
    while (this.walkers.length < target) {
      const i = this.walkers.length;
      const tile = ring[(i * 7 + 1) % ring.length];
      if (!tile) break;
      this.makeWalker(tile.x, tile.y, this.walkerVariant(owners, i));
    }
    // Re-dress existing walkers whose owner's outfit changed (e.g. after the
    // player picks a new outfit from the Journal — no population change).
    for (let i = 0; i < this.walkers.length; i += 1) {
      const w = this.walkers[i];
      if (!w) continue;
      const variant = this.walkerVariant(owners, i);
      if (variant !== w.variant) {
        w.variant = variant;
        w.body.setTexture(`hv-vill-${variant}-${w.frame}`);
      }
    }
  }

  private removeWalker(index: number): void {
    const w = this.walkers[index];
    if (!w) return;
    w.moveTween?.remove();
    w.bobTween?.remove();
    w.idle?.remove(false);
    w.gait?.remove(false);
    w.root.destroy();
    this.walkers.splice(index, 1);
  }

  private makeWalker(tx: number, ty: number, variant: number): void {
    const { sx, sy } = isoToScreen(tx, ty, TILE_W, TILE_H);

    // Soft shadow sits at the feet on the root (so it never bobs); the character
    // sprite bobs inside `vis`, its origin at the feet (local 0,0 = tile point).
    const shadow = this.add.image(0, 0, 'hv-vill-shadow').setAlpha(0.85);
    const body = this.add.image(0, 0, `hv-vill-${variant}-0`).setOrigin(0.5, 1);
    const vis = this.add.container(0, 0, [body]);
    const root = this.add.container(sx, sy, [shadow, vis]).setDepth(sy + 0.6);
    this.ambient?.add(root);

    const walker: Walker = {
      root,
      vis,
      body,
      variant,
      frame: 0,
      tx,
      ty,
      moveTween: undefined,
      bobTween: undefined,
      idle: undefined,
      gait: undefined,
    };
    this.walkers.push(walker);

    if (this.reducedMotion) return; // stand idle — no bob, no gait, no roaming
    walker.bobTween = this.tweens.add({
      targets: vis,
      y: -2,
      duration: 320,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });
    walker.gait = this.time.addEvent({
      delay: GAIT_MS,
      loop: true,
      callback: () => this.stepGait(walker),
    });
    this.walkerStep(walker);
  }

  /** Advance a walker's 2-frame gait: alternate idle/step textures while it is
   * actually moving, and settle on the idle frame the moment it stops. */
  private stepGait(w: Walker): void {
    if (this.reducedMotion) return;
    const moving = w.moveTween?.isPlaying() ?? false;
    const next: 0 | 1 = moving ? (w.frame === 0 ? 1 : 0) : 0;
    if (next === w.frame) return;
    w.frame = next;
    w.body.setTexture(`hv-vill-${w.variant}-${next}`);
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
    const onPath = neigh.filter(
      (n) =>
        isPathRing(n.x, n.y) || this.landscape().network.has(tileKey(n.x, n.y))
    );
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
    for (const [key, img] of this.decorImgs) {
      if (isTreeDecor(img.texture.key)) {
        const { x, y } = parseKey(key);
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
      w.gait?.remove(false);
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
    // Void background: kill each object's bob/twinkle tween, then destroy it, so
    // no orphaned tween keeps ticking after the scene shuts down.
    for (const p of this.bgParts) {
      this.tweens.killTweensOf(p);
      p.destroy();
    }
    this.bgParts = [];
    for (const p of this.muralParts) p.destroy();
    this.muralParts = [];
    this.muralBoard = undefined;
    for (const p of this.crestParts) p.destroy();
    this.crestParts = [];
    this.stopPolling();
    if (this.conn) {
      disconnectRealtime('village');
      this.conn = undefined;
    }
    store.off('change', this.onStoreChange);
    window.removeEventListener(HV_FOCUS_TILE, this.onFocusTile);
    window.removeEventListener(HV_CLEAR_SELECTION, this.onClearSelection);
    document.removeEventListener('visibilitychange', this.onVisibility);
    setTileToScreen(null);
    setHighlightTiles(null);
    this.tileHintTween?.stop();
    this.tileHintTween = undefined;
  }
}
