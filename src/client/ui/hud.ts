import type { Game } from 'phaser';
import {
  KEEP_STAGE_COSTS,
  MARKET,
  MAX_LEVEL,
  PLOT_LEVELS,
} from '../../shared/catalog';
import type { Good, PlayerState, StateResponse } from '../../shared/types';
import { GOODS, goodsTotal, xpFor } from '../../shared/logic/economy';
import type { HvTileSelected } from '../events';
import { HV_TILE_SELECTED } from '../events';
import { api } from '../net';
import { store } from '../state';
import {
  activeQuest,
  CATEGORY_META,
  clearPending,
  el,
  FESTIVAL_TIP,
  fmtInt,
  GOOD_LABEL,
  goodIcon,
  iconEl,
  injectStyles,
  isPending,
  markPending,
  mountToasts,
  notifyError,
  promptLogin,
  readyCount,
  setGame,
  toast,
  toastAction,
  todayUtc,
  WEATHER_META,
  WEATHER_TIP,
  withTip,
} from './dom';
import type { ShareKind } from '../net';
import { mountSheetRoot } from './sheet';
import { openMenuSheet, openTileSheet } from './panels';
import { openKeepSheet, openLevelSheet, openMarketSheet } from './sheets';
import { mountJournal } from './journal';

/**
 * The persistent HUD chrome: the top resource bar, the wallet drawer, the
 * bottom-right FAB rail, the toast host, the first-run tutorial, and `initHud`
 * — the entry point `game.ts` calls once Phaser has booted. Everything reads from
 * `store` and re-renders on `'change'`; nothing here is torn down (it lives for
 * the whole session), so there are no listener leaks to chase.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const RING_R = 16;
const RING_C = 2 * Math.PI * RING_R;

// Persistent element references (built once, updated on each render).
let coinsChip: HTMLButtonElement;
let coinsNum: HTMLElement;
let ring: HTMLElement;
let ringProgress: SVGCircleElement;
let ringLevel: HTMLElement;
let weatherChip: HTMLElement;
let weatherIcon: HTMLElement;
let weatherLabel: HTMLElement;
let festChip: HTMLElement;
let festIcon: HTMLElement;
let festLabel: HTMLElement;
let signinPill: HTMLElement;
let walletCaret: HTMLButtonElement;

// Keep pill (top-left column, beneath the Journal banner).
let keepPill: HTMLButtonElement;
let keepLabel: HTMLElement;
let keepFill: HTMLElement;

let walletDrawer: HTMLElement;
let walletOpen = false;
const walletCounts = new Map<Good, HTMLElement>();

let collectFab: HTMLButtonElement;
let collectBadge: HTMLElement;
let marketFab: HTMLButtonElement;
let marketPulse: HTMLElement;
let checkinFab: HTMLButtonElement;
let checkinStreak: HTMLElement;

// Count-up animation + level-up tracking.
const rafMap = new Map<HTMLElement, number>();
let lastCoins = 0;
let prevLevel: number | null = null;
let prevStage: number | null = null;

// Collapsible objectives (top-left column): after 6s without interaction — or
// immediately when the player touches the map — the Journal banner + Hall pill
// give way to two compact chips; tapping a chip re-expands for 8s. Pure
// presentation, nothing persisted.
const OBJ_IDLE_MS = 6000;
const OBJ_PEEK_MS = 8000;
const OBJ_RING_R = 16;
const OBJ_RING_C = 2 * Math.PI * OBJ_RING_R;
let topLeft: HTMLElement;
let jrChip: HTMLButtonElement;
let jrChipRing: SVGCircleElement;
let hallChip: HTMLButtonElement;
let hallChipLvl: HTMLElement;
let objTimer: number | undefined;
/** `${index}:${lap}:${done}` for the last-seen quest ('' = none) — expansion edge. */
let prevQuestSig: string | null = null;

// ── Entry point ──────────────────────────────────────────────────────────────

