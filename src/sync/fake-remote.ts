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

import type { SyncBoard } from "@/sync/merge";
import type { RemoteAsset, SyncTransport } from "@/sync/transport";

const DB_NAME = "canwas-fake-remote";
const DB_VERSION = 1;
const BOARD_STORE = "boards";
const ASSET_STORE = "assets";

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

  async listBoardIds() {
    const keys = await run<IDBValidKey[]>(BOARD_STORE, "readonly", (store) =>
      store.getAllKeys(),
    );
    return keys.map(String);
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
    return record ? (JSON.parse(JSON.stringify(record)) as SyncBoard) : null;
  },

  async putBoard(board) {
    await run(BOARD_STORE, "readwrite", (store) => store.put(board));
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
};
