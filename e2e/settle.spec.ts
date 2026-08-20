import { expect, test } from "@playwright/test";

import { settleRound } from "../src/sync/settle";
import type { SyncBoard } from "../src/sync/merge";
import type { BoardNode } from "../src/board/types";

/**
 * What happens to work done while a sync round was in the air.
 *
 * Runs in Node: the question is entirely about node lists. It is also the
 * question with the worst failure mode in the app — a node that vanishes a
 * second after it is created, and takes a tombstone with it, so the next push
 * deletes it everywhere. Silent, permanent, and indistinguishable from a
 * misclick.
 */

function node(id: string, updatedAt: number, x = 0): BoardNode {
  return {
    id,
    kind: "image",
    order: `a${id}`,
    updatedAt,
    x,
    y: 0,
    w: 10,
    h: 10,
    assetId: "asset",
  };
}

function board(
  nodes: BoardNode[],
  tombstones: SyncBoard["tombstones"] = [],
): SyncBoard {
  return {
    id: "deck",
    name: "Deck",
    nodes,
    tombstones,
    createdAt: 1,
    updatedAt: 2,
  };
}

const ids = (result: SyncBoard) => result.nodes.map((each) => each.id).sort();

test("a node pasted mid-round is not swallowed by the result", () => {
  const started = board([node("a", 100)]);
  // The round went to Drive and came back with what it started with.
  const merged = board([node("a", 100)]);
  // Meanwhile someone pasted.
  const current = board([node("a", 100), node("b", 150)]);

  expect(ids(settleRound({ started, merged, current }))).toEqual(["a", "b"]);
});

test("a node moved mid-round keeps where it was moved to", () => {
  const started = board([node("a", 100, 0)]);
  const merged = board([node("a", 100, 0)]);
  const current = board([node("a", 200, 500)]);

  const settled = settleRound({ started, merged, current });
  expect(settled.nodes[0]!.x).toBe(500);
});

test("a node the remote genuinely deleted still goes", () => {
  const started = board([node("a", 100), node("b", 100)]);
  // The other device deleted b, so the round's result does not have it and its
  // tombstone says why. This must not look like "arrived while we were busy".
  const merged = board([node("a", 100)], [{ id: "b", deletedAt: 300 }]);
  const current = board([node("a", 100), node("b", 100)]);

  expect(ids(settleRound({ started, merged, current }))).toEqual(["a"]);
});

test("a node the remote sent arrives", () => {
  const started = board([node("a", 100)]);
  const merged = board([node("a", 100), node("remote", 120)]);
  const current = board([node("a", 100)]);

  expect(ids(settleRound({ started, merged, current }))).toEqual([
    "a",
    "remote",
  ]);
});

test("a node deleted locally mid-round stays deleted", () => {
  const started = board([node("a", 100), node("b", 100)]);
  const merged = board([node("a", 100), node("b", 100)]);
  const current = board([node("a", 100)], [{ id: "b", deletedAt: 400 }]);

  expect(ids(settleRound({ started, merged, current }))).toEqual(["a"]);
});

test("a quiet board is left exactly as it is", () => {
  const started = board([node("a", 100)]);
  const merged = board([node("a", 100)]);
  const current = board([node("a", 100)]);

  expect(ids(settleRound({ started, merged, current }))).toEqual(["a"]);
});
