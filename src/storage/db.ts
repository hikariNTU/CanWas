import { assetIdsOf, type BoardNode, type OcrState } from "@/board/types";
import type { Viewport } from "@/canvas/coords";

const DB_NAME = "canwas";
const DB_VERSION = 2;

export const ASSET_STORE = "assets";
export const BOARD_STORE = "boards";
export const MODEL_STORE = "models";

/** What actually lands on disk. Object URLs are runtime-only and excluded. */
export interface StoredAsset {
  id: string;
  blob: Blob;
  width: number;
  height: number;
  hash: string;
  ocr: OcrState;
}

export interface StoredBoard {
  id: string;
  name: string;
  nodes: BoardNode[];
  viewport: Viewport;
  createdAt: number;
  updatedAt: number;
}

let connection: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ASSET_STORE)) {
        db.createObjectStore(ASSET_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(BOARD_STORE)) {
        db.createObjectStore(BOARD_STORE, { keyPath: "id" });
      }
      // Added in version 2. Only ever created, never migrated: a cache with
      // nothing in it costs one download, so there is nothing worth carrying
      // across a schema change.
      if (!db.objectStoreNames.contains(MODEL_STORE)) {
        db.createObjectStore(MODEL_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return connection;
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = operation(transaction.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

export function putAsset(asset: StoredAsset): Promise<IDBValidKey> {
  return run(ASSET_STORE, "readwrite", (store) => store.put(asset));
}

export function getAsset(id: string): Promise<StoredAsset | undefined> {
  return run(ASSET_STORE, "readonly", (store) => store.get(id));
}

/** Keys in this store are always the asset's content hash, so always strings. */
export function getAllAssetIds(): Promise<string[]> {
  return run(
    ASSET_STORE,
    "readonly",
    (store) => store.getAllKeys() as IDBRequest<string[]>,
  );
}

export function deleteAsset(id: string): Promise<undefined> {
  return run(ASSET_STORE, "readwrite", (store) => store.delete(id));
}

/**
 * A downloaded model file. Cached because the recognizer's weights are 21 MB
 * and the browser's HTTP cache is not something to bet a 21 MB download on —
 * it is evictable, and on a cache miss the download happens again with no way
 * to tell that it did.
 */
export interface StoredModel {
  id: string;
  bytes: ArrayBuffer;
  /** The source's ETag, which Hugging Face sets to the content's SHA-256. */
  etag: string;
  fetchedAt: number;
}

export function putModel(model: StoredModel): Promise<IDBValidKey> {
  return run(MODEL_STORE, "readwrite", (store) => store.put(model));
}

export function getModel(id: string): Promise<StoredModel | undefined> {
  return run(MODEL_STORE, "readonly", (store) => store.get(id));
}

export function putBoard(board: StoredBoard): Promise<IDBValidKey> {
  return run(BOARD_STORE, "readwrite", (store) => store.put(board));
}

export function getBoard(id: string): Promise<StoredBoard | undefined> {
  return run(BOARD_STORE, "readonly", (store) => store.get(id));
}

export function getAllBoards(): Promise<StoredBoard[]> {
  return run(BOARD_STORE, "readonly", (store) => store.getAll());
}

export function deleteBoard(id: string): Promise<undefined> {
  return run(BOARD_STORE, "readwrite", (store) => store.delete(id));
}

/**
 * Mark-and-sweep, run at startup only (D14).
 *
 * Assets carry no reference count: a stored counter has to be adjusted on every
 * mutation path, and a crash between the node write and the counter write
 * desyncs it permanently. There is no state here to corrupt, so a crash mid-run
 * is repaired by the next run.
 *
 * Startup is the safe moment because undo history is in-memory (D16) and so is
 * always empty at that point — the sweep can never reclaim bytes an undo entry
 * still needs.
 */
export async function sweepOrphanedAssets(): Promise<number> {
  const [boards, assetIds] = await Promise.all([
    getAllBoards(),
    getAllAssetIds(),
  ]);
  const live = new Set(boards.flatMap((board) => assetIdsOf(board.nodes)));
  const orphans = assetIds.filter((id) => !live.has(id));
  await Promise.all(orphans.map((id) => deleteAsset(id)));
  return orphans.length;
}
