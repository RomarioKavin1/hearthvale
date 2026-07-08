import type { FestivalCategory, Good, LeaderRow, TraderOffer } from '../../shared/types';
import {
  CATALOG,
  HALL_POPULATION,
  hallPerks,
  KEEP_STAGE_COSTS,
  MARKET,
  MAX_LEVEL,
  PLOT_LEVELS,
  STAGE_NAME_WORDS,
  STAGE_POT,
} from '../../shared/catalog';
import { GOODS, xpFor } from '../../shared/logic/economy';
import {
  advanceQuest,
  QUEST_CHAIN,
  questAt,
} from '../../shared/quests';
import { buyValue, priceFor, sellValue } from '../../shared/logic/market';
import type { SpriteKey } from '../art/manifest';
import { api } from '../net';
import { store } from '../state';
import {
  activeQuest,
  CATEGORY_META,
  el,
  fmtInt,
  GOOD_LABEL,
  goodIcon,
  iconEl,
  isPending,
  pctStr,
  promptLogin,
  todayUtc,
} from './dom';
import { action, openSheet, refreshSheet, setSheetTitle, toast } from './sheet';

/**
 * The v2 "menu" sheets: the village Market (moving prices + sell/buy steppers),
 * the wandering Trader (daily swap offers), the Grand Keep (planks/bricks
 * contributions with a pro-rata pot + stage naming), the festival ballot, the
 * leaderboards and the how-to guide. Each keeps its own small module-scoped UI
 * state so the sheet manager's frequent re-renders don't discard it.
 */

const CATS: FestivalCategory[] = ['coins', 'raw', 'processed', 'decor'];

const TRADE_CAP = 500;

// ── Market ─────────────────────────────────────────────────────────────────

type QtyPick = '1' | '10' | '50' | 'max';
const QTY_PICKS: QtyPick[] = ['1', '10', '50', 'max'];

let marketFocus: Good | null = null;
let sellPick: QtyPick = '1';
let buyPick: QtyPick = '1';

/** Largest quantity of `good` a player with `coins` can buy from `stock`. */
const maxAffordableBuy = (good: Good, stock: number, coins: number): number => {
  const limit = Math.min(stock, TRADE_CAP);
  let qty = 0;
  let cost = 0;
  while (qty < limit) {
    const next = cost + Math.ceil(priceFor(stock - 1 - qty, good) * 1.25);
    if (next > coins) break;
    cost = next;
    qty += 1;
  }
  return qty;
};

const sellQty = (pick: QtyPick, holding: number): number => {
  const cap = Math.min(holding, TRADE_CAP);
  return pick === 'max' ? cap : Math.min(Number(pick), cap);
};

const buyQty = (
  pick: QtyPick,
  good: Good,
  stock: number,
  coins: number
): number => {
  const max = maxAffordableBuy(good, stock, coins);
  return pick === 'max' ? max : Math.min(Number(pick), max);
};

/** The good the village most needs: highest price-to-base ratio above 1×. */
const hottestGood = (): Good | null => {
  const prices = store.data?.prices;
  if (!prices) return null;
  let best: Good | null = null;
  let bestRatio = 1;
  for (const g of GOODS) {
    const ratio = prices[g] / MARKET[g].base;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = g;
    }
  }
  return best;
};

const stepRow = (
  picks: QtyPick[],
  active: QtyPick,
  onPick: (p: QtyPick) => void
): HTMLElement => {
  const steps = el('div', { cls: 'hv-steps' });
  for (const p of picks) {
    const b = el('button', {
      cls: `hv-step${active === p ? ' is-picked' : ''}`,
      text: p === 'max' ? 'Max' : p,
      attrs: { type: 'button' },
    });
    b.addEventListener('click', () => onPick(p));
    steps.appendChild(b);
  }
  return steps;
};

