import {
  assetIdsOf,
  type BoardNode,
  type OcrState,
  type Tombstone,
} from "@/board/types";
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
  /** The synced copy. See `Asset` in board/types.ts. */
  webp?: Blob;
}

export interface StoredBoard {
  id: string;
  name: string;
  nodes: BoardNode[];
  /**
   * Ids of nodes deleted from this board (D56). Optional because boards written
   * before tombstones existed have none — and a board with no record of a
   * deletion is a board that never deleted anything, as far as a merge can tell.
   */
  tombstones?: Tombstone[];
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

export interface StorageBreakdown {
  /** Image bytes, from the blobs themselves. */
  assetBytes: number;
  assetCount: number;
  /** The WebP re-encodes, which is what a sync would upload. */
  webpBytes: number;
  /** Cached model weights. */
  modelBytes: number;
  modelCount: number;
  boardCount: number;
  /** What the browser thinks this origin uses, including its own overhead. */
  quotaUsed?: number;
  quota?: number;
  /** Whether the browser has promised not to evict this origin. */
  persisted?: boolean;
}

/**
 * What is actually on disk, counted rather than estimated.
 *
 * `navigator.storage.estimate()` alone is not enough to answer "why is this
 * using 40 MB": it reports one number for the whole origin, and the interesting
 * split is between images the user pasted and weights that can be re-downloaded
 * for free. Blob sizes are read from the records without reading their bytes.
 */
export async function storageBreakdown(): Promise<StorageBreakdown> {
  const [assets, models, boards] = await Promise.all([
    run<StoredAsset[]>(ASSET_STORE, "readonly", (store) => store.getAll()),
    run<StoredModel[]>(MODEL_STORE, "readonly", (store) => store.getAll()),
    getAllBoards(),
  ]);

  const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
  const persisted = await navigator.storage
    ?.persisted?.()
    .catch(() => undefined);

  return {
    assetBytes: assets.reduce((total, asset) => total + asset.blob.size, 0),
    assetCount: assets.length,
    webpBytes: assets.reduce(
      (total, asset) => total + (asset.webp?.size ?? 0),
      0,
    ),
    modelBytes: models.reduce(
      (total, model) => total + model.bytes.byteLength,
      0,
    ),
    modelCount: models.length,
    boardCount: boards.length,
    quotaUsed: estimate?.usage,
    quota: estimate?.quota,
    persisted,
  };
}

/** Drops the cached weights. They cost nothing but a re-download. */
export async function clearModels(): Promise<void> {
  await run(MODEL_STORE, "readwrite", (store) => store.clear());
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
