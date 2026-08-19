/**
 * The Drive side of the transport seam (D57).
 *
 * Everything Drive-specific that the sync loop would otherwise have to know
 * lives here: that a folder has to exist before a file can go in it, that a
 * file is addressed by an opaque id rather than by its name, and that finding
 * that id costs a request.
 *
 * The layout is the one in docs/sync.md:
 *
 *     CanWas/boards/<board-id>.json
 *     CanWas/assets/<sha256>.<ext>
 */

import type { Session } from "@/sync/auth";
import {
  ensureFolder,
  getFileContent,
  listChildren,
  putFile,
  ROOT_FOLDER_NAME,
  type DriveFile,
} from "@/sync/drive";
import type { SyncBoard } from "@/sync/merge";
import type { SyncTransport } from "@/sync/transport";

const BOARDS_FOLDER = "boards";
const ASSETS_FOLDER = "assets";

/**
 * Folder ids and the directory listing, cached for the life of a session.
 *
 * Drive has no path lookup: reaching `CanWas/assets/<hash>.webp` means three
 * queries to walk the names, every time. Caching turns a sync of twenty assets
 * from sixty requests into one listing plus the uploads that are actually
 * needed. The listing is refreshed whenever this transport writes, so it can
 * only ever be stale in the direction of doing extra work.
 */
interface Directory {
  boardsFolderId: string;
  assetsFolderId: string;
  boards: Map<string, DriveFile>;
  assets: Map<string, DriveFile>;
}

export function createDriveTransport(
  getSession: () => Session | null,
): SyncTransport {
  let directory: Promise<Directory> | null = null;

  function session(): Session {
    const current = getSession();
    if (!current) {
      // Not an expected state: the loop only runs while signed in. Throwing
      // beats a silent no-op that looks like a board with nothing to sync.
      throw new Error("Drive transport used while signed out");
    }
    return current;
  }

  async function load(): Promise<Directory> {
    const active = session();
    const rootId = await ensureFolder(active, ROOT_FOLDER_NAME);
    const [boardsFolderId, assetsFolderId] = await Promise.all([
      ensureFolder(active, BOARDS_FOLDER, rootId),
      ensureFolder(active, ASSETS_FOLDER, rootId),
    ]);
    const [boards, assets] = await Promise.all([
      listChildren(active, boardsFolderId),
      listChildren(active, assetsFolderId),
    ]);
    return {
      boardsFolderId,
      assetsFolderId,
      boards: new Map(boards.map((file) => [file.name, file])),
      assets: new Map(assets.map((file) => [file.name, file])),
    };
  }

  function open(): Promise<Directory> {
    directory ??= load();
    return directory;
  }

  return {
    name: "drive",

    async listBoardIds() {
      const { boards } = await open();
      return [...boards.keys()]
        .filter((name) => name.endsWith(".json"))
        .map((name) => name.slice(0, -".json".length));
    },

    async getBoard(id) {
      const { boards } = await open();
      const file = boards.get(`${id}.json`);
      if (!file) {
        return null;
      }
      const blob = await getFileContent(session(), file.id);
      return JSON.parse(await blob.text()) as SyncBoard;
    },

    async putBoard(board) {
      const state = await open();
      const name = `${board.id}.json`;
      const written = await putFile(session(), {
        name,
        parentId: state.boardsFolderId,
        fileId: state.boards.get(name)?.id,
        body: new Blob([JSON.stringify(board)], { type: "application/json" }),
      });
      state.boards.set(name, { ...written, name });
    },

    async hasAsset(id) {
      const { assets } = await open();
      return [...assets.keys()].some((name) => name.startsWith(`${id}.`));
    },

    async getAsset(id) {
      const { assets } = await open();
      const name = [...assets.keys()].find((candidate) =>
        candidate.startsWith(`${id}.`),
      );
      const file = name ? assets.get(name) : undefined;
      if (!file || !name) {
        return null;
      }
      return {
        blob: await getFileContent(session(), file.id),
        extension: name.slice(name.lastIndexOf(".") + 1),
      };
    },

    async putAsset(id, asset) {
      const state = await open();
      const name = `${id}.${asset.extension}`;
      const written = await putFile(session(), {
        name,
        parentId: state.assetsFolderId,
        fileId: state.assets.get(name)?.id,
        body: asset.blob,
      });
      state.assets.set(name, { ...written, name });
    },
  };
}