const renderMarketBody = (good: Good): HTMLElement => {
  const data = store.data;
  const me = data?.me ?? null;
  const stock = data?.stockpile[good] ?? 0;
  const coins = me?.coins ?? 0;
  const holding = me?.wallet[good] ?? 0;

  const body = el('div', { cls: 'hv-mkt-body' });

  // Sell segment.
  const sQty = sellQty(sellPick, holding);
  const sGain = sellValue(sQty, stock, good);
  const sellSeg = el('div', { cls: 'hv-mkt-seg' });
  sellSeg.appendChild(el('div', { cls: 'hv-mkt-seg-label', text: 'Sell to the village' }));
  sellSeg.appendChild(
    stepRow(QTY_PICKS, sellPick, (p) => {
      sellPick = p;
      refreshSheet();
    })
  );
  sellSeg.appendChild(
    el('div', { cls: 'hv-preview', text: `Sell ${fmtInt(sQty)} → +${fmtInt(sGain)} coins` })
  );
  const sellBtn = el('button', {
    cls: 'hv-btn',
    text: me ? `Sell ${fmtInt(sQty)}` : 'Sign in to sell',
    attrs: { type: 'button' },
  });
  if (me && (sQty <= 0 || isPending('sell'))) sellBtn.disabled = true;
  sellBtn.addEventListener('click', () => {
    if (!me) {
      promptLogin();
      return;
    }
    void action('sell', async () => {
      const res = await api.sell(good, sQty);
      store.applyMutation({ me: res.me, stockpile: res.stockpile, prices: res.prices });
      toast(`Sold ${fmtInt(sQty)} ${GOOD_LABEL[good]} for +${fmtInt(sGain)}`, 'gain');
    });
  });
  sellSeg.appendChild(sellBtn);
  body.appendChild(sellSeg);

  // Buy segment.
  const bQty = buyQty(buyPick, good, stock, coins);
  const bCost = buyValue(bQty, stock, good);
  const buySeg = el('div', { cls: 'hv-mkt-seg' });
  buySeg.appendChild(el('div', { cls: 'hv-mkt-seg-label', text: 'Buy from the village' }));
  buySeg.appendChild(
    stepRow(QTY_PICKS, buyPick, (p) => {
      buyPick = p;
      refreshSheet();
    })
  );
  buySeg.appendChild(
    el('div', { cls: 'hv-preview', text: `Buy ${fmtInt(bQty)} → −${fmtInt(bCost)} coins` })
  );
  const buyBtn = el('button', {
    cls: 'hv-btn hv-btn-ghost',
    text: me ? `Buy ${fmtInt(bQty)}` : 'Sign in to buy',
    attrs: { type: 'button' },
  });
  if (me && (bQty <= 0 || bCost > coins || stock < bQty || isPending('buy'))) {
    buyBtn.disabled = true;
  }
  buyBtn.addEventListener('click', () => {
    if (!me) {
      promptLogin();
      return;
    }
    void action('buy', async () => {
      const res = await api.buy(good, bQty);
      store.applyMutation({ me: res.me, stockpile: res.stockpile, prices: res.prices });
      toast(`Bought ${fmtInt(bQty)} ${GOOD_LABEL[good]} for −${fmtInt(bCost)}`, 'gain');
    });
  });
  buySeg.appendChild(buyBtn);
  if (stock <= 0) {
    buySeg.appendChild(el('p', { cls: 'hv-note hv-muted', text: 'The stockpile is empty — nothing to buy.' }));
  }
  body.appendChild(buySeg);

  return body;
};

const renderMarketRow = (good: Good): HTMLElement => {
  const data = store.data;
  const price = data?.prices[good] ?? 0;
  const stock = data?.stockpile[good] ?? 0;
  const holding = data?.me?.wallet[good] ?? 0;
  const base = MARKET[good].base;
  const expanded = marketFocus === good;

  const priceChildren: Node[] = [];
  if (price > base) priceChildren.push(iconEl('icon-arrow-up', 13));
  else if (price < base) priceChildren.push(iconEl('icon-arrow-down', 13));
  priceChildren.push(el('span', { text: String(price) }));
  const priceEl = el('div', {
    cls: `hv-mkt-price${price > base ? ' hv-trend-up' : price < base ? ' hv-trend-down' : ''}`,
    children: priceChildren,
  });

  const head = el('button', {
    cls: 'hv-mkt-head',
    attrs: { type: 'button' },
    children: [
      goodIcon(good, 34),
      el('div', {
        cls: 'hv-mkt-main',
        children: [
          el('div', { cls: 'hv-mkt-name', text: GOOD_LABEL[good] }),
          el('div', { cls: 'hv-mkt-sub', text: `In stock: ${fmtInt(stock)}` }),
        ],
      }),
      el('div', {
        cls: 'hv-mkt-right',
        children: [priceEl, el('div', { cls: 'hv-mkt-hold', text: `You: ${fmtInt(holding)}` })],
      }),
    ],
  });
  head.addEventListener('click', () => {
    marketFocus = expanded ? null : good;
    sellPick = '1';
    buyPick = '1';
    refreshSheet();
  });

  const wrap = el('div', { cls: 'hv-mkt', children: [head] });
  if (expanded) wrap.appendChild(renderMarketBody(good));
  return wrap;
};

export const openMarketSheet = (focus?: Good): void => {
  if (focus) marketFocus = focus;
  openSheet({
    title: 'Market',
    render: (body) => {
      const stack = el('div', { cls: 'hv-stack' });

      const hot = hottestGood();
      if (hot) {
        stack.appendChild(
          el('div', {
            cls: 'hv-callout',
            children: [
              goodIcon(hot, 22),
              el('span', { text: `The village needs ${GOOD_LABEL[hot]}` }),
            ],
          })
        );
      } else {
        stack.appendChild(
          el('p', { cls: 'hv-note', text: 'Sell goods when prices rise; the village auto-buys what its workshops need.' })
        );
      }

      const rows = el('div', { cls: 'hv-mkt-rows' });
      for (const good of GOODS) rows.appendChild(renderMarketRow(good));
      stack.appendChild(rows);
      body.appendChild(stack);
    },
    onClose: () => {
      marketFocus = null;
    },
  });
};

// ── Trader ─────────────────────────────────────────────────────────────────

