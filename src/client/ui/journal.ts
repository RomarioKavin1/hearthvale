import type { QuestView } from '../../shared/types';
import { api } from '../net';
import { store } from '../state';
import {
  activeQuest,
  clearNode,
  clearPending,
  el,
  fmtInt,
  iconEl,
  isPending,
  markPending,
  notifyError,
  pctStr,
  toast,
  withTip,
} from './dom';
import { openJournalSheet } from './sheets';

/**
 * The Villager's Journal banner (Task G2) — a compact card pinned top-left under
 * the top bar that always answers "what do I do now". It mirrors the server's
 * single active quest (`StateResponse.quest`): a scroll icon, the quest title, a
 * thin progress bar and a reward chip.
 *
 * States, top-down:
 *   • logged-out ............... hidden (the sign-in pill covers this).
 *   • in-progress .............. muted cream card; tap opens the Journal sheet.
 *   • done → GOLD .............. glow border, "Claim: {title}", the whole banner
 *                                is the (pending-guarded) claim button.
 *
 * Claiming pays the reward server-side, bursts confetti over the banner and
 * refreshes the store so the next quest slides in. When a quest's `done` flips
 * false→true (progress caught up) the banner pulses and a soft toast invites the
 * claim. Everything degrades gracefully under `prefers-reduced-motion`.
 */

const PARTICLE_COUNT = 12;

let banner: HTMLButtonElement | undefined;
let iconSlot: HTMLElement | undefined;
let titleEl: HTMLElement | undefined;
let fillEl: HTMLElement | undefined;
let progressText: HTMLElement | undefined;
let rewardEl: HTMLElement | undefined;

// Previous `done` state, so we can detect the false→true completion edge.
let prevDone = false;

const reduceMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Build the reward chip children for a quest (coins and/or xp). */
const rewardChildren = (reward: QuestView['reward']): Node[] => {
  const out: Node[] = [];
  if (reward.coins !== undefined) {
    out.push(
      el('span', {
        cls: 'hv-jr-reward-chip',
        children: [iconEl('icon-coin', 13), el('span', { text: fmtInt(reward.coins) })],
      })
    );
  }
  if (reward.xp !== undefined) {
    out.push(
      el('span', {
        cls: 'hv-jr-reward-chip',
        children: [iconEl('icon-star', 13), el('span', { text: `${fmtInt(reward.xp)} XP` })],
      })
    );
  }
  return out;
};

/** A short human summary of a reward, e.g. "+40 coins" / "+50 XP". Zero-valued
 * legs are dropped so a coin-only quest never reads "+40 coins & +0 XP" (the
 * claim response carries an always-present `xp: 0` for coin-only rewards). */
const rewardSummary = (reward: QuestView['reward']): string => {
  const parts: string[] = [];
  if (reward.coins) parts.push(`+${fmtInt(reward.coins)} coins`);
  if (reward.xp) parts.push(`+${fmtInt(reward.xp)} XP`);
  return parts.join(' & ');
};

/** Spray a short-lived confetti burst of DOM particles over the banner. */
const confetti = (): void => {
  if (!banner || reduceMotion()) return;
  const burst = el('div', { cls: 'hv-jr-confetti' });
  const colors = ['var(--glow)', 'var(--accent)', 'var(--leaf)', 'var(--straw)', 'var(--red)'];
  for (let i = 0; i < PARTICLE_COUNT; i += 1) {
    const angle = (i / PARTICLE_COUNT) * Math.PI * 2;
    const dist = 42 + Math.random() * 26;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - 18;
    const color = colors[i % colors.length];
    const p = el('i', {
      attrs: {
        style: `--dx:${dx.toFixed(1)}px;--dy:${dy.toFixed(1)}px;background:${color}`,
      },
    });
    burst.appendChild(p);
  }
  banner.appendChild(burst);
  window.setTimeout(() => burst.remove(), 900);
};

/** Run a one-shot scale pulse on the banner (skipped under reduced motion). */
const pulse = (): void => {
  if (!banner || reduceMotion()) return;
  banner.classList.remove('is-pulse');
  void banner.offsetWidth; // restart the animation
  banner.classList.add('is-pulse');
  window.setTimeout(() => banner?.classList.remove('is-pulse'), 700);
};

const doClaim = (): void => {
  if (isPending('claimQuest')) return;
  markPending('claimQuest');
  render();
  void api
    .claimQuest()
    .then((res) => {
      store.applyMutation({ me: res.me });
      confetti();
      const summary = rewardSummary(res.gained);
      toast(summary ? `Quest claimed — ${summary}!` : 'Quest claimed!', 'celebrate');
      return store.refresh();
    })
    .catch((err: unknown) =>
      notifyError(err instanceof Error ? err.message : 'Could not claim this goal.')
    )
    .finally(() => {
      clearPending('claimQuest');
      render();
    });
};

const onBannerClick = (): void => {
  const data = store.data;
  const quest = data ? activeQuest(data) : null;
  if (!quest) return;
  if (quest.done) doClaim();
  else openJournalSheet();
};

const render = (): void => {
  if (!banner || !iconSlot || !titleEl || !fillEl || !progressText || !rewardEl) return;
  const data = store.data;
  const quest = data ? activeQuest(data) : null;
  // Logged-out (or no snapshot yet): the sign-in pill covers the call-to-action.
  if (!data?.me || !quest) {
    banner.style.display = 'none';
    prevDone = false;
    return;
  }
  banner.style.display = '';

  const claiming = isPending('claimQuest');
  const done = quest.done;

  // Completion edge (false→true): pulse + a soft nudge toast.
  if (done && !prevDone && !claiming) {
    pulse();
    toast('Journal goal complete — tap to claim', 'gain');
  }
  prevDone = done;

  banner.classList.toggle('is-done', done);
  banner.classList.toggle('is-claiming', claiming);

  titleEl.textContent = done ? `Claim: ${quest.title}` : quest.title;

  const frac = quest.target > 0 ? quest.have / quest.target : 1;
  fillEl.style.width = pctStr(frac);
  progressText.textContent = `${fmtInt(quest.have)} / ${fmtInt(quest.target)}`;

  clearNode(rewardEl);
  for (const chip of rewardChildren(quest.reward)) rewardEl.appendChild(chip);
};

/** Build the banner, mount it into `parent`, and start mirroring the store. */
export const mountJournal = (parent: HTMLElement): void => {
  iconSlot = el('span', { cls: 'hv-jr-icon', children: [iconEl('icon-scroll', 18)] });
  titleEl = el('div', { cls: 'hv-jr-title', text: '' });
  fillEl = el('i');
  const bar = el('div', { cls: 'hv-jr-bar', children: [fillEl] });
  progressText = el('div', { cls: 'hv-jr-progress', text: '' });
  rewardEl = el('div', { cls: 'hv-jr-reward' });

  const main = el('div', {
    cls: 'hv-jr-main',
    children: [
      el('div', { cls: 'hv-jr-top', children: [titleEl, rewardEl] }),
      el('div', { cls: 'hv-jr-barline', children: [bar, progressText] }),
    ],
  });

  banner = el('button', {
    cls: 'hv-jr',
    attrs: { type: 'button' },
    children: [iconSlot, main],
    on: { click: onBannerClick },
  });
  withTip(banner, 'Your current goal — tap to open the Journal');
  banner.style.display = 'none';
  parent.appendChild(banner);

  store.on('change', render);
  render();
};
