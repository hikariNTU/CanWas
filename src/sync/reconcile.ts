/**
 * One pass over every board on this device, and every board on the remote.
 *
 * `useSync` keeps the *open* board in step, which was the whole of sync until
 * now. That left two holes with the same shape. Connecting Drive for the first
 * time uploaded one board out of however many exist, and the rest waited to be
 * opened one at a time — so "back up my work" quietly meant "back up the thing
 * I happen to be looking at". And a board made on another device never appeared
 * here at all, because the menu is fed from local IndexedDB and nothing ever
 * asked the remote what it had.
 *
 * Both are answered by walking the union of the two sides once.
 *
 * The open board is skipped. Its nodes live in atoms that the UI is writing to,
 * and merging the same board from disk at the same time is a race with two
 * writers and no winner — `useSync` owns it, and this pass does not touch it.
 *
 * Boards that are not open are synced in `"records"` mode: their board record
 * and their images go up, and nothing comes down but the record. Images are
 * the one thing here that cannot be recomputed, so they belong on the remote
 * immediately; pulling *down* the images of a board nobody has opened is
 * speculative traffic, and the placeholder already covers a node whose picture
 * has not arrived.
 */

import { isBoardDeleted, type Asset } from "@/board/types";
import type { EngineName } from "@/ocr/types";
import type { BoardMeta } from "@/storage/boards-atom";
import {
  getAllBoards,
  getAsset,
  getSyncBase,
  putBoard,
  putSyncBase,
  type StoredBoard,
} from "@/storage/db";
import { IDENTITY_VIEWPORT } from "@/canvas/coords";
import { announce } from "@/storage/tab-channel";
import type { SyncBoard } from "@/sync/merge";
import { syncBoard } from "@/sync/sync-board";
import type { SyncTransport } from "@/sync/transport";

export interface ReconcileReport {
  /** Boards the remote had that this device did not. Graves are not arrivals. */
  arrived: string[];
  /** Boards that turned out to be deleted, on either side. */
  buried: string[];
  /** Boards this device pushed, whether new to the remote or merged into it. */
  pushed: string[];
  /** Boards both sides already agreed on, settled without a single request. */
  skipped: number;
  /** Boards that failed, by id. One bad board does not stop the pass. */
  failed: string[];
}

function asSyncBoard(stored: StoredBoard): SyncBoard {
  return {
    id: stored.id,
    name: stored.name,
    nodes: stored.nodes,
    tombstones: stored.tombstones ?? [],
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
    // Spread rather than assigned, so a board that was never deleted does not
    // acquire a `deletedAt` key holding `undefined` on its way to the remote.
    ...(stored.deletedAt === undefined ? {} : { deletedAt: stored.deletedAt }),
  };
}

export async function reconcileBoards(options: {
  transport: SyncTransport;
  /**
   * The open board, whose atoms are authoritative. Never touched here.
   *
   * Asked again for every board rather than captured once, because the pass
   * outlives a navigation. Fifty boards is seconds of requests, and the board
   * that was safe to touch when the pass started may be the one on screen by
   * the time the pass reaches it — two writers on one board, one working from
   * atoms and one from disk.
   */
  skip: () => string | null;
  engine: EngineName;
  /**
   * Called as each board settles, so the menu fills in as the pass runs.
   *
   * Graves are reported too, carrying their `deletedAt`. The caller has to ask
   * `isBoardDeleted` rather than assume a callback means a board — a board
   * deleted on another device arrives through here, and adding it to the menu
   * is precisely the bug this is meant to fix.
   */
  onBoard: (meta: BoardMeta) => void;
}): Promise<ReconcileReport> {
  const { transport } = options;
  const report: ReconcileReport = {
    arrived: [],
    buried: [],
    pushed: [],
    skipped: 0,
    failed: [],
  };

  const [remote, local] = await Promise.all([
    transport.listBoards(),
    getAllBoards(),
  ]);
  const remoteById = new Map(remote.map((meta) => [meta.id, meta]));
  const localById = new Map(local.map((board) => [board.id, board]));

  for (const id of new Set([...localById.keys(), ...remoteById.keys()])) {
    if (id === options.skip()) {
      continue;
    }
    try {
      const stored = localById.get(id);
      if (!stored) {
        const pulled = await transport.getBoard(id);
        if (!pulled) {
          // Listed a moment ago and gone now, or listed by a name that is not
          // a board. Nothing to do and nothing wrong.
          continue;
        }
        // Straight to disk: there is no local copy to merge with, so there is
        // nothing to decide. The base records that the remote and this device
        // now agree, which is what stops the next round reading an empty local
        // board as a deletion.
        await putBoard({
          ...pulled,
          viewport: IDENTITY_VIEWPORT,
          tombstones: pulled.tombstones,
        });
        await putSyncBase({ boardId: id, board: pulled, syncedAt: Date.now() });
        // The record lands either way — a grave has to be written down here or
        // this device forgets the deletion and downloads the board again on
        // every round, forever. Only what it *is* differs.
        if (isBoardDeleted(pulled)) {
          report.buried.push(id);
        } else {
          report.arrived.push(id);
        }
        options.onBoard(metaOf(pulled));
        // A board that did not exist a moment ago: every tab's menu is stale.
        announce({ kind: "boards" });
        continue;
      }

      const base = (await getSyncBase(id))?.board as SyncBoard | undefined;
      const remoteMeta = remoteById.get(id);
      // The cheap answer, and the one that makes this affordable to run on
      // every connect: if both sides are exactly where the last round left
      // them, there is nothing to merge and nothing to send. Costs no requests
      // at all — the stamps came from a folder listing already in hand.
      //
      // Requires all three stamps to agree. An absent one means "ask": a board
      // written by an older build has no stamp, and reading that as agreement
      // would skip it forever.
      if (
        base &&
        remoteMeta?.updatedAt !== undefined &&
        remoteMeta.updatedAt === base.updatedAt &&
        stored.updatedAt === base.updatedAt
      ) {
        report.skipped++;
        continue;
      }

      const result = await syncBoard({
        transport,
        local: {
          board: asSyncBoard(stored),
          // Nothing held in memory for a board that is not open. Blobs are
          // read from disk one at a time, and only for images the remote turns
          // out to be missing.
          assets: {},
          loadAsset: (assetId) =>
            getAsset(assetId) as Promise<Asset | undefined>,
        },
        base: base ?? null,
        mode: "records",
        engine: options.engine,
        // Nothing is downloaded in this mode, so neither of these can fire.
        onAsset: () => Promise.resolve(),
        onText: () => Promise.resolve(),
      });

      await putBoard({
        ...result.merged,
        viewport: stored.viewport,
      });
      await putSyncBase({
        boardId: id,
        board: result.merged,
        syncedAt: Date.now(),
      });
      if (isBoardDeleted(result.merged)) {
        report.buried.push(id);
        // The menu is one row longer than the truth in every open tab: this
        // board was deleted somewhere else and has only now been heard about.
        announce({ kind: "boards" });
      } else {
        report.pushed.push(id);
      }
      options.onBoard(metaOf(result.merged));
      announce({
        kind: "board",
        boardId: id,
        updatedAt: result.merged.updatedAt,
      });
    } catch {
      // One board that cannot be read, or one upload that fails, must not stop
      // the other forty-nine. The board keeps whatever it had; the next pass
      // tries again.
      report.failed.push(id);
    }
  }

  return report;
}

function metaOf(board: SyncBoard): BoardMeta {
  return {
    id: board.id,
    name: board.name,
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
    ...(board.deletedAt === undefined ? {} : { deletedAt: board.deletedAt }),
  };
}