const getSide = (offer: TraderOffer): HTMLElement => {
  if ('cosmetic' in offer.get) {
    return el('div', {
      cls: 'hv-trade-side',
      children: [
        iconEl('icon-star', 30),
        el('div', { cls: 'hv-trade-qty', text: 'Golden' }),
        el('div', { cls: 'hv-trade-cap', text: 'roof cosmetic' }),
      ],
    });
  }
  const g = offer.get;
  return el('div', {
    cls: 'hv-trade-side',
    children: [
      goodIcon(g.good, 30),
      el('div', { cls: 'hv-trade-qty', text: fmtInt(g.qty) }),
      el('div', { cls: 'hv-trade-cap', text: GOOD_LABEL[g.good] }),
    ],
  });
};

const renderTradeCard = (offer: TraderOffer, index: number): HTMLElement => {
  const data = store.data;
  const me = data?.me ?? null;
  const done = data?.trader.done ?? false;
  const golden = 'cosmetic' in offer.get;
  const have = me?.wallet[offer.give.good] ?? 0;
  const short = have < offer.give.qty;

  const deal = el('div', {
    cls: 'hv-trade-deal',
    children: [
      el('div', {
        cls: 'hv-trade-side',
        children: [
          goodIcon(offer.give.good, 30),
          el('div', { cls: 'hv-trade-qty', text: fmtInt(offer.give.qty) }),
          el('div', { cls: 'hv-trade-cap', text: GOOD_LABEL[offer.give.good] }),
        ],
      }),
      el('div', { cls: 'hv-trade-arrow', children: [iconEl('icon-arrow-up', 20)] }),
      getSide(offer),
    ],
  });

  let reason: string | null = null;
  if (!me) reason = null;
  else if (done) reason = 'You’ve already traded today.';
  else if (short) reason = `You need ${fmtInt(offer.give.qty)} ${GOOD_LABEL[offer.give.good]}.`;

  const btn = el('button', {
    cls: 'hv-btn',
    text: me ? 'Accept' : 'Sign in to trade',
    attrs: { type: 'button' },
  });
  if ((me && reason !== null) || isPending('trade')) btn.disabled = true;
  btn.addEventListener('click', () => {
    if (!me) {
      promptLogin();
      return;
    }
    void action('trade', async () => {
      const res = await api.trade(index);
      const cur = store.data;
      if (cur) cur.trader.done = true;
      const mut = res.tile
        ? { me: res.me, key: res.tile.key, tile: res.tile.tile }
        : { me: res.me };
      store.applyMutation(mut);
      toast('The trader tips their hat — deal done!', 'celebrate');
    });
  });

  const card = el('div', {
    cls: `hv-trade${golden ? ' is-golden' : ''}`,
    children: [deal, btn],
  });
  if (me && reason !== null) card.appendChild(el('p', { cls: 'hv-note hv-muted', text: reason }));
  return card;
};

export const openTraderSheet = (): void => {
  openSheet({
    title: 'Wandering Trader',
    render: (body) => {
      const data = store.data;
      const stack = el('div', { cls: 'hv-stack' });
      stack.appendChild(
        el('p', { cls: 'hv-note', text: 'A trader passes through daily. Take one deal — choose well.' })
      );

      const offers = data?.trader.offers ?? [];
      const cards = el('div', { cls: 'hv-trade-cards' });
      offers.forEach((offer, i) => cards.appendChild(renderTradeCard(offer, i)));
      stack.appendChild(cards);

      stack.appendChild(
        el('p', { cls: 'hv-note hv-muted', text: 'New offers at midnight UTC.' })
      );
      body.appendChild(stack);
    },
  });
};

// ── Grand Keep ───────────────────────────────────────────────────────────────

type KeepGood = 'planks' | 'bricks';
type KeepPick = '10' | '50' | 'all';
const keepPick: Record<KeepGood, KeepPick> = { planks: '10', bricks: '10' };

const keepAmount = (pick: KeepPick, have: number): number =>
  pick === 'all' ? have : Math.min(Number(pick), have);

const keepBar = (
  good: KeepGood,
  have: number,
  need: number
): HTMLElement => {
  const frac = need > 0 ? have / need : 1;
  return el('div', {
    cls: 'hv-stack',
    children: [
      el('div', {
        cls: 'hv-row-line',
        children: [
          el('span', {
            cls: 'hv-chain',
            children: [goodIcon(good, 18), el('span', { text: GOOD_LABEL[good] })],
          }),
          el('b', { text: `${fmtInt(have)} / ${fmtInt(need)}` }),
        ],
      }),
      el('div', {
        cls: 'hv-fill hv-fill-glow',
        children: [el('i', { attrs: { style: `width:${pctStr(frac)}` } })],
      }),
    ],
  });
};

