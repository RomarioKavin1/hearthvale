import type { BuildingSpec, TierStats } from '../../shared/catalog';
import { CATALOG, tierStats } from '../../shared/catalog';
import type { PlayerState, StateResponse, Tier, TileState } from '../../shared/types';
import { isClaimable } from '../../shared/logic/grid';
import {
  accrue,
  adjacencyBonus,
  canClaim,
  emptyStockpile,
  goodsTotal,
  plotsForLevel,
  roleToFestival,
} from '../../shared/logic/economy';
import type { HvTileSelected } from '../events';
import { api } from '../net';
import { store } from '../state';
import {
  boostsLeft,
  CATEGORY_META,
  el,
  fmtBuildTime,
  fmtDur,
  fmtInt,
  iconUrl,
  isPending,
  ownedCount,
  pctStr,
  promptLogin,
} from './dom';
import {
  action,
  openSheet,
  setSheetTitle,
  toast,
} from './sheet';
import {
  openBallotSheet,
  openHowToSheet,
  openLandmarkSheet,
  openLeaderboardsSheet,
} from './sheets';

/**
 * The two "hub" sheets: the context-sensitive tile sheet (six variants driven by
 * what was tapped) and the menu that fans out to the four secondary sheets. Both
 * recompute from `store` on every render so they track claims/builds/collects and
 * live countdowns without stale closures.
 */

const stars = (tier: number): string =>
  '★★★'.slice(0, tier) + '☆☆☆'.slice(0, Math.max(0, 3 - tier));

const line = (label: string, value: string): HTMLElement =>
  el('div', {
    cls: 'hv-row-line',
    children: [el('span', { text: label }), el('b', { text: value })],
  });

// ── Tile sheet ───────────────────────────────────────────────────────────────

export const openTileSheet = (detail: HvTileSelected): void => {
  const { x, y, key } = detail;
  openSheet({
    title: 'Plot',
    tick: 1000,
    render: (body) => {
      const data = store.data;
      if (!data) return;
      const me = data.me;
      const tile = data.grid[key] ?? null;
      const mine = tile !== null && me !== null && tile.owner === me.id;
      const claimable = isClaimable(x, y) && tile === null;

      if (claimable) {
        if (me) renderClaim(body, data, me, x, y, key);
        else renderSignIn(body);
        return;
      }
      if (tile !== null && mine && me) {
        if (tile.buildingId === undefined) renderBuildGrid(body, me, x, y, key);
        else renderMineBuilding(body, data, me, tile, x, y, key);
        return;
      }
      if (tile !== null) {
        if (tile.buildingId !== undefined) renderNeighbour(body, me, tile, x, y);
        else renderOwnerFlavor(body, tile);
        return;
      }
      renderPlaza(body);
    },
  });
};

// ── Variant (a): claimable, logged in ────────────────────────────────────────

const renderClaim = (
  body: HTMLElement,
  data: StateResponse,
  me: PlayerState,
  x: number,
  y: number,
  key: string
): void => {
  setSheetTitle('Open plot');
  const owned = ownedCount(data, me.id);
  const max = plotsForLevel(me.level);
  const reason = canClaim(data.grid, x, y, me, owned);

  const stack = el('div', { cls: 'hv-stack' });
  stack.appendChild(el('p', { cls: 'hv-note', text: 'A patch of open grass, waiting for a home.' }));
  stack.appendChild(line('Plots used', `${owned} / ${max}`));

  const btn = el('button', {
    cls: 'hv-btn',
    text: '🏡 Settle here',
    attrs: { type: 'button' },
  });
  if (reason !== null || isPending('claim')) btn.disabled = true;
  btn.addEventListener('click', () => {
    void action('claim', async () => {
      const res = await api.claim(x, y);
      store.applyMutation({ key, tile: res.tile, me: res.me });
      toast('Settled a new plot! 🏡', 'celebrate');
    });
  });
  stack.appendChild(btn);
  if (reason !== null) stack.appendChild(el('p', { cls: 'hv-note hv-muted', text: reason }));
  body.appendChild(stack);
};

// ── Variant (b): claimable, logged out ───────────────────────────────────────

