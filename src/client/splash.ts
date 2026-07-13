import { context, requestExpandedMode } from '@devvit/web/client';
import { PAL } from '../shared/palette';
import { SPRITES } from './art/manifest';
import type { SpriteKey } from './art/manifest';

/**
 * Hearthvale inline splash — the storefront every redditor meets in the feed.
 *
 * Feather-light on purpose: pure DOM + CSS, no Phaser and no sprite atlas, so it
 * paints in well under a second inside the ~350px feed unit. The village is a
 * small CSS diorama — a floating grass island on wooden stilts with a few
 * roofed cottages and (once the village raises it) a keep tower — echoing the
 * Sketch Town look without loading a single image. Colours flow from `PAL`, live
 * numbers arrive async from `GET /api/summary`, and the whole card taps through
 * to the full game via `requestExpandedMode`.
 */

// ── Live summary shape (subset of the server's GET /api/summary) ───────────────

type Weather = 'sunny' | 'rain' | 'clear' | 'harvestmoon';

type Theme = 'meadow' | 'autumn' | 'twilight' | 'pale' | 'desert';

type Summary = {
  villageName: string;
  theme: Theme;
  buildings: number;
  players: number;
  hallLevel: number;
  readyForMe: number;
  weather: Weather;
  hotGood: string;
  hotPrice: number;
  crest: number;
  crestColor: number;
};

/** The crest emblem sprite per index (0..5), matching catalog CREST_EMBLEMS. */
const CREST_ICON: readonly SpriteKey[] = [
  'icon-star',
  'icon-trophy',
  'icon-scroll',
  'icon-home',
  'icon-hammer',
  'icon-coin',
];
/** The crest banner colour per index (0..3), matching catalog CREST_COLORS
 * (Sand/Rustic/Forest/Royal — the colored crest towers). */
const CREST_HEX: readonly string[] = [
  PAL.roofBeige,
  PAL.roofBrown,
  PAL.roofGreen,
  PAL.roofPurple,
];

const DEFAULT_VILLAGE_NAME = 'Hearthvale';

const displayName = (name: string): string =>
  name.trim().length > 0 ? name.trim() : DEFAULT_VILLAGE_NAME;

const WEATHER_LABEL: Record<Weather, string> = {
  sunny: 'Sunny',
  rain: 'Rain',
  clear: 'Clear',
  harvestmoon: 'Harvest Moon',
};

// ── Palette → CSS custom properties (single source of truth) ──────────────────

const injectPaletteVars = (): void => {
  const style = document.createElement('style');
  style.textContent = `:root{
  --sky-top:${PAL.cream};
  --sky-mid:${PAL.glow};
  --sky-low:${PAL.accent};
  --grass:${PAL.grass};
  --grass-dark:${PAL.grassDark};
  --grass-light:${PAL.grassLight};
  --dirt:${PAL.soil};
  --dirt-dark:${PAL.soilDark};
  --wood:${PAL.wood};
  --wood-dark:${PAL.woodDark};
  --wall:${PAL.wall};
  --wall-shade:${PAL.wallShade};
  --roof-red:${PAL.roofRed};
  --roof-blue:${PAL.roofBlue};
  --roof-straw:${PAL.roofStraw};
  --stone:${PAL.stone};
  --stone-dark:${PAL.stoneDark};
  --glow:${PAL.glow};
  --glow-soft:${PAL.glow}55;
  --cream:${PAL.cream};
  --ink:${PAL.ink};
  --ink-shadow:${PAL.ink}2e;
  --accent:${PAL.accent};
  --skel-a:${PAL.wallShade};
  --skel-b:${PAL.cream};
}`;
  document.head.appendChild(style);
};

// ── Small DOM helper (keeps types exact, no casts) ────────────────────────────

type ElOpts = { cls?: string; text?: string };

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: ElOpts = {}
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (opts.cls !== undefined) node.className = opts.cls;
  if (opts.text !== undefined) node.textContent = opts.text;
  return node;
};

