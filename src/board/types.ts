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

export type OcrState =
  | { status: "idle" }
  | { status: "queued" }
  | { status: "running"; progress?: number }
  | { status: "done"; words: Word[] }
  | { status: "failed"; error: string };

export interface Asset {
  id: AssetId;
  blob: Blob;
  /** Intrinsic pixels. */
  width: number;
  height: number;
  /** Content hash — the same image pasted twice reuses one Asset. */
  hash: string;
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
  /** World coordinates of the top-left corner. */
  x: number;
  y: number;
  /** World size. */
  w: number;
  h: number;
  assetId: AssetId;
}

export type BoardNode = ImageNode;

/**
 * Paint order is the array order and nothing else — there is no `z` field
 * (D18). Index 0 is backmost.
 */
export interface Board {
  id: string;
  name: string;
  nodes: BoardNode[];
  createdAt: number;
  updatedAt: number;
}
