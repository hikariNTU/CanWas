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

import type { Word } from "@/board/types";
import type { EngineName } from "@/ocr/types";
import type { SyncBoard } from "@/sync/merge";

export type TransportName = "drive" | "fake";

export interface RemoteAsset {
  blob: Blob;
  /** Extension as stored, so a download knows what it is holding. */
  extension: string;
}

/**
 * A recognition, as it travels.
 *
 * Carries the engine that produced it because the words are only meaningful
 * against one: the mock recognizer invents strings, and a board that had been
 * near a `?engine=mock` session would otherwise poison every other device with
 * nonsense that looks exactly like a result.
 */
export interface RemoteText {
  engine: EngineName;
  words: Word[];
}

/**
 * What the remote can say about a board without the board being fetched.
 *
 * `updatedAt` is the whole point: it is what lets a device with fifty boards
 * decide, from one listing it already had to make, that forty-nine of them are
 * untouched and need no request at all. Optional because a board written by an
 * older build carries no such stamp — and an absent stamp must mean "ask",
 * never "skip".
 */
export interface RemoteBoardMeta {
  id: string;
  name?: string;
  updatedAt?: number;
}

export interface SyncTransport {
  readonly name: TransportName;
  /** Boards the remote holds, deleted ones included — a tombstone is data. */
  listBoards(): Promise<RemoteBoardMeta[]>;
  getBoard(id: string): Promise<SyncBoard | null>;
  putBoard(board: SyncBoard): Promise<void>;
  /**
   * Where this asset can be opened in the remote's own interface, if anywhere.
   *
   * `null` from a transport that has no such place, and from one that has the
   * place but not this file — an asset this device has never pushed exists
   * locally and nowhere else, and a link to it would be a 404 wearing a menu
   * item. The caller shows the item only when this answers.
   */
  assetUrl(id: string): Promise<string | null>;
  hasAsset(id: string): Promise<boolean>;
  getAsset(id: string): Promise<RemoteAsset | null>;
  putAsset(id: string, asset: RemoteAsset): Promise<void>;
  /**
   * Recognition, keyed by the same content hash as the image it came from.
   *
   * Its own three methods rather than an asset with a different extension:
   * `hasAsset` answers by filename prefix, so a text file living beside the
   * image would make a picture nobody has look present.
   */
  hasText(id: string): Promise<boolean>;
  getText(id: string): Promise<RemoteText | null>;
  putText(id: string, text: RemoteText): Promise<void>;
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
