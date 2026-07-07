import { context, requestExpandedMode } from '@devvit/web/client';
import { PAL } from '../shared/palette';

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

type Summary = {
  buildings: number;
  players: number;
  landmarkStage: number;
  readyForMe: number;
  weather: Weather;
  hotGood: string;
  hotPrice: number;
};

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

// ── Scene assembly (all shapes are CSS; roofs/windows are pseudo-elements) ─────

const buildScene = (): { scene: HTMLDivElement; keepEl: HTMLDivElement } => {
  const scene = el('div', { cls: 'hv-scene' });
  scene.appendChild(el('div', { cls: 'hv-cloud c1' }));
  scene.appendChild(el('div', { cls: 'hv-cloud c2' }));

  const island = el('div', { cls: 'hv-island' });

  const hamlet = el('div', { cls: 'hv-hamlet' });
  hamlet.appendChild(el('div', { cls: 'hv-house r-red' }));
  const keepEl = el('div', { cls: 'hv-keep is-hidden' });
  hamlet.appendChild(keepEl);
  hamlet.appendChild(el('div', { cls: 'hv-house r-blue' }));
  hamlet.appendChild(el('div', { cls: 'hv-house r-straw' }));

  island.appendChild(hamlet);
  island.appendChild(el('div', { cls: 'hv-grass' }));
  island.appendChild(el('div', { cls: 'hv-dirt' }));
  island.appendChild(el('div', { cls: 'hv-leg l1' }));
  island.appendChild(el('div', { cls: 'hv-leg l2' }));

  scene.appendChild(island);
  return { scene, keepEl };
};

// ── Live-stats plumbing ───────────────────────────────────────────────────────

const isWeather = (value: unknown): value is Weather =>
  value === 'sunny' ||
  value === 'rain' ||
  value === 'clear' ||
  value === 'harvestmoon';

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
  'weather' in body &&
  isWeather(body.weather) &&
  'hotGood' in body &&
  typeof body.hotGood === 'string' &&
  'hotPrice' in body &&
  typeof body.hotPrice === 'number';

const fmtInt = (n: number): string => Math.round(n).toLocaleString('en-US');

const chip = (text: string): HTMLSpanElement => el('span', { cls: 'hv-chip', text });

const fillStats = (
  statsEl: HTMLDivElement,
  hookEl: HTMLDivElement,
  keepEl: HTMLDivElement,
  s: Summary
): void => {
  statsEl.replaceChildren(
    chip(`${fmtInt(s.buildings)} buildings`),
    chip(`${fmtInt(s.players)} villagers`),
    chip(`Keep stage ${s.landmarkStage}/5`)
  );

  if (s.landmarkStage >= 1) keepEl.classList.remove('is-hidden');
  else keepEl.classList.add('is-hidden');

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
  statsEl: HTMLDivElement,
  hookEl: HTMLDivElement,
  keepEl: HTMLDivElement
): Promise<void> => {
  try {
    const res = await fetch('/api/summary');
    if (!res.ok) throw new Error('summary unavailable');
    const body: unknown = await res.json();
    if (!isSummary(body)) throw new Error('bad summary shape');
    fillStats(statsEl, hookEl, keepEl, body);
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
  statsEl.appendChild(el('span', { cls: 'hv-skel' }));
  content.appendChild(statsEl);

  const hookEl = el('div', { cls: 'hv-hook is-hidden' });
  content.appendChild(hookEl);

  const cta = el('button', { cls: 'hv-cta', text: 'Enter the Village' });
  cta.type = 'button';
  content.appendChild(cta);

  return { content, statsEl, hookEl, cta };
};

// ── Boot ──────────────────────────────────────────────────────────────────────

const mount = (): void => {
  const root = document.getElementById('splash-root');
  if (!root) return;

  injectPaletteVars();
  const { scene, keepEl } = buildScene();
  root.appendChild(scene);

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
  void loadSummary(statsEl, hookEl, keepEl);
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
