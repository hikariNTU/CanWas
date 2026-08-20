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
  isExpired,
  listChildren,
  putFile,
  ROOT_FOLDER_NAME,
  type DriveFile,
} from "@/sync/drive";
import {
  accepted,
  BOARD_VERSION,
  stamped,
  TEXT_VERSION,
} from "@/sync/document";
import type { SyncBoard } from "@/sync/merge";
import type { RemoteText, SyncTransport } from "@/sync/transport";

const BOARDS_FOLDER = "boards";
const ASSETS_FOLDER = "assets";
/** Recognition, one file per image hash. Its own folder rather than a second
 *  extension in `assets/`, so a name-prefix lookup cannot confuse the two. */
const TEXT_FOLDER = "text";

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
  textFolderId: string;
  boards: Map<string, DriveFile>;
  assets: Map<string, DriveFile>;
  text: Map<string, DriveFile>;
}

/**
 * Hands out a live access token, renewing it when asked.
 *
 * `renew` is the caller saying "the one you gave me did not work" — the
 * provider is free to answer a plain call from cache, but a renewing call has
 * to come back with a token it has not handed out before.
 */
export type SessionSource = (renew?: boolean) => Promise<Session>;

export function createDriveTransport(getSession: SessionSource): SyncTransport {
  let directory: Promise<Directory> | null = null;

  /**
   * Runs one Drive call with a token, and once more with a new token if Drive
   * says the old one is finished.
   *
   * Both halves are needed. The clock check in the provider catches the common
   * case without a wasted round trip, but it trusts this device's clock and
   * Google's stated lifetime; a revoked grant, a rotated token or a skewed
   * clock all show up only as a 401 from the server. Retrying once on that is
   * the difference between a session that lasts and one that turns amber an
   * hour in.
   */
  async function authed<T>(run: (session: Session) => Promise<T>): Promise<T> {
    try {
      return await run(await getSession());
    } catch (error) {
      if (!isExpired(error)) {
        throw error;
      }
      return run(await getSession(true));
    }
  }

  // Retried as a whole rather than per call: every step of the walk is a
  // lookup-or-create, so running it twice finds what the first attempt made.
  const load = (): Promise<Directory> =>
    authed(async (active) => {
      const rootId = await ensureFolder(active, ROOT_FOLDER_NAME);
      const [boardsFolderId, assetsFolderId, textFolderId] = await Promise.all([
        ensureFolder(active, BOARDS_FOLDER, rootId),
        ensureFolder(active, ASSETS_FOLDER, rootId),
        ensureFolder(active, TEXT_FOLDER, rootId),
      ]);
      const [boards, assets, text] = await Promise.all([
        listChildren(active, boardsFolderId),
        listChildren(active, assetsFolderId),
        listChildren(active, textFolderId),
      ]);
      return {
        boardsFolderId,
        assetsFolderId,
        textFolderId,
        boards: new Map(boards.map((file) => [file.name, file])),
        assets: new Map(assets.map((file) => [file.name, file])),
        text: new Map(text.map((file) => [file.name, file])),
      };
    });

  function open(): Promise<Directory> {
    // A rejected promise left in the cache would be handed to every later
    // round, so a single failed walk would make the transport permanently
    // broken for the life of the session.
    directory ??= load().catch((error: unknown) => {
      directory = null;
      throw error;
    });
    return directory;
  }

  return {
    name: "drive",

    async listBoards() {
      const { boards } = await open();
      return [...boards.entries()]
        .filter(([name]) => name.endsWith(".json"))
        .map(([name, file]) => ({
          id: name.slice(0, -".json".length),
          name: file.appProperties?.name,
          // Written by `putBoard` as a decimal string. A file from an older
          // build has none, and `undefined` is read as "ask", not as "skip".
          updatedAt: Number(file.appProperties?.updatedAt) || undefined,
        }));
    },

    async getBoard(id) {
      const { boards } = await open();
      const file = boards.get(`${id}.json`);
      if (!file) {
        return null;
      }
      const blob = await authed((active) => getFileContent(active, file.id));
      return accepted<SyncBoard>(
        JSON.parse(await blob.text()),
        BOARD_VERSION,
        `board ${id}`,
      );
    },

    async putBoard(board) {
      const state = await open();
      const name = `${board.id}.json`;
      const written = await authed((active) =>
        putFile(active, {
          name,
          parentId: state.boardsFolderId,
          fileId: state.boards.get(name)?.id,
          body: new Blob([JSON.stringify(stamped(board, BOARD_VERSION))], {
            type: "application/json",
          }),
          // Repeated into Drive's own metadata so a listing — one request,
          // already made — answers "which boards, called what, changed when"
          // without opening a single file.
          appProperties: {
            name: board.name,
            updatedAt: String(board.updatedAt),
          },
        }),
      );
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
        blob: await authed((active) => getFileContent(active, file.id)),
        extension: name.slice(name.lastIndexOf(".") + 1),
      };
    },

    async hasText(id) {
      const { text } = await open();
      return text.has(`${id}.json`);
    },

    async getText(id) {
      const { text } = await open();
      const file = text.get(`${id}.json`);
      if (!file) {
        return null;
      }
      const blob = await authed((active) => getFileContent(active, file.id));
      return accepted<RemoteText>(
        JSON.parse(await blob.text()),
        TEXT_VERSION,
        `text ${id}`,
      );
    },

    async putText(id, value) {
      const state = await open();
      const name = `${id}.json`;
      const written = await authed((active) =>
        putFile(active, {
          name,
          parentId: state.textFolderId,
          fileId: state.text.get(name)?.id,
          body: new Blob([JSON.stringify(stamped(value, TEXT_VERSION))], {
            type: "application/json",
          }),
        }),
      );
      state.text.set(name, { ...written, name });
    },

    async putAsset(id, asset) {
      const state = await open();
      const name = `${id}.${asset.extension}`;
      const written = await authed((active) =>
        putFile(active, {
          name,
          parentId: state.assetsFolderId,
          fileId: state.assets.get(name)?.id,
          body: asset.blob,
        }),
      );
      state.assets.set(name, { ...written, name });
    },
  };
}
