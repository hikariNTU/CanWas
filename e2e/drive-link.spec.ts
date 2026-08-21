import { expect, test } from "@playwright/test";

import { createDriveTransport } from "../src/sync/drive-transport";
import { fakeRemote } from "../src/sync/fake-remote";
import type { Session } from "../src/sync/auth";

/**
 * The link that takes an image node to the file behind it.
 *
 * Runs in Node against a stubbed Drive, like the token test beside it: the
 * question is what URL the transport builds for a file it has listed, and
 * whether it declines to build one for a file it has not. Neither is visible
 * from the UI without a real Google account, and the second is the one that
 * matters — a menu item linking to a 404 is worse than no menu item.
 */

const FOLDER_MIME = "application/vnd.google-apps.folder";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

/** A Drive holding exactly one asset, under the layout in docs/sync.md. */
function stubDrive(): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : input.toString();
    const query = decodeURIComponent(url.replaceAll("+", " "));
    if (query.includes("name = ")) {
      const name = /name = '([^']*)'/.exec(query)?.[1] ?? "?";
      return json({
        files: [{ id: `${name}-id`, name, mimeType: FOLDER_MIME }],
      });
    }
    if (query.includes("in parents")) {
      return json({
        files: query.includes("assets-id")
          ? [{ id: "asset-file", name: "hash1.webp", mimeType: "image/webp" }]
          : [],
      });
    }
    return json({ id: "created", name: "created", mimeType: FOLDER_MIME });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function transport() {
  const session: Session = {
    accessToken: "live",
    expiresAt: Date.now() + 3_600_000,
  };
  return createDriveTransport(() => Promise.resolve(session));
}

test("an uploaded asset links to its own Drive file", async () => {
  const restore = stubDrive();
  try {
    // The id is the file's, not the content hash: Drive addresses files by an
    // opaque id, and the name only exists inside a folder listing.
    await expect(transport().assetUrl("hash1")).resolves.toBe(
      "https://drive.google.com/file/d/asset-file/view",
    );
  } finally {
    restore();
  }
});

test("an asset the remote has never seen has no link", async () => {
  const restore = stubDrive();
  try {
    await expect(transport().assetUrl("hash2")).resolves.toBeNull();
  } finally {
    restore();
  }
});

test("the fake remote has nowhere to open a file", async () => {
  // An IndexedDB database on this machine, with no page to point a browser at.
  // This is what keeps the menu item out of every `?sync=fake` session.
  await expect(fakeRemote.assetUrl("hash1")).resolves.toBeNull();
});