const renderSignIn = (body: HTMLElement): void => {
  setSheetTitle('Open plot');
  const stack = el('div', { cls: 'hv-stack' });
  stack.appendChild(el('p', { cls: 'hv-note', text: 'Sign in with your Reddit account to settle here and start your village.' }));
  const btn = el('button', {
    cls: 'hv-btn',
    text: 'Sign in to play',
    attrs: { type: 'button' },
    on: { click: () => promptLogin() },
  });
  stack.appendChild(btn);
  body.appendChild(stack);
};

// ── Variant (c): mine, empty → build grid ────────────────────────────────────

const renderBuildGrid = (
  body: HTMLElement,
  me: PlayerState,
  x: number,
  y: number,
  key: string
): void => {
  setSheetTitle('Build here');
  const cards = el('div', { cls: 'hv-cards' });

  for (const spec of Object.values(CATALOG)) {
    const meta = CATEGORY_META[roleToFestival(spec.role)];
    const locked = me.level < spec.unlockLevel;
    const broke = me.coins < spec.cost;

    const img = el('img', {
      cls: 'hv-pixel',
      attrs: { alt: spec.name, src: iconUrl(spec.id) },
    });
    const sub =
      spec.role === 'decor'
        ? `+10%/tier ✨`
        : `${spec.ratePerMin}/min ${meta.emoji}`;

    const card = el('button', {
      cls: `hv-card${locked ? ' is-locked' : ''}`,
      attrs: { type: 'button' },
      children: [
        img,
        el('div', { cls: 'hv-card-name', text: spec.name }),
        el('div', { cls: 'hv-card-sub', text: sub }),
        el('div', {
          cls: `hv-card-cost${broke ? ' is-broke' : ''}`,
          text: `${fmtInt(spec.cost)} 🪙`,
        }),
        locked
          ? el('div', { cls: 'hv-lock', text: `Lv ${spec.unlockLevel}` })
          : el('div', { cls: 'hv-card-sub', text: `⏱ ${fmtBuildTime(spec.buildSeconds)}` }),
      ],
    });

    if (locked || isPending(`build:${spec.id}`)) card.disabled = true;
    if (!locked) {
      card.addEventListener('click', () => {
        void action(`build:${spec.id}`, async () => {
          const res = await api.build(x, y, spec.id);
          store.applyMutation({ key, tile: res.tile, me: res.me });
          toast(`Built ${spec.name}! 🔨`, 'gain');
        });
      });
    }
    cards.appendChild(card);
  }
  body.appendChild(cards);
};

// ── Variant (d): mine, building ──────────────────────────────────────────────

const renderMineBuilding = (
  body: HTMLElement,
  data: StateResponse,
  me: PlayerState,
  tile: TileState,
  x: number,
  y: number,
  key: string
): void => {
  const bid = tile.buildingId;
  if (bid === undefined) return;
  const spec = CATALOG[bid];
  const meta = CATEGORY_META[roleToFestival(spec.role)];
  const now = store.serverNow();
  setSheetTitle(spec.name);

  const stack = el('div', { cls: 'hv-stack' });
  stack.appendChild(
    el('div', {
      cls: 'hv-row-line',
      children: [
        el('span', { text: spec.name }),
        el('span', { cls: 'hv-stars', text: stars(tile.tier) }),
      ],
    })
  );

  // Construction countdown.
  if (now < tile.readyAt) {
    stack.appendChild(line('Building…', fmtDur(tile.readyAt - now)));
    const span = Math.max(1, tile.readyAt - tile.builtAt);
    const frac = (now - tile.builtAt) / span;
    stack.appendChild(
      el('div', { cls: 'hv-fill hv-fill-glow', children: [el('i', { attrs: { style: `width:${pctStr(frac)}` } })] })
    );
    body.appendChild(stack);
    return;
  }

  const statsT = tierStats(spec, tile.tier);

  if (spec.role === 'decor') {
    stack.appendChild(el('p', { cls: 'hv-note', text: `Boosts each neighbouring producer by +${10 * tile.tier}%.` }));
  } else {
    renderProducerStats(stack, data, spec, statsT, tile, x, y, now, meta.emoji, key);
  }

  if (tile.boostUntil > now) {
    stack.appendChild(
      el('div', { cls: 'hv-row-line', children: [el('span', { text: '⚡ Boosted ×2' }), el('b', { text: `${fmtDur(tile.boostUntil - now)} left` })] })
    );
  }

  renderUpgrade(stack, me, spec, tile, x, y, key);
  body.appendChild(stack);
};

