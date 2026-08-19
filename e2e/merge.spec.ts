import { expect, test } from "@playwright/test";

import { mergeBoards, type SyncBoard } from "../src/sync/merge";
import type { BoardNode } from "../src/board/types";

/**
 * The merge is pure, so these run in Node with no page. It is also the one part
 * of sync that cannot be debugged after the fact: by the time anyone notices,
 * the evidence is two devices that disagree and no record of what either used
 * to hold.
 */

function image(id: string, order: string, updatedAt: number, x = 0): BoardNode {
  return {
    id,
    kind: "image",
    order,
    updatedAt,
    x,
    y: 0,
    w: 100,
    h: 100,
    assetId: `asset-${id}`,
  };
}

function text(
  id: string,
  order: string,
  updatedAt: number,
  content: string,
): BoardNode {
  return {
    id,
    kind: "text",
    order,
    updatedAt,
    x: 0,
    y: 0,
    w: 100,
    h: 20,
    text: content,
    fontSize: 16,
  };
}

function board(nodes: BoardNode[], over: Partial<SyncBoard> = {}): SyncBoard {
  return {
    id: "b1",
    name: "Board",
    nodes,
    tombstones: [],
    createdAt: 1000,
    updatedAt: Math.max(1000, ...nodes.map((node) => node.updatedAt)),
    ...over,
  };
}

const idsOf = (result: { board: SyncBoard }) =>
  result.board.nodes.map((node) => node.id);

/** Every rule has to reach the same board from either side. */
function expectSymmetric(a: SyncBoard, b: SyncBoard, base: SyncBoard | null) {
  expect(mergeBoards(a, b, base).board).toEqual(mergeBoards(b, a, base).board);
}

test("two devices each adding a node keep both", () => {
  // The case that makes per-board last-writer-wins wrong: whichever landed
  // second would have erased the other's node.
  const shared = image("shared", "a0", 1000);
  const a = board([shared, image("laptop", "a1", 2000)]);
  const b = board([shared, image("phone", "a2", 2100)]);

  expect(idsOf(mergeBoards(a, b))).toEqual(["shared", "laptop", "phone"]);
  expectSymmetric(a, b, null);
});

test("a deletion survives against a device that still holds the node", () => {
  const kept = image("kept", "a0", 1000);
  const gone = image("gone", "a1", 1000);
  const laptop = board([kept], {
    tombstones: [{ id: "gone", deletedAt: 3000 }],
    updatedAt: 3000,
  });
  const phone = board([kept, gone]);

  expect(idsOf(mergeBoards(laptop, phone))).toEqual(["kept"]);
  expectSymmetric(laptop, phone, null);

  // The tombstone is carried forward, or the next sync with a third device
  // would resurrect the node all over again.
  expect(mergeBoards(laptop, phone).board.tombstones).toEqual([
    { id: "gone", deletedAt: 3000 },
  ]);
});

test("a node touched after it was deleted comes back", () => {
  // Undo does exactly this: the delete is recorded, then reversed.
  const laptop = board([], {
    tombstones: [{ id: "n1", deletedAt: 3000 }],
    updatedAt: 3000,
  });
  const phone = board([image("n1", "a0", 4000)]);

  const { board: merged } = mergeBoards(laptop, phone);
  expect(idsOf({ board: merged })).toEqual(["n1"]);
  // And the stale tombstone does not linger to kill it on the next round.
  expect(merged.tombstones).toEqual([]);
  expectSymmetric(laptop, phone, null);
});

test("text edited on both devices keeps the loser beside the winner", () => {
  const laptop = board([text("t1", "a0", 5000, "from the laptop")]);
  const phone = board([text("t1", "a0", 4000, "from the phone")]);

  const { board: merged, report } = mergeBoards(laptop, phone);
  expect(report.conflicts).toBe(1);
  expect(merged.nodes).toHaveLength(2);

  const winner = merged.nodes.find((node) => node.id === "t1")!;
  expect(winner.kind === "text" && winner.text).toBe("from the laptop");

  const rescued = merged.nodes.find((node) => node.id !== "t1")!;
  expect(rescued.kind === "text" && rescued.text).toBe("from the phone");
  // Offset so it is visible rather than hidden under the winner.
  expect(rescued.x).toBeGreaterThan(winner.x);

  // The rescued id is derived, not generated: a random one would differ on the
  // two devices and each sync would multiply the copies.
  expectSymmetric(laptop, phone, null);

  // Merging again changes nothing, which is what stops the copies breeding.
  const twice = mergeBoards(merged, phone).board;
  expect(twice.nodes).toHaveLength(2);
  expect(mergeBoards(twice, laptop).board.nodes).toHaveLength(2);
});

