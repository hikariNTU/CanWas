import { expect, test } from "@playwright/test";

import {
  compareNodes,
  FIRST_ORDER_KEY,
  orderKeyBetween,
  orderKeysBetween,
  sortNodes,
  withOrderKeys,
} from "../src/board/order";
import type { BoardNode } from "../src/board/types";

/**
 * Pure functions, so these run in Node with no page. The algorithm is the one
 * piece of this app where a subtle bug is invisible until two devices disagree
 * about what is on top, which is exactly when it cannot be debugged.
 */

function textNode(id: string, order: string): BoardNode {
  return {
    id,
    kind: "text",
    order,
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    text: id,
    fontSize: 16,
  };
}

test("known keys", () => {
  expect(orderKeyBetween(null, null)).toBe("a0");
  expect(FIRST_ORDER_KEY).toBe("a0");
  expect(orderKeyBetween("a0", null)).toBe("a1");
  expect(orderKeyBetween(null, "a0")).toBe("Zz");
  expect(orderKeyBetween("a0", "a1")).toBe("a0V");
  expect(orderKeyBetween("a0V", "a1")).toBe("a0l");
});

test("a key always fits between two adjacent keys", () => {
  let low = "a0";
  let high = "a1";
  // Repeatedly halving the same gap is the case that breaks a float-based
  // scheme after about 50 rounds. Strings have no such floor.
  for (let round = 0; round < 200; round++) {
    const middle = orderKeyBetween(low, high);
    expect(low < middle).toBe(true);
    expect(middle < high).toBe(true);
    if (round % 2 === 0) {
      low = middle;
    } else {
      high = middle;
    }
  }
});

test("appending stays short", () => {
  let key = orderKeyBetween(null, null);
  let previous = "";
  for (let index = 0; index < 5000; index++) {
    previous = key;
    key = orderKeyBetween(key, null);
    expect(previous < key).toBe(true);
  }
  // The integer part is what buys this. A fraction-only scheme would be
  // hundreds of characters deep by here.
  expect(key.length).toBeLessThanOrEqual(4);
});

test("prepending stays short", () => {
  let key = orderKeyBetween(null, null);
  for (let index = 0; index < 5000; index++) {
    const next = orderKeyBetween(null, key);
    expect(next < key).toBe(true);
    key = next;
  }
  expect(key.length).toBeLessThanOrEqual(4);
});

test("random insertions keep the intended sequence", () => {
  // A deterministic generator, so a failure is reproducible.
  let seed = 12345;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  const keys: string[] = [orderKeyBetween(null, null)];
  for (let step = 0; step < 3000; step++) {
    const at = Math.floor(random() * (keys.length + 1));
    const key = orderKeyBetween(keys[at - 1] ?? null, keys[at] ?? null);
    keys.splice(at, 0, key);
  }

  // The list was built in the order the user intended; sorting the keys must
  // reproduce it exactly.
  expect([...keys].sort()).toEqual(keys);
  expect(new Set(keys).size).toBe(keys.length);
});

test("a batch of keys all land in the gap, in order", () => {
  const keys = orderKeysBetween("a0", "a1", 20);
  expect(keys).toHaveLength(20);
  expect([...keys].sort()).toEqual(keys);
  expect(keys[0]! > "a0").toBe(true);
  expect(keys.at(-1)! < "a1").toBe(true);

  // Unbounded on both sides is what an empty board asks for.
  const open = orderKeysBetween(null, null, 5);
  expect([...open].sort()).toEqual(open);
});

test("equal keys are broken by id, not by array position", () => {
  // Two devices inserting at the same place while offline mint the same key.
  const fromLaptop = textNode("bbb", "a1");
  const fromPhone = textNode("aaa", "a1");
  expect(compareNodes(fromLaptop, fromPhone)).toBeGreaterThan(0);
  expect(sortNodes([fromLaptop, fromPhone]).map((node) => node.id)).toEqual([
    "aaa",
    "bbb",
  ]);
  // And the same board, whichever order the two arrived in.
  expect(sortNodes([fromPhone, fromLaptop]).map((node) => node.id)).toEqual([
    "aaa",
    "bbb",
  ]);
});

test("nodes stored before order keys existed keep their painted order", () => {
  const stored = [
    textNode("back", undefined as unknown as string),
    textNode("middle", undefined as unknown as string),
    textNode("front", undefined as unknown as string),
  ];
  const migrated = withOrderKeys(stored);
  expect(migrated.map((node) => node.id)).toEqual(["back", "middle", "front"]);
  expect([...migrated].sort(compareNodes)).toEqual(migrated);

  // A board that already has keys is left alone apart from being sorted.
  const keyed = [textNode("b", "a2"), textNode("a", "a1")];
  expect(withOrderKeys(keyed).map((node) => node.id)).toEqual(["a", "b"]);
});

test("malformed keys are rejected rather than silently reordered", () => {
  expect(() => orderKeyBetween("a1", "a0")).toThrow();
  expect(() => orderKeyBetween("a1", "a1")).toThrow();
  expect(() => orderKeyBetween("", null)).toThrow();
  expect(() => orderKeyBetween("a0V0", null)).toThrow();
});
