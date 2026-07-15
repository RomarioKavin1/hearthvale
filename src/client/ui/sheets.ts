import type { Good, LeaderRow } from '../../shared/types';
import {
  CATALOG,
  HALL_POPULATION,
  hallPerks,
  KEEP_STAGE_COSTS,
  MARKET,
  MAX_LEVEL,
  OUTFIT_HEX,
  PLOT_LEVELS,
  STAGE_NAME_WORDS,
  STAGE_POT,
} from '../../shared/catalog';
import { GOODS, xpFor } from '../../shared/logic/economy';
import { sellValue } from '../../shared/logic/market';
import {
  advanceQuest,
  QUEST_CHAIN,
  questAt,
} from '../../shared/quests';
import type { SpriteKey } from '../art/manifest';
import { api } from '../net';
import { store } from '../state';
import {
  activeQuest,
  el,
  fmtInt,
  GOOD_LABEL,
  goodIcon,
  iconEl,
  isPending,
  pctStr,
  promptLogin,
  withTip,
} from './dom';
import { action, openSheet, refreshSheet, setSheetTitle, toast } from './sheet';
import { noteHallOpened, noteMarketOpened } from './walkthrough';

/**
 * The "menu" sheets: the read-only Village Market info panel (prices, trends,
 * stockpile), the Village Hall (planks/bricks contributions with a pro-rata pot
 * + stage naming), the leaderboards, the how-to guide, the Journal and the
 * level-unlocks sheet. Each keeps its own small module-scoped UI state so the
 * sheet manager's frequent re-renders don't discard it.
 */

// ── Village Market ───────────────────────────────────────────────────────────
// Read-only price/stockpile dashboard PLUS per-good manual selling (P1): tap a
// good you hold to expand a sell stepper. Selling is the only way the shared
// stockpile — which processors draw from — refills.

/** Hard cap on a single sell order (matches the server's MAX_SELL_QTY). */
const SELL_CAP = 500;

type SellPick = '10' | '50' | 'all';
let marketFocus: Good | null = null;
let sellPick: SellPick = '10';

