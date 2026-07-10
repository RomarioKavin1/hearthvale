// Stub for '@devvit/web/client', aliased in by vite.harness.config.ts.
//
// Every symbol the real client code imports from '@devvit/web/client' is
// re-implemented here against the browser and the local realtime bus, so the
// REAL Phaser scene + DOM HUD run unchanged with no Devvit runtime present.
//
// Only the surface the game path actually uses needs real behaviour
// (connectRealtime/disconnectRealtime for the scene, showToast/showLoginPrompt
// for the HUD). The rest are honest no-ops that log, so the module still
// satisfies any stray import.

import { clearChannel, subscribe } from './mock-bus';

/** The fake Devvit web context. Mirrors the fields real client code reads. */
export const context = {
  userId: 't2_dev',
  username: 'dev_player',
  postId: 't3_dev',
  subredditName: 'hearthvale_dev',
  postAuthorId: 't2_dev',
  client: undefined,
};

// ── Realtime ────────────────────────────────────────────────────────────────

/** A stand-in for Devvit's Connection object (only `disconnect` is used). */
export class Connection {
  readonly #channel: string;
  #off: () => void;
  constructor(channel: string, off: () => void) {
    this.#channel = channel;
    this.#off = off;
  }
  async disconnect(): Promise<void> {
    this.#off();
    clearChannel(this.#channel);
  }
}

type ConnectOptions = {
  channel: string;
  onConnect?: (channel: string) => void;
  onDisconnect?: (channel: string) => void;
  onMessage: (data: unknown) => void;
};

const connected = new Set<string>();

export const connectRealtime = (opts: ConnectOptions): Connection => {
  const off = subscribe(opts.channel, (msg) => opts.onMessage(msg));
  connected.add(opts.channel);
  // Defer onConnect so callers that stop polling on connect settle after setup.
  setTimeout(() => opts.onConnect?.(opts.channel), 0);
  return new Connection(opts.channel, () => {
    off();
    connected.delete(opts.channel);
  });
};

export const disconnectRealtime = (channel: string): void => {
  connected.delete(channel);
  clearChannel(channel);
};

export const isRealtimeConnected = (channel: string): boolean =>
  connected.has(channel);

// ── Toasts / prompts / navigation ─────────────────────────────────────────────

type ToastLike = { text: string; appearance?: string };

const isToastLike = (v: unknown): v is ToastLike =>
  typeof v === 'object' && v !== null && 'text' in v;

/** Render a toast into a self-contained DOM strip (no Devvit host chrome). */
export const showToast = (textOrToast: string | ToastLike): void => {
  const text = isToastLike(textOrToast) ? textOrToast.text : textOrToast;
  let host = document.getElementById('hv-harness-toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'hv-harness-toasts';
    host.style.cssText =
      'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);' +
      'z-index:2147483000;display:flex;flex-direction:column;gap:6px;' +
      'align-items:center;pointer-events:none;font-family:system-ui,sans-serif';
    document.body.appendChild(host);
  }
  const chip = document.createElement('div');
  chip.textContent = text;
  chip.style.cssText =
    'background:#1b1b22;color:#fff;padding:8px 14px;border-radius:999px;' +
    'font-size:13px;box-shadow:0 4px 14px rgba(0,0,0,.35);opacity:0;' +
    'transition:opacity .18s ease';
  host.appendChild(chip);
  requestAnimationFrame(() => (chip.style.opacity = '1'));
  setTimeout(() => {
    chip.style.opacity = '0';
    setTimeout(() => chip.remove(), 250);
  }, 2600);
};

export const showLoginPrompt = (): void =>
  console.log('[harness] showLoginPrompt() — no-op (already "logged in" as dev_player)');

export const navigateTo = (url: unknown): void =>
  console.log('[harness] navigateTo()', url);

export const requestExpandedMode = (_event: unknown, entry: string): void =>
  console.log(`[harness] requestExpandedMode(entry=${entry}) — no-op`);

export const exitExpandedMode = (): void =>
  console.log('[harness] exitExpandedMode() — no-op');

export const getWebViewMode = (): 'inline' | 'expanded' => 'expanded';