const contributeControls = (good: KeepGood): HTMLElement => {
  const me = store.data?.me ?? null;
  const have = me?.wallet[good] ?? 0;
  const pick = keepPick[good];
  const amount = keepAmount(pick, have);

  const seg = el('div', { cls: 'hv-mkt-seg' });
  const steps = el('div', { cls: 'hv-steps' });
  for (const p of ['10', '50', 'all'] as KeepPick[]) {
    const disabled = p === 'all' ? have <= 0 : have < Number(p);
    const b = el('button', {
      cls: `hv-step${pick === p ? ' is-picked' : ''}`,
      text: p === 'all' ? 'All' : p,
      attrs: { type: 'button' },
    });
    if (disabled && pick !== p) b.disabled = true;
    b.addEventListener('click', () => {
      keepPick[good] = p;
      refreshSheet();
    });
    steps.appendChild(b);
  }
  seg.appendChild(steps);

  const btn = el('button', {
    cls: 'hv-btn',
    text: me ? `Contribute ${fmtInt(amount)} ${GOOD_LABEL[good]}` : 'Sign in to contribute',
    attrs: { type: 'button' },
  });
  if (me && (amount <= 0 || isPending(`contribute:${good}`))) btn.disabled = true;
  btn.addEventListener('click', () => {
    if (!me) {
      promptLogin();
      return;
    }
    void action(`contribute:${good}`, async () => {
      const before = store.data?.me?.wallet[good] ?? 0;
      const res = await api.contribute(good, amount);
      store.applyMutation({ city: res.city, me: res.me });
      const applied = Math.max(0, before - res.me.wallet[good]);
      toast(`+${fmtInt(applied)} ${GOOD_LABEL[good]} to the Grand Keep!`, 'celebrate');
    });
  });
  seg.appendChild(btn);
  return seg;
};

const renderPlaque = (stageDone: number, stageNames: string[]): HTMLElement => {
  const plaque = el('div', { cls: 'hv-plaque' });
  for (let i = 0; i < stageDone; i += 1) {
    const name = stageNames[i] ?? '';
    const row = el('div', { cls: 'hv-plaque-row' });
    row.appendChild(
      el('div', {
        cls: `hv-plaque-name${name ? '' : ' is-unnamed'}`,
        text: name || `Stage ${i + 1} — unnamed`,
      })
    );
    row.appendChild(el('div', { cls: 'hv-plaque-top', text: 'Raised by the village' }));
    plaque.appendChild(row);
  }
  return plaque;
};

/** A simple labelled progress bar for the Village Hall's population requirement
 * (villagers = houses on the map). Mirrors `keepBar` but with a home icon. */
const villagerBar = (have: number, need: number): HTMLElement => {
  const frac = need > 0 ? have / need : 1;
  return el('div', {
    cls: 'hv-stack',
    children: [
      el('div', {
        cls: 'hv-row-line',
        children: [
          el('span', {
            cls: 'hv-chain',
            children: [iconEl('icon-home', 18), el('span', { text: 'Villagers' })],
          }),
          el('b', { text: `${fmtInt(have)} / ${fmtInt(need)}` }),
        ],
      }),
      el('div', {
        cls: 'hv-fill hv-fill-glow',
        children: [el('i', { attrs: { style: `width:${pctStr(frac)}` } })],
      }),
    ],
  });
};

/** Human descriptions of the perks a Village Hall level-up to `target` unlocks
 * (the delta over the previous level), for the "Next level" teaser list. */
const perkLines = (target: number): string[] => {
  const lines: string[] = [`+3% village production (${hallPerks(target).productionPct}% total)`];
  if (target === 1) lines.push('Trader offers 3 → 4 each day');
  if (target === 2) lines.push('Market sell cap 500 → 750');
  if (target === 3) lines.push('+1 plot for every villager');
  if (target === 4) lines.push('Boost limit 5 → 7 per day');
  if (target === 5) lines.push('Golden Hall banner for the village');
  return lines;
};

export const openKeepSheet = (): void => {
  openSheet({
    title: 'Village Hall',
    render: (body) => {
      const data = store.data;
      if (!data) return;
      const { city, me } = data;
      const level = city.hallLevel;
      const stages = KEEP_STAGE_COSTS.length;
      const complete = level >= stages;

      const stack = el('div', { cls: 'hv-stack' });

      // Plaque of completed levels + naming CTA for the last one.
      if (level >= 1) {
        stack.appendChild(el('div', { cls: 'hv-mkt-seg-label', text: 'Completed levels' }));
        stack.appendChild(renderPlaque(level, city.stageNames));
        const last = level - 1;
        if (!(city.stageNames[last] ?? '')) {
          const nameBtn = el('button', {
            cls: 'hv-btn hv-btn-ghost',
            text: me ? 'Name this level' : 'Sign in to name a level',
            attrs: { type: 'button' },
          });
          nameBtn.addEventListener('click', () => {
            if (!me) {
              promptLogin();
              return;
            }
            openNameStageSheet(last);
          });
          stack.appendChild(nameBtn);
        }
      }

      if (complete) {
        stack.appendChild(
          el('div', {
            cls: 'hv-callout',
            children: [
              iconEl('icon-trophy', 22),
              el('span', { text: 'The Village Hall stands at its highest level!' }),
            ],
          })
        );
        stack.appendChild(
          el('p', { cls: 'hv-note', text: 'The whole village raised it together — its perks apply to everyone.' })
        );
        body.appendChild(stack);
        return;
      }

      // The next level needs BOTH resources AND population — two requirement bars.
      const cost = KEEP_STAGE_COSTS[level] ?? { planks: 0, bricks: 0 };
      const popNeed = HALL_POPULATION[level] ?? 0;
      stack.appendChild(
        el('div', { cls: 'hv-mkt-seg-label', text: `Raising to level ${level + 1} of ${stages}` })
      );
      const bars = el('div', { cls: 'hv-keep-bars' });
      bars.appendChild(keepBar('planks', city.stagePlanks, cost.planks));
      bars.appendChild(keepBar('bricks', city.stageBricks, cost.bricks));
      bars.appendChild(villagerBar(city.population, popNeed));
      stack.appendChild(bars);

      // Contribute controls per good.
      stack.appendChild(contributeControls('planks'));
      stack.appendChild(contributeControls('bricks'));

      const pot = (level + 1) * STAGE_POT;
      stack.appendChild(
        el('p', { cls: 'hv-note', text: `Level pot: ${fmtInt(pot)} coins, split by contribution.` })
      );

      // Next-level perks teaser.
      stack.appendChild(el('div', { cls: 'hv-mkt-seg-label', text: `Next: level ${level + 1} unlocks` }));
      for (const line of perkLines(level + 1)) {
        stack.appendChild(el('div', { cls: 'hv-note hv-muted', text: line }));
      }

      body.appendChild(stack);
    },
  });
};

