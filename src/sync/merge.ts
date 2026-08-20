/**
 * Merging two versions of the same board (D56).
 *
 * Pure, and deliberately so: this is the part of sync that cannot be debugged
 * from a bug report. By the time a user notices, the evidence is a board on two
 * devices that disagree, and neither device knows what it used to look like.
 *
 * The one property everything rests on is **symmetry**. The laptop merges
 * (local, remote) and the phone merges (remote, local), and both must land on
 * the same board — otherwise each push convinces the other device it is out of
 * date and the two ping-pong forever. So no rule here may break a tie by
 * looking at which argument it was handed. Ties break on content and on ids,
 * which both devices see the same way.
 */

import { sortNodes } from "@/board/order";
import {
  isBoardDeleted,
  type BoardNode,
  type NodeId,
  type TextNode,
  type Tombstone,
} from "@/board/types";

/** World units. Enough that a rescued copy is visibly beside its winner. */
const CONFLICT_OFFSET = 24;

export interface SyncBoard {
  id: string;
  name: string;
  nodes: BoardNode[];
  tombstones: Tombstone[];
  createdAt: number;
  updatedAt: number;
  /** Set instead of dropping the record, so the deletion itself can sync. */
  deletedAt?: number;
}

export interface MergeReport {
  /** Counted against the first argument, which is normally the local copy. */
  added: number;
  updated: number;
  removed: number;
  /** Text nodes edited on both sides, each kept as a second node. */
  conflicts: number;
}

/**
 * Every field that describes a node, in a fixed order, excluding `updatedAt`.
 *
 * Two jobs, and they have to agree with each other: deciding whether two nodes
 * are the same, and breaking a tie between two that are not. The stamp is left
 * out because a node restamped without being changed — an undo and a redo, say
 * — has not changed.
 */
function contentOf(node: BoardNode): string {
  const shared = [
    node.id,
    node.kind,
    node.order,
    node.x,
    node.y,
    node.w,
    node.h,
  ];
  return JSON.stringify(
    node.kind === "image"
      ? [...shared, node.assetId]
      : [...shared, node.text, node.fontSize],
  );
}

function sameContent(a: BoardNode, b: BoardNode): boolean {
  return contentOf(a) === contentOf(b);
}

/**
 * The winner of a straight conflict: newer wins, and if the stamps are equal
 * the greater content string does.
 *
 * Two devices can genuinely produce the same millisecond, and "whichever we
 * called local" is not an answer both of them can reach.
 */
function newer(a: BoardNode, b: BoardNode): BoardNode {
  if (a.updatedAt !== b.updatedAt) {
    return a.updatedAt > b.updatedAt ? a : b;
  }
  return contentOf(a) > contentOf(b) ? a : b;
}

function byId(nodes: readonly BoardNode[]): Map<NodeId, BoardNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

/**
 * The copy that lost a text conflict, kept beside the winner.
 *
 * Its id is derived from the loser rather than generated, because a random id
 * would differ on the two devices and the next sync would treat each device's
 * rescue as a new node the other had never seen — one conflict becoming two
 * nodes, then four. `~` cannot occur in a generated id, so a derived one can
 * never collide with a real one.
 *
 * It keeps the winner's order key and is separated by position instead. Ties in
 * the key are broken by id, so the pair stays adjacent in the paint order on
 * every device.
 */
function rescue(loser: TextNode, winner: BoardNode): TextNode {
  return {
    ...loser,
    id: `${loser.id}~${loser.updatedAt.toString(36)}`,
    order: winner.order,
    x: loser.x + CONFLICT_OFFSET,
    y: loser.y + CONFLICT_OFFSET,
  };
}

/**
 * Merges two versions of one board, optionally against the last version both
 * devices agreed on.
 *
 * Without a base this is a union with last-writer-wins, which is the best that
 * can be done on a first sync — it can tell that two nodes differ, but not
 * which side did the differing. With a base it can, and that is what makes a
 * deletion on one device survive an edit on the other instead of losing to it.
 */
