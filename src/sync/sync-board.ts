/**
 * One round of sync for one board: pull, merge, push, and move the images.
 *
 * Split out of the React hook because none of it is React. It reads and writes
 * through callbacks so the same function can be run from a test with no store
 * and no timers.
 */

import {
  assetIdsOf,
  type Asset,
  type BoardNode,
  type Tombstone,
  type Word,
} from "@/board/types";
import type { EngineName } from "@/ocr/types";
import { mergeBoards, type MergeReport, type SyncBoard } from "@/sync/merge";
import type { SyncTransport } from "@/sync/transport";

export interface BoardSnapshot {
  board: SyncBoard;
  /** Assets this device holds, by id. Only their bytes are wanted here. */
  assets: Record<string, Asset>;
  /**
   * Fetches an asset this device holds on disk but not in memory.
   *
   * The open board keeps its assets in the store, so `assets` answers for it.
   * A pass over every board cannot: fifty boards of image blobs held at once
   * to upload the few that are missing is a way to run a phone out of memory
   * doing housekeeping. This is consulted only after the remote has said it
   * does not have the asset, so nothing is read off disk to be thrown away.
   */
  loadAsset?: (id: string) => Promise<Asset | undefined>;
}

export interface SyncResult {
  merged: SyncBoard;
  report: MergeReport;
  uploaded: number;
  downloaded: string[];
  /** Asset ids whose recognition came down from the remote. */
  read: string[];
  /** True when the local board is already what the remote holds. */
  unchanged: boolean;
}

/**
 * The bytes that travel: the WebP if there is one, the original if not (D52).
 *
 * A device that receives a board therefore gets the WebP and nothing else,
 * which is fine — the asset id is the hash of the *original*, and it travels as
 * the filename rather than being recomputed. Two devices holding different
 * bytes under one id is the design, not a conflict.
 */
export function uploadableBytes(asset: Asset): {
  blob: Blob;
  extension: string;
} {
  const blob = asset.webp ?? asset.blob;
  const extension =
    blob.type === "image/webp" ? "webp" : (blob.type.split("/")[1] ?? "bin");
  return { blob, extension };
}

export async function syncBoard(options: {
  transport: SyncTransport;
  local: BoardSnapshot;
  base: SyncBoard | null;
  /**
   * Called with any asset the remote had that this device did not, together
   * with its reading if the remote had one — so the asset can be stored
   * already read and never enter the recognition queue at all.
   */
  onAsset: (id: string, blob: Blob, words?: readonly Word[]) => Promise<void>;
  /** Called with any recognition the remote had that this device did not. */
  onText: (id: string, words: readonly Word[]) => Promise<void>;
  /** This build's recognizer. Results from another one are not interchangeable. */
  engine: EngineName;
  /**
   * `"records"` pushes but never downloads.
   *
   * For boards the user is not looking at. Their board record and their images
   * belong on the remote — that is what connecting was for, and an image is
   * the one thing here that cannot be recomputed. Pulling *down* the images of
   * a board nobody has opened is speculative traffic, and the board renders
   * with placeholders until it is opened, which is machinery that already
   * exists.
   */
  mode?: "full" | "records";
}): Promise<SyncResult> {
  const { transport, local, base } = options;

  const remote = await transport.getBoard(local.board.id);
  const { board: merged, report } = remote
    ? mergeBoards(local.board, remote, base)
    : { board: local.board, report: emptyReport() };

  // Assets go up before the board does. A board that references an image the
  // remote does not have yet is a board another device renders with a hole in
  // it, and the window between the two writes is exactly when a phone is most
  // likely to be closed.
  const uploaded = await pushAssets(transport, merged.nodes, local);

  const unchanged =
    remote !== null &&
    sameBoard(merged, remote) &&
    sameBoard(merged, local.board);
  if (!unchanged) {
    await transport.putBoard(merged);
  }

  // Recognition moves *before* the images it belongs to, so a downloaded asset
  // can arrive already read. Landing the pixels first would put an unread asset
  // in the store and the local pipeline would start on it the moment React saw
  // it — spending the 21 MB and the seconds this exchange exists to save, and
  // then overwriting the arriving reading with its own.
  const records = options.mode === "records";
  const readings = records
    ? new Map<string, readonly Word[]>()
    : await pullText(transport, merged.nodes, local.assets, options);

  const downloaded = records
    ? []
    : await pullAssets(transport, merged.nodes, local.assets, (id, blob) =>
        options.onAsset(id, blob, readings.get(id)),
      );

  // An asset this device already held takes its reading on its own: no
  // download is coming to carry it.
  for (const [id, words] of readings) {
    if (local.assets[id]) {
      await options.onText(id, words);
    }
  }

  return {
    merged,
    report,
    uploaded,
    downloaded,
    read: [...readings.keys()],
    unchanged,
  };
}