const renderProducerStats = (
  stack: HTMLElement,
  data: StateResponse,
  spec: BuildingSpec,
  statsT: TierStats,
  tile: TileState,
  x: number,
  y: number,
  now: number,
  emoji: string,
  key: string
): void => {
  const fest = data.city.festival;
  const adj = adjacencyBonus(data.grid, x, y, fest, now);
  const festing = fest === roleToFestival(spec.role);
  const effRate = statsT.ratePerMin * (festing ? 1.5 : 1) * (1 + adj);

  stack.appendChild(line('Output', `${effRate.toFixed(1)}/min ${emoji}`));
  stack.appendChild(el('div', { cls: 'hv-note hv-muted', text: `Base ${statsT.ratePerMin}/min` }));
  if (festing) stack.appendChild(el('div', { cls: 'hv-note hv-muted', text: '× 1.5 festival bonus today' }));
  if (adj > 0) stack.appendChild(el('div', { cls: 'hv-note hv-muted', text: `+ ${Math.round(adj * 100)}% from nearby decor` }));

  // TODO(V4): thread the real stockpile in so processor previews are accurate.
  const { gained } = accrue(tile, now, fest, adj, data.city.weather, emptyStockpile());
  const accrued = gained.coins + goodsTotal(gained.goods);
  const frac = statsT.cap > 0 ? accrued / statsT.cap : 0;
  stack.appendChild(
    el('div', { cls: 'hv-fill', children: [el('i', { attrs: { style: `width:${pctStr(frac)}` } })] })
  );
  stack.appendChild(el('div', { cls: 'hv-fill-cap', text: `Storage ${fmtInt(accrued)} / ${fmtInt(statsT.cap)}` }));

  const collect = el('button', {
    cls: 'hv-btn',
    text: `Collect ${fmtInt(accrued)} ${emoji}`,
    attrs: { type: 'button' },
  });
  if (accrued <= 0 || isPending('collect')) collect.disabled = true;
  collect.addEventListener('click', () => {
    void action('collect', async () => {
      const res = await api.collect(x, y);
      store.applyMutation({ key, tile: res.tile, me: res.me });
      const got = res.gained.coins + goodsTotal(res.gained.goods);
      toast(`+${fmtInt(got)} ${emoji}`, 'gain');
    });
  });
  stack.appendChild(collect);
};

const renderUpgrade = (
  stack: HTMLElement,
  me: PlayerState,
  spec: BuildingSpec,
  tile: TileState,
  x: number,
  y: number,
  key: string
): void => {
  if (tile.tier >= 3) {
    stack.appendChild(el('p', { cls: 'hv-note hv-muted', text: 'Max tier ★★★' }));
    return;
  }
  const nextTier: Tier = tile.tier === 1 ? 2 : 3;
  const cost = tierStats(spec, nextTier).cost;
  const affordable = me.coins >= cost;

  const btn = el('button', {
    cls: 'hv-btn hv-btn-ghost',
    text: `Upgrade to ${stars(nextTier)} — ${fmtInt(cost)} 🪙`,
    attrs: { type: 'button' },
  });
  if (!affordable || isPending('upgrade')) btn.disabled = true;
  btn.addEventListener('click', () => {
    void action('upgrade', async () => {
      const res = await api.upgrade(x, y);
      store.applyMutation({ key, tile: res.tile, me: res.me });
      toast(`Upgraded to tier ${nextTier}! ⭐`, 'celebrate');
    });
  });
  stack.appendChild(btn);
  if (!affordable) stack.appendChild(el('p', { cls: 'hv-note hv-muted', text: `Need ${fmtInt(cost)} 🪙 to upgrade.` }));
};

