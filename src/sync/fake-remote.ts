/**
 * A remote that is really a second IndexedDB database on this machine.
 *
 * It exists so the merge can be developed and watched without a Google OAuth
 * client, and so the end-to-end suite can run two tabs as two devices — they
 * share this database exactly as two real devices share a Drive folder, and
 * every code path above it is the one Drive will use.
 *
 * A separate database rather than another store in `canwas`: the point is that
 * it is somewhere else. Sharing the app's own database would let a bug in the
 * loop read local state and call it remote, and the test would pass.
 */

import {
  accepted,
  BOARD_VERSION,
  stamped,
  TEXT_VERSION,
} from "@/sync/document";
import type { SyncBoard } from "@/sync/merge";
import type { RemoteAsset, RemoteText, SyncTransport } from "@/sync/transport";

const DB_NAME = "canwas-fake-remote";
const DB_VERSION = 2;
const BOARD_STORE = "boards";
const ASSET_STORE = "assets";
const TEXT_STORE = "text";

let connection: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BOARD_STORE)) {
        db.createObjectStore(BOARD_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(ASSET_STORE)) {
        db.createObjectStore(ASSET_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(TEXT_STORE)) {
        db.createObjectStore(TEXT_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return connection;
}

async function run<T>(
  store: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const request = action(db.transaction(store, mode).objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

interface StoredAsset extends RemoteAsset {
  id: string;
}

export const fakeRemote: SyncTransport = {
  name: "fake",

  async listBoards() {
    // Drive answers this from file metadata it already had; here the whole
    // record is to hand, so the same three fields are read off it.
    const records = await run<SyncBoard[]>(BOARD_STORE, "readonly", (store) =>
      store.getAll(),
    );
    return records.map((board) => ({
      id: board.id,
      name: board.name,
      updatedAt: board.updatedAt,
    }));
  },

  async getBoard(id) {
    const record = await run<SyncBoard | undefined>(
      BOARD_STORE,
      "readonly",
      (store) => store.get(id),
    );
    // Structured-cloned out of another database, so it is a copy already — but
    // returned through JSON anyway, because Drive will hand back parsed JSON
    // and a difference in what the two transports return is a difference the
    // loop would eventually depend on.
    return record
      ? accepted<SyncBoard>(
          JSON.parse(JSON.stringify(record)),
          BOARD_VERSION,
          `board ${id}`,
        )
      : null;
  },

  async putBoard(board) {
    await run(BOARD_STORE, "readwrite", (store) =>
      store.put(stamped(board, BOARD_VERSION)),
    );
  },

  // No interface to open anything in: this remote is an IndexedDB database on
  // this machine. Returning `null` is what hides the menu item under
  // `?sync=fake`, which is also how the tests assert it stays hidden.
  assetUrl() {
    return Promise.resolve(null);
  },

  async hasAsset(id) {
    const count = await run<number>(ASSET_STORE, "readonly", (store) =>
      store.count(id),
    );
    return count > 0;
  },

  async getAsset(id) {
    const record = await run<StoredAsset | undefined>(
      ASSET_STORE,
      "readonly",
      (store) => store.get(id),
    );
    return record ? { blob: record.blob, extension: record.extension } : null;
  },

  async putAsset(id, asset) {
    await run(ASSET_STORE, "readwrite", (store) => store.put({ id, ...asset }));
  },

  async hasText(id) {
    const count = await run<number>(TEXT_STORE, "readonly", (store) =>
      store.count(id),
    );
    return count > 0;
  },

  async getText(id) {
    const record = await run<(RemoteText & { id: string }) | undefined>(
      TEXT_STORE,
      "readonly",
      (store) => store.get(id),
    );
    if (!record) {
      return null;
    }
    // The key is the store's, not the document's.
    const { engine, words } = accepted<RemoteText & { id: string }>(
      JSON.parse(JSON.stringify(record)),
      TEXT_VERSION,
      `text ${id}`,
    );
    return { engine, words };
  },

  async putText(id, text) {
    await run(TEXT_STORE, "readwrite", (store) =>
      store.put({ id, ...stamped(text, TEXT_VERSION) }),
    );
  },
};