// ── Stage naming picker ───────────────────────────────────────────────────────

let pickAdj: number | null = null;
let pickNoun: number | null = null;

const openNameStageSheet = (stageIndex: number): void => {
  pickAdj = null;
  pickNoun = null;
  openSheet({
    title: 'Name the stage',
    render: (body) => {
      const stack = el('div', { cls: 'hv-stack' });
      stack.appendChild(
        el('p', { cls: 'hv-note', text: 'Top contributors name a completed stage. Pick a word from each column.' })
      );

      const picker = el('div', { cls: 'hv-picker' });
      const colFor = (
        words: string[],
        selected: number | null,
        onPick: (i: number) => void
      ): HTMLElement => {
        const col = el('div', { cls: 'hv-picker-col' });
        words.forEach((w, i) => {
          const opt = el('button', {
            cls: `hv-picker-opt${selected === i ? ' is-picked' : ''}`,
            text: w,
            attrs: { type: 'button' },
          });
          opt.addEventListener('click', () => onPick(i));
          col.appendChild(opt);
        });
        return col;
      };
      picker.appendChild(
        colFor(STAGE_NAME_WORDS.adjectives, pickAdj, (i) => {
          pickAdj = i;
          refreshSheet();
        })
      );
      picker.appendChild(
        colFor(STAGE_NAME_WORDS.nouns, pickNoun, (i) => {
          pickNoun = i;
          refreshSheet();
        })
      );
      stack.appendChild(picker);

      const preview =
        pickAdj !== null && pickNoun !== null
          ? `${STAGE_NAME_WORDS.adjectives[pickAdj]} ${STAGE_NAME_WORDS.nouns[pickNoun]}`
          : 'Pick two words';
      stack.appendChild(el('div', { cls: 'hv-picker-preview', text: preview }));

      const submit = el('button', {
        cls: 'hv-btn',
        text: 'Name this stage',
        attrs: { type: 'button' },
      });
      if (pickAdj === null || pickNoun === null || isPending('nameStage')) {
        submit.disabled = true;
      }
      submit.addEventListener('click', () => {
        if (pickAdj === null || pickNoun === null) return;
        const a = pickAdj;
        const n = pickNoun;
        void action('nameStage', async () => {
          const res = await api.nameStage(a, n);
          store.applyMutation({ city: res.city });
          toast(`Stage named ${res.city.stageNames[stageIndex] ?? ''}!`, 'celebrate');
          openKeepSheet();
        });
      });
      stack.appendChild(submit);
      body.appendChild(stack);
    },
  });
};

// ── Ballot ───────────────────────────────────────────────────────────────────

let voteCounts: Record<FestivalCategory, number> | null = null;

const VOTE_KEY = 'hv-vote';

const votedToday = (): FestivalCategory | null => {
  try {
    const raw = sessionStorage.getItem(VOTE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'day' in parsed &&
      'category' in parsed &&
      parsed.day === todayUtc()
    ) {
      const cat = parsed.category;
      if (
        cat === 'coins' ||
        cat === 'raw' ||
        cat === 'processed' ||
        cat === 'decor'
      ) {
        return cat;
      }
    }
  } catch {
    return null;
  }
  return null;
};

const rememberVote = (category: FestivalCategory): void => {
  try {
    sessionStorage.setItem(
      VOTE_KEY,
      JSON.stringify({ day: todayUtc(), category })
    );
  } catch {
    // Private-mode storage failures are non-fatal — the vote still registered.
  }
};

