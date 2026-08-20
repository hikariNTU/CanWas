/** See docs/domain-model.md — this file is that document in TypeScript. */

export type AssetId = string;
export type NodeId = string;

export interface Word {
  text: string;
  /** Asset pixel coordinates, never world or screen. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  confidence: number;
}

/**
 * What a running job is busy with. The first image on a fresh browser spends
 * most of its wait fetching 31 MB of weights, and a bar labelled "reading"
 * through that is a bar that looks stuck.
 */
export type OcrPhase = "download" | "read";

export type OcrState =
  | { status: "idle" }
  | { status: "queued" }
  | { status: "running"; progress?: number; phase?: OcrPhase }
  | { status: "done"; words: Word[] }
  | { status: "failed"; error: string };

export interface Asset {
  id: AssetId;
  blob: Blob;
  /** Intrinsic pixels. */
  width: number;
  height: number;
  /**
   * Content hash of the *original* bytes, always, even on a device that only
   * ever received the WebP. The id is the hash, so hashing anything else would
   * make the same picture two different assets depending on which device saw
   * it first.
   */
  hash: string;
  /**
   * A WebP re-encode of `blob`, at the same dimensions.
   *
   * Absent until the background conversion finishes, and absent forever if the
   * browser cannot encode WebP. This is the copy that syncs: a clipboard
   * screenshot is a lossless PNG, which is free to keep locally and is not free
   * against someone's Drive quota or a phone connection.
   */
  webp?: Blob;
  /** Recognition belongs to the pixels, not to placement (D13). */
  ocr: OcrState;
  /**
   * Object URL for rendering. Recreated on load and revoked when the asset is
   * dropped from memory, since `blob:` URLs do not survive a reload.
   */
  url: string;
}

export interface ImageNode {
  id: NodeId;
  kind: "image";
  /**
   * When this node last changed, as an epoch millisecond stamp (D56).
   *
   * Per node rather than per board, because a merge is per node: two devices
   * that each edit a different node have not conflicted, and a board-level
   * stamp cannot tell you that.
   */
  updatedAt: number;
  /**
   * Paint order, as a fractional index (D55). Lowest sorts to the back.
   *
   * A string rather than a number because there is always room for another key
   * between any two, which is what lets a node be restacked — or arrive from
   * another device — without renumbering anything around it. `src/board/order.ts`
   * owns every key that gets made.
   */
  order: string;
  /** World coordinates of the top-left corner. */
  x: number;
  y: number;
  /** World size. */
  w: number;
  h: number;
  assetId: AssetId;
}

export interface TextNode {
  id: NodeId;
  kind: "text";
  /** See `ImageNode.updatedAt`. */
  updatedAt: number;
  /** See `ImageNode.order`. */
  order: string;
  /** World coordinates of the top-left corner. */
  x: number;
  y: number;
  /**
   * `w` is the wrap width and is authoritative. `h` is a cached measurement of
   * the laid-out text, refreshed whenever the content changes — text nodes
   * render at automatic height, so nothing depends on `h` being exact.
   */
  w: number;
  h: number;
  text: string;
  /** World units, so text scales with the canvas like everything else. */
  fontSize: number;
}

export type BoardNode = ImageNode | TextNode;

/**
 * Paint order is each node's `order` key (D55). The array is kept sorted by it
 * so that index order and paint order still agree, but the key is what is
 * authoritative and what survives a merge — an array position does not.
 */
export interface Board {
  id: string;
  name: string;
  nodes: BoardNode[];
  createdAt: number;
  updatedAt: number;
}

/** Asset ids referenced by a node list. Text nodes reference none. */
export function assetIdsOf(nodes: readonly BoardNode[]): AssetId[] {
  return nodes
    .filter((node): node is ImageNode => node.kind === "image")
    .map((node) => node.assetId);
}

/**
 * A node that does not have its place or its stamp yet.
 *
 * Both are handed out by `insertNodes` and `applyPatch` — the code that can see
 * where the node is going, and the moment it got there.
 */
export type NewNode<T extends BoardNode = BoardNode> = T extends unknown
  ? Omit<T, "order" | "updatedAt">
  : never;

/**
 * A record that a node was deleted, kept in place of the node.
 *
 * Without one, a device still holding the node pushes it back at the next sync
 * and the deletion undoes itself — from the user's side, an image they threw
 * away reappears (D56).
 */
export interface Tombstone {
  id: NodeId;
  deletedAt: number;
}

/**
 * Whether one copy of a board counts as deleted.
 *
 * The record is kept rather than dropped, so that the deletion itself can
 * travel — a board simply removed from disk is indistinguishable from a board
 * this device has not heard of yet, and the next round would fetch it back.
 * This is the predicate that decides whether such a record is a grave or a
 * board, and *everything* must ask it: the menu, the merge, the reconcile
 * pass. A menu filtering on `deletedAt !== undefined` while the merge compares
 * stamps would hide a board here that is alive everywhere else.
 *
 * An edit *after* the deletion revives it. That is the only way back, and it
 * is deliberate: editing a grave is a thing you can only do on purpose.
 */
export function isBoardDeleted(board: {
  deletedAt?: number;
  updatedAt: number;
}): boolean {
  return board.deletedAt !== undefined && board.deletedAt >= board.updatedAt;
}

/**
 * A board nothing has ever been done to.
 *
 * Landing on the app with no boards makes one, so the very first thing a new
 * device does is create an empty "Untitled" — and the first thing it did after
 * signing in was upload it. Sign in on three machines and the account collects
 * three empty boards nobody asked for (D79). This is the predicate that keeps
 * them home.
 *
 * All four clauses are load-bearing:
 *
 * - **No nodes** is the obvious half, and on its own it is wrong: a board whose
 *   last image was deleted is empty too, and that emptiness is an edit that
 *   has to travel or the deletion never reaches the other devices.
 * - **No tombstones** is what separates those two. Something was deleted here.
 * - **`updatedAt === createdAt`** catches every edit that leaves no node
 *   behind — a rename, most of all. `createBoard` sets the two equal and every
 *   edit moves one of them.
 * - **Not deleted**, because a grave is the one empty board that most needs to
 *   be uploaded.
 *
 * A board materialised from a deep link is *not* untouched by this test, which
 * is the point: it is stamped `updatedAt: 0` precisely because this device has
 * no edit to offer, and it must still sync in order to be filled in.
 *
 * Caller-side, being untouched is not enough — a board the remote has already
 * seen must keep syncing however empty it is, or this device stops answering
 * for it. The sync base is what says so, and both callers check it.
 */
export function isUntouchedBoard(board: {
  nodes: readonly BoardNode[];
  tombstones?: readonly Tombstone[];
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}): boolean {
  return (
    board.deletedAt === undefined &&
    board.nodes.length === 0 &&
    (board.tombstones?.length ?? 0) === 0 &&
    board.updatedAt === board.createdAt
  );
}
