import { CATALOG, GRID_SIZE } from '../../shared/catalog';
import type { StateResponse } from '../../shared/types';
import { questSnapshot } from '../../shared/quests';
import { isClaimable, neighbors, tileKey } from '../../shared/logic/grid';
import { isRiver } from '../../shared/logic/expansion';
import { tileToScreen } from '../events';
import { store } from '../state';
import { el, todayUtc } from './dom';

/**
 * The guided walkthrough (U1) — an active coach-mark overlay that points new
 * players at the exact thing to do next. It complements the always-on Journal
 * banner: the banner says WHAT the current goal is; the walkthrough points WHERE
 * to tap, with a dimmed spotlight cut-out, a bouncing arrow and a small
 * parchment tip card (Kenney UI-pack art via CSS in dom.ts).
 *
 * Steps are derived from the same signals the Journal reads (owned plots, whether
 * a wheat field exists, collects, check-in, plus two "sheet seen" flags), so the
 * tour auto-advances the instant the player performs each action — nothing here
 * tracks progress independently. Targets resolve to either a DOM element (FABs,
 * the wheat-field build card, the Hall pill) or a scene tile (via the
 * `tileToScreen` bridge the Village scene registers); scene targets are tracked
 * live so the mark follows the map as it pans or zooms.
 *
 * The tour is one-shot per browser session (`sessionStorage`) and never shown to
 * veterans (anyone who has already earned/collected/levelled). It is skippable at
 * every step and degrades to a static arrow under `prefers-reduced-motion`.
 */

const DONE_KEY = 'hv-walkthrough-done';
const WHEATFIELD_COST = CATALOG.wheatfield.cost;

// Two flags for surfaces that have no player-state signal of their own: set when
// the Market / Village Hall sheets first open (see sheets.ts). Session-scoped.
let marketSeen = false;
let hallSeen = false;

/** Called by sheets.ts when the Market sheet opens (advances step 4→5). */
export const noteMarketOpened = (): void => {
  marketSeen = true;
  evaluate();
};
/** Called by sheets.ts when the Village Hall sheet opens (completes step 6). */
export const noteHallOpened = (): void => {
  hallSeen = true;
  evaluate();
};

// ── Step model ───────────────────────────────────────────────────────────────

type Target =
  | { kind: 'dom'; selector: string }
  | { kind: 'tile'; at: (data: StateResponse) => { x: number; y: number } | null };

type Step = {
  id: string;
  title: string;
  body: string;
  /** True once the player has performed this step's action. */
  done: (data: StateResponse, snap: ReturnType<typeof questSnapshot>) => boolean;
  target: (data: StateResponse) => Target | null;
};

/** Owned tiles of the player, with coords. */
const ownedTiles = (
  data: StateResponse,
  id: string
): Array<{ x: number; y: number; buildingId: string | undefined }> => {
  const out: Array<{ x: number; y: number; buildingId: string | undefined }> = [];
  for (const [key, tile] of Object.entries(data.grid)) {
    if (tile.owner !== id) continue;
    const [xs, ys] = key.split(',');
    out.push({ x: Number(xs), y: Number(ys), buildingId: tile.buildingId });
  }
  return out;
};

const isOpenTile = (data: StateResponse, x: number, y: number): boolean =>
  isClaimable(x, y) && !isRiver(x, y) && data.grid[tileKey(x, y)] === undefined;