// ── Scene assembly (a real Sketch Town mini-diorama of <img> block sprites) ────
//
// Each Kenney block PNG is 128×176 with its top-face diamond centre at (64, 95).
// We lay the blocks out on the same iso pitch the game uses (TILE_W 128 / TILE_H
// 64), scaled down, and lift bases/roofs by the same block-step the renderer
// uses (BASE −45, ROOF −90 from the ground; the keep cap −70). Painter order is
// front-to-back via a z-index keyed on the tile's screen row (x+y).

const SCALE = 0.36;
const HALFW = (128 / 2) * SCALE; // screen dx per (x−y) unit
const HALFH = (64 / 2) * SCALE; // screen dy per (x+y) unit
const IMG_W = 128 * SCALE;
const TOP_CX = 64 * SCALE; // top-face centre offset within the scaled image
const TOP_CY = 95 * SCALE;
const ORIGIN_X = 120; // diorama-local centre (matches .hv-diorama width/2)
const ORIGIN_Y = 46;

/** Lift constants (native px, before scaling) mirroring art/render.ts. */
const LIFT_BASE = 45;
const LIFT_ROOF = 90;
const LIFT_CAP = 70;

/** Place one block sprite at iso tile (x,y), lifted `lift` native px, layered by
 * `layer` within its screen row. Returns the <img> so callers can toggle it. */
const placeBlock = (
  host: HTMLElement,
  key: SpriteKey,
  x: number,
  y: number,
  lift: number,
  layer: number
): HTMLImageElement => {
  const img = el('img', { cls: 'hv-blk' });
  img.src = SPRITES[key];
  img.alt = '';
  img.draggable = false;
  const cx = ORIGIN_X + (x - y) * HALFW;
  const cy = ORIGIN_Y + (x + y) * HALFH - lift * SCALE;
  img.style.left = `${cx - TOP_CX}px`;
  img.style.top = `${cy - TOP_CY}px`;
  img.style.width = `${IMG_W}px`;
  img.style.zIndex = String((x + y) * 10 + layer);
  host.appendChild(img);
  return img;
};

const buildScene = (): { scene: HTMLDivElement; capEl: HTMLImageElement } => {
  const scene = el('div', { cls: 'hv-scene' });
  scene.appendChild(el('div', { cls: 'hv-cloud c1' }));
  scene.appendChild(el('div', { cls: 'hv-cloud c2' }));

  const diorama = el('div', { cls: 'hv-diorama' });

  // Grass island (a compact hex of blocks) with a path tile leading in.
  const ground: Array<[number, number, SpriteKey]> = [
    [1, 1, 'grass-block'],
    [2, 1, 'grass-block'],
    [3, 1, 'grass-block'],
    [1, 2, 'grass-block'],
    [2, 2, 'grass-block'],
    [3, 2, 'grass-block'],
    [2, 3, 'grass-path'],
    [3, 3, 'grass-block'],
  ];
  for (const [x, y, key] of ground) placeBlock(diorama, key, x, y, 0, 0);

  // Two cottages (base wall + tier-coloured roof).
  placeBlock(diorama, 'building-door', 1, 1, LIFT_BASE, 2);
  placeBlock(diorama, 'roof-gable-brown', 1, 1, LIFT_ROOF, 4);
  placeBlock(diorama, 'building-window', 3, 1, LIFT_BASE, 2);
  placeBlock(diorama, 'roof-point-green', 3, 1, LIFT_ROOF, 4);

  // The Grand Keep at the centre — its crown cap fades in once the Hall levels up.
  placeBlock(diorama, 'castle-tower', 2, 2, LIFT_BASE, 2);
  const capEl = placeBlock(diorama, 'castle-tower-top', 2, 2, LIFT_CAP, 5);
  capEl.classList.add('is-hidden');

  // A pine on the front corner.
  placeBlock(diorama, 'tree-pine', 3, 3, LIFT_BASE, 3);

  scene.appendChild(diorama);
  return { scene, capEl };
};

// ── Live-stats plumbing ───────────────────────────────────────────────────────

const isWeather = (value: unknown): value is Weather =>
  value === 'sunny' ||
  value === 'rain' ||
  value === 'clear' ||
  value === 'harvestmoon';