export const openBallotSheet = (): void => {
  openSheet({
    title: 'Tomorrow’s festival',
    render: (body) => {
      const me = store.data?.me ?? null;
      const voted = votedToday();
      const counts = voteCounts;
      const total = counts
        ? Math.max(1, CATS.reduce((s, c) => s + counts[c], 0))
        : 0;

      const stack = el('div', { cls: 'hv-stack' });
      stack.appendChild(
        el('p', { cls: 'hv-note', text: 'Cast your vote — the winning category gets ×1.5 production tomorrow.' })
      );

      const cards = el('div', { cls: 'hv-cat-cards' });
      for (const cat of CATS) {
        const meta = CATEGORY_META[cat];
        const count = voteCounts ? voteCounts[cat] : 0;
        const frac = total > 0 ? count / total : 0;

        const main = el('div', { cls: 'hv-cat-main' });
        main.appendChild(el('div', { cls: 'hv-cat-name', text: meta.label }));
        if (voteCounts) {
          main.appendChild(
            el('div', {
              cls: 'hv-cat-bar',
              children: [
                el('i', {
                  attrs: { style: `width:${pctStr(frac)};background:${meta.color}` },
                }),
              ],
            })
          );
        }

        const card = el('button', {
          cls: `hv-cat${voted === cat ? ' is-picked' : ''}`,
          attrs: { type: 'button', style: `border-color:${meta.color}` },
          children: [
            el('span', { cls: 'hv-cat-emoji', children: [iconEl(meta.icon, 24)] }),
            main,
            el('span', {
              cls: 'hv-cat-count',
              children: voteCounts
                ? [el('span', { text: fmtInt(count) })]
                : voted === cat
                  ? [iconEl('icon-check', 16)]
                  : [],
            }),
          ],
        });
        if (isPending('vote')) card.disabled = true;
        card.addEventListener('click', () => {
          if (!me) {
            promptLogin();
            return;
          }
          void action('vote', async () => {
            const res = await api.vote(cat);
            voteCounts = res.counts;
            rememberVote(cat);
            toast(`Voted ${meta.label}`, 'gain');
          });
        });
        cards.appendChild(card);
      }
      stack.appendChild(cards);

      if (voted) {
        stack.appendChild(
          el('p', { cls: 'hv-note hv-muted', text: 'Thanks for voting — tallies update as neighbours weigh in.' })
        );
      }
      body.appendChild(stack);
    },
    onClose: () => {
      voteCounts = null;
    },
  });
};

// ── Leaderboards ─────────────────────────────────────────────────────────────

type Board = { value: LeaderRow[]; earned: LeaderRow[]; contrib: LeaderRow[] };
type Tab = 'value' | 'earned' | 'contrib';

let board: Board | null = null;
let boardError = false;
let activeTab: Tab = 'value';

const TABS: Tab[] = ['value', 'earned', 'contrib'];

const TAB_LABELS: Record<Tab, string> = {
  value: 'Value',
  earned: 'Earned',
  contrib: 'Contributed',
};

export const openLeaderboardsSheet = (): void => {
  board = null;
  boardError = false;
  openSheet({
    title: 'Leaderboards',
    render: (body) => {
      const stack = el('div', {});

      const tabs = el('div', { cls: 'hv-tabs' });
      for (const tab of TABS) {
        const b = el('button', {
          cls: `hv-tab${activeTab === tab ? ' is-active' : ''}`,
          text: TAB_LABELS[tab],
          attrs: { type: 'button' },
        });
        b.addEventListener('click', () => {
          activeTab = tab;
          refreshSheet();
        });
        tabs.appendChild(b);
      }
      stack.appendChild(tabs);

      if (boardError) {
        stack.appendChild(el('div', { cls: 'hv-empty', text: 'Could not load the leaderboards.' }));
      } else if (!board) {
        stack.appendChild(el('div', { cls: 'hv-empty', text: 'Loading…' }));
      } else {
        const rows = board[activeTab];
        if (rows.length === 0) {
          stack.appendChild(el('div', { cls: 'hv-empty', text: 'No villagers on the board yet — be the first!' }));
        } else {
          const list = el('div', { cls: 'hv-lb-rows' });
          rows.forEach((row, i) => {
            list.appendChild(
              el('div', {
                cls: `hv-lb-row${row.me ? ' is-me' : ''}`,
                children: [
                  el('span', { cls: 'hv-lb-rank', text: `${i + 1}` }),
                  el('span', { cls: 'hv-lb-name', text: row.name }),
                  el('span', { cls: 'hv-lb-score', text: fmtInt(row.score) }),
                ],
              })
            );
          });
          stack.appendChild(list);
        }
      }
      body.appendChild(stack);
    },
  });

  void api
    .leaderboards()
    .then((res) => {
      board = { value: res.value, earned: res.earned, contrib: res.contrib };
      refreshSheet();
    })
    .catch(() => {
      boardError = true;
      refreshSheet();
    });
};

// ── How to play ──────────────────────────────────────────────────────────────

