import { sortNodes } from "@/board/order";
import type { BoardNode, NodeId, Tombstone } from "@/board/types";

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
 * Every op restamps the node it touches with the time the patch was applied.
 * An undo restamps too — from the sync layer's side an undo is an edit like any
 * other, and a node that quietly kept an older stamp would lose the next merge
 * against the very change it was undoing.
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
/**
 * `now` stamps every node the patch touches. `"preserve"` leaves the stamps on
 * the nodes alone, which is what applying a merge needs: those stamps came from
 * whichever device made the edit, and overwriting them with this device's clock
 * would make every merge look like a local change and push straight back.
 */
export function applyPatch(
  nodes: readonly BoardNode[],
  patch: Patch,
  now: number | "preserve" = Date.now(),
): BoardNode[] {
  let next = [...nodes];
  for (const op of patch) {
    next = applyOp(next, op, now);
  }
  return sortNodes(next);
}

/**
 * The tombstones a patch leaves behind, folded into the ones already held.
 *
 * Kept beside `applyPatch` rather than inside it because tombstones belong to
 * the board and nodes are just a list — but derived from the same patch, at the
 * same instant, so the two can never disagree about what was deleted.
 *
 * An insert clears any tombstone for that id: undoing a delete has to bring the
 * node back on every device, and a tombstone that outlived its node would have
 * the next sync delete it again.
 */
export function tombstonesAfter(
  existing: readonly Tombstone[],
  patch: Patch,
  now: number = Date.now(),
): Tombstone[] {
  let next: Tombstone[] | null = null;
  for (const op of patch) {
    if (op.kind === "remove") {
      next = [
        ...(next ?? existing).filter((stone) => stone.id !== op.node.id),
        { id: op.node.id, deletedAt: now },
      ];
    } else if (op.kind === "insert") {
      const without: Tombstone[] = (next ?? existing).filter(
        (stone) => stone.id !== op.node.id,
      );
      if (next !== null || without.length !== existing.length) {
        next = without;
      }
    }
  }
  // The identity is the signal: a patch that deleted nothing hands back the
  // array it was given, so the caller can skip a store write and the re-render
  // that comes with it.
  return next ?? (existing as Tombstone[]);
}

function applyOp(
  nodes: BoardNode[],
  op: NodeOp,
  now: number | "preserve",
): BoardNode[] {
  const stamp = (node: BoardNode) =>
    now === "preserve" ? node.updatedAt : now;
  switch (op.kind) {
    case "insert": {
      return [...nodes, { ...op.node, updatedAt: stamp(op.node) }];
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
        node.id === op.id
          ? { ...node, ...op.rect, updatedAt: stamp(node) }
          : node,
      );
    }
    case "text": {
      return nodes.map((node) =>
        node.id === op.id && node.kind === "text"
          ? { ...node, text: op.text, updatedAt: stamp(node) }
          : node,
      );
    }
    case "fontSize": {
      return nodes.map((node) =>
        node.id === op.id && node.kind === "text"
          ? { ...node, fontSize: op.fontSize, updatedAt: stamp(node) }
          : node,
      );
    }
    case "order": {
      return nodes.map((node) =>
        node.id === op.id
          ? { ...node, order: op.order, updatedAt: stamp(node) }
          : node,
      );
    }
  }
}

export function rectOf(node: BoardNode): Rect {
  return { x: node.x, y: node.y, w: node.w, h: node.h };
}