export const initHud = (game: Game): void => {
  setGame(game);
  injectStyles();

  const host = document.getElementById('app') ?? document.body;
  const hud = el('div', { attrs: { id: 'hv-hud' } });
  host.appendChild(hud);

  hud.appendChild(buildTopBar());
  hud.appendChild(buildWalletDrawer());
  hud.appendChild(buildFabs());

  // Top-left column: the Journal banner, then the Keep pill, stacked — plus
  // their compact collapsed chips (visible only while the column is collapsed).
  topLeft = el('div', { cls: 'hv-topleft' });
  hud.appendChild(topLeft);
  mountJournal(topLeft);
  topLeft.appendChild(buildKeepPill());
  topLeft.appendChild(buildJournalChip());
  topLeft.appendChild(buildHallChip());
  initObjectivesCollapse();

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
  ring = el('button', {
    cls: 'hv-ring',
    attrs: { type: 'button' },
    on: { click: () => openLevelSheet() },
  });
  withTip(ring, () => `Level ${store.data?.me?.level ?? 1} — tap for unlocks`);
  ring.appendChild(svg);
  ring.appendChild(ringLevel);
};

const buildTopBar = (): HTMLElement => {
  // Left: coins chip + a caret that toggles the goods wallet drawer.
  coinsNum = el('span', { cls: 'hv-chip-num', text: '0' });
  coinsChip = el('button', {
    cls: 'hv-chip',
    attrs: { type: 'button' },
    children: [iconEl('icon-coin', 16), coinsNum],
    on: { click: () => toggleWallet() },
  });
  withTip(coinsChip, 'Your coins — tap for wallet');
  walletCaret = el('button', {
    cls: 'hv-caret',
    attrs: { type: 'button' },
    children: [iconEl('icon-arrow-down', 16)],
    on: { click: () => toggleWallet() },
  });
  withTip(walletCaret, 'Show your goods');
  const left = el('div', { cls: 'hv-tb-left', children: [coinsChip, walletCaret] });

  // Right: level ring (logged in) or the sign-in pill (logged out).
  buildRing();
  signinPill = el('button', {
    cls: 'hv-signin-pill',
    attrs: { type: 'button' },
    children: [iconEl('icon-home', 15), el('span', { text: 'Sign in to build' })],
    on: { click: () => promptLogin() },
  });
  const right = el('div', { cls: 'hv-tb-right', children: [ring, signinPill] });

  // Center: weather + festival, cream-on-ink, truncating on narrow screens.
  weatherIcon = iconEl('icon-star', 14);
  weatherLabel = el('span', { cls: 'hv-tb-label', text: 'Sunny' });
  weatherChip = el('div', {
    cls: 'hv-tb-chip',
    children: [weatherIcon, weatherLabel],
  });
  withTip(weatherChip, () => WEATHER_TIP[store.data?.weather ?? 'sunny']);
  festIcon = iconEl('icon-coin', 14);
  festLabel = el('span', { cls: 'hv-tb-label', text: 'Festival' });
  festChip = el('div', {
    cls: 'hv-tb-chip hv-tb-fest',
    children: [festIcon, festLabel],
  });
  withTip(festChip, () => FESTIVAL_TIP[store.data?.city.festival ?? 'coins']);
  const center = el('div', { cls: 'hv-tb-center', children: [weatherChip, festChip] });

  return el('div', { cls: 'hv-topbar', children: [left, center, right] });
};

// ── Wallet drawer ────────────────────────────────────────────────────────────

const buildWalletDrawer = (): HTMLElement => {
  walletDrawer = el('div', { cls: 'hv-wallet' });
  for (const good of GOODS) {
    const count = el('span', { cls: 'hv-wallet-count', text: '0' });
    walletCounts.set(good, count);
    const row = el('button', {
      cls: 'hv-wallet-row',
      attrs: { type: 'button' },
      children: [
        goodIcon(good, 24),
        el('div', {
          cls: 'hv-wallet-main',
          children: [
            el('span', { cls: 'hv-wallet-name', text: GOOD_LABEL[good] }),
            count,
          ],
        }),
      ],
      on: {
        click: () => {
          setWallet(false);
          openMarketSheet(good);
        },
      },
    });
    walletDrawer.appendChild(row);
  }
  return walletDrawer;
};

const setWallet = (open: boolean): void => {
  walletOpen = open;
  walletDrawer.classList.toggle('is-open', open);
  walletCaret.classList.toggle('is-open', open);
};

const toggleWallet = (): void => {
  if (!store.data?.me) {
    promptLogin();
    return;
  }
  setWallet(!walletOpen);
};

// ── FAB stack ────────────────────────────────────────────────────────────────

const buildFab = (
  icon: HTMLElement,
  caption: string,
  tip: string,
  primary: boolean
): HTMLButtonElement => {
  const fab = el('button', {
    cls: `hv-fab${primary ? ' hv-primary' : ''}`,
    attrs: { type: 'button' },
    children: [icon, el('span', { cls: 'hv-fab-cap', text: caption })],
  });
  return withTip(fab, tip);
};

