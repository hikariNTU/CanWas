import { AlertDialog } from "@base-ui/react/alert-dialog";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useAtom } from "jotai";
import { useEffect, useState } from "react";

import {
  deleteBoard,
  getAllBoards,
  putBoard,
  type StoredBoard,
} from "@/storage/db";
import { IDENTITY_VIEWPORT } from "@/canvas/coords";
import { boardsMetaAtom, type BoardMeta } from "@/storage/boards-atom";
import { useTranslation } from "@/translations";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const { t, lang } = useTranslation();
  const navigate = useNavigate();
  const [boardsMeta, setBoardsMeta] = useAtom(boardsMetaAtom);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void getAllBoards().then((boards) => {
      setBoardsMeta(
        Object.fromEntries(
          boards.map((board) => [
            board.id,
            {
              id: board.id,
              name: board.name,
              createdAt: board.createdAt,
              updatedAt: board.updatedAt,
            } satisfies BoardMeta,
          ]),
        ),
      );
      setLoaded(true);
    });
  }, [setBoardsMeta]);

  const boards = Object.values(boardsMeta).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );

  async function createBoard() {
    const now = Date.now();
    const board: StoredBoard = {
      id: crypto.randomUUID(),
      name: t("home.untitled"),
      nodes: [],
      viewport: IDENTITY_VIEWPORT,
      createdAt: now,
      updatedAt: now,
    };
    await putBoard(board);
    await navigate({ to: "/board/$boardId", params: { boardId: board.id } });
  }

  async function removeBoard(id: string) {
    await deleteBoard(id);
    setBoardsMeta((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
    // Orphaned assets are reclaimed by the startup sweep (D14), not here:
    // sweeping now could reclaim bytes a still-open board is using.
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("home.title")}
          </h1>
          <p className="mt-2 text-sm text-neutral-400">{t("app.tagline")}</p>
        </div>
        <button
          type="button"
          data-testid="create-board"
          onClick={() => void createBoard()}
          className="shrink-0 rounded-md border border-neutral-800 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 transition-colors duration-150 hover:bg-neutral-700 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
        >
          {t("home.create")}
        </button>
      </div>

      {loaded && boards.length === 0 && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-6">
          <p className="text-sm text-neutral-400">{t("home.empty")}</p>
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {boards.map((board) => (
          <li
            key={board.id}
            data-testid="board-row"
            className="flex items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3"
          >
            <Link
              to="/board/$boardId"
              params={{ boardId: board.id }}
              className="min-w-0 flex-1 rounded-md text-sm text-neutral-100 transition-colors duration-150 hover:text-sky-400 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
            >
              <span className="block truncate">{board.name}</span>
              <span className="mt-0.5 block text-xs text-neutral-500">
                {new Intl.DateTimeFormat(lang, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(board.updatedAt)}
              </span>
            </Link>
            <DeleteBoardButton
              name={board.name}
              onConfirm={() => void removeBoard(board.id)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Deleting a board is not undoable — the history stack covers content only
 * (D17) — so it is confirmed explicitly.
 */
function DeleteBoardButton({
  name,
  onConfirm,
}: {
  name: string;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();

  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger
        data-testid="delete-board"
        aria-label={t("home.delete")}
        className="shrink-0 rounded-md px-2 py-1 text-sm text-neutral-500 transition-colors duration-150 hover:bg-neutral-800 hover:text-red-400 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
      >
        {t("home.delete")}
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 bg-neutral-950/70 backdrop-blur-sm" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-neutral-800 bg-neutral-900 p-5 shadow-2xl">
          <AlertDialog.Title className="text-sm font-semibold text-neutral-100">
            {t("home.deleteTitle")}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-neutral-400">
            {t("home.deleteBody")}
          </AlertDialog.Description>
          <p className="mt-2 truncate text-sm text-neutral-300">{name}</p>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Close className="rounded-md border border-neutral-800 px-3 py-1.5 text-sm text-neutral-300 transition-colors duration-150 hover:bg-neutral-800 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none">
              {t("common.cancel")}
            </AlertDialog.Close>
            <AlertDialog.Close
              data-testid="confirm-delete"
              onClick={onConfirm}
              className="rounded-md bg-red-500/15 px-3 py-1.5 text-sm text-red-400 transition-colors duration-150 hover:bg-red-500/25 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
            >
              {t("home.delete")}
            </AlertDialog.Close>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
