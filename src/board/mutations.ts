import { rectOf, type Change, type Patch, type Rect } from "@/board/patch";
import type { BoardNode, NodeId } from "@/board/types";

/**
 * Every mutation is built here, and every one returns its inverse alongside its
 * forward patch. A mutation whose inverse is written somewhere else, or later,
 * is how an undo stack silently corrupts a document (D15) — so the two are
 * always produced by the same function, from the same snapshot of state.
 */

export function insertNodes(
  nodes: readonly BoardNode[],
  added: readonly BoardNode[],
  label: string,
): Change {
  // Appended, because array order is paint order and new nodes belong on top.
  const apply: Patch = added.map((node, offset) => ({
    kind: "insert",
    index: nodes.length + offset,
    node,
  }));
  const invert: Patch = [...added]
    .reverse()
    .map((node) => ({ kind: "remove", index: -1, node }) as const);
  return { label, apply, invert };
}

export function deleteNodes(
  nodes: readonly BoardNode[],
  ids: readonly NodeId[],
): Change {
  const targets = ids
    .map((id) => ({ index: nodes.findIndex((node) => node.id === id), id }))
    .filter((entry) => entry.index !== -1)
    // Highest index first, so earlier removals cannot shift later ones.
    .sort((a, b) => b.index - a.index);

  const apply: Patch = targets.map(({ index }) => ({
    kind: "remove",
    index,
    node: nodes[index]!,
  }));
  // Reinsert lowest index first so each node lands back at its original slot.
  const invert: Patch = [...targets].reverse().map(({ index }) => ({
    kind: "insert",
    index,
    node: nodes[index]!,
  }));

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

/** Moves nodes to the end (front) or the start (back) of the paint order. */
export function reorderNodes(
  nodes: readonly BoardNode[],
  ids: readonly NodeId[],
  target: "front" | "back",
): Change {
  const indices = nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => ids.includes(node.id))
    .map(({ index }) => index);

  if (indices.length === 0) {
    return { label: `bring to ${target}`, apply: [], invert: [] };
  }

  const apply: Patch = [];
  const invert: Patch = [];

  if (target === "front") {
    // Lowest first: each moves to the end, preserving relative order.
    for (const from of indices) {
      apply.push({ kind: "reorder", from, to: nodes.length - 1 });
    }
  } else {
    for (const from of [...indices].reverse()) {
      apply.push({ kind: "reorder", from, to: 0 });
    }
  }

  // Undo a sequence of moves by reversing each, in reverse order.
  for (const op of [...apply].reverse()) {
    if (op.kind === "reorder") {
      invert.push({ kind: "reorder", from: op.to, to: op.from });
    }
  }

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