const isTheme = (value: unknown): value is Theme =>
  value === 'meadow' ||
  value === 'autumn' ||
  value === 'twilight' ||
  value === 'pale' ||
  value === 'desert';

const isSummary = (body: unknown): body is Summary =>
  typeof body === 'object' &&
  body !== null &&
  'villageName' in body &&
  typeof body.villageName === 'string' &&
  'theme' in body &&
  isTheme(body.theme) &&
  'buildings' in body &&
  typeof body.buildings === 'number' &&
  'players' in body &&
  typeof body.players === 'number' &&
  'hallLevel' in body &&
  typeof body.hallLevel === 'number' &&
  'readyForMe' in body &&
  typeof body.readyForMe === 'number' &&
  'weather' in body &&
  isWeather(body.weather) &&
  'hotGood' in body &&
  typeof body.hotGood === 'string' &&
  'hotPrice' in body &&
  typeof body.hotPrice === 'number' &&
  'crest' in body &&
  typeof body.crest === 'number' &&
  'crestColor' in body &&
  typeof body.crestColor === 'number';

const fmtInt = (n: number): string => Math.round(n).toLocaleString('en-US');

/** A stat pill: a small white icon sprite beside its label. */
const pill = (icon: SpriteKey, text: string): HTMLSpanElement => {
  const span = el('span', { cls: 'hv-pill' });
  const img = el('img', { cls: 'hv-pill-icon' });
  img.src = SPRITES[icon];
  img.alt = '';
  img.draggable = false;
  span.appendChild(img);
  span.appendChild(el('span', { text }));
  return span;
};

const THEME_CLASSES: Record<Theme, string> = {
  meadow: 'hv-theme-meadow',
  autumn: 'hv-theme-autumn',
  twilight: 'hv-theme-twilight',
  pale: 'hv-theme-pale',
  desert: 'hv-theme-desert',
};

const fillStats = (
  root: HTMLElement,
  titleEl: HTMLHeadingElement,
  crestEl: HTMLSpanElement,
  statsEl: HTMLDivElement,
  hookEl: HTMLDivElement,
  capEl: HTMLImageElement,
  s: Summary
): void => {
  // Village name in the title line; sky theme on the root; crest chip beside it.
  titleEl.textContent = displayName(s.villageName);
  fillCrest(crestEl, s);
  for (const cls of Object.values(THEME_CLASSES)) root.classList.remove(cls);
  root.classList.add(THEME_CLASSES[s.theme]);

  statsEl.replaceChildren(
    pill('icon-home', `${fmtInt(s.buildings)} buildings`),
    pill('icon-star', `${fmtInt(s.players)} villagers`),
    pill('icon-trophy', `Hall L${s.hallLevel}/5`)
  );

  if (s.hallLevel >= 1) capEl.classList.remove('is-hidden');
  else capEl.classList.add('is-hidden');

  if (s.readyForMe > 0) {
    const plots = s.readyForMe === 1 ? 'plot is' : 'plots are';
    hookEl.textContent = `${s.readyForMe} of your ${plots} ready to collect`;
    hookEl.classList.add('is-ready');
  } else {
    const label = WEATHER_LABEL[s.weather];
    hookEl.textContent = `Market: ${s.hotGood} is paying ${s.hotPrice} coins — Weather: ${label}`;
    hookEl.classList.remove('is-ready');
  }
  hookEl.classList.remove('is-hidden');
};

const loadSummary = async (
  root: HTMLElement,
  titleEl: HTMLHeadingElement,
  crestEl: HTMLSpanElement,
  statsEl: HTMLDivElement,
  hookEl: HTMLDivElement,
  capEl: HTMLImageElement
): Promise<void> => {
  try {
    const res = await fetch('/api/summary');
    if (!res.ok) throw new Error('summary unavailable');
    const body: unknown = await res.json();
    if (!isSummary(body)) throw new Error('bad summary shape');
    fillStats(root, titleEl, crestEl, statsEl, hookEl, capEl, body);
  } catch {
    // Silent in the feed: drop the stats + hook, keep the scene, title and CTA.
    statsEl.classList.add('is-hidden');
    hookEl.classList.add('is-hidden');
  }
};

