import { context, requestExpandedMode } from '@devvit/web/client';
import { PAL } from '../shared/palette';

/**
 * Hearthvale inline splash — the storefront every redditor meets in the feed.
 *
 * Feather-light on purpose: pure DOM + CSS, no Phaser and no external assets, so
 * it paints in well under a second inside the ~350px feed unit. The village is a
 * layered CSS pixel-art scene (box-shadow sprites), colours flow from `PAL`
 * (the one palette), live numbers arrive async from `GET /api/summary`, and the
 * whole card taps through to the full game via `requestExpandedMode`.
 */

// ── Live summary shape (mirrors the server's GET /api/summary) ────────────────

type Festival = 'coins' | 'supplies' | 'decor';

type Summary = {
  buildings: number;
  players: number;
  landmarkStage: number;
  landmarkPct: number;
  festival: Festival;
  readyForMe: number;
};

// ── Palette → CSS custom properties (single source of truth) ──────────────────

const injectPaletteVars = (): void => {
  const style = document.createElement('style');
  style.textContent = `:root{
  --night:${PAL.night};
  --dusk:${PAL.roofBlueDark};
  --horizon:${PAL.accent};
  --horizon-lo:${PAL.glow};
  --glow:${PAL.glow};
  --glow-soft:${PAL.glow}55;
  --grass:${PAL.grass};
  --grass-dark:${PAL.grassDark};
  --grass-light:${PAL.grassLight};
  --ink:${PAL.ink};
  --cream:${PAL.cream};
  --wood-dark:${PAL.woodDark};
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

// ── Box-shadow pixel-art sprites ──────────────────────────────────────────────
// Each sprite is a fixed-size box whose pixels are box-shadows on a single dot,
// so an entire building costs just two DOM nodes. Offsets are expressed in
// `var(--px)` units so the whole scene scales from one CSS variable.

const CH: Record<string, string> = {
  R: PAL.roofRed,
  r: PAL.roofRedDark,
  B: PAL.roofBlue,
  b: PAL.roofBlueDark,
  S: PAL.roofStraw,
  s: PAL.roofStrawDark,
  W: PAL.wall,
  w: PAL.wallShade,
  D: PAL.woodDark,
  G: PAL.glow,
  T: PAL.stone,
  t: PAL.stoneDark,
};

type Sprite = { rows: string[] };

/** A cosy little cottage with a red roof and a lit window. */
const HOUSE_RED: Sprite = {
  rows: [
    '..rrr..',
    '.rRRRr.',
    'rRRRRRr',
    '.WWWWW.',
    '.WWWWW.',
    '.WGwDW.',
    '.WwwDW.',
    '.WwwDW.',
  ],
};

/** A blue-roofed neighbour. */
const HOUSE_BLUE: Sprite = {
  rows: [
    '..bbb..',
    '.bBBBb.',
    'bBBBBBb',
    '.wwwww.',
    '.wDGw..',
    '.wDww..',
    '.wDww..',
  ],
};

/** A tiny straw-roofed hut. */
const HUT: Sprite = {
  rows: ['.sSs.', 'sSSSs', '.WWW.', '.WGW.', '.WDW.', '.WDW.'],
};

/** The clocktower — the village's shared landmark, glowing clock face and all. */
const CLOCKTOWER: Sprite = {
  rows: [
    '...S...',
    '..SSS..',
    '.SSSSS.',
    'SSSSSSS',
    '.TTTTT.',
    '.TtttT.',
    '.TGGGT.',
    '.TGGGT.',
    '.TtttT.',
    '.TDDDT.',
    '.TTTTT.',
  ],
};

const shadowFor = (sprite: Sprite): string => {
  const parts: string[] = [];
  sprite.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const color = CH[row.charAt(x)];
      if (color === undefined) continue;
      parts.push(`calc(${x} * var(--px)) calc(${y} * var(--px)) 0 0 ${color}`);
    }
  });
  return parts.join(',');
};

const spriteEl = (sprite: Sprite): HTMLDivElement => {
  const cols = Math.max(...sprite.rows.map((r) => r.length));
  const wrap = el('div', { cls: 'hv-sprite' });
  wrap.style.width = `calc(${cols} * var(--px))`;
  wrap.style.height = `calc(${sprite.rows.length} * var(--px))`;
  const dot = el('i', { cls: 'hv-px' });
  dot.style.boxShadow = shadowFor(sprite);
  wrap.appendChild(dot);
  return wrap;
};

// ── Scene assembly ────────────────────────────────────────────────────────────

const buildScene = (): HTMLDivElement => {
  const scene = el('div', { cls: 'hv-scene' });
  scene.appendChild(el('div', { cls: 'hv-twinkle t1' }));
  scene.appendChild(el('div', { cls: 'hv-twinkle t2' }));
  scene.appendChild(el('div', { cls: 'hv-twinkle t3' }));

  const village = el('div', { cls: 'hv-village' });
  for (const sprite of [HUT, HOUSE_RED, CLOCKTOWER, HOUSE_BLUE]) {
    village.appendChild(spriteEl(sprite));
  }
  scene.appendChild(village);
  scene.appendChild(el('div', { cls: 'hv-grass' }));
  return scene;
};

// ── Live-stats plumbing ───────────────────────────────────────────────────────

const FEST_LABEL: Record<Festival, { title: string; noun: string }> = {
  coins: { title: 'Coin', noun: 'coin' },
  supplies: { title: 'Supply', noun: 'supply' },
  decor: { title: 'Decor', noun: 'decor' },
};

const isFestival = (value: unknown): value is Festival =>
  value === 'coins' || value === 'supplies' || value === 'decor';

const isSummary = (body: unknown): body is Summary =>
  typeof body === 'object' &&
  body !== null &&
  'buildings' in body &&
  typeof body.buildings === 'number' &&
  'players' in body &&
  typeof body.players === 'number' &&
  'landmarkStage' in body &&
  typeof body.landmarkStage === 'number' &&
  'readyForMe' in body &&
  typeof body.readyForMe === 'number' &&
  'festival' in body &&
  isFestival(body.festival);

const fmtInt = (n: number): string => Math.round(n).toLocaleString('en-US');

const stat = (emoji: string, value: string, label: string): HTMLSpanElement => {
  const span = el('span');
  span.textContent = `${emoji} ${value} ${label}`;
  return span;
};

const dot = (): HTMLSpanElement => el('span', { cls: 'hv-dot', text: '·' });

const fillStats = (
  statsEl: HTMLDivElement,
  hookEl: HTMLDivElement,
  s: Summary
): void => {
  statsEl.replaceChildren(
    stat('🏘', fmtInt(s.buildings), 'buildings'),
    dot(),
    stat('👥', fmtInt(s.players), 'villagers'),
    dot(),
    stat('🕰', `stage ${s.landmarkStage}/5`, '')
  );

  if (s.readyForMe > 0) {
    const plots = s.readyForMe === 1 ? 'plot is' : 'plots are';
    hookEl.textContent = `🪙 ${s.readyForMe} of your ${plots} ready to collect!`;
    hookEl.classList.add('is-ready');
  } else {
    const f = FEST_LABEL[s.festival];
    hookEl.textContent = `🎪 ${f.title} Festival today — ×1.5 ${f.noun} production!`;
    hookEl.classList.remove('is-ready');
  }
  hookEl.classList.remove('is-hidden');
};

const loadSummary = async (
  statsEl: HTMLDivElement,
  hookEl: HTMLDivElement
): Promise<void> => {
  try {
    const res = await fetch('/api/summary');
    if (!res.ok) throw new Error('summary unavailable');
    const body: unknown = await res.json();
    if (!isSummary(body)) throw new Error('bad summary shape');
    fillStats(statsEl, hookEl, body);
  } catch {
    // Silent in the feed: drop the stats + hook, keep the scene, title and CTA.
    statsEl.classList.add('is-hidden');
    hookEl.classList.add('is-hidden');
  }
};

// ── Content column ────────────────────────────────────────────────────────────

const buildContent = (): {
  content: HTMLDivElement;
  statsEl: HTMLDivElement;
  hookEl: HTMLDivElement;
  cta: HTMLButtonElement;
} => {
  const content = el('div', { cls: 'hv-content' });

  const name = context.username;
  if (name !== undefined && name.length > 0) {
    content.appendChild(el('div', { cls: 'hv-greet', text: `Welcome back, u/${name}` }));
  }

  content.appendChild(el('h1', { cls: 'hv-title', text: 'Hearthvale' }));
  content.appendChild(
    el('p', { cls: 'hv-tagline', text: 'a village your subreddit builds together' })
  );

  const statsEl = el('div', { cls: 'hv-stats' });
  statsEl.appendChild(el('span', { cls: 'hv-skel' }));
  statsEl.appendChild(dot());
  statsEl.appendChild(el('span', { cls: 'hv-skel' }));
  content.appendChild(statsEl);

  const hookEl = el('div', { cls: 'hv-hook is-hidden' });
  content.appendChild(hookEl);

  const cta = el('button', { cls: 'hv-cta', text: 'Enter the Village →' });
  cta.type = 'button';
  content.appendChild(cta);

  return { content, statsEl, hookEl, cta };
};

// ── Boot ──────────────────────────────────────────────────────────────────────

const mount = (): void => {
  const root = document.getElementById('splash-root');
  if (!root) return;

  injectPaletteVars();
  root.appendChild(buildScene());

  const { content, statsEl, hookEl, cta } = buildContent();
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
  void loadSummary(statsEl, hookEl);
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
