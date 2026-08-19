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
} from "@/board/types";
import { mergeBoards, type MergeReport, type SyncBoard } from "@/sync/merge";
import type { SyncTransport } from "@/sync/transport";

export interface BoardSnapshot {
  board: SyncBoard;
  /** Assets this device holds, by id. Only their bytes are wanted here. */
  assets: Record<string, Asset>;
}

export interface SyncResult {
  merged: SyncBoard;
  report: MergeReport;
  uploaded: number;
  downloaded: string[];
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
  /** Called with any asset the remote had that this device did not. */
  onAsset: (id: string, blob: Blob) => Promise<void>;
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
  const uploaded = await pushAssets(transport, merged.nodes, local.assets);

  const unchanged =
    remote !== null &&
    sameBoard(merged, remote) &&
    sameBoard(merged, local.board);
  if (!unchanged) {
    await transport.putBoard(merged);
  }

  const downloaded = await pullAssets(
    transport,
    merged.nodes,
    local.assets,
    options.onAsset,
  );

  return { merged, report, uploaded, downloaded, unchanged };
}

async function pushAssets(
  transport: SyncTransport,
  nodes: readonly BoardNode[],
  held: Record<string, Asset>,
): Promise<number> {
  let uploaded = 0;
  for (const id of new Set(assetIdsOf(nodes))) {
    const asset = held[id];
    if (!asset || (await transport.hasAsset(id))) {
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