test("an image changed on both devices takes one rectangle, not two", () => {
  const laptop = board([image("i1", "a0", 5000, 40)]);
  const phone = board([image("i1", "a0", 4000, 90)]);

  const { board: merged, report } = mergeBoards(laptop, phone);
  expect(merged.nodes).toHaveLength(1);
  expect(merged.nodes[0]!.x).toBe(40);
  expect(report.conflicts).toBe(0);
});

test("a base tells an edit apart from an untouched copy", () => {
  const original = text("t1", "a0", 1000, "original");
  const base = board([original]);
  // The laptop's content is unchanged but its stamp is newer — an undo and a
  // redo will do that. Straight last-writer-wins would hand it the win and
  // silently discard the phone's real edit.
  const laptop = board([{ ...original, updatedAt: 9000 }]);
  const phone = board([text("t1", "a0", 2000, "edited on the phone")]);

  const { board: merged, report } = mergeBoards(laptop, phone, base);
  expect(merged.nodes).toHaveLength(1);
  const only = merged.nodes[0]!;
  expect(only.kind === "text" && only.text).toBe("edited on the phone");
  expect(report.conflicts).toBe(0);
  expectSymmetric(laptop, phone, base);
});

test("a base makes a deletion stick even with the tombstone gone", () => {
  // Tombstones are reclaimed eventually. The base still records that the node
  // was there and is not any more.
  const node = image("n1", "a0", 1000);
  const base = board([node]);
  const laptop = board([], { updatedAt: 3000 });
  const phone = board([node]);

  expect(idsOf(mergeBoards(laptop, phone, base))).toEqual([]);
  expectSymmetric(laptop, phone, base);
});

test("a board deleted on one device stays deleted, unless the other edited it", () => {
  const laptop = board([], { deletedAt: 5000, updatedAt: 5000 });
  const untouched = board([image("n1", "a0", 1000)], { updatedAt: 1000 });
  expect(mergeBoards(laptop, untouched).board.deletedAt).toBe(5000);
  expectSymmetric(laptop, untouched, null);

  const busy = board([image("n1", "a0", 8000)], { updatedAt: 8000 });
  expect(mergeBoards(laptop, busy).board.deletedAt).toBeUndefined();
  expectSymmetric(laptop, busy, null);
});

test("the newer name wins, and a tie is broken the same way on both devices", () => {
  const a = board([], { name: "Groceries", updatedAt: 2000 });
  const b = board([], { name: "Shopping", updatedAt: 3000 });
  expect(mergeBoards(a, b).board.name).toBe("Shopping");
  expectSymmetric(a, b, null);

  const tieA = board([], { name: "Alpha", updatedAt: 2000 });
  const tieB = board([], { name: "Beta", updatedAt: 2000 });
  expect(mergeBoards(tieA, tieB).board.name).toBe(
    mergeBoards(tieB, tieA).board.name,
  );
});

test("merging a board with itself changes nothing", () => {
  const only = board([image("i1", "a0", 1000), text("t1", "a1", 2000, "note")]);
  expect(mergeBoards(only, only).board).toEqual(only);
});

test("the report counts against the first argument", () => {
  const shared = image("shared", "a0", 1000);
  const laptop = board([shared, image("mine", "a1", 2000)]);
  const phone = board([shared, image("theirs", "a2", 2000)], {
    tombstones: [{ id: "mine", deletedAt: 4000 }],
    updatedAt: 4000,
  });

  const { report } = mergeBoards(laptop, phone);
  expect(report).toEqual({ added: 1, updated: 0, removed: 1, conflicts: 0 });
});

test("random divergence still converges on both devices", () => {
  let seed = 99;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  for (let round = 0; round < 200; round++) {
    const common = [
      image("c1", "a0", 1000),
      text("c2", "a1", 1000, "shared note"),
    ];
    const base = board(common);

    const diverge = (label: string) => {
      const nodes = common.map((node) =>
        random() < 0.3
          ? node.kind === "text"
            ? text(node.id, node.order, 2000 + random() * 100, label)
            : image(node.id, node.order, 2000 + random() * 100, random() * 50)
          : node,
      );
      const tombstones = random() < 0.2 ? [{ id: "c1", deletedAt: 3000 }] : [];
      if (random() < 0.5) {
        nodes.push(image(`new-${label}`, "a2", 2500));
      }
      return board(
        nodes.filter((node) => !tombstones.some((s) => s.id === node.id)),
        { tombstones, name: label, updatedAt: 3000 },
      );
    };

    const laptop = diverge("laptop");
    const phone = diverge("phone");
    expect(mergeBoards(laptop, phone, base).board).toEqual(
      mergeBoards(phone, laptop, base).board,
    );
  }
});
