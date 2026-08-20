/**
 * What one tab tells the others.
 *
 * Two tabs on this origin are two sets of atoms over one IndexedDB. Each writes
 * the *whole* board record when it saves, so a tab holding a stale node list
 * lands it on top of a newer one — the second tab does not have to be edited to
 * destroy work, it only has to be open and then saved. Nothing here used a lock
 * or a channel, so neither tab knew the other existed.
 *
 * The fix is not a lock. It is telling the truth quickly: a tab that hears its
 * board changed on disk reloads it, so by the time it writes anything it is
 * writing over its own reading rather than over someone else's work.
 *
 * Deliberately carries no board content. Only "this changed, go and look" —
 * the message can arrive out of order, arrive twice, or be dropped entirely,
 * and IndexedDB is still the one source of truth. A payload would be a second
 * copy of the board that could disagree with the first.
 */

export type TabMessage =
  /** A board's stored record was replaced. */
  | { kind: "board"; boardId: string; updatedAt: number }
  /** A board was created or removed: the list changed, not a board. */
  | { kind: "boards" };

const CHANNEL = "canwas-tabs";

/**
 * One channel per tab, made on first use.
 *
 * `BroadcastChannel` is absent in a few places this app otherwise runs — some
 * embedded webviews, and any environment where the constructor is stubbed out.
 * Missing it costs the cross-tab behaviour and nothing else, which is exactly
 * where the app was before this existed, so it degrades to that rather than
 * throwing.
 */
let channel: BroadcastChannel | null | undefined;

function open(): BroadcastChannel | null {
  if (channel === undefined) {
    channel =
      typeof BroadcastChannel === "function"
        ? new BroadcastChannel(CHANNEL)
        : null;
  }
  return channel;
}

export function announce(message: TabMessage): void {
  try {
    open()?.postMessage(message);
  } catch {
    // A closed channel, or a message that will not clone. Neither is worth
    // failing a save that has already succeeded.
  }
}

/** Returns the unsubscribe. A tab never hears its own announcements. */
export function listen(handler: (message: TabMessage) => void): () => void {
  const live = open();
  if (!live) {
    return () => {};
  }
  const onMessage = (event: MessageEvent<TabMessage>) => handler(event.data);
  live.addEventListener("message", onMessage);
  return () => live.removeEventListener("message", onMessage);
}