// ── Variant (e): neighbour's producer → boost ────────────────────────────────

const renderNeighbour = (
  body: HTMLElement,
  me: PlayerState | null,
  tile: TileState,
  x: number,
  y: number
): void => {
  const bid = tile.buildingId;
  if (bid === undefined) return;
  const spec = CATALOG[bid];
  const now = store.serverNow();
  setSheetTitle(`${tile.ownerName}’s plot`);

  const stack = el('div', { cls: 'hv-stack' });
  stack.appendChild(line('Neighbour', tile.ownerName));
  stack.appendChild(
    el('div', {
      cls: 'hv-row-line',
      children: [el('span', { text: spec.name }), el('span', { cls: 'hv-stars', text: stars(tile.tier) })],
    })
  );

  let reason: string | null = null;
  if (spec.role === 'decor') reason = 'Decorations can’t be boosted.';
  else if (now < tile.readyAt) reason = 'Still under construction.';
  else if (tile.boostUntil > now) reason = `Already boosted — ${fmtDur(tile.boostUntil - now)} left.`;
  else if (me !== null && boostsLeft(me) <= 0) reason = 'No boosts left today.';

  const btn = el('button', {
    cls: 'hv-btn hv-btn-accent',
    text: me ? '⚡ Boost ×2 for 30m' : 'Sign in to boost',
    attrs: { type: 'button' },
  });
  if ((me !== null && reason !== null) || isPending('boost')) btn.disabled = true;
  btn.addEventListener('click', () => {
    if (!me) {
      promptLogin();
      return;
    }
    void action('boost', async () => {
      const res = await api.boost(x, y);
      store.applyMutation({ key: `${x},${y}`, tile: res.tile, me: res.me });
      toast(`Boosted ${tile.ownerName}’s ${spec.name}! ⚡`, 'gain');
    });
  });
  stack.appendChild(btn);

  if (me) stack.appendChild(el('p', { cls: 'hv-note hv-muted', text: `${boostsLeft(me)} boosts left today.` }));
  if (me !== null && reason !== null) stack.appendChild(el('p', { cls: 'hv-note hv-muted', text: reason }));
  body.appendChild(stack);
};

// ── Variant: neighbour's empty plot ──────────────────────────────────────────

const renderOwnerFlavor = (body: HTMLElement, tile: TileState): void => {
  setSheetTitle(`${tile.ownerName}’s plot`);
  body.appendChild(
    el('p', { cls: 'hv-note', text: `${tile.ownerName} claimed this plot but hasn’t built here yet.` })
  );
};

// ── Variant (f): plaza ───────────────────────────────────────────────────────

const renderPlaza = (body: HTMLElement): void => {
  setSheetTitle('Village square');
  body.appendChild(
    el('p', {
      cls: 'hv-note',
      text: 'The village square 🌳 — a shared gathering place at the heart of Hearthvale. The clocktower rises here; plots can’t be claimed on the plaza.',
    })
  );
};

// ── Menu sheet ───────────────────────────────────────────────────────────────

type MenuItem = { emoji: string; label: string; open: () => void };

const MENU: MenuItem[] = [
  { emoji: '🏰', label: 'Clocktower', open: openLandmarkSheet },
  { emoji: '🗳️', label: 'Festival ballot', open: openBallotSheet },
  { emoji: '🏆', label: 'Leaderboards', open: openLeaderboardsSheet },
  { emoji: '📖', label: 'How to play', open: openHowToSheet },
];

export const openMenuSheet = (): void => {
  openSheet({
    title: 'Menu',
    render: (body) => {
      const menu = el('div', { cls: 'hv-menu' });
      for (const item of MENU) {
        const btn = el('button', {
          cls: 'hv-menu-btn',
          attrs: { type: 'button' },
          children: [
            el('span', { cls: 'hv-menu-emoji', text: item.emoji }),
            el('span', { text: item.label }),
            el('span', { cls: 'hv-menu-arrow', text: '›' }),
          ],
        });
        btn.addEventListener('click', () => item.open());
        menu.appendChild(btn);
      }
      body.appendChild(menu);
    },
  });
};
