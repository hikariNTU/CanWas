import { expect, test } from "@playwright/test";

import { createDriveTransport } from "../src/sync/drive-transport";
import type { Session } from "../src/sync/auth";

/**
 * What happens to a Drive sync when the hour runs out.
 *
 * Runs in Node against a stubbed `fetch` rather than in a page, because the
 * thing under test is invisible from the UI and slow from real life: a token
 * lasts an hour, so a bug here is one nobody sees until a session has been
 * open long enough for everyone to have stopped watching. The stub lets that
 * hour pass in a millisecond.
 */

const FOLDER_MIME = "application/vnd.google-apps.folder";

interface Stub {
  /** Tokens the fake Drive still accepts. Anything else gets a 401. */
  live: Set<string>;
  /** Authorization tokens seen, in order. */
  seen: string[];
  restore: () => void;
}

/** A Drive small enough to fit in a test: two folders and one board file. */
function stubDrive(live: string[]): Stub {
  const original = globalThis.fetch;
  const stub: Stub = {
    live: new Set(live),
    seen: [],
    restore: () => {
      globalThis.fetch = original;
    },
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    const token = String(
      new Headers(init?.headers).get("Authorization") ?? "",
    ).replace("Bearer ", "");
    stub.seen.push(token);
    if (!stub.live.has(token)) {
      return new Response("expired", { status: 401 });
    }
    if (url.includes("alt=media")) {
      return new Response(
        JSON.stringify({
          id: "deck",
          name: "Deck",
          nodes: [],
          tombstones: [],
          createdAt: 1,
          updatedAt: 2,
        }),
      );
    }
    // `URLSearchParams` writes spaces as `+`, which `decodeURIComponent`
    // leaves alone — so this has to undo both encodings or every query below
    // looks like a query for nothing.
    const query = decodeURIComponent(url.replaceAll("+", " "));
    if (query.includes("name = ")) {
      const name = /name = '([^']*)'/.exec(query)?.[1] ?? "?";
      return json({
        files: [{ id: `${name}-id`, name, mimeType: FOLDER_MIME }],
      });
    }
    if (query.includes("in parents")) {
      return json({
        files: query.includes("boards-id")
          ? [{ id: "deck-file", name: "deck.json", mimeType: "text/json" }]
          : [],
      });
    }
    return json({ id: "created", name: "created", mimeType: FOLDER_MIME });
  }) as typeof fetch;

  return stub;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

function session(accessToken: string): Session {
  return { accessToken, expiresAt: Date.now() + 3_600_000 };
}

test("a token Drive rejects is renewed once, and the call retried", async () => {
  const drive = stubDrive(["fresh"]);
  let renewals = 0;
  let current = "stale";

  const transport = createDriveTransport(async (renew) => {
    if (renew) {
      renewals++;
      current = "fresh";
    }
    return session(current);
  });

  try {
    // The clock says this token is good for another hour. Drive disagrees,
    // which is the case the expiry check cannot catch: a revoked grant and a
    // skewed clock both look like this and neither is visible locally.
    const board = await transport.getBoard("deck");
    expect(board?.id).toBe("deck");
    expect(renewals).toBe(1);
    expect(drive.seen[0]).toBe("stale");
    expect(drive.seen.filter((token) => token === "stale")).toHaveLength(1);
  } finally {
    drive.restore();
  }
});

test("a renewal that fails surfaces instead of retrying forever", async () => {
  const drive = stubDrive([]);
  let renewals = 0;

  const transport = createDriveTransport(async (renew) => {
    if (renew) {
      renewals++;
      // The grant is gone — revoked, or a password change elsewhere. No token
      // will work, and a transport that kept trying would spin.
      throw new Error("consent required");
    }
    return session("stale");
  });

  try {
    await expect(transport.getBoard("deck")).rejects.toThrow(
      "consent required",
    );
    expect(renewals).toBe(1);
  } finally {
    drive.restore();
  }
});

test("a failed directory walk does not poison the transport", async () => {
  const drive = stubDrive([]);
  const transport = createDriveTransport(async () => session("stale"));

  try {
    await expect(transport.getBoard("deck")).rejects.toThrow();
    // The cached walk is a promise. A rejected one left in place would be
    // handed to every later round, so one bad minute would break sync for the
    // life of the session.
    drive.live.add("stale");
    const board = await transport.getBoard("deck");
    expect(board?.id).toBe("deck");
  } finally {
    drive.restore();
  }
});