/**
 * Moves recognition results in whichever direction is missing one.
 *
 * Reading an image costs 21 MB of weights and real seconds of a real CPU, and
 * the answer depends on nothing but the bytes — which are content-addressed, so
 * the same id is the same pixels on every device, forever. That makes this the
 * cheapest thing in the whole sync to share and the most expensive to not
 * share.
 *
 * It also cannot conflict. Two devices that both read the same image did not
 * disagree about anything, so whoever wrote first wins and nobody loses.
 */
async function pullText(
  transport: SyncTransport,
  nodes: readonly BoardNode[],
  held: Record<string, Asset>,
  options: { engine: EngineName },
): Promise<Map<string, readonly Word[]>> {
  const readings = new Map<string, readonly Word[]>();
  for (const id of new Set(assetIdsOf(nodes))) {
    const ocr = held[id]?.ocr;
    if (ocr?.status === "done") {
      // Only a finished reading goes up. A failure is this device's problem —
      // it ran out of memory, or the tab was closed — and publishing it would
      // stop every other device from trying.
      if (!(await transport.hasText(id))) {
        await transport.putText(id, {
          engine: options.engine,
          words: ocr.words,
        });
      }
      continue;
    }
    const remote = await transport.getText(id);
    // A mock reading is invented text, and the two engines are not
    // interchangeable in either direction. This is the one way this feature
    // could quietly ruin a board, so it is checked rather than assumed.
    if (!remote || remote.engine !== options.engine) {
      continue;
    }
    readings.set(id, remote.words);
  }
  return readings;
}

async function pushAssets(
  transport: SyncTransport,
  nodes: readonly BoardNode[],
  local: BoardSnapshot,
): Promise<number> {
  let uploaded = 0;
  for (const id of new Set(assetIdsOf(nodes))) {
    // Asked before the bytes are looked for, rather than after. On Drive this
    // costs nothing — the folder listing is already in hand — and it means a
    // board whose images are all uploaded reads no blobs at all.
    if (await transport.hasAsset(id)) {
      continue;
    }
    const asset = local.assets[id] ?? (await local.loadAsset?.(id));
    if (!asset) {
      continue;
    }
    await transport.putAsset(id, uploadableBytes(asset));
    uploaded++;
  }
  return uploaded;
}

async function pullAssets(
  transport: SyncTransport,
  nodes: readonly BoardNode[],
  held: Record<string, Asset>,
  onAsset: (id: string, blob: Blob) => Promise<void>,
): Promise<string[]> {
  const fetched: string[] = [];
  for (const id of new Set(assetIdsOf(nodes))) {
    if (held[id]) {
      continue;
    }
    const remote = await transport.getAsset(id);
    if (!remote) {
      // A board that names an image nobody has is not an error worth stopping
      // for: the node renders as nothing until some device that has the bytes
      // syncs them up.
      continue;
    }
    await onAsset(id, remote.blob);
    fetched.push(id);
  }
  return fetched;
}

function sameBoard(a: SyncBoard, b: SyncBoard): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

/** Field order is not content, and two JSON encoders need not agree on it. */
function normalize(board: SyncBoard): unknown {
  return [
    board.id,
    board.name,
    board.createdAt,
    board.deletedAt ?? null,
    board.nodes.map((node) => JSON.stringify(node, Object.keys(node).sort())),
    board.tombstones.map((stone: Tombstone) => [stone.id, stone.deletedAt]),
  ];
}

function emptyReport(): MergeReport {
  return { added: 0, updated: 0, removed: 0, conflicts: 0 };
}