const buildFabs = (): HTMLElement => {
  // Order top→bottom: Collect · Market · Check in · Menu.
  collectFab = buildFab(
    iconEl('icon-coin', 24),
    'Collect',
    'Collect every ready building at once',
    true
  );
  collectBadge = el('span', { cls: 'hv-fab-badge' });
  collectFab.appendChild(collectBadge);
  collectFab.addEventListener('click', doCollectAll);

  marketFab = buildFab(
    iconEl('icon-cart', 24),
    'Market',
    'Open the village market to buy and sell goods',
    false
  );
  marketPulse = el('span', { cls: 'hv-fab-pulse' });
  marketPulse.style.display = 'none';
  marketFab.appendChild(marketPulse);
  marketFab.addEventListener('click', () => openMarketSheet());

  checkinFab = buildFab(
    iconEl('icon-streak', 24),
    'Check in',
    'Daily check-in — coins and a growing streak',
    false
  );
  checkinStreak = el('span', { cls: 'hv-streak' });
  checkinFab.appendChild(checkinStreak);
  checkinFab.addEventListener('click', doCheckin);

  const menuFab = buildFab(
    iconEl('icon-gear', 24),
    'Menu',
    'Market, trader, hall, ballot, leaderboards and help',
    false
  );
  menuFab.addEventListener('click', () => openMenuSheet());

  return el('div', {
    cls: 'hv-fabs',
    children: [collectFab, marketFab, checkinFab, menuFab],
  });
};

// ── Hall pill (collective goal, always in view) ──────────────────────────────

const buildKeepPill = (): HTMLButtonElement => {
  keepLabel = el('span', { cls: 'hv-keep-label', text: 'Hall' });
  keepFill = el('i');
  keepPill = el('button', {
    cls: 'hv-keep-pill',
    attrs: { type: 'button' },
    children: [
      iconEl('icon-trophy', 15),
      el('div', {
        cls: 'hv-keep-main',
        children: [
          keepLabel,
          el('div', { cls: 'hv-keep-bar', children: [keepFill] }),
        ],
      }),
    ],
    on: { click: () => openKeepSheet() },
  });
  withTip(keepPill, 'Village Hall — tap to contribute planks and bricks');
  return keepPill;
};

const renderKeepPill = (data: StateResponse): void => {
  const level = data.city.hallLevel;
  const stages = KEEP_STAGE_COSTS.length;
  if (level >= stages) {
    keepLabel.textContent = 'Hall complete';
    keepFill.style.width = '100%';
    return;
  }
  const cost = KEEP_STAGE_COSTS[level] ?? { planks: 0, bricks: 0 };
  const have = data.city.stagePlanks + data.city.stageBricks;
  const need = cost.planks + cost.bricks;
  const frac = need > 0 ? have / need : 0;
  const pct = Math.round(Math.max(0, Math.min(1, frac)) * 100);
  // The population half of the level-up gate: villagers here / needed next.
  const popNeed = data.ring.nextThreshold;
  const villagers =
    popNeed !== null ? ` · villagers ${data.ring.population}/${popNeed}` : '';
  keepLabel.textContent = `Hall L${level} · resources ${pct}%${villagers}`;
  keepFill.style.width = `${pct}%`;
};

// ── Collapsible objectives (banner + pill ⇄ compact chips) ───────────────────

const setObjCollapsed = (collapsed: boolean): void => {
  topLeft.classList.toggle('is-collapsed', collapsed);
};

/** (Re)arm the auto-collapse timer. */
const armObjTimer = (ms: number): void => {
  if (objTimer !== undefined) window.clearTimeout(objTimer);
  objTimer = window.setTimeout(() => {
    objTimer = undefined;
    setObjCollapsed(true);
  }, ms);
};

/** Expand the column now and collapse again after `ms` of no interaction. */
const expandObjectives = (ms: number): void => {
  setObjCollapsed(false);
  armObjTimer(ms);
};

const initObjectivesCollapse = (): void => {
  armObjTimer(OBJ_IDLE_MS);
  // The HUD root is pointer-events:none, so a map drag's pointerdown targets the
  // canvas — any press whose target is outside the column collapses it at once,
  // while presses inside it just restart the idle window.
  window.addEventListener('pointerdown', (e: PointerEvent) => {
    const t = e.target;
    if (t instanceof Node && topLeft.contains(t)) {
      armObjTimer(OBJ_IDLE_MS);
      return;
    }
    if (objTimer !== undefined) {
      window.clearTimeout(objTimer);
      objTimer = undefined;
    }
    setObjCollapsed(true);
  });
};

