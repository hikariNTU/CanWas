import { useSyncExternalStore } from "react";

/**
 * What one finger does on the board.
 *
 * `pan` moves the viewport wherever the finger lands, including on top of a
 * node; `select` drags nodes and rubber-bands empty canvas. A touch device has
 * no space bar and no middle button, so a full-bleed screenshot leaves nothing
 * to press that is not the image — and the board becomes impossible to move
 * around. The mode chip is that missing modifier, made visible (D70).
 *
 * Module state with a manual subscription rather than a Jotai atom, for the
 * same reason `pan-key.ts` is: the consumers that matter are native
 * `pointerdown` handlers which read the value once, at the instant of the
 * press. They are registered once and must not be torn down and re-attached
 * when the mode changes, or a gesture in flight loses its listeners.
 *
 * Not persisted, and deliberately not part of the board record. It is a view
 * preference like the viewport (D17), and syncing it would mean picking up a
 * phone and finding the mode a laptop chose.
 */
export type CanvasMode = "pan" | "select";

const COARSE_QUERY = "(pointer: coarse)";

let stored: CanvasMode = "pan";
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Whether the primary pointer is a finger.
 *
 * `pointer: coarse` asks what the device is mainly driven with, not what it is
 * capable of: a touchscreen laptop and an iPad with a keyboard attached both
 * report a fine primary pointer and both already have the modifiers, so
 * neither gets the chip. Live, because attaching a mouse changes the answer
 * mid-session.
 */
function coarseNow(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia(COARSE_QUERY).matches
  );
}

let coarse = coarseNow();

if (typeof window !== "undefined") {
  window.matchMedia(COARSE_QUERY).addEventListener("change", (event) => {
    coarse = event.matches;
    emit();
  });
}

/**
 * The mode actually in force. A fine pointer is always in `select`: it has
 * space and middle-drag for panning, it never sees the chip, and letting a
 * mode it cannot see govern its clicks would be a trap.
 */
export function currentMode(): CanvasMode {
  return coarse ? stored : "select";
}

export function setCanvasMode(next: CanvasMode) {
  if (stored === next) {
    return;
  }
  stored = next;
  emit();
}

/** For tests, which need each case to start from a known mode. */
export function resetCanvasMode() {
  stored = "pan";
  emit();
}

/**
 * Whether the primary pointer is a finger, on its own.
 *
 * Separate from `useCanvasMode` because a node's context menu cares about the
 * device but has no opinion about the mode.
 */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => coarse,
    () => false,
  );
}

export function useCanvasMode(): {
  mode: CanvasMode;
  setMode: (next: CanvasMode) => void;
  coarse: boolean;
} {
  const mode = useSyncExternalStore<CanvasMode>(
    subscribe,
    currentMode,
    () => "select",
  );
  const isCoarse = useCoarsePointer();
  // `setCanvasMode` is a module function and so is already stable — no
  // `useCallback` needed, and nothing re-renders because it changed identity.
  return { mode, setMode: setCanvasMode, coarse: isCoarse };
}
