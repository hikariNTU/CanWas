import { expect, test } from "@playwright/test";
import { createStore } from "jotai";

import { authAtom } from "../src/sync/auth";
import {
  allowEditsAtom,
  discardHeldEditAtom,
  guardedEditAtom,
  heldEditAtom,
  noteRemoteBoardAtom,
  releaseHeldEditAtom,
} from "../src/sync/edit-guard";

/**
 * The guard's decision table, in Node rather than in a page (D74).
 *
 * The browser tests cover the states a dev build can actually reach, which is
 * "no account configured at all". The states that matter in production —
 * signed out with a remembered account, and a token that expired an hour into
 * the session — need an auth atom that can be put wherever the test likes, and
 * a reconnect that cannot be clicked from a test because Google's popup is not
 * something Playwright can consent to on anyone's behalf.
 */

const BOARD = "atoms";

function ranCounter() {
  const calls: number[] = [];
  return { calls, edit: () => calls.push(Date.now()) };
}

test("an unreachable remote holds the edit, a reachable one runs it", () => {
  for (const status of ["signedOut", "expired", "failed"] as const) {
    const store = createStore();
    store.set(noteRemoteBoardAtom, BOARD);
    store.set(
      authAtom,
      status === "failed" ? { status, error: "nope" } : { status },
    );

    const { calls, edit } = ranCounter();
    expect(store.set(guardedEditAtom, BOARD, edit)).toBe(false);
    expect(calls).toHaveLength(0);
    expect(store.get(heldEditAtom)?.boardId).toBe(BOARD);
  }

  const live = createStore();
  live.set(noteRemoteBoardAtom, BOARD);
  live.set(authAtom, {
    status: "signedIn",
    session: { accessToken: "t", expiresAt: Date.now() + 3_600_000 },
  });
  const { calls, edit } = ranCounter();
  expect(live.set(guardedEditAtom, BOARD, edit)).toBe(true);
  expect(calls).toHaveLength(1);
  expect(live.get(heldEditAtom)).toBeNull();
});

test("a board with no remote is never held", () => {
  const store = createStore();
  store.set(authAtom, { status: "expired" });

  const { calls, edit } = ranCounter();
  expect(store.set(guardedEditAtom, "neversynced", edit)).toBe(true);
  expect(calls).toHaveLength(1);
});

test("the first held edit is the one that survives a second attempt", () => {
  const store = createStore();
  store.set(noteRemoteBoardAtom, BOARD);
  store.set(authAtom, { status: "expired" });

  const first = ranCounter();
  const second = ranCounter();
  store.set(guardedEditAtom, BOARD, first.edit);
  store.set(guardedEditAtom, BOARD, second.edit);

  // The dialog is modal, so a second edit means a keyboard shortcut fired at
  // it. Replacing the held edit would lose the action that raised the dialog,
  // which is the one the user is looking at an explanation of.
  store.set(allowEditsAtom, BOARD);
  expect(first.calls).toHaveLength(1);
  expect(second.calls).toHaveLength(0);
});

test("allowing edits stops the guard for that board only", () => {
  const store = createStore();
  store.set(noteRemoteBoardAtom, BOARD);
  store.set(noteRemoteBoardAtom, "other");
  store.set(authAtom, { status: "expired" });

  const held = ranCounter();
  store.set(guardedEditAtom, BOARD, held.edit);
  store.set(allowEditsAtom, BOARD);
  expect(held.calls).toHaveLength(1);

  const later = ranCounter();
  expect(store.set(guardedEditAtom, BOARD, later.edit)).toBe(true);
  expect(later.calls).toHaveLength(1);

  const elsewhere = ranCounter();
  expect(store.set(guardedEditAtom, "other", elsewhere.edit)).toBe(false);
  expect(elsewhere.calls).toHaveLength(0);
});

test("a release lands the held edit; a discard drops it", () => {
  const store = createStore();
  store.set(noteRemoteBoardAtom, BOARD);
  store.set(authAtom, { status: "expired" });

  // What the dialog does once a reconnect has actually pulled. The edit is a
  // function of the current nodes, so running it against a board that just
  // merged is correct rather than stale.
  const reconnected = ranCounter();
  store.set(guardedEditAtom, BOARD, reconnected.edit);
  store.set(releaseHeldEditAtom);
  expect(reconnected.calls).toHaveLength(1);
  expect(store.get(heldEditAtom)).toBeNull();

  const abandoned = ranCounter();
  store.set(guardedEditAtom, BOARD, abandoned.edit);
  store.set(discardHeldEditAtom);
  expect(abandoned.calls).toHaveLength(0);
  expect(store.get(heldEditAtom)).toBeNull();
});
