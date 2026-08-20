import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";

import { boardsMetaAtom } from "@/storage/boards-atom";
import { renameBoardAtom } from "@/storage/board-actions";
import { useTranslation } from "@/translations";
import { Tip } from "@/ui/tooltip";

/**
 * The board title, editable in place.
 *
 * At rest it is bare text over the canvas with no surface of its own — chrome
 * that is only read does not need a container. The background appears only
 * while editing, where it marks the text as an input you can type into.
 */
export function BoardName({ boardId }: { boardId: string }) {
  const meta = useAtomValue(boardsMetaAtom)[boardId];
  const rename = useSetAtom(renameBoardAtom);
  const { t } = useTranslation();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.select();
    }
  }, [editing]);

  const name = meta?.name ?? boardId;

  // The window's title, from the component that owns the name.
  //
  // Worth doing because this app is a set of boards and the browser is where
  // several of them end up at once — in tabs, in the history, in a bookmark.
  // All of them read "CanWas" without this, which makes the tab strip useless
  // exactly when it is needed. Cleared on unmount rather than left behind, so
  // a board closed does not go on naming the window.
  //
  // `meta` is briefly absent while the board loads, and `name` falls back to
  // the raw id — a title of "a7f3c2… - CanWas" flashing past is worse than no
  // title, so that case waits.
  useEffect(() => {
    if (!meta) {
      return;
    }
    document.title = `${meta.name} - CanWas`;
    return () => {
      document.title = "CanWas";
    };
  }, [meta]);

  function startEditing() {
    setDraft(name);
    setEditing(true);
  }

  function commit() {
    rename(boardId, draft);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        data-testid="board-name-input"
        value={draft}
        aria-label={t("board.rename")}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit();
          } else if (event.key === "Escape") {
            setEditing(false);
          }
          // Shortcuts like Delete and Cmd+A belong to the text field here.
          event.stopPropagation();
        }}
        className="glass pointer-events-auto h-9 w-52 rounded-lg px-2.5 text-sm text-neutral-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
      />
    );
  }

  return (
    <Tip label={t("board.rename")}>
      <button
        type="button"
        data-testid="board-name"
        aria-label={t("board.rename")}
        onClick={startEditing}
        className="pointer-events-auto h-9 max-w-52 truncate rounded-lg px-2 text-sm text-neutral-400 transition-colors duration-150 hover:text-neutral-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
      >
        {name}
      </button>
    </Tip>
  );
}