/** The journal chip: a circle with the scroll icon wrapped by a thin progress
 * ring; turns gold (CSS .is-claimable) with a gentle pulse when claimable. */
const buildJournalChip = (): HTMLButtonElement => {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 40 40');

  const track = document.createElementNS(SVG_NS, 'circle');
  track.setAttribute('cx', '20');
  track.setAttribute('cy', '20');
  track.setAttribute('r', String(OBJ_RING_R));
  track.setAttribute('fill', 'none');
  track.setAttribute('stroke', 'var(--wall-shade)');
  track.setAttribute('stroke-width', '3');

  jrChipRing = document.createElementNS(SVG_NS, 'circle');
  jrChipRing.setAttribute('cx', '20');
  jrChipRing.setAttribute('cy', '20');
  jrChipRing.setAttribute('r', String(OBJ_RING_R));
  jrChipRing.setAttribute('fill', 'none');
  jrChipRing.setAttribute('stroke', 'var(--leaf)');
  jrChipRing.setAttribute('stroke-width', '3');
  jrChipRing.setAttribute('stroke-linecap', 'round');
  jrChipRing.setAttribute('stroke-dasharray', String(OBJ_RING_C));
  jrChipRing.setAttribute('stroke-dashoffset', String(OBJ_RING_C));
  jrChipRing.setAttribute('transform', 'rotate(-90 20 20)');

  svg.appendChild(track);
  svg.appendChild(jrChipRing);

  jrChip = el('button', {
    cls: 'hv-obj-chip hv-obj-jr',
    attrs: { type: 'button', 'aria-label': 'Current goal — tap to expand' },
    children: [iconEl('icon-scroll', 16)],
    on: { click: () => expandObjectives(OBJ_PEEK_MS) },
  });
  jrChip.appendChild(svg);
  jrChip.style.display = 'none';
  return jrChip;
};

/** The hall chip: a tiny dark circle with the trophy icon + hall level number. */
const buildHallChip = (): HTMLButtonElement => {
  hallChipLvl = el('span', { cls: 'hv-obj-lvl', text: '0' });
  hallChip = el('button', {
    cls: 'hv-obj-chip hv-obj-hall',
    attrs: { type: 'button', 'aria-label': 'Village Hall — tap to expand' },
    children: [iconEl('icon-trophy', 13), hallChipLvl],
    on: { click: () => expandObjectives(OBJ_PEEK_MS) },
  });
  return hallChip;
};

/** Mirror quest/hall state onto the chips; auto-expand on a quest edge (done
 * flips true, or a brand-new quest arrives). */
const renderObjChips = (data: StateResponse): void => {
  const quest = data.me ? activeQuest(data) : null;
  jrChip.style.display = quest ? '' : 'none';
  if (quest) {
    const frac =
      quest.target > 0 ? Math.max(0, Math.min(1, quest.have / quest.target)) : 1;
    jrChipRing.setAttribute('stroke-dashoffset', String(OBJ_RING_C * (1 - frac)));
    jrChipRing.setAttribute('stroke', quest.done ? 'var(--wood-dark)' : 'var(--leaf)');
    jrChip.classList.toggle('is-claimable', quest.done);
  }
  hallChipLvl.textContent = String(data.city.hallLevel);

  const sig = quest ? `${quest.index}:${quest.lap}:${quest.done ? 1 : 0}` : '';
  if (quest && prevQuestSig !== null && sig !== prevQuestSig) {
    const [pi = '', pl = '', pd = ''] = prevQuestSig.split(':');
    const isNewQuest =
      prevQuestSig === '' || pi !== String(quest.index) || pl !== String(quest.lap);
    const nowClaimable = quest.done && pd !== '1' && !isNewQuest;
    if (isNewQuest || nowClaimable) expandObjectives(OBJ_PEEK_MS);
  }
  prevQuestSig = sig;
};

