import type { BoardNode, NodeId } from "@/board/types";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The primitive edits a board's node list can undergo. Everything undoable is
 * expressed as a list of these, so `applyPatch` is the single place node state
 * changes shape.
 *
 * `remove` carries the whole node rather than just its id: that is what lets
 * its inverse put the node back with its exact geometry *and* its exact array
 * index, which is the paint order (D18).
 */
export type NodeOp =
  | { kind: "insert"; index: number; node: BoardNode }
  | { kind: "remove"; index: number; node: BoardNode }
  | { kind: "geometry"; id: NodeId; rect: Rect }
  | { kind: "text"; id: NodeId; text: string }
  | { kind: "reorder"; from: number; to: number };

export type Patch = NodeOp[];

/** One undoable unit of work: a forward patch and its exact inverse. */
export interface Change {
  label: string;
  apply: Patch;
  invert: Patch;
}

export function applyPatch(
  nodes: readonly BoardNode[],
  patch: Patch,
): BoardNode[] {
  let next = [...nodes];
  for (const op of patch) {
    next = applyOp(next, op);
  }
  return next;
}

function applyOp(nodes: BoardNode[], op: NodeOp): BoardNode[] {
  switch (op.kind) {
    case "insert": {
      const next = [...nodes];
      next.splice(op.index, 0, op.node);
      return next;
    }
    case "remove": {
      const index = nodes.findIndex((node) => node.id === op.node.id);
      if (index === -1) {
        return nodes;
      }
      const next = [...nodes];
      next.splice(index, 1);
      return next;
    }
    case "geometry": {
      return nodes.map((node) =>
        node.id === op.id ? { ...node, ...op.rect } : node,
      );
    }
    case "text": {
      return nodes.map((node) =>
        node.id === op.id && node.kind === "text"
          ? { ...node, text: op.text }
          : node,
      );
    }
    case "reorder": {
      const next = [...nodes];
      const [moved] = next.splice(op.from, 1);
      if (!moved) {
        return nodes;
      }
      next.splice(op.to, 0, moved);
      return next;
    }
  }
}

export function rectOf(node: BoardNode): Rect {
  return { x: node.x, y: node.y, w: node.w, h: node.h };
}
