import { sortNodes } from "@/board/order";
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
 * its inverse put the node back with its exact geometry *and* its exact order
 * key, which is the paint order (D55).
 *
 * No op names a position. An index is meaningless the moment another device
 * has a list of its own, so restacking is `order` — a new key for one node —
 * and an insert carries its key on the node itself.
 */
export type NodeOp =
  | { kind: "insert"; node: BoardNode }
  | { kind: "remove"; node: BoardNode }
  | { kind: "geometry"; id: NodeId; rect: Rect }
  | { kind: "text"; id: NodeId; text: string }
  | { kind: "fontSize"; id: NodeId; fontSize: number }
  | { kind: "order"; id: NodeId; order: string };

export type Patch = NodeOp[];

/** One undoable unit of work: a forward patch and its exact inverse. */
export interface Change {
  label: string;
  apply: Patch;
  invert: Patch;
}

/**
 * The node list is kept sorted by order key, here and nowhere else.
 *
 * Everything downstream — rendering, hit testing, "the topmost node" — can then
 * go on reading the array in paint order, and no caller has to remember to
 * re-sort after an edit.
 */
export function applyPatch(
  nodes: readonly BoardNode[],
  patch: Patch,
): BoardNode[] {
  let next = [...nodes];
  for (const op of patch) {
    next = applyOp(next, op);
  }
  return sortNodes(next);
}

function applyOp(nodes: BoardNode[], op: NodeOp): BoardNode[] {
  switch (op.kind) {
    case "insert": {
      return [...nodes, op.node];
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
    case "fontSize": {
      return nodes.map((node) =>
        node.id === op.id && node.kind === "text"
          ? { ...node, fontSize: op.fontSize }
          : node,
      );
    }
    case "order": {
      return nodes.map((node) =>
        node.id === op.id ? { ...node, order: op.order } : node,
      );
    }
  }
}

export function rectOf(node: BoardNode): Rect {
  return { x: node.x, y: node.y, w: node.w, h: node.h };
}
