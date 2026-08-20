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
        onClick={startEditing}
        className="pointer-events-auto h-9 max-w-52 truncate rounded-lg px-2 text-sm text-neutral-400 transition-colors duration-150 hover:text-neutral-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
      >
        {name}
      </button>
    </Tip>
  );
}