export function mergeBoards(
  a: SyncBoard,
  b: SyncBoard,
  base: SyncBoard | null = null,
): { board: SyncBoard; report: MergeReport } {
  const nodesA = byId(a.nodes);
  const nodesB = byId(b.nodes);
  const nodesBase = base ? byId(base.nodes) : null;

  const report: MergeReport = {
    added: 0,
    updated: 0,
    removed: 0,
    conflicts: 0,
  };
  const merged: BoardNode[] = [];
  const rescued: BoardNode[] = [];

  for (const id of new Set([...nodesA.keys(), ...nodesB.keys()])) {
    const fromA = nodesA.get(id);
    const fromB = nodesB.get(id);

    if (fromA && fromB) {
      if (sameContent(fromA, fromB)) {
        merged.push(newer(fromA, fromB));
        continue;
      }
      const original = nodesBase?.get(id);
      if (original && sameContent(original, fromA)) {
        merged.push(fromB);
        continue;
      }
      if (original && sameContent(original, fromB)) {
        merged.push(fromA);
        continue;
      }
      // Both sides changed it, so something is going to be lost.
      const winner = newer(fromA, fromB);
      const loser = winner === fromA ? fromB : fromA;
      merged.push(winner);
      // Only text is rescued. A picture that moved on both devices has one
      // rectangle or the other, and a duplicate image would be litter; a
      // paragraph typed on both devices is work nobody can retype.
      if (
        loser.kind === "text" &&
        winner.kind === "text" &&
        loser.text !== winner.text
      ) {
        rescued.push(rescue(loser, winner));
        report.conflicts++;
      }
      continue;
    }

    const only = (fromA ?? fromB)!;
    // Present on one side only. With a base, its absence on the other side is
    // a deletion; without one, it can only be read as an addition.
    if (nodesBase?.has(id)) {
      continue;
    }
    merged.push(only);
  }

  // A rescue whose id is already on the board is the *same* rescue, arriving a
  // second time: the conflict is still there on the next sync, and the id is
  // derived rather than generated precisely so it can be recognised. Adding it
  // again is how one lost paragraph becomes two, then four.
  const present = new Set(merged.map((node) => node.id));
  for (const copy of rescued) {
    if (!present.has(copy.id)) {
      merged.push(copy);
      present.add(copy.id);
    } else {
      report.conflicts--;
    }
  }

  const tombstones = mergeTombstones(a.tombstones, b.tombstones);
  const buried = new Map(
    tombstones.map((stone) => [stone.id, stone.deletedAt]),
  );
  const survivors = merged.filter((node) => {
    const deletedAt = buried.get(node.id);
    // A node edited *after* it was deleted was deliberately brought back — undo
    // does that — and the tombstone is the stale record, not the node.
    return deletedAt === undefined || node.updatedAt > deletedAt;
  });

  for (const node of survivors) {
    const before = nodesA.get(node.id);
    if (!before) {
      report.added++;
    } else if (!sameContent(before, node)) {
      report.updated++;
    }
  }
  const kept = new Set(survivors.map((node) => node.id));
  report.removed = a.nodes.filter((node) => !kept.has(node.id)).length;

  return {
    board: {
      id: a.id,
      name: pickName(a, b),
      nodes: sortNodes(survivors),
      tombstones: tombstones.filter((stone) => !kept.has(stone.id)),
      createdAt: Math.min(a.createdAt, b.createdAt),
      updatedAt: Math.max(a.updatedAt, b.updatedAt),
      ...(isDeleted(a, b)
        ? { deletedAt: Math.max(a.deletedAt ?? 0, b.deletedAt ?? 0) }
        : {}),
    },
    report,
  };
}

function mergeTombstones(
  a: readonly Tombstone[],
  b: readonly Tombstone[],
): Tombstone[] {
  const latest = new Map<NodeId, number>();
  for (const stone of [...a, ...b]) {
    latest.set(stone.id, Math.max(latest.get(stone.id) ?? 0, stone.deletedAt));
  }
  return [...latest]
    .map(([id, deletedAt]) => ({ id, deletedAt }))
    .sort((first, second) => (first.id < second.id ? -1 : 1));
}

/** Renames are whole-board, so this is the one thing that is genuinely LWW. */
function pickName(a: SyncBoard, b: SyncBoard): string {
  if (a.name === b.name) {
    return a.name;
  }
  if (a.updatedAt !== b.updatedAt) {
    return a.updatedAt > b.updatedAt ? a.name : b.name;
  }
  return a.name > b.name ? a.name : b.name;
}

/**
 * A board stays deleted unless the other device has done something to it since.
 *
 * Deleting on the laptop and pasting on the phone is a real disagreement, and
 * of the two answers, keeping the board is the one that can still be undone by
 * hand.
 *
 * The same rule as `isBoardDeleted`, across two copies: a side that is itself
 * deleted offers no live edit, so its stamp does not count against the other
 * side's deletion.
 */
function isDeleted(a: SyncBoard, b: SyncBoard): boolean {
  const deletion = Math.max(a.deletedAt ?? 0, b.deletedAt ?? 0);
  const liveEdit = Math.max(
    isBoardDeleted(a) ? 0 : a.updatedAt,
    isBoardDeleted(b) ? 0 : b.updatedAt,
  );
  return deletion > 0 && deletion >= liveEdit;
}