const HOW_STEPS: Array<{ icon: SpriteKey; title: string; text: string }> = [
  { icon: 'icon-home', title: 'Settle', text: 'Tap any open grass tile to claim a plot. More villagers unlock more land.' },
  { icon: 'furrow-crop-wheat', title: 'Produce', text: 'Wheat Fields, Groves and Quarries make raw goods. The village always needs grain.' },
  { icon: 'icon-cart', title: 'Sell or process', text: 'Sell raw goods on the Market when prices rise, or feed them to a Windmill, Sawmill or Kiln.' },
  { icon: 'icon-trophy', title: 'Raise the Keep', text: 'Contribute planks and bricks to the Grand Keep. Every stage boosts the whole village.' },
  { icon: 'icon-scroll', title: 'Trader & weather', text: 'A trader offers one daily swap, and the weather changes what pays best each day.' },
];

export const openHowToSheet = (): void => {
  openSheet({
    title: 'How to play',
    render: (body) => {
      const how = el('div', { cls: 'hv-how' });
      for (const step of HOW_STEPS) {
        how.appendChild(
          el('div', {
            cls: 'hv-how-step',
            children: [
              el('div', { cls: 'hv-how-emoji', children: [iconEl(step.icon, 24)] }),
              el('div', {
                cls: 'hv-how-txt',
                children: [
                  el('b', { text: step.title }),
                  el('span', { text: step.text }),
                ],
              }),
            ],
          })
        );
      }
      how.appendChild(
        el('p', {
          cls: 'hv-note',
          text: 'Vote each day for tomorrow’s festival (×1.5 output), and check in daily to build a streak for bonus coins.',
        })
      );
      body.appendChild(how);
    },
  });
};

// ── Villager's Journal ─────────────────────────────────────────────────────────

/** A completed chain quest: a check tick + its muted title. */
const journalDoneRow = (title: string): HTMLElement =>
  el('div', {
    cls: 'hv-jrs-row is-done',
    children: [
      el('span', { cls: 'hv-jrs-tick', children: [iconEl('icon-check', 14)] }),
      el('span', { cls: 'hv-jrs-name', text: title }),
    ],
  });

/** An upcoming (teased) quest: greyed, "Up next" tag + reward hint. */
const journalUpcomingRow = (
  title: string,
  reward: { coins?: number; xp?: number }
): HTMLElement => {
  const bits: string[] = [];
  if (reward.coins !== undefined) bits.push(`+${fmtInt(reward.coins)}c`);
  if (reward.xp !== undefined) bits.push(`+${fmtInt(reward.xp)} XP`);
  return el('div', {
    cls: 'hv-jrs-row is-next',
    children: [
      el('span', { cls: 'hv-jrs-tag', text: 'Up next' }),
      el('div', {
        cls: 'hv-jrs-nextmain',
        children: [
          el('span', { cls: 'hv-jrs-name', text: title }),
          el('span', { cls: 'hv-jrs-reward', text: bits.join(' · ') }),
        ],
      }),
    ],
  });
};

export const openJournalSheet = (): void => {
  openSheet({
    title: "Villager's Journal",
    render: (body) => {
      const data = store.data;
      const me = data?.me ?? null;
      const quest = data ? activeQuest(data) : null;
      const stack = el('div', { cls: 'hv-stack' });

      if (!me || !quest) {
        stack.appendChild(
          el('p', { cls: 'hv-note', text: 'Sign in to start your quest chain.' })
        );
        body.appendChild(stack);
        return;
      }

      const idx = me.questIndex;
      const lap = me.questLap;

      // Completed chain quests (kept concise: the fixed ladder up to the active one).
      const doneCount = Math.min(idx, QUEST_CHAIN.length);
      if (doneCount > 0) {
        stack.appendChild(el('div', { cls: 'hv-mkt-seg-label', text: 'Completed' }));
        const doneList = el('div', { cls: 'hv-jrs-list' });
        for (let i = 0; i < doneCount; i += 1) {
          const q = QUEST_CHAIN[i];
          if (q) doneList.appendChild(journalDoneRow(q.title));
        }
        stack.appendChild(doneList);
      }

      // Once into repeatable territory, name the current lap so scaling reads.
      if (idx >= QUEST_CHAIN.length) {
        stack.appendChild(
          el('p', {
            cls: 'hv-note hv-muted',
            text: `Repeatable tiers — Lap ${fmtInt(lap + 1)}. Each lap raises the goal and its reward.`,
          })
        );
      }

      // Active quest — the highlighted focus card.
      stack.appendChild(el('div', { cls: 'hv-mkt-seg-label', text: 'Now' }));
      const frac = quest.target > 0 ? quest.have / quest.target : 1;
      const rewardBits: Node[] = [];
      if (quest.reward.coins !== undefined) {
        rewardBits.push(
          el('span', {
            cls: 'hv-jrs-reward-chip',
            children: [iconEl('icon-coin', 13), el('span', { text: fmtInt(quest.reward.coins) })],
          })
        );
      }
      if (quest.reward.xp !== undefined) {
        rewardBits.push(
          el('span', {
            cls: 'hv-jrs-reward-chip',
            children: [iconEl('icon-star', 13), el('span', { text: `${fmtInt(quest.reward.xp)} XP` })],
          })
        );
      }
      stack.appendChild(
        el('div', {
          cls: `hv-jrs-active${quest.done ? ' is-done' : ''}`,
          children: [
            el('div', {
              cls: 'hv-jrs-active-head',
              children: [
                el('span', { cls: 'hv-jrs-icon', children: [iconEl('icon-scroll', 20)] }),
                el('div', { cls: 'hv-jrs-active-title', text: quest.title }),
              ],
            }),
            el('p', { cls: 'hv-jrs-blurb', text: quest.blurb }),
            el('div', {
              cls: 'hv-fill hv-fill-glow',
              children: [el('i', { attrs: { style: `width:${pctStr(frac)}` } })],
            }),
            el('div', {
              cls: 'hv-jrs-active-foot',
              children: [
                el('span', {
                  cls: 'hv-jrs-count',
                  text: `${fmtInt(quest.have)} / ${fmtInt(quest.target)}`,
                }),
                el('div', { cls: 'hv-jrs-reward', children: rewardBits }),
              ],
            }),
          ],
        })
      );
      if (quest.done) {
        stack.appendChild(
          el('p', { cls: 'hv-note', text: 'Goal complete — tap the banner to claim your reward.' })
        );
      }

      // Tease the next two rungs (correct lap scaling via advanceQuest).
      const teased = el('div', { cls: 'hv-jrs-list' });
      let pos = { index: idx, lap };
      for (let n = 0; n < 2; n += 1) {
        pos = advanceQuest(pos.index, pos.lap);
        const q = questAt(pos.index, pos.lap);
        teased.appendChild(journalUpcomingRow(q.title, q.reward));
      }
      stack.appendChild(teased);

      body.appendChild(stack);
    },
  });
};