const doCollectAll = (): void => {
  if (isPending('collectAll')) return;
  markPending('collectAll');
  renderHud();
  void api
    .collectAll()
    .then((res) => {
      const tiles = Object.entries(res.tiles).map(([key, tile]) => ({ key, tile }));
      store.applyMutation({ tiles, me: res.me });
      const got = res.gained.coins + goodsTotal(res.gained.goods);
      if (got > 0) toast(`Collected +${fmtInt(got)}`, 'gain');
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
      toast(
        `Checked in! Streak ${res.me.streak} — +${fmtInt(res.gained.coins)} coins, +${fmtInt(res.gained.xp)} XP`,
        'celebrate'
      );
    })
    .catch((err: unknown) =>
      notifyError(err instanceof Error ? err.message : 'Could not check in.')
    )
    .finally(() => {
      clearPending('checkin');
      renderHud();
    });
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

/** Offer an opt-in "share this milestone to the comments" toast button. */
const promptShare = (kind: ShareKind, value: number): void => {
  toastAction('Share it?', 'Share', () => {
    void api
      .share(kind, value)
      .then(() => toast('Shared to comments!', 'celebrate'))
      .catch((err: unknown) =>
        notifyError(err instanceof Error ? err.message : 'Could not share.')
      );
  });
};

const swapIcon = (slot: HTMLElement, next: HTMLElement): HTMLElement => {
  slot.replaceWith(next);
  return next;
};

const renderWeather = (data: StateResponse): void => {
  const meta = WEATHER_META[data.weather];
  weatherIcon = swapIcon(weatherIcon, iconEl(meta.icon, 14));
  weatherLabel.textContent = meta.label;
  weatherChip.setAttribute('aria-label', WEATHER_TIP[data.weather]);
};

const renderFestival = (data: StateResponse): void => {
  const meta = CATEGORY_META[data.city.festival];
  festIcon = swapIcon(festIcon, iconEl(meta.icon, 14));
  festLabel.textContent = meta.label;
  festChip.setAttribute('aria-label', FESTIVAL_TIP[data.city.festival]);
};

const renderWallet = (me: PlayerState): void => {
  for (const good of GOODS) {
    const span = walletCounts.get(good);
    if (span) span.textContent = fmtInt(me.wallet[good]);
  }
};

const renderPlayer = (me: PlayerState): void => {
  coinsChip.style.display = '';
  walletCaret.style.display = '';
  ring.style.display = '';
  signinPill.style.display = 'none';

  animateCount(coinsNum, lastCoins, me.coins);
  lastCoins = me.coins;
  renderWallet(me);

  const cur = xpFor(me.level);
  const next = xpFor(me.level + 1);
  const denom = next - cur;
  const frac = me.level >= MAX_LEVEL || denom <= 0 ? 1 : (me.xp - cur) / denom;
  const clamped = Math.max(0, Math.min(1, frac));
  ringProgress.setAttribute('stroke-dashoffset', String(RING_C * (1 - clamped)));
  ringLevel.textContent = String(me.level);
  ring.setAttribute('aria-label', `Level ${me.level} — tap for unlocks`);

  if (prevLevel !== null && me.level > prevLevel) {
    const unlocked = PLOT_LEVELS.includes(me.level);
    toast(
      `Level ${me.level}!${unlocked ? ' New plot unlocked' : ''}`,
      'celebrate'
    );
    if (me.level >= 2) promptShare('levelup', me.level);
  }
  prevLevel = me.level;
};

const renderLoggedOut = (): void => {
  coinsChip.style.display = 'none';
  walletCaret.style.display = 'none';
  ring.style.display = 'none';
  signinPill.style.display = '';
  setWallet(false);
};

/** True when any good's market price has climbed to ≥1.5× its base. */
const anyPriceHot = (data: StateResponse): boolean => {
  for (const g of GOODS) {
    if (data.prices[g] >= MARKET[g].base * 1.5) return true;
  }
  return false;
};

const renderFabs = (data: StateResponse, me: PlayerState | null): void => {
  // Market FAB is public (prices are visible logged out); pulse when goods are hot.
  marketPulse.style.display = anyPriceHot(data) ? '' : 'none';

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
  checkinFab.classList.toggle('is-checked', checkedIn);
  checkinStreak.textContent = me.streak > 0 ? String(me.streak) : '';
  checkinStreak.style.display = me.streak > 0 ? '' : 'none';
};

const renderHud = (): void => {
  const data = store.data;
  if (!data) return;
  const me = data.me;

  renderWeather(data);
  renderFestival(data);
  renderKeepPill(data);
  renderObjChips(data);
  if (me) renderPlayer(me);
  else renderLoggedOut();
  renderFabs(data, me);

  // A Village Hall level the whole village just raised together — offer a share.
  const stage = data.city.hallLevel;
  if (prevStage !== null && stage > prevStage && stage >= 1) {
    promptShare('stage', stage);
  }
  prevStage = stage;
};
