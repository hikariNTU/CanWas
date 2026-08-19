/**
 * The seam between the sync loop and wherever the boards actually live.
 *
 * Two implementations: Drive, and a fake remote in a second IndexedDB database
 * on this machine. The fake is not only for tests — a Google OAuth client
 * cannot always be created on demand, and the merge is the part worth building
 * carefully. Keeping the transport behind an interface means the hard half can
 * be written, run and watched today, against the same code path Drive will use.
 *
 * The same reasoning gave OCR its mock recognizer, and the same rule applies:
 * one module names a concrete implementation, and it is this one.
 */

import type { SyncBoard } from "@/sync/merge";

export type TransportName = "drive" | "fake";

export interface RemoteAsset {
  blob: Blob;
  /** Extension as stored, so a download knows what it is holding. */
  extension: string;
}

export interface SyncTransport {
  readonly name: TransportName;
  /** Board ids the remote holds, deleted ones included — a tombstone is data. */
  listBoardIds(): Promise<string[]>;
  getBoard(id: string): Promise<SyncBoard | null>;
  putBoard(board: SyncBoard): Promise<void>;
  hasAsset(id: string): Promise<boolean>;
  getAsset(id: string): Promise<RemoteAsset | null>;
  putAsset(id: string, asset: RemoteAsset): Promise<void>;
}

/**
 * `?sync=fake` swaps Drive for the local fake. Read from the URL rather than
 * from a build flag so a real build can be pointed at it without rebuilding —
 * which is also what lets two browser tabs act as two devices.
 */
export function selectedTransport(): TransportName {
  if (typeof window === "undefined") {
    return "drive";
  }
  return new URLSearchParams(window.location.search).get("sync") === "fake"
    ? "fake"
    : "drive";
}
