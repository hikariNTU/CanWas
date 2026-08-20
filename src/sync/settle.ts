/**
 * Landing a finished sync round on a board that did not stand still for it.
 *
 * A round reads the board, talks to Drive for a second or several — longer
 * when it is uploading a screenshot — and comes back with a merged result. By
 * then the board may have moved: a node pasted, a node dragged, a node
 * deleted. Applying the result as-is would undo every one of those, because
 * the round never saw them and its result therefore says they do not exist.
 *
 * The rule is that the round only has authority over what it saw. Anything
 * that happened since is newer than the round by definition, and survives to
 * be pushed by the next one.
 *
 * This is the same problem the merge already solves, so it is the same merge
 * that solves it: the board as it is now against the round's result, over the
 * board as the round found it. `started` being the base is what distinguishes
 * "the remote deleted this" from "this arrived while we were busy" — the first
 * is in the base and the second is not.
 */

import { mergeBoards, type SyncBoard } from "@/sync/merge";

export function settleRound(options: {
  /** The board as the round found it. */
  started: SyncBoard;
  /** What the round produced, and what the remote now holds. */
  merged: SyncBoard;
  /** The board as it is at this instant, which may have moved on. */
  current: SyncBoard;
}): SyncBoard {
  const { started, merged, current } = options;
  return mergeBoards(current, merged, started).board;
}
