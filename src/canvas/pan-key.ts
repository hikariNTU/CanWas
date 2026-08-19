/**
 * Whether the pan modifier — the space bar — is held.
 *
 * Left-drag on empty canvas draws a selection box (D54), so a mouse needs some
 * other way to say "pan". Space is what every canvas tool uses for it.
 *
 * This is module state rather than React state on purpose: the two consumers
 * are native pointerdown handlers that read it once, at the instant of the
 * press. Threading it through a store would re-render the whole canvas twice
 * per key press to answer a question nothing renders.
 */

let down = false;

if (typeof window !== "undefined") {
  window.addEventListener("keydown", (event) => {
    // A space typed into a text node is a space, not a gesture.
    const target = event.target as HTMLElement | null;
    if (
      target?.isContentEditable ||
      /^(INPUT|TEXTAREA)$/.test(target?.tagName ?? "")
    ) {
      return;
    }
    if (event.code === "Space") {
      down = true;
    }
  });
  window.addEventListener("keyup", (event) => {
    if (event.code === "Space") {
      down = false;
    }
  });
  // Releasing the key in another window never reaches us, and a stuck pan
  // modifier means left-drag silently stops selecting.
  window.addEventListener("blur", () => {
    down = false;
  });
}

export function isPanKeyDown(): boolean {
  return down;
}
