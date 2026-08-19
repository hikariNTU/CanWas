/**
 * Paint order as a sortable string per node, rather than a position in an array
 * (D55).
 *
 * The array index was the paint order until sync appeared on the horizon, and
 * an index is the one thing two devices cannot merge: append a node on the
 * laptop and another on the phone, and you have two arrays whose last elements
 * disagree with no operation that recovers either intent. A key is different —
 * both devices keep their own key, both keys sort, and the result is the same
 * board on both.
 *
 * This is the algorithm from David Greenspan's "Implementing Fractional
 * Indexing", the same one Figma and Excalidraw use. A key is an integer part
 * whose first character encodes how many digits follow, then an optional
 * fraction. That structure is what keeps repeated appends at constant length:
 * `a0`, `a1`, ... `az`, `b00` — where a fraction-only scheme would creep a
 * character longer every few appends and never stop.
 */

import type { BoardNode } from "@/board/types";

/**
 * Base 62 in ASCII order, so a plain string comparison *is* the numeric
 * comparison. Any alphabet works as long as it is sorted; this one is the
 * densest that stays URL-safe and free of escaping in JSON.
 */
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const SMALLEST_INTEGER = "A" + DIGITS[0]!.repeat(26);

/** The first key on an empty board. Deliberately mid-range, so both ends stay open. */
export const FIRST_ORDER_KEY = "a" + DIGITS[0]!;

/**
 * How many digits follow the head character.
 *
 * `a`-`z` count upward from 2 and `A`-`Z` downward from 2, which is what lets a
 * key grow in either direction without ever needing a separator: the head is
 * both the magnitude and the sign.
 */
function integerLength(head: string): number {
  if (head >= "a" && head <= "z") {
    return head.charCodeAt(0) - 97 + 2;
  }
  if (head >= "A" && head <= "Z") {
    return 90 - head.charCodeAt(0) + 2;
  }
  throw new Error(`invalid order key head: ${head}`);
}

function integerPartOf(key: string): string {
  const length = integerLength(key[0]!);
  if (length > key.length) {
    throw new Error(`invalid order key: ${key}`);
  }
  return key.slice(0, length);
}

function assertValidInteger(part: string): void {
  if (part.length !== integerLength(part[0]!)) {
    throw new Error(`invalid order key integer: ${part}`);
  }
}

/** Next integer, or null at the top of the representable range. */
function incrementInteger(part: string): string | null {
  assertValidInteger(part);
  const [head, ...digits] = part.split("");
  let carry = true;
  for (let index = digits.length - 1; carry && index >= 0; index--) {
    const next = DIGITS.indexOf(digits[index]!) + 1;
    if (next === DIGITS.length) {
      digits[index] = DIGITS[0]!;
    } else {
      digits[index] = DIGITS[next]!;
      carry = false;
    }
  }
  if (!carry) {
    return head! + digits.join("");
  }
  // Carried out of the top digit: the integer needs one more place, which is
  // spelled by moving the head one letter along.
  if (head === "Z") {
    return "a" + DIGITS[0]!;
  }
  if (head === "z") {
    return null;
  }
  const nextHead = String.fromCharCode(head!.charCodeAt(0) + 1);
  if (nextHead > "a") {
    digits.push(DIGITS[0]!);
  } else {
    digits.pop();
  }
  return nextHead + digits.join("");
}

/** Previous integer, or null at the bottom of the representable range. */
function decrementInteger(part: string): string | null {
  assertValidInteger(part);
  const [head, ...digits] = part.split("");
  let borrow = true;
  for (let index = digits.length - 1; borrow && index >= 0; index--) {
    const next = DIGITS.indexOf(digits[index]!) - 1;
    if (next === -1) {
      digits[index] = DIGITS.at(-1)!;
    } else {
      digits[index] = DIGITS[next]!;
      borrow = false;
    }
  }
  if (!borrow) {
    return head! + digits.join("");
  }
  if (head === "a") {
    return "Z" + DIGITS.at(-1)!;
  }
  if (head === "A") {
    return null;
  }
  const nextHead = String.fromCharCode(head!.charCodeAt(0) - 1);
  if (nextHead < "Z") {
    digits.push(DIGITS.at(-1)!);
  } else {
    digits.pop();
  }
  return nextHead + digits.join("");
}

/**
 * A fraction strictly between two fractions, `b` null meaning "no upper bound".
 *
 * Never ends in the lowest digit: a trailing `0` is a different spelling of a
 * shorter key, and allowing both spellings would mean two equal keys that do
 * not compare equal.
 */
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) {
    throw new Error(`midpoint out of order: ${a} >= ${b}`);
  }
  if (a.slice(-1) === DIGITS[0] || (b != null && b.slice(-1) === DIGITS[0])) {
    throw new Error("order key fraction ends in the lowest digit");
  }
  if (b !== null) {
    // Skip the shared prefix; the gap, if there is one, is after it.
    let shared = 0;
    while ((a[shared] ?? DIGITS[0]) === b[shared]) {
      shared++;
    }
    if (shared > 0) {
      return b.slice(0, shared) + midpoint(a.slice(shared), b.slice(shared));
    }
  }
  const low = a === "" ? 0 : DIGITS.indexOf(a[0]!);
  const high = b === null ? DIGITS.length : DIGITS.indexOf(b[0]!);
  if (high - low > 1) {
    return DIGITS[Math.round(0.5 * (low + high))]!;
  }
  // The two are adjacent digits, so the answer is one place longer.
  if (b !== null && b.length > 1) {
    return b.slice(0, 1);
  }
  return DIGITS[low]! + midpoint(a.slice(1), null);
}

