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
 * most of its wait fetching 21 MB of weights, and a bar labelled "reading"
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
 * A node that does not have its place yet.
 *
 * Order keys are handed out by `insertNodes`, which is the only code that can
 * see where the new node is going relative to everything already there.
 */
export type NewNode<T extends BoardNode = BoardNode> = T extends unknown
  ? Omit<T, "order">
  : never;
