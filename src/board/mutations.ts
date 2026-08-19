import { keyAbove, orderKeysBetween } from "@/board/order";
import { rectOf, type Change, type Patch, type Rect } from "@/board/patch";
import { FONT_SIZES } from "@/board/text";
import type { BoardNode, NewNode, NodeId, TextNode } from "@/board/types";

/**
 * Every mutation is built here, and every one returns its inverse alongside its
 * forward patch. A mutation whose inverse is written somewhere else, or later,
 * is how an undo stack silently corrupts a document (D15) — so the two are
 * always produced by the same function, from the same snapshot of state.
 */

/**
 * Places new nodes on top, in the order given.
 *
 * The order keys are minted here rather than by whoever built the node: this is
 * the only place that can see where the new node lands relative to what is
 * already on the board.
 */
export function insertNodes(
  nodes: readonly BoardNode[],
  added: readonly NewNode[],
  label: string,
): Change {
  const keys = orderKeysBetween(keyAbove(nodes), null, added.length);
  const placed = added.map(
    (node, offset) => ({ ...node, order: keys[offset]! }) as BoardNode,
  );

  const apply: Patch = placed.map((node) => ({ kind: "insert", node }));
  const invert: Patch = [...placed]
    .reverse()
    .map((node) => ({ kind: "remove", node }) as const);
  return { label, apply, invert };
}

export function deleteNodes(
  nodes: readonly BoardNode[],
  ids: readonly NodeId[],
): Change {
  const targets = nodes.filter((node) => ids.includes(node.id));

  const apply: Patch = targets.map((node) => ({ kind: "remove", node }));
  // Each node carries its own order key, so putting it back needs no memory of
  // where it sat.
  const invert: Patch = targets.map((node) => ({ kind: "insert", node }));

  return { label: `delete ${targets.length} node(s)`, apply, invert };
}

export function moveNodes(
  nodes: readonly BoardNode[],
  ids: readonly NodeId[],
  dx: number,
  dy: number,
): Change {
  const moved = nodes.filter((node) => ids.includes(node.id));
  const apply: Patch = moved.map((node) => ({
    kind: "geometry",
    id: node.id,
    rect: { ...rectOf(node), x: node.x + dx, y: node.y + dy },
  }));
  const invert: Patch = moved.map((node) => ({
    kind: "geometry",
    id: node.id,
    rect: rectOf(node),
  }));
  return { label: `move ${moved.length} node(s)`, apply, invert };
}

export function resizeNode(
  nodes: readonly BoardNode[],
  id: NodeId,
  rect: Rect,
): Change {
  const node = nodes.find((candidate) => candidate.id === id);
  if (!node) {
    return { label: "resize", apply: [], invert: [] };
  }
  return {
    label: "resize",
    apply: [{ kind: "geometry", id, rect }],
    invert: [{ kind: "geometry", id, rect: rectOf(node) }],
  };
}

/**
 * Moves nodes to the front or the back of the paint order.
 *
 * New keys are cut against the nodes that are *staying*, not against the whole
 * list: bringing the topmost node to the front would otherwise mint a key above
 * itself and creep upward on every press.
 */
export function reorderNodes(
  nodes: readonly BoardNode[],
  ids: readonly NodeId[],
  target: "front" | "back",
): Change {
  const moved = nodes.filter((node) => ids.includes(node.id));
  const staying = nodes.filter((node) => !ids.includes(node.id));
  if (moved.length === 0 || staying.length === 0) {
    return { label: `bring to ${target}`, apply: [], invert: [] };
  }

  const keys =
    target === "front"
      ? orderKeysBetween(staying.at(-1)!.order, null, moved.length)
      : orderKeysBetween(null, staying[0]!.order, moved.length);

  // Relative order among the moved nodes is preserved: they arrive as a block.
  const apply: Patch = moved.map((node, offset) => ({
    kind: "order",
    id: node.id,
    order: keys[offset]!,
  }));
  const invert: Patch = moved.map((node) => ({
    kind: "order",
    id: node.id,
    order: node.order,
  }));

  return { label: `bring to ${target}`, apply, invert };
}

/**
 * Text content plus the height it laid out to, as one Change.
 *
 * A patch is a list, so the content edit and its measurement travel together
 * and undo as a single step — the alternative, committing the height
 * separately, would put a second entry on the stack that the user never
 * performed.
 */
export function setTextContent(
  nodes: readonly BoardNode[],
  id: NodeId,
  text: string,
  height: number,
): Change {
  const node = nodes.find((candidate) => candidate.id === id);
  if (
    !node ||
    node.kind !== "text" ||
    (node.text === text && node.h === height)
  ) {
    return { label: "edit text", apply: [], invert: [] };
  }
  return {
    label: "edit text",
    apply: [
      { kind: "text", id, text },
      { kind: "geometry", id, rect: { ...rectOf(node), h: height } },
    ],
    invert: [
      { kind: "text", id, text: node.text },
      { kind: "geometry", id, rect: rectOf(node) },
    ],
  };
}

export function setFontSize(
  nodes: readonly BoardNode[],
  id: NodeId,
  fontSize: number,
): Change {
  const node = nodes.find((candidate) => candidate.id === id);
  if (!node || node.kind !== "text" || node.fontSize === fontSize) {
    return { label: "text size", apply: [], invert: [] };
  }
  return {
    label: "text size",
    apply: [{ kind: "fontSize", id, fontSize }],
    invert: [{ kind: "fontSize", id, fontSize: node.fontSize }],
  };
}

/** Nearest preset to an arbitrary size, so stepping is well defined either way. */
function nearestPresetIndex(fontSize: number): number {
  let best = 0;
  for (let index = 1; index < FONT_SIZES.length; index++) {
    if (
      Math.abs(FONT_SIZES[index]! - fontSize) <
      Math.abs(FONT_SIZES[best]! - fontSize)
    ) {
      best = index;
    }
  }
  return best;
}

/**
 * Moves every selected text node one preset up or down, clamped at the ends.
 *
 * All of them in a single Change, so a multi-node resize is one undo step
 * rather than one per node.
 */
export function stepFontSize(
  nodes: readonly BoardNode[],
  ids: readonly NodeId[],
  direction: 1 | -1,
): Change {
  const targets = nodes.filter(
    (node): node is TextNode => node.kind === "text" && ids.includes(node.id),
  );

  const apply: Patch = [];
  const invert: Patch = [];
  for (const node of targets) {
    const index = nearestPresetIndex(node.fontSize);
    const next =
      FONT_SIZES[
        Math.min(FONT_SIZES.length - 1, Math.max(0, index + direction))
      ]!;
    if (next === node.fontSize) {
      continue;
    }
    apply.push({ kind: "fontSize", id: node.id, fontSize: next });
    invert.push({ kind: "fontSize", id: node.id, fontSize: node.fontSize });
  }
  return { label: "text size", apply, invert };
}
