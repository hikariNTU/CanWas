import type { BoardNode, NewNode } from "@/board/types";

/**
 * Copy and paste of nodes, carried as HTML on the system clipboard.
 *
 * The payload rides in a `data-canwas` attribute on an empty `<div>` in the
 * clipboard's `text/html` flavour, with the readable text alongside it as
 * `text/plain`. Three properties come out of that, and no other transport has
 * all three:
 *
 * - It survives the OS clipboard, so a copy in one tab pastes into another,
 *   and pasting into a text editor yields the text rather than a blob of JSON.
 * - It is written and read synchronously through the copy and paste events,
 *   which is what D21 requires: `navigator.clipboard` cannot be driven by a
 *   synthetic event, and every clipboard path here has to be testable.
 * - A custom MIME type would do the first two, but Safari drops unknown
 *   flavours on the way through the OS clipboard. `text/html` is one every
 *   platform already carries.
 *
 * Assets are not copied — only the id that names them. Pasting into another
 * board on the same device therefore shares the pixels rather than duplicating
 * them (D13), and pasting into a browser that has never seen the asset renders
 * the node as missing, exactly as an unsynced image does.
 */

const ATTRIBUTE = "data-canwas";

/** Bumped if the payload shape changes. An older tab ignores what it cannot read. */
const FORMAT = 1;

/**
 * A node on its way through the clipboard: no id, no order, no stamp.
 *
 * Distributed over the union rather than written as `Omit<NewNode, "id">`,
 * which is not distributive — it would collapse an image and a text node into
 * the fields they happen to share and drop `assetId` and `text` on the floor.
 */
export type CopiedNode = NewNode extends infer T
  ? T extends NewNode
    ? Omit<T, "id">
    : never
  : never;

export interface CopiedBoard {
  /** Size of the copied group in world units, so a paste can be centred. */
  w: number;
  h: number;
  /** Coordinates are relative to the group's top-left corner. */
  nodes: CopiedNode[];
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** The clipboard flavours for `nodes`, or null when there is nothing to copy. */
export function encodeNodes(
  nodes: readonly BoardNode[],
): { html: string; text: string } | null {
  if (nodes.length === 0) {
    return null;
  }
  const x = Math.min(...nodes.map((node) => node.x));
  const y = Math.min(...nodes.map((node) => node.y));
  const w = Math.max(...nodes.map((node) => node.x + node.w)) - x;
  const h = Math.max(...nodes.map((node) => node.y + node.h)) - y;

  const copied: CopiedNode[] = nodes.map((node) => {
    // Placement, order and stamp all belong to wherever this lands, and are
    // minted there by `insertNodes` and `applyPatch`.
    const { id: _id, order: _order, updatedAt: _updatedAt, ...rest } = node;
    return { ...rest, x: node.x - x, y: node.y - y };
  });

  const payload = JSON.stringify({ format: FORMAT, w, h, nodes: copied });
  return {
    html: `<div ${ATTRIBUTE}="${escapeAttribute(payload)}"></div>`,
    // What a paste into any other app gets. Images have no text of their own
    // here — their recognition lives on the Asset, not on the Node.
    text: nodes
      .filter((node) => node.kind === "text")
      .map((node) => node.text)
      .join("\n\n"),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * One node, validated field by field.
 *
 * Clipboard content is untrusted input — it can come from any page that chose
 * to write this attribute — so nothing is taken on trust and a single bad node
 * discards the whole paste.
 */
function readNode(value: unknown): CopiedNode | null {
  if (!isRecord(value)) {
    return null;
  }
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  const w = finiteNumber(value.w);
  const h = finiteNumber(value.h);
  if (x === null || y === null || w === null || h === null || w <= 0) {
    return null;
  }
  if (value.kind === "image" && typeof value.assetId === "string") {
    return { kind: "image", x, y, w, h, assetId: value.assetId };
  }
  if (value.kind === "text" && typeof value.text === "string") {
    const fontSize = finiteNumber(value.fontSize);
    if (fontSize === null || fontSize <= 0) {
      return null;
    }
    return { kind: "text", x, y, w, h, text: value.text, fontSize };
  }
  return null;
}

/** Reads back what `encodeNodes` wrote, or null for any other clipboard. */
export function decodeNodes(html: string): CopiedBoard | null {
  // Cheap reject first: every paste of ordinary rich text reaches this.
  if (!html.includes(ATTRIBUTE)) {
    return null;
  }
  // Parsed rather than pattern-matched. `DOMParser` runs no scripts and loads
  // no subresources, and the clipboard's HTML arrives wrapped in whatever
  // fragment markers the platform added.
  const raw = new DOMParser()
    .parseFromString(html, "text/html")
    .querySelector(`[${ATTRIBUTE}]`)
    ?.getAttribute(ATTRIBUTE);
  if (!raw) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.format !== FORMAT) {
    return null;
  }
  const w = finiteNumber(parsed.w);
  const h = finiteNumber(parsed.h);
  if (w === null || h === null || !Array.isArray(parsed.nodes)) {
    return null;
  }
  const nodes: CopiedNode[] = [];
  for (const candidate of parsed.nodes) {
    const node = readNode(candidate);
    if (!node) {
      return null;
    }
    nodes.push(node);
  }
  return nodes.length === 0 ? null : { w, h, nodes };
}
