// Local realtime bus for the dev harness.
//
// The real game talks to Devvit's realtime service (`connectRealtime` on the
// client, `realtime.send` on the server). In the harness there is no server and
// no socket: the mock API publishes "broadcasts" onto this in-process bus and the
// mocked `connectRealtime` subscribes to it, so the Phaser scene's live-update
// code paths (tile pops, hall level-ups, ring unlocks, market/festival changes)
// run exactly as they do in production.

type Listener = (msg: unknown) => void;

const channels = new Map<string, Set<Listener>>();

/** Subscribe a listener to a channel. Returns an unsubscribe function. */
export const subscribe = (channel: string, fn: Listener): (() => void) => {
  let set = channels.get(channel);
  if (!set) {
    set = new Set<Listener>();
    channels.set(channel, set);
  }
  set.add(fn);
  return () => {
    const s = channels.get(channel);
    if (s) s.delete(fn);
  };
};

/** Remove every listener on a channel (mirrors `disconnectRealtime`). */
export const clearChannel = (channel: string): void => {
  channels.delete(channel);
};

/**
 * Publish a message to every subscriber of a channel. Delivery is deferred to a
 * macrotask so a broadcast triggered while handling a fetch lands AFTER the
 * client has processed that fetch's response — matching the real ordering where
 * the mutation response is applied before its realtime echo arrives.
 */
export const publish = (channel: string, msg: unknown): void => {
  setTimeout(() => {
    const set = channels.get(channel);
    if (!set) return;
    for (const fn of set) fn(msg);
  }, 0);
};