// ── Level unlocks ──────────────────────────────────────────────────────────────

/** Buildings whose `unlockLevel` is exactly `level`, in catalog order. */
const buildingsUnlockingAt = (level: number): string[] =>
  Object.values(CATALOG)
    // The house is auto-placed on the first claim, never built — omit it.
    .filter((spec) => spec.unlockLevel === level && spec.special !== 'house')
    .map((spec) => spec.name);

/** The plot number that a level in PLOT_LEVELS grants (1-indexed). */
const plotNumberAt = (level: number): number | null => {
  const i = PLOT_LEVELS.indexOf(level);
  return i === -1 ? null : i + 1;
};

export const openLevelSheet = (): void => {
  openSheet({
    title: '',
    render: (body) => {
      const me = store.data?.me ?? null;
      if (!me) {
        const stack = el('div', { cls: 'hv-stack' });
        stack.appendChild(el('p', { cls: 'hv-note', text: 'Sign in to earn levels.' }));
        body.appendChild(stack);
        return;
      }
      setSheetTitle(`Level ${fmtInt(me.level)}`);

      const stack = el('div', { cls: 'hv-stack' });

      // XP progress toward the next level (mirrors the top-bar ring).
      const cur = xpFor(me.level);
      const next = xpFor(me.level + 1);
      const denom = next - cur;
      const atMax = me.level >= MAX_LEVEL || denom <= 0;
      const frac = atMax ? 1 : (me.xp - cur) / denom;
      stack.appendChild(
        el('div', {
          cls: 'hv-row-line',
          children: [
            el('span', {
              cls: 'hv-chain',
              children: [iconEl('icon-star', 16), el('span', { text: 'Experience' })],
            }),
            el('b', {
              text: atMax ? 'Max level' : `${fmtInt(Math.max(0, me.xp - cur))} / ${fmtInt(denom)}`,
            }),
          ],
        })
      );
      stack.appendChild(
        el('div', {
          cls: 'hv-fill hv-fill-glow',
          children: [el('i', { attrs: { style: `width:${pctStr(frac)}` } })],
        })
      );
      stack.appendChild(
        el('p', {
          cls: 'hv-note',
          text: atMax
            ? "You've reached the height of village renown — keep building!"
            : 'Keep earning XP by collecting, selling and building. Here is what the next levels unlock.',
        })
      );

      // Unlock ladder: the next up-to-three levels that actually unlock something.
      const rows = el('div', { cls: 'hv-jrs-list' });
      let shown = 0;
      for (let k = me.level + 1; k <= MAX_LEVEL && shown < 3; k += 1) {
        const names = buildingsUnlockingAt(k);
        const plot = plotNumberAt(k);
        if (names.length === 0 && plot === null) continue;
        const unlocks: string[] = [...names];
        if (plot !== null) unlocks.push(`${ordinal(plot)} building plot`);
        rows.appendChild(
          el('div', {
            cls: 'hv-jrs-unlock',
            children: [
              el('span', { cls: 'hv-jrs-lvl', text: `Lv ${fmtInt(k)}` }),
              el('span', { cls: 'hv-jrs-name', text: unlocks.join(', ') }),
            ],
          })
        );
        shown += 1;
      }
      if (shown === 0) {
        rows.appendChild(
          el('div', { cls: 'hv-empty', text: 'Everything is unlocked — you have it all.' })
        );
      }
      stack.appendChild(el('div', { cls: 'hv-mkt-seg-label', text: 'Coming up' }));
      stack.appendChild(rows);

      body.appendChild(stack);
    },
  });
};

/** Small ordinal helper for plot copy ("3rd building plot"). */
const ordinal = (n: number): string => {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
};
