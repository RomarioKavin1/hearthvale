import type { BuildingCategory, LeaderRow } from '../../shared/types';
import { LANDMARK_THRESHOLDS } from '../../shared/catalog';
import { api } from '../net';
import { store } from '../state';
import {
  CATEGORY_META,
  el,
  fmtInt,
  isPending,
  pctStr,
  promptLogin,
  todayUtc,
} from './dom';
import { action, openSheet, refreshSheet, toast } from './sheet';

/**
 * The four "menu" sheets: landmark contributions, the festival ballot, the
 * leaderboards and the how-to guide. Each keeps its own small module-scoped UI
 * state (chosen amount, active tab, cached rows) so the sheet manager's frequent
 * re-renders don't discard it.
 */

const CATS: BuildingCategory[] = ['coins', 'supplies', 'decor'];

// ── Landmark ─────────────────────────────────────────────────────────────────

type StepPick = '10' | '50' | 'all';
let landmarkPick: StepPick = '10';

const pickedAmount = (supplies: number): number =>
  landmarkPick === 'all' ? supplies : Number(landmarkPick);

export const openLandmarkSheet = (): void => {
  openSheet({
    title: '🏰 Clocktower',
    render: (body) => {
      const data = store.data;
      if (!data) return;
      const { city, me } = data;
      const stage = city.landmarkStage;
      const stages = LANDMARK_THRESHOLDS.length;
      const complete = stage >= stages;

      const stack = el('div', { cls: 'hv-stack' });

      if (complete) {
        stack.appendChild(
          el('div', {
            cls: 'hv-note',
            children: [
              el('div', {
                text: '✨ The clocktower is complete! ✨',
                attrs: { style: 'font-size:16px;font-weight:800;text-align:center' },
              }),
              el('p', {
                cls: 'hv-note',
                text: 'The whole village raised it together. Its bell rings over every rooftop.',
              }),
            ],
          })
        );
        body.appendChild(stack);
        return;
      }

      const threshold = LANDMARK_THRESHOLDS[stage] ?? 0;
      const progress = city.landmarkProgress;
      const frac = threshold > 0 ? progress / threshold : 0;

      stack.appendChild(
        el('div', {
          cls: 'hv-row-line',
          children: [
            el('span', { text: `Stage ${stage + 1} of ${stages}` }),
            el('b', { text: `${fmtInt(progress)} / ${fmtInt(threshold)}` }),
          ],
        })
      );
      stack.appendChild(
        el('div', {
          cls: 'hv-fill hv-fill-glow',
          children: [
            el('i', { attrs: { style: `width:${pctStr(frac)}` } }),
          ],
        })
      );

      // Supplies balance + contribute stepper.
      stack.appendChild(
        el('div', {
          cls: 'hv-row-line',
          children: [
            el('span', { text: 'Your supplies' }),
            el('b', { text: `${fmtInt(me?.supplies ?? 0)} 🌿` }),
          ],
        })
      );

      const supplies = me?.supplies ?? 0;
      const steps = el('div', { cls: 'hv-steps' });
      const addStep = (pick: StepPick, label: string): void => {
        const disabled = pick === 'all' ? supplies <= 0 : supplies < Number(pick);
        const b = el('button', {
          cls: `hv-step${landmarkPick === pick ? ' is-picked' : ''}`,
          text: label,
          attrs: { type: 'button' },
        });
        if (disabled && landmarkPick !== pick) b.disabled = true;
        b.addEventListener('click', () => {
          landmarkPick = pick;
          refreshSheet();
        });
        steps.appendChild(b);
      };
      addStep('10', '10');
      addStep('50', '50');
      addStep('all', 'All');
      stack.appendChild(steps);

      const amount = Math.min(pickedAmount(supplies), supplies);
      const confirm = el('button', {
        cls: 'hv-btn',
        text: me
          ? `Contribute ${fmtInt(amount)} 🌿`
          : 'Sign in to contribute',
        attrs: { type: 'button' },
      });
      if (me && (amount <= 0 || isPending('contribute'))) confirm.disabled = true;
      confirm.addEventListener('click', () => {
        if (!me) {
          promptLogin();
          return;
        }
        void action('contribute', async () => {
          // The server clamps the contribution to the player's supplies, so read
          // the balance before the call and report the amount actually applied.
          const before = store.data?.me?.supplies ?? 0;
          const res = await api.contribute(amount);
          store.applyMutation({ city: res.city, me: res.me });
          const applied = Math.max(0, before - res.me.supplies);
          toast(`+${fmtInt(applied)} to the clocktower! 🏰`, 'celebrate');
        });
      });
      stack.appendChild(confirm);

      stack.appendChild(
        el('p', {
          cls: 'hv-note',
          text: 'Contributors to each stage earn (stage × 100) coins the moment that stage is completed by the village.',
        })
      );

      body.appendChild(stack);
    },
  });
};

// ── Ballot ───────────────────────────────────────────────────────────────────

let voteCounts: Record<BuildingCategory, number> | null = null;

const VOTE_KEY = 'hv-vote';

const votedToday = (): BuildingCategory | null => {
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
      if (cat === 'coins' || cat === 'supplies' || cat === 'decor') return cat;
    }
  } catch {
    return null;
  }
  return null;
};

const rememberVote = (category: BuildingCategory): void => {
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
    title: '🗳️ Tomorrow’s festival',
    render: (body) => {
      const me = store.data?.me ?? null;
      const voted = votedToday();
      const counts = voteCounts;
      const total = counts
        ? Math.max(1, CATS.reduce((s, c) => s + counts[c], 0))
        : 0;

      const stack = el('div', { cls: 'hv-stack' });
      stack.appendChild(
        el('p', { cls: 'hv-note', text: 'Cast your vote — the winning category’s buildings produce ×1.5 all day tomorrow.' })
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
            el('span', { cls: 'hv-cat-emoji', text: meta.emoji }),
            main,
            el('span', {
              cls: 'hv-cat-count',
              text: voteCounts ? fmtInt(count) : voted === cat ? '✓' : '',
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
            toast(`Voted ${meta.label} ${meta.emoji}`, 'gain');
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
    title: '🏆 Leaderboards',
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

const HOW_STEPS: Array<{ emoji: string; title: string; text: string }> = [
  { emoji: '🏡', title: 'Settle a plot', text: 'Tap any open grass tile to claim your first plot in the village.' },
  { emoji: '🔨', title: 'Build', text: 'Place cottages, gardens and more. Each earns coins or supplies over time.' },
  { emoji: '🪙', title: 'Collect', text: 'Tap a ready building — or hit Collect All — to gather what it produced.' },
  { emoji: '⚡', title: 'Help neighbours', text: 'Boost a neighbour’s building to double its output for 30 minutes (and earn coins).' },
  { emoji: '🏰', title: 'Raise the clocktower', text: 'Contribute supplies to the shared landmark. Every stage rewards its backers.' },
];

export const openHowToSheet = (): void => {
  openSheet({
    title: '📖 How to play',
    render: (body) => {
      const how = el('div', { cls: 'hv-how' });
      for (const step of HOW_STEPS) {
        how.appendChild(
          el('div', {
            cls: 'hv-how-step',
            children: [
              el('div', { cls: 'hv-how-emoji', text: step.emoji }),
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