// ── Content column ────────────────────────────────────────────────────────────

const buildContent = (): {
  content: HTMLDivElement;
  titleEl: HTMLHeadingElement;
  crestEl: HTMLSpanElement;
  statsEl: HTMLDivElement;
  hookEl: HTMLDivElement;
  cta: HTMLButtonElement;
} => {
  const content = el('div', { cls: 'hv-content' });

  const name = context.username;
  if (name !== undefined && name.length > 0) {
    content.appendChild(el('div', { cls: 'hv-greet', text: `Welcome back, u/${name}` }));
  }

  // Defaults to the fallback name; the live summary swaps in the mod-set name.
  // A crest chip (emblem + colour dot) sits beside the title once the summary
  // arrives — hidden until then.
  const titleEl = el('h1', { cls: 'hv-title', text: DEFAULT_VILLAGE_NAME });
  const crestEl = el('span', { cls: 'hv-crest-chip is-hidden' });
  crestEl.style.cssText =
    'display:none;align-items:center;gap:5px;padding:3px 8px;border-radius:999px;' +
    'border:2px solid var(--ink);background:var(--cream);vertical-align:middle;margin-left:8px';
  const titleRow = el('div', { cls: 'hv-titlerow' });
  titleRow.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:4px';
  titleRow.appendChild(titleEl);
  titleRow.appendChild(crestEl);
  content.appendChild(titleRow);
  content.appendChild(
    el('p', { cls: 'hv-tagline', text: 'a village your subreddit builds together' })
  );

  const statsEl = el('div', { cls: 'hv-stats' });
  statsEl.appendChild(el('span', { cls: 'hv-skel' }));
  statsEl.appendChild(el('span', { cls: 'hv-skel' }));
  content.appendChild(statsEl);

  const hookEl = el('div', { cls: 'hv-hook is-hidden' });
  content.appendChild(hookEl);

  const cta = el('button', { cls: 'hv-cta', text: 'Enter the Village' });
  cta.type = 'button';
  content.appendChild(cta);

  return { content, titleEl, crestEl, statsEl, hookEl, cta };
};

/** Fill the crest chip (emblem icon + colour dot), or hide it if unset. */
const fillCrest = (crestEl: HTMLSpanElement, s: Summary): void => {
  const icon = CREST_ICON[s.crest];
  const hex = CREST_HEX[s.crestColor];
  if (icon === undefined || hex === undefined) {
    crestEl.style.display = 'none';
    return;
  }
  crestEl.replaceChildren();
  const dot = el('span');
  dot.style.cssText = `width:11px;height:11px;border-radius:50%;background:${hex};border:1px solid var(--ink)`;
  const img = el('img');
  img.src = SPRITES[icon];
  img.alt = '';
  img.draggable = false;
  img.style.cssText = 'width:15px;height:15px';
  crestEl.appendChild(dot);
  crestEl.appendChild(img);
  crestEl.style.display = 'inline-flex';
};

// ── Boot ──────────────────────────────────────────────────────────────────────

const mount = (): void => {
  const root = document.getElementById('splash-root');
  if (!root) return;

  injectPaletteVars();
  const { scene, capEl } = buildScene();
  root.appendChild(scene);

  const { content, titleEl, crestEl, statsEl, hookEl, cta } = buildContent();
  root.appendChild(content);

  // Whole card taps through; the button is the visual affordance. A one-shot
  // guard keeps the bubbled button+card clicks from firing two expand requests.
  let entering = false;
  const enter = (e: MouseEvent): void => {
    if (entering) return;
    entering = true;
    requestExpandedMode(e, 'game');
    window.setTimeout(() => {
      entering = false;
    }, 500);
  };
  cta.addEventListener('click', enter);
  root.addEventListener('click', enter);

  // Fetch after first paint — nothing blocks the initial render.
  void loadSummary(root, titleEl, crestEl, statsEl, hookEl, capEl);
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
