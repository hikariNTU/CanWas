import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Menu } from "@base-ui/react/menu";
import { useNavigate } from "@tanstack/react-router";
import { useAtom } from "jotai";
import { useState } from "react";

import { isBoardDeleted } from "@/board/types";
import { boardSlug } from "@/lib/slug";
import { Icon } from "@/ui/icon";
import { boardsMetaAtom } from "@/storage/boards-atom";
import {
  createBoard,
  listBoards,
  metaOf,
  removeBoard,
} from "@/storage/board-actions";
import {
  currentLangAtom,
  useTranslation,
  type ProvidedLang,
} from "@/translations";

const languages: { value: ProvidedLang; label: string }[] = [
  { value: "en-US", label: "English" },
  { value: "zh-TW", label: "繁體中文" },
];

const itemClass =
  "flex w-full cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-neutral-300 select-none data-[highlighted]:bg-white/10 data-[highlighted]:text-neutral-100";

/**
 * The board screen's only menu. With no home screen (D31), everything that is
 * not the canvas lives here: switching boards, creating one, deleting the
 * current one, resetting the view, and language.
 */
export function BoardMenu({
  boardId,
  onResetView,
}: {
  boardId: string;
  onResetView: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [lang, setLang] = useAtom(currentLangAtom);
  const [boardsMeta, setBoardsMeta] = useAtom(boardsMetaAtom);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Graves are in the atom — they have to be, so a deletion heard about from
  // another device can replace the live row it arrives on top of — and they
  // are not boards. Filtered here rather than kept out of the atom, so there
  // is one copy of each board's metadata and every reader asks the same
  // question of it.
  const boards = Object.values(boardsMeta)
    .filter((board) => !isBoardDeleted(board))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const current = boardsMeta[boardId];

  async function openNewBoard() {
    const board = await createBoard(t("home.untitled"));
    setBoardsMeta((previous) => ({ ...previous, [board.id]: metaOf(board) }));
    await navigate({
      to: "/$boardSlug",
      params: { boardSlug: boardSlug(board.id, board.name) },
    });
  }

  async function deleteCurrentBoard() {
    const grave = await removeBoard(boardId);
    // The grave replaces the row rather than removing it. The board's own
    // debounced save may still be in flight, and it builds its record by
    // spreading whatever is in this atom when the timer fires — so an entry
    // that is merely absent lets a save land a board with no `deletedAt` on
    // top of the grave, and the deletion is undone by a timer.
    setBoardsMeta((previous) => ({ ...previous, [boardId]: grave }));
    // Never leave the user on a board that no longer exists: fall through to
    // the next most recent, or a fresh one if that was the last.
    const remaining = (await listBoards()).filter(
      (board) => board.id !== boardId,
    );
    const target =
      remaining[0] ?? metaOf(await createBoard(t("home.untitled")));
    await navigate({
      to: "/$boardSlug",
      params: { boardSlug: boardSlug(target.id, target.name) },
    });
  }

  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          data-testid="board-menu"
          aria-label={t("menu.open")}
          className="pointer-events-auto grid h-9 w-9 place-items-center rounded-full glass text-neutral-400 transition-colors duration-150 hover:bg-white/10 hover:text-neutral-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none pointer-coarse:h-11 pointer-coarse:w-11"
        >
          <Icon name="menu" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner sideOffset={6} align="start">
            <Menu.Popup className="max-h-[80vh] min-w-56 overflow-y-auto rounded-lg glass-strong p-1 text-sm">
              <Menu.Item
                data-testid="menu-new-board"
                className={itemClass}
                onClick={() => void openNewBoard()}
              >
                <Icon
                  name="add"
                  size={18}
                  className="shrink-0 text-neutral-500"
                />
                {t("home.create")}
              </Menu.Item>
              <Menu.Item className={itemClass} onClick={onResetView}>
                <Icon
                  name="recenter"
                  size={18}
                  className="shrink-0 text-neutral-500"
                />
                {t("canvas.resetView")}
              </Menu.Item>
              <Menu.Item
                data-testid="menu-delete-board"
                className={`${itemClass} data-[highlighted]:text-red-400`}
                onClick={() => setConfirmingDelete(true)}
              >
                <Icon
                  name="delete"
                  size={18}
                  className="shrink-0 text-neutral-500"
                />
                {t("board.delete")}
              </Menu.Item>

              <Menu.Separator className="my-1 h-px bg-white/10" />
              <Menu.RadioGroup
                value={boardId}
                onValueChange={(value) => {
                  const target = boardsMeta[String(value)];
                  if (target) {
                    void navigate({
                      to: "/$boardSlug",
                      params: { boardSlug: boardSlug(target.id, target.name) },
                    });
                  }
                }}
              >
                {/* GroupLabel reads its group from context, so it must be
                    nested inside the RadioGroup rather than sitting beside it. */}
                <Menu.GroupLabel className="px-2 py-1 text-xs text-neutral-500">
                  {t("home.title")}
                </Menu.GroupLabel>
                {boards.map((board) => (
                  <Menu.RadioItem
                    key={board.id}
                    value={board.id}
                    data-testid="menu-board-item"
                    className={itemClass}
                  >
                    <Indicator />
                    <span className="truncate">{board.name}</span>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>

              <Menu.Separator className="my-1 h-px bg-white/10" />
              <Menu.RadioGroup
                value={lang}
                onValueChange={(value) => setLang(value as ProvidedLang)}
              >
                <Menu.GroupLabel className="px-2 py-1 text-xs text-neutral-500">
                  {t("lang.label")}
                </Menu.GroupLabel>
                {languages.map((language) => (
                  <Menu.RadioItem
                    key={language.value}
                    value={language.value}
                    className={itemClass}
                  >
                    <Indicator />
                    {language.label}
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      {/* Deleting a board is not undoable — history covers content only
          (D17) — so it is confirmed explicitly. */}
      <AlertDialog.Root
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="fixed inset-0 bg-neutral-950/70 backdrop-blur-sm" />
          <AlertDialog.Popup className="fixed top-1/2 left-1/2 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg glass-strong p-5">
            <AlertDialog.Title className="text-sm font-semibold text-neutral-100">
              {t("home.deleteTitle")}
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-neutral-400">
              {t("home.deleteBody")}
            </AlertDialog.Description>
            <p className="mt-2 truncate text-sm text-neutral-300">
              {current?.name ?? boardId}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Close className="rounded-md border border-neutral-800 px-3 py-1.5 text-sm text-neutral-300 transition-colors duration-150 hover:bg-neutral-800 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none">
                {t("common.cancel")}
              </AlertDialog.Close>
              <AlertDialog.Close
                data-testid="confirm-delete"
                onClick={() => void deleteCurrentBoard()}
                className="rounded-md bg-red-500/15 px-3 py-1.5 text-sm text-red-400 transition-colors duration-150 hover:bg-red-500/25 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
              >
                {t("board.delete")}
              </AlertDialog.Close>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}

/** Fixed-width gutter so labels align whether or not the tick is showing. */
function Indicator() {
  return (
    <span className="grid w-4 shrink-0 place-items-center">
      <Menu.RadioItemIndicator className="flex">
        <Icon name="check" size={18} className="text-sky-400" />
      </Menu.RadioItemIndicator>
    </span>
  );
}