function assertValidKey(key: string): void {
  if (key === SMALLEST_INTEGER) {
    throw new Error(`invalid order key: ${key}`);
  }
  const integer = integerPartOf(key);
  if (key.slice(integer.length).slice(-1) === DIGITS[0]) {
    throw new Error(`invalid order key: ${key}`);
  }
}

/**
 * A key that sorts strictly between `a` and `b`. Either may be null, meaning
 * "nothing on that side" — `(null, null)` is the first key on a board.
 */
export function orderKeyBetween(a: string | null, b: string | null): string {
  if (a !== null) {
    assertValidKey(a);
  }
  if (b !== null) {
    assertValidKey(b);
  }
  if (a !== null && b !== null && a >= b) {
    throw new Error(`order keys out of order: ${a} >= ${b}`);
  }

  if (a === null) {
    if (b === null) {
      return FIRST_ORDER_KEY;
    }
    const integer = integerPartOf(b);
    const fraction = b.slice(integer.length);
    if (integer === SMALLEST_INTEGER) {
      return integer + midpoint("", fraction);
    }
    // `b` has a fraction, so its own integer part is already below it.
    if (integer < b) {
      return integer;
    }
    const decremented = decrementInteger(integer);
    if (decremented === null) {
      throw new Error("order key underflow");
    }
    return decremented;
  }

  if (b === null) {
    const integer = integerPartOf(a);
    const fraction = a.slice(integer.length);
    const incremented = incrementInteger(integer);
    return incremented === null
      ? integer + midpoint(fraction, null)
      : incremented;
  }

  const integerA = integerPartOf(a);
  const fractionA = a.slice(integerA.length);
  const integerB = integerPartOf(b);
  if (integerA === integerB) {
    return integerA + midpoint(fractionA, b.slice(integerB.length));
  }
  const incremented = incrementInteger(integerA);
  if (incremented === null) {
    throw new Error("order key overflow");
  }
  return incremented < b ? incremented : integerA + midpoint(fractionA, null);
}

/** `count` keys in ascending order, all strictly between `a` and `b`. */
export function orderKeysBetween(
  a: string | null,
  b: string | null,
  count: number,
): string[] {
  const keys: string[] = [];
  let low = a;
  for (let index = 0; index < count; index++) {
    // Splitting off the low side each time keeps every key below `b`, which a
    // naive halving from both ends does not guarantee.
    const key = orderKeyBetween(low, b);
    keys.push(key);
    low = key;
  }
  return keys;
}

/**
 * Total order over nodes: by key, then by id.
 *
 * The id tiebreak is not decoration. Two devices that both insert at the same
 * place while offline generate the *same* key, and without a second term the
 * two boards would paint them in whichever order each array happened to hold —
 * the exact disagreement keys exist to remove.
 */
export function compareNodes(a: BoardNode, b: BoardNode): number {
  if (a.order !== b.order) {
    return a.order < b.order ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortNodes(nodes: readonly BoardNode[]): BoardNode[] {
  return [...nodes].sort(compareNodes);
}

/** Key that sorts above everything in `nodes`, which must already be sorted. */
export function keyAbove(nodes: readonly BoardNode[]): string | null {
  return nodes.at(-1)?.order ?? null;
}

/**
 * Fills in what a stored board may predate — order keys (D55) and per-node
 * stamps (D56) — and returns the list sorted.
 *
 * Order keys come from the array order the board was saved in, which *was* the
 * paint order. Stamps fall back to the board's own `updatedAt`: it is the
 * newest thing known to be true about those nodes, and guessing `now` instead
 * would make an untouched old board win every merge against a device that has
 * genuinely edited it.
 *
 * Runs on every hydration rather than as a one-shot migration: a board can
 * arrive from IndexedDB or, later, from Drive, and one written by an older
 * build on another device is not a case that ever stops happening.
 */
export function normalizeNodes(
  nodes: readonly BoardNode[],
  boardUpdatedAt: number,
): BoardNode[] {
  const keys = nodes.every((node) => typeof node.order === "string")
    ? null
    : orderKeysBetween(null, null, nodes.length);
  return sortNodes(
    nodes.map((node, index) => ({
      ...node,
      order: keys === null ? node.order : keys[index]!,
      updatedAt:
        typeof node.updatedAt === "number" ? node.updatedAt : boardUpdatedAt,
    })),
  );
}
