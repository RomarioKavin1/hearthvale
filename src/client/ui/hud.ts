import type { Game } from 'phaser';
import { MAX_LEVEL, PLOT_LEVELS } from '../../shared/catalog';
import type { PlayerState, StateResponse } from '../../shared/types';
import { xpFor } from '../../shared/logic/economy';
import type { HvTileSelected } from '../events';
import { HV_TILE_SELECTED } from '../events';
import { api } from '../net';
import { store } from '../state';
import {
  CATEGORY_META,
  clearPending,
  el,
  fmtInt,
  injectStyles,
  isPending,
  markPending,
  mountToasts,
  notifyError,
  ownedCount,
  promptLogin,
  readyCount,
  setGame,
  toast,
  todayUtc,
} from './dom';
import { mountSheetRoot } from './sheet';
import { openMenuSheet, openTileSheet } from './panels';

/**
 * The persistent HUD chrome: the top resource bar, the bottom-right FAB stack,
 * the toast host, the onboarding overlay, and `initHud` — the entry point
 * `game.ts` calls once Phaser has booted. Everything reads from `store` and
 * re-renders on `'change'`; nothing here is torn down (it lives for the whole
 * session), so there are no listener leaks to chase.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const RING_R = 16;
const RING_C = 2 * Math.PI * RING_R;

// Persistent element references (built once, updated on each render).
let coinsChip: HTMLElement;
let coinsNum: HTMLElement;
let suppliesChip: HTMLElement;
let suppliesNum: HTMLElement;
let ring: HTMLElement;
let ringProgress: SVGCircleElement;
let ringLevel: HTMLElement;
let festChip: HTMLElement;
let festEmoji: HTMLElement;
let festLabel: HTMLElement;
let signinPill: HTMLElement;

let collectFab: HTMLButtonElement;
let collectBadge: HTMLElement;
let checkinFab: HTMLButtonElement;
let checkinStreak: HTMLElement;

let onboard: HTMLElement;
let onboardDismissed = false;

// Count-up animation + level-up tracking.
const rafMap = new Map<HTMLElement, number>();
let lastCoins = 0;
let lastSupplies = 0;
let prevLevel: number | null = null;

// ── Entry point ──────────────────────────────────────────────────────────────

export const initHud = (game: Game): void => {
  setGame(game);
  injectStyles();

  const host = document.getElementById('app') ?? document.body;
  const hud = el('div', { attrs: { id: 'hv-hud' } });
  host.appendChild(hud);

  hud.appendChild(buildTopBar());
  hud.appendChild(buildFabs());
  hud.appendChild(buildOnboarding());
  mountSheetRoot(hud);
  mountToasts(hud);

  window.addEventListener(HV_TILE_SELECTED, (e: Event) => {
    if (e instanceof CustomEvent) {
      const detail: HvTileSelected = e.detail;
      openTileSheet(detail);
    }
  });

  store.on('change', renderHud);
  // Buildings ripen over time without a store change, so refresh the FAB state
  // (Collect-All badge, check-in availability) on a light cadence too.
  window.setInterval(renderHud, 4000);
  renderHud();
};

// ── Top bar ──────────────────────────────────────────────────────────────────

const buildChip = (swatchColor: string, emoji: string): { chip: HTMLElement; num: HTMLElement } => {
  const num = el('span', { cls: 'hv-chip-num', text: '0' });
  const chip = el('div', {
    cls: 'hv-chip',
    children: [
      el('span', { cls: 'hv-swatch', attrs: { style: `background:${swatchColor}` } }),
      el('span', { cls: 'hv-chip-emoji', text: emoji }),
      num,
    ],
  });
  return { chip, num };
};

const buildRing = (): void => {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '40');
  svg.setAttribute('height', '40');
  svg.setAttribute('viewBox', '0 0 40 40');

  const track = document.createElementNS(SVG_NS, 'circle');
  track.setAttribute('cx', '20');
  track.setAttribute('cy', '20');
  track.setAttribute('r', String(RING_R));
  track.setAttribute('fill', 'none');
  track.setAttribute('stroke', 'var(--wall-shade)');
  track.setAttribute('stroke-width', '4');

  ringProgress = document.createElementNS(SVG_NS, 'circle');
  ringProgress.setAttribute('cx', '20');
  ringProgress.setAttribute('cy', '20');
  ringProgress.setAttribute('r', String(RING_R));
  ringProgress.setAttribute('fill', 'none');
  ringProgress.setAttribute('stroke', 'var(--glow)');
  ringProgress.setAttribute('stroke-width', '4');
  ringProgress.setAttribute('stroke-linecap', 'round');
  ringProgress.setAttribute('stroke-dasharray', String(RING_C));
  ringProgress.setAttribute('stroke-dashoffset', String(RING_C));
  ringProgress.setAttribute('transform', 'rotate(-90 20 20)');

  svg.appendChild(track);
  svg.appendChild(ringProgress);

  ringLevel = el('span', { cls: 'hv-ring-lvl', text: '1' });
  ring = el('div', { cls: 'hv-ring', attrs: { title: 'Level' } });
  ring.appendChild(svg);
  ring.appendChild(ringLevel);
};

const buildTopBar = (): HTMLElement => {
  const coins = buildChip('var(--straw)', '🪙');
  coinsChip = coins.chip;
  coinsNum = coins.num;
  const supplies = buildChip('var(--leaf)', '🌿');
  suppliesChip = supplies.chip;
  suppliesNum = supplies.num;

  buildRing();

  festEmoji = el('span', { cls: 'hv-chip-emoji', text: '🪙' });
  festLabel = el('span', { cls: 'hv-fest-label', text: 'Festival' });
  festChip = el('div', {
    cls: 'hv-fest',
    attrs: { title: 'Today’s festival' },
    children: [festEmoji, festLabel],
  });

  signinPill = el('button', {
    cls: 'hv-signin-pill',
    attrs: { type: 'button' },
    text: '👋 Sign in to start building',
    on: { click: () => promptLogin() },
  });

  return el('div', {
    cls: 'hv-topbar',
    children: [coinsChip, suppliesChip, ring, festChip, signinPill],
  });
};

// ── FAB stack ────────────────────────────────────────────────────────────────

const buildFab = (
  emoji: string,
  caption: string,
  primary: boolean
): HTMLButtonElement => {
  return el('button', {
    cls: `hv-fab${primary ? ' hv-primary' : ''}`,
    attrs: { type: 'button' },
    children: [
      el('span', { cls: 'hv-fab-emoji', text: emoji }),
      el('span', { cls: 'hv-fab-cap', text: caption }),
    ],
  });
};

const buildFabs = (): HTMLElement => {
  collectFab = buildFab('🧺', 'Collect', true);
  collectBadge = el('span', { cls: 'hv-fab-badge' });
  collectFab.appendChild(collectBadge);
  collectFab.addEventListener('click', doCollectAll);

  checkinFab = buildFab('🔥', 'Check in', false);
  checkinStreak = el('span', { cls: 'hv-streak' });
  checkinFab.appendChild(checkinStreak);
  checkinFab.addEventListener('click', doCheckin);

  const menuFab = buildFab('☰', 'Menu', false);
  menuFab.addEventListener('click', () => openMenuSheet());

  return el('div', {
    cls: 'hv-fabs',
    children: [collectFab, checkinFab, menuFab],
  });
};

const doCollectAll = (): void => {
  if (isPending('collectAll')) return;
  markPending('collectAll');
  renderHud();
  void api
    .collectAll()
    .then(async (res) => {
      store.applyMutation({ me: res.me });
      const got = res.gained.coins + res.gained.supplies;
      if (got > 0) toast(`Collected +${fmtInt(got)} 🪙🌿`, 'gain');
      // Returned tiles carry no keys, so resync the grid to clear ready pips.
      await store.refresh();
    })
    .catch((err: unknown) =>
      notifyError(err instanceof Error ? err.message : 'Could not collect.')
    )
    .finally(() => {
      clearPending('collectAll');
      renderHud();
    });
};

const doCheckin = (): void => {
  if (isPending('checkin')) return;
  markPending('checkin');
  renderHud();
  void api
    .checkin()
    .then((res) => {
      store.applyMutation({ me: res.me });
      toast(`Checked in! 🔥${res.me.streak} — +${fmtInt(res.gained.coins)} 🪙`, 'celebrate');
    })
    .catch((err: unknown) =>
      notifyError(err instanceof Error ? err.message : 'Could not check in.')
    )
    .finally(() => {
      clearPending('checkin');
      renderHud();
    });
};

// ── Onboarding overlay ───────────────────────────────────────────────────────

const buildOnboarding = (): HTMLElement => {
  const dismiss = el('button', {
    cls: 'hv-onboard-dismiss',
    text: '✕',
    attrs: { type: 'button', 'aria-label': 'Dismiss' },
    on: {
      click: () => {
        onboardDismissed = true;
        renderHud();
      },
    },
  });
  const card = el('div', {
    cls: 'hv-onboard-card',
    children: [
      dismiss,
      el('h3', { text: 'Welcome to Hearthvale 🏡' }),
      el('p', { text: 'Tap any open grass tile to settle your first plot.' }),
      el('div', { cls: 'hv-onboard-arrow', text: '⌄' }),
    ],
  });
  onboard = el('div', { cls: 'hv-onboard', children: [card] });
  onboard.style.display = 'none';
  return onboard;
};

// ── Render ───────────────────────────────────────────────────────────────────

const animateCount = (span: HTMLElement, from: number, to: number): void => {
  const existing = rafMap.get(span);
  if (existing !== undefined) cancelAnimationFrame(existing);
  if (from === to) {
    span.textContent = fmtInt(to);
    rafMap.delete(span);
    return;
  }
  const start = performance.now();
  const step = (t: number): void => {
    const k = Math.min(1, (t - start) / 400);
    span.textContent = fmtInt(from + (to - from) * k);
    if (k < 1) rafMap.set(span, requestAnimationFrame(step));
    else rafMap.delete(span);
  };
  rafMap.set(span, requestAnimationFrame(step));
};

const renderFestival = (data: StateResponse): void => {
  const meta = CATEGORY_META[data.city.festival];
  festEmoji.textContent = meta.emoji;
  festLabel.textContent = meta.label;
  festChip.style.borderColor = meta.color;
};

const renderPlayer = (me: PlayerState): void => {
  coinsChip.style.display = '';
  suppliesChip.style.display = '';
  ring.style.display = '';
  signinPill.style.display = 'none';

  animateCount(coinsNum, lastCoins, me.coins);
  animateCount(suppliesNum, lastSupplies, me.supplies);
  lastCoins = me.coins;
  lastSupplies = me.supplies;

  const cur = xpFor(me.level);
  const next = xpFor(me.level + 1);
  const denom = next - cur;
  const frac = me.level >= MAX_LEVEL || denom <= 0 ? 1 : (me.xp - cur) / denom;
  const clamped = Math.max(0, Math.min(1, frac));
  ringProgress.setAttribute('stroke-dashoffset', String(RING_C * (1 - clamped)));
  ringLevel.textContent = String(me.level);

  if (prevLevel !== null && me.level > prevLevel) {
    const unlocked = PLOT_LEVELS.includes(me.level);
    toast(
      `Level ${me.level}!${unlocked ? ' New plot unlocked 🎉' : ' 🎉'}`,
      'celebrate'
    );
  }
  prevLevel = me.level;
};

const renderLoggedOut = (): void => {
  coinsChip.style.display = 'none';
  suppliesChip.style.display = 'none';
  ring.style.display = 'none';
  signinPill.style.display = '';
};

const renderFabs = (data: StateResponse, me: PlayerState | null): void => {
  if (!me) {
    collectFab.style.display = 'none';
    checkinFab.style.display = 'none';
    return;
  }
  const now = store.serverNow();
  const ready = readyCount(data, me.id, now);
  const busyCollect = isPending('collectAll');
  collectFab.style.display = ready > 0 || busyCollect ? '' : 'none';
  collectBadge.textContent = String(ready);
  collectBadge.style.display = ready > 0 ? '' : 'none';
  collectFab.disabled = busyCollect || ready === 0;

  checkinFab.style.display = '';
  const checkedIn = me.lastCheckIn === todayUtc();
  checkinFab.disabled = checkedIn || isPending('checkin');
  checkinStreak.textContent = me.streak > 0 ? String(me.streak) : '';
  checkinStreak.style.display = me.streak > 0 ? '' : 'none';
};

const renderOnboarding = (data: StateResponse, me: PlayerState | null): void => {
  const show =
    me !== null && !onboardDismissed && ownedCount(data, me.id) === 0;
  onboard.style.display = show ? '' : 'none';
};

const renderHud = (): void => {
  const data = store.data;
  if (!data) return;
  const me = data.me;

  renderFestival(data);
  if (me) renderPlayer(me);
  else renderLoggedOut();
  renderFabs(data, me);
  renderOnboarding(data, me);
};
