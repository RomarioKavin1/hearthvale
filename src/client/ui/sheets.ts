import type { Good, LeaderRow } from '../../shared/types';
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

// ── Village Market (read-only info panel) ────────────────────────────────────
// S1: harvests auto-sell on collect, so the market is a dashboard, not a shop.

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

const renderMarketRow = (good: Good): HTMLElement => {
  const data = store.data;
  const price = data?.prices[good] ?? 0;
  const stock = data?.stockpile[good] ?? 0;
  const base = MARKET[good].base;

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

  const head = el('div', {
    cls: 'hv-mkt-head',
    children: [
      goodIcon(good, 34),
      el('div', {
        cls: 'hv-mkt-main',
        children: [
          el('div', { cls: 'hv-mkt-name', text: GOOD_LABEL[good] }),
          el('div', { cls: 'hv-mkt-sub', text: `In stock: ${fmtInt(stock)}` }),
          bar,
        ],
      }),
      el('div', { cls: 'hv-mkt-right', children: [priceEl] }),
    ],
  });

  return el('div', { cls: 'hv-mkt', children: [head] });
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
          text: 'Your harvests sell here automatically — prices rise when the village runs short.',
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
  { icon: 'icon-home', title: 'Settle', text: 'Tap open grass to claim a plot. Your first claim builds your House.' },
  { icon: 'furrow-crop-wheat', title: 'Plant', text: 'Build a Wheat Field, Grove or Quarry and let it ripen.' },
  { icon: 'icon-coin', title: 'Tap to collect', text: 'Tap a ready building — your harvest sells itself and coins pop instantly.' },
  { icon: 'icon-star', title: 'Perfect Harvest', text: 'Ripe buildings sparkle gold now and then — tap during the sparkle for a double harvest.' },
  { icon: 'icon-hammer', title: 'Grow', text: 'Spend coins on more buildings and upgrades. Sawmills and kilns make planks and bricks.' },
  { icon: 'icon-trophy', title: 'Raise the Village Hall', text: 'Contribute planks and bricks together — every Hall level boosts everyone and unlocks new land.' },
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
          text: 'Check in daily for a growing coin streak, and boost a neighbour’s building for a little bonus.',
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