/** The claimable, unowned, non-river tile nearest the village centre. */
const nearestClaimable = (
  data: StateResponse
): { x: number; y: number } | null => {
  const cx = (GRID_SIZE - 1) / 2;
  const cy = (GRID_SIZE - 1) / 2;
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let x = 0; x < GRID_SIZE; x += 1) {
    for (let y = 0; y < GRID_SIZE; y += 1) {
      if (!isOpenTile(data, x, y)) continue;
      const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best;
};

/** Where to send the player to build their first field: an already-claimed empty
 * plot if they have one, else an open tile beside their House, else the nearest
 * open tile. */
const buildSpot = (data: StateResponse, id: string): { x: number; y: number } | null => {
  const owned = ownedTiles(data, id);
  const empty = owned.find((t) => t.buildingId === undefined);
  if (empty) return { x: empty.x, y: empty.y };
  const house = owned.find((t) => t.buildingId === 'house') ?? owned[0];
  if (house) {
    for (const n of neighbors(house.x, house.y)) {
      if (isOpenTile(data, n.x, n.y)) return { x: n.x, y: n.y };
    }
  }
  return nearestClaimable(data);
};

const firstBuildingTile = (
  data: StateResponse,
  id: string,
  buildingId: string
): { x: number; y: number } | null => {
  const t = ownedTiles(data, id).find((o) => o.buildingId === buildingId);
  return t ? { x: t.x, y: t.y } : null;
};

const checkedInToday = (data: StateResponse): boolean =>
  data.me?.lastCheckIn === todayUtc();

const STEPS: Step[] = [
  {
    id: 'found',
    title: 'Found your homestead',
    body: 'Tap this patch of open grass to settle your first plot — your House rises here.',
    done: (_d, snap) => snap.owned >= 1,
    target: (data) => {
      const t = nearestClaimable(data);
      return t ? { kind: 'tile', at: () => nearestClaimable(store.data ?? data) } : null;
    },
  },
  {
    id: 'field',
    title: 'Build a Wheat Field',
    body: `Tap a tile beside your House, settle it, then build a Wheat Field (${WHEATFIELD_COST} coins). Wheat feeds the whole village.`,
    done: (_d, snap) => snap.wheatfieldBuilt,
    target: () => {
      // If the build sheet is open, point straight at the Wheat Field card.
      const card = document.querySelector('[data-build-id="wheatfield"]');
      if (card instanceof HTMLElement) return { kind: 'dom', selector: '[data-build-id="wheatfield"]' };
      return { kind: 'tile', at: (d) => buildSpot(d, d.me?.id ?? '') };
    },
  },
  {
    id: 'collect',
    title: 'Gather your harvest',
    body: 'Your field grows in real time. When a coin pops above it, tap the field to collect — it sells itself at the Market.',
    done: (data) => (data.me?.collects ?? 0) >= 1,
    target: () => ({
      kind: 'tile',
      at: (d) => firstBuildingTile(d, d.me?.id ?? '', 'wheatfield'),
    }),
  },
  {
    id: 'market',
    title: 'Visit the Market',
    body: "Your harvest sold itself at the Market. Open it to see today's prices and what the village needs.",
    done: () => marketSeen,
    target: () => ({ kind: 'dom', selector: '[data-fab="market"]' }),
  },
  {
    id: 'checkin',
    title: 'Check in daily',
    body: 'Warm yourself at the Hearth each day for coins, XP and a growing streak.',
    done: (data) => checkedInToday(data),
    target: () => ({ kind: 'dom', selector: '[data-fab="checkin"]' }),
  },
  {
    id: 'hall',
    title: 'Raise the Village Hall',
    body: "The Village Hall is everyone's goal — contribute planks and bricks to level the whole village up together.",
    done: () => hallSeen,
    target: () => {
      const pill = document.querySelector('.hv-keep-pill');
      if (pill instanceof HTMLElement && pill.offsetParent !== null) {
        return { kind: 'dom', selector: '.hv-keep-pill' };
      }
      return { kind: 'dom', selector: '.hv-obj-hall' };
    },
  },
];

// ── Overlay DOM ──────────────────────────────────────────────────────────────

let root: HTMLElement | undefined;
let spot: HTMLElement | undefined;
let arrow: HTMLElement | undefined;
let card: HTMLElement | undefined;
let stepLabel: HTMLElement | undefined;
let titleEl: HTMLElement | undefined;
let bodyEl: HTMLElement | undefined;
let dotsEl: HTMLElement | undefined;

let activeIndex = -1;
let rafId = 0;
let decided = false;

const isDone = (): boolean => {
  try {
    return sessionStorage.getItem(DONE_KEY) === '1';
  } catch {
    return false;
  }
};

const markDone = (): void => {
  try {
    sessionStorage.setItem(DONE_KEY, '1');
  } catch {
    // sessionStorage unavailable (private mode) — the in-memory guard still holds.
  }
};

/** A returning/experienced player who should never see the tour. */
const isVeteran = (data: StateResponse): boolean => {
  const me = data.me;
  if (!me) return false;
  const snap = questSnapshot(data.grid, me.id);
  return (
    me.level > 1 ||
    (me.collects ?? 0) > 0 ||
    (me.lifetimeEarned ?? 0) > 0 ||
    snap.owned > 1
  );
};

const build = (mount: HTMLElement): void => {
  spot = el('div', { cls: 'hv-wt-spot' });
  arrow = el('div', { cls: 'hv-wt-arrow', attrs: { role: 'presentation' } });

  stepLabel = el('p', { cls: 'hv-wt-step', text: '' });
  titleEl = el('p', { cls: 'hv-wt-title', text: '' });
  bodyEl = el('p', { cls: 'hv-wt-body', text: '' });
  dotsEl = el('div', { cls: 'hv-wt-dots' });
  const skip = el('button', {
    cls: 'hv-wt-skip',
    text: 'Skip tour',
    attrs: { type: 'button' },
    on: { click: () => complete() },
  });
  const foot = el('div', { cls: 'hv-wt-foot', children: [skip, dotsEl] });
  card = el('div', {
    cls: 'hv-wt-card',
    attrs: { role: 'dialog', 'aria-label': 'Getting started' },
    children: [stepLabel, titleEl, bodyEl, foot],
  });

  root = el('div', {
    cls: 'hv-wt-root is-hidden',
    children: [spot, arrow, card],
  });
  mount.appendChild(root);

  for (let i = 0; i < STEPS.length; i += 1) {
    dotsEl.appendChild(el('span', { cls: 'hv-wt-dot' }));
  }

  window.addEventListener('resize', () => {
    if (activeIndex >= 0) position();
  });
};

const hide = (): void => {
  if (root) root.classList.add('is-hidden');
  activeIndex = -1;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
};

const complete = (): void => {
  markDone();
  hide();
};

/** The first step whose action the player hasn't performed yet (or null when the
 * whole tour is finished). */
const activeStep = (data: StateResponse): { step: Step; index: number } | null => {
  const me = data.me;
  if (!me) return null;
  const snap = questSnapshot(data.grid, me.id);
  for (let i = 0; i < STEPS.length; i += 1) {
    const step = STEPS[i];
    if (!step) continue;
    if (!step.done(data, snap)) return { step, index: i };
  }
  return null;
};

const setStepContent = (step: Step, index: number): void => {
  if (!stepLabel || !titleEl || !bodyEl || !dotsEl) return;
  stepLabel.textContent = `Step ${index + 1} of ${STEPS.length}`;
  titleEl.textContent = step.title;
  bodyEl.textContent = step.body;
  const dots = dotsEl.children;
  for (let i = 0; i < dots.length; i += 1) {
    dots[i]?.classList.toggle('is-on', i === index);
  }
};

/** Resolve the active target to a viewport-space rectangle, or null when it can't
 * be placed right now (e.g. a scene tile scrolled off-canvas). */
const targetRect = (
  target: Target,
  data: StateResponse
): { x: number; y: number; w: number; h: number } | null => {
  if (target.kind === 'dom') {
    const node = document.querySelector(target.selector);
    if (!(node instanceof HTMLElement) || node.offsetParent === null) return null;
    const r = node.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }
  const tile = target.at(data);
  if (!tile) return null;
  const pt = tileToScreen(tile.x, tile.y);
  if (!pt) return null;
  const w = 76;
  const h = 54;
  return { x: pt.x - w / 2, y: pt.y - h / 2, w, h };
};

/** Place the spotlight, arrow and tip card around the current target rect. */
const position = (): void => {
  const data = store.data;
  if (!root || !spot || !arrow || !card || activeIndex < 0 || !data) return;
  const step = STEPS[activeIndex];
  if (!step) return;
  const target = step.target(data);
  const rect = target ? targetRect(target, data) : null;
  if (!target || !rect) {
    // Target not resolvable this frame — keep the card up but drop the spotlight
    // and arrow so nothing points at empty space.
    spot.style.opacity = '0';
    arrow.style.opacity = '0';
    return;
  }
  // A scene tile whose sheet is now open is hidden behind the modal — drop the
  // spotlight so the (skinned) modal shows at full brightness. DOM targets such
  // as the Wheat Field card live inside the modal and stay spotlit.
  const modalOpen = document.querySelector('.hv-backdrop.is-open') !== null;
  const hideMark = target.kind === 'tile' && modalOpen;
  spot.style.opacity = hideMark ? '0' : '1';
  arrow.style.opacity = hideMark ? '0' : '1';

  const pad = target.kind === 'dom' ? 8 : 4;
  spot.style.left = `${rect.x - pad}px`;
  spot.style.top = `${rect.y - pad}px`;
  spot.style.width = `${rect.w + pad * 2}px`;
  spot.style.height = `${rect.h + pad * 2}px`;

  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Arrow above the target pointing down; flip below (pointing up) near the top.
  const above = rect.y > 96;
  arrow.style.setProperty('--rot', above ? '180deg' : '0deg');
  arrow.style.left = `${cx}px`;
  arrow.style.top = `${above ? rect.y - 26 : rect.y + rect.h + 26}px`;

  // Tip card horizontally centred (stable, never hugs a screen edge) and in the
  // vertical half opposite the target so it never covers the spotlight.
  const cw = card.offsetWidth || 280;
  const ch = card.offsetHeight || 150;
  const left = Math.max(12, Math.min((vw - cw) / 2, vw - cw - 12));
  const top = cy < vh * 0.5 ? vh - ch - 24 : 96;
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
};

/** Reposition every frame while a step is active (cheap: a few reads + writes),
 * so scene targets track the camera and DOM targets track any reflow. */
const loop = (): void => {
  if (activeIndex < 0) return;
  position();
  rafId = requestAnimationFrame(loop);
};

const show = (step: Step, index: number): void => {
  if (!root) return;
  const changed = index !== activeIndex;
  activeIndex = index;
  root.classList.remove('is-hidden');
  if (changed) setStepContent(step, index);
  position();
  if (!rafId) rafId = requestAnimationFrame(loop);
};

/** Re-derive the tour state from the store and reflect it in the overlay. */
const evaluate = (): void => {
  if (!root) return;
  const data = store.data;
  if (!data || !data.me) {
    hide();
    return;
  }
  if (isDone()) {
    hide();
    return;
  }
  if (!decided) {
    decided = true;
    if (isVeteran(data)) {
      complete();
      return;
    }
  }
  const active = activeStep(data);
  if (!active) {
    complete();
    return;
  }
  show(active.step, active.index);
};

/** Mount the walkthrough overlay and begin mirroring the store. Call once, after
 * the HUD chrome is in place. */
export const initWalkthrough = (mount: HTMLElement): void => {
  if (root) return;
  build(mount);
  store.on('change', evaluate);
  evaluate();
};