const sellQty = (pick: SellPick, held: number): number => {
  const cap = Math.min(held, SELL_CAP);
  return pick === 'all' ? cap : Math.min(Number(pick), cap);
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

/** The expandable sell panel for one good: a 10/50/All stepper, a live
 * sellValue preview and the Sell button. Shown when the row is focused. */
const renderSellBody = (good: Good): HTMLElement => {
  const data = store.data;
  const me = data?.me ?? null;
  const stock = data?.stockpile[good] ?? 0;
  const held = me?.wallet[good] ?? 0;

  const seg = el('div', { cls: 'hv-mkt-seg' });

  if (me && held <= 0) {
    seg.appendChild(
      el('p', {
        cls: 'hv-note hv-muted',
        text: `You have no ${GOOD_LABEL[good]} to sell yet — collect some first.`,
      })
    );
    return seg;
  }

  const qty = sellQty(sellPick, held);
  const gain = sellValue(qty, stock, good);

  const steps = el('div', { cls: 'hv-steps' });
  for (const p of ['10', '50', 'all'] as SellPick[]) {
    const disabled = me !== null && (p === 'all' ? held <= 0 : held < Number(p));
    const b = el('button', {
      cls: `hv-step${sellPick === p ? ' is-picked' : ''}`,
      text: p === 'all' ? 'All' : p,
      attrs: { type: 'button' },
    });
    if (disabled && sellPick !== p) b.disabled = true;
    b.addEventListener('click', () => {
      sellPick = p;
      refreshSheet();
    });
    steps.appendChild(b);
  }
  seg.appendChild(steps);

  seg.appendChild(
    el('div', {
      cls: 'hv-mkt-preview',
      children: [
        el('span', { text: `Sell ${fmtInt(qty)} ${GOOD_LABEL[good]}` }),
        el('b', {
          cls: 'hv-chain',
          children: [el('span', { text: `+${fmtInt(gain)}` }), iconEl('icon-coin', 14)],
        }),
      ],
    })
  );

  const btn = el('button', {
    cls: 'hv-btn',
    text: me ? `Sell ${fmtInt(qty)}` : 'Sign in to sell',
    attrs: { type: 'button', 'data-sell-btn': good },
  });
  if (me && (qty <= 0 || isPending('sell'))) btn.disabled = true;
  btn.addEventListener('click', () => {
    if (!me) {
      promptLogin();
      return;
    }
    void action('sell', async () => {
      const res = await api.sell(good, qty);
      store.applyMutation({ me: res.me, stockpile: res.stockpile, prices: res.prices });
      toast(`Sold ${fmtInt(qty)} ${GOOD_LABEL[good]} for +${fmtInt(gain)} coins`, 'gain');
    });
  });
  seg.appendChild(btn);
  return seg;
};

const renderMarketRow = (good: Good): HTMLElement => {
  const data = store.data;
  const price = data?.prices[good] ?? 0;
  const stock = data?.stockpile[good] ?? 0;
  const held = data?.me?.wallet[good] ?? 0;
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
  if (price > base) {
    withTip(priceEl, 'Price above base — the village is short on this good');
  } else if (price < base) {
    withTip(priceEl, 'Price below base — the village is well stocked');
  }

  // Stockpile bar pivots on the market target: half-full at the target stock
  // (the neutral price point), full at a 2x-target glut (the price floor).
  const frac = stock / (2 * MARKET[good].target);
  const bar = el('div', {
    cls: 'hv-fill',
    children: [el('i', { attrs: { style: `width:${pctStr(frac)}` } })],
  });

  const subText =
    held > 0 ? `In stock: ${fmtInt(stock)} · You hold: ${fmtInt(held)}` : `In stock: ${fmtInt(stock)}`;
  const head = el('button', {
    cls: 'hv-mkt-head',
    attrs: { type: 'button', 'data-mkt-good': good },
    children: [
      goodIcon(good, 34),
      el('div', {
        cls: 'hv-mkt-main',
        children: [
          el('div', { cls: 'hv-mkt-name', text: GOOD_LABEL[good] }),
          el('div', { cls: 'hv-mkt-sub', text: subText }),
          bar,
        ],
      }),
      el('div', {
        cls: 'hv-mkt-right',
        children: [priceEl, el('div', { cls: 'hv-mkt-hold', text: held > 0 ? 'Tap to sell' : '' })],
      }),
    ],
  });
  head.addEventListener('click', () => {
    marketFocus = expanded ? null : good;
    sellPick = '10';
    refreshSheet();
  });

  const wrap = el('div', { cls: 'hv-mkt', children: [head] });
  if (expanded) wrap.appendChild(renderSellBody(good));
  return wrap;
};

export const openMarketSheet = (): void => {
  noteMarketOpened();
  openSheet({
    title: 'Village Market',
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
      }
      stack.appendChild(
        el('p', {
          cls: 'hv-note',
          text: 'Sell at the Market — prices rise when the village runs short, and processors buy from the stockpile your sales fill.',
        })
      );

      const rows = el('div', { cls: 'hv-mkt-rows' });
      for (const good of GOODS) rows.appendChild(renderMarketRow(good));
      stack.appendChild(rows);
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
  withTip(
    btn,
    `Give ${GOOD_LABEL[good]} to the Village Hall — you earn a share of the level pot`
  );
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
      toast(`+${fmtInt(applied)} ${GOOD_LABEL[good]} to the Village Hall!`, 'celebrate');
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
        text: name || `Level ${i + 1} — unnamed`,
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
  if (target === 3) lines.push('+1 plot for every villager');
  if (target === 4) lines.push('Boost limit 5 → 7 per day');
  if (target === 5) lines.push('Golden Hall banner for the village');
  return lines;
};

/** The player's held Hall material (planks + bricks) as two compact chips —
 * the only goods a villager still carries; they are spent right below. */
const heldGoodsRow = (planks: number, bricks: number): HTMLElement =>
  el('div', {
    cls: 'hv-held-row',
    children: (['planks', 'bricks'] as const).map((good) =>
      el('span', {
        cls: 'hv-held-chip',
        children: [
          goodIcon(good, 18),
          el('span', {
            text: `${fmtInt(good === 'planks' ? planks : bricks)} ${GOOD_LABEL[good]}`,
          }),
        ],
      })
    ),
  });

export const openKeepSheet = (): void => {
  noteHallOpened();
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

      // What the player is carrying, then the contribute controls per good.
      if (me) {
        stack.appendChild(
          el('div', { cls: 'hv-mkt-seg-label', text: 'Your building material' })
        );
        stack.appendChild(heldGoodsRow(me.wallet.planks, me.wallet.bricks));
        if (me.wallet.planks <= 0 && me.wallet.bricks <= 0) {
          stack.appendChild(
            el('p', {
              cls: 'hv-note hv-muted',
              text: 'Sawmills make planks and kilns make bricks — build one to start contributing.',
            })
          );
        }
      }
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
    title: 'Name this level',
    render: (body) => {
      const stack = el('div', { cls: 'hv-stack' });
      stack.appendChild(
        el('p', { cls: 'hv-note', text: 'Top contributors name a completed level. Pick a word from each column.' })
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
        text: 'Name this level',
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
          toast(`Level named ${res.city.stageNames[stageIndex] ?? ''}!`, 'celebrate');
          openKeepSheet();
        });
      });
      stack.appendChild(submit);
      body.appendChild(stack);
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

// ── How Hearthvale works (the complete reference) ─────────────────────────────

/**
 * The single source of truth for "how the game works", opened both from the
 * always-visible HUD info button and the Menu's "How to play" entry. Every
 * number here is pulled from the shared catalog / economy / quest logic so the
 * reference never drifts from the rules the server actually runs. Rendered as a
 * tap-to-expand accordion (native <details>) so the sheet stays scannable.
 */
const INFO_SECTIONS: Array<{
  icon: SpriteKey;
  title: string;
  lines: string[];
}> = [
  {
    icon: 'icon-home',
    title: 'Getting started',
    lines: [
      'Tap open grass to settle a plot. Your first claim is free and raises your House.',
      'You begin with two plots, so you can start a field and a grove before any level-up.',
      'A short guided tour points out settling, planting, collecting and selling.',
    ],
  },
  {
    icon: 'icon-hammer',
    title: 'Buildings & chains',
    lines: [
      'Raw producers: Wheat Field (60c, wheat), Forester’s Grove (80c, logs), Quarry (150c, stone, Lv2).',
      'Processors: Windmill (220c, 2 wheat to 1 flour, Lv2), Sawmill (300c, 2 logs to 1 planks, Lv3), Mason’s Kiln (400c, 2 stone to 1 bricks, Lv4).',
      'Bakery (350c, Lv3) bakes 1 flour into 12 coins. Homes: House (free first claim), Manor (1600c, Lv9). Decor: Old Well (120c), Tree Grove (60c), Stone Fountain (700c).',
      'Chains: wheat to flour to bread; logs to planks; stone to bricks.',
      'Wallet-first: a workshop grinds YOUR OWN goods free first, then buys any extra from the shared stockpile.',
      'Upgrade to tier 2 (x2.5 cost, x2.2 rate) or tier 3 (x6 cost, x4 rate). Demolishing refunds 50%.',
    ],
  },
  {
    icon: 'icon-coin',
    title: 'Ready & collecting',
    lines: [
      'Ripe buildings float a bubble. Tap the bubble or the building to collect straight into your wallet.',
      'Collect All (the coin button) gathers every ready building at once.',
      'Perfect Harvest: a ripe building sparkles gold about every 11s for ~1.8s. Tap during the sparkle to double that harvest.',
    ],
  },
  {
    icon: 'icon-cart',
    title: 'Market',
    lines: [
      'Marginal pricing: every unit you sell nudges the price. Prices rise when the village is short and fall on a surplus.',
      'Base prices: wheat 3, logs 4, stone 5, flour 9, planks 12, bricks 15.',
      'Selling fills the shared stockpile that workshops buy from. A "village needs" note flags goods running low.',
    ],
  },
  {
    icon: 'icon-trophy',
    title: 'Village Hall',
    lines: [
      'Five levels, each needing planks + bricks AND a house population: L1 30p/15b, 2 houses; L2 60/40, 4; L3 120/80, 8; L4 200/140, 14; L5 320/220, 22.',
      'Perks stack: +3% village production per level, +1 plot for everyone from L3, daily boost limit 5 rising to 7 at L4.',
      'Each level pays a coin pot (level n = n x 400c) split by contribution (at least 25c each). The top contributor names the level, which also unlocks a wider land ring.',
    ],
  },
  {
    icon: 'icon-star',
    title: 'Placement bonuses',
    lines: [
      'Windmill by a Wheat Field, Bakery by a Windmill, Sawmill by a Grove, Kiln by a Quarry: +25% each.',
      'A raw producer beside the river: +50%.',
      'Adjacent decor: +0.1 x tier each (cap +60%, doubled during a decor festival). Total placement bonus caps at +100%.',
    ],
  },
  {
    icon: 'icon-streak',
    title: 'Daily rhythm',
    lines: [
      'Weather rolls daily: sunny +10%, harvest moon +50%, rain +30% to wheat and logs, clear neutral.',
      'A festival auto-rotates coins to raw to processed to decor, giving that category +50% for the day.',
      'Check in daily for 25c x your streak day (up to 175c at a 7-day streak) plus 50 XP. Missing a day resets the streak.',
      'A fresh daily post keeps the village in the feed.',
    ],
  },
  {
    icon: 'icon-scroll',
    title: 'Quests & journal',
    lines: [
      'The Journal runs a quest chain (found homestead, build a field, first harvest, Perfect Harvest, sell 10, and on). Claim each for coins and XP.',
      'XP levels you up: level N needs 50 x N x (N-1) XP, up to level 15. New levels unlock buildings and plots.',
      'Titles by level: Settler, Builder (3), Architect (6), Alderman (9), Founder (12).',
    ],
  },
  {
    icon: 'icon-question',
    title: 'Expression',
    lines: [
      'Village Mural: a shared 24 x 16 canvas. Paint up to 12 pixels a day, and painting over others is allowed.',
      'Personalise with 8 villager outfits and roof paint (25c). Mods set the crest, village name and theme or biome.',
    ],
  },
  {
    icon: 'icon-check',
    title: 'Neighbours',
    lines: [
      'Boost a neighbour’s building: it produces double for 30 minutes and you earn 15c + 5 XP.',
      'The daily boost limit is 5, rising to 7 once the Village Hall reaches level 4.',
      'Leaderboards rank villagers by Value, Earned and Contributed.',
    ],
  },
  {
    icon: 'icon-arrow-up',
    title: 'Land',
    lines: [
      'Land opens in rings as the Village Hall levels up, not from raw population. Locked tiles reject building until the Hall unlocks them.',
      'Ruins (crumbled walls, old stone circles, dry wells) are scenic landmarks you cannot build on.',
      'The river and the central village square are also unbuildable.',
    ],
  },
];

export const openHowToSheet = (): void => {
  openSheet({
    title: 'How Hearthvale works',
    render: (body) => {
      const wrap = el('div', { cls: 'hv-info' });
      INFO_SECTIONS.forEach((sec, i) => {
        const bodyLines = el('div', {
          cls: 'hv-info-body',
          children: sec.lines.map((t) => el('p', { text: t })),
        });
        const summary = el('summary', {
          cls: 'hv-info-sum',
          children: [
            el('span', { cls: 'hv-info-ic', children: [iconEl(sec.icon, 18)] }),
            el('span', { cls: 'hv-info-ttl', text: sec.title }),
          ],
        });
        const details = el('details', {
          cls: 'hv-info-sec',
          children: [summary, bodyLines],
        });
        // Open the first section so the sheet never reads as an empty list.
        if (i === 0) details.setAttribute('open', '');
        wrap.appendChild(details);
      });
      body.appendChild(wrap);
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

      // My villager: pick the outfit colour your walker wears in the village.
      stack.appendChild(el('div', { cls: 'hv-mkt-seg-label', text: 'My villager' }));
      const outfits = el('div', { cls: 'hv-outfits' });
      OUTFIT_HEX.forEach((hex, i) => {
        const selected = me.outfit === i;
        const btn = el('button', {
          cls: `hv-outfit${selected ? ' is-selected' : ''}`,
          attrs: { type: 'button', style: `background:${hex}` },
        });
        btn.setAttribute('aria-label', `Outfit ${i + 1}`);
        if (selected || isPending('outfit')) btn.disabled = true;
        btn.addEventListener('click', () => {
          void action('outfit', async () => {
            const res = await api.outfit(i);
            store.applyMutation({ me: res.me });
            toast('Your villager changed outfit', 'gain');
          });
        });
        outfits.appendChild(btn);
      });
      stack.appendChild(outfits);
      stack.appendChild(
        el('p', {
          cls: 'hv-note hv-muted',
          text: 'The villager in this colour on the map is you.',
        })
      );

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
