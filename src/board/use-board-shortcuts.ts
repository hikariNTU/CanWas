import { useStore } from "jotai";
import { useEffect } from "react";

import { useBoardHistory, useSelection } from "@/board/history";
import { deleteNodes, reorderNodes } from "@/board/mutations";
import { boardNodesAtom } from "@/board/store";

/**
 * Board-level keyboard actions. Viewport shortcuts live with the viewport — pan
 * and zoom are not undoable and share nothing with these (D17).
 *
 * Nodes are read from the store when a key is pressed, never captured from a
 * render. A prop snapshot goes stale between an async paste landing and the
 * next render, which made Select All quietly select only the nodes that existed
 * when the listener was last registered.
 */
export function useBoardShortcuts(boardId: string) {
  const store = useStore();
  const { commit, undo, redo } = useBoardHistory(boardId);
  const { selection, setSelection } = useSelection(boardId);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      // Never steal keys from a text field.
      if (
        target?.isContentEditable ||
        /^(INPUT|TEXTAREA)$/.test(target?.tagName ?? "")
      ) {
        return;
      }

      const nodes = store.get(boardNodesAtom)[boardId] ?? [];
      const accel = event.metaKey || event.ctrlKey;

      if (accel && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }

      if (accel && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelection(nodes.map((node) => node.id));
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (selection.length === 0) {
          return;
        }
        event.preventDefault();
        commit((current) => deleteNodes(current, selection));
        setSelection([]);
        return;
      }

      if (event.key === "Escape") {
        setSelection([]);
        return;
      }

      if ((event.key === "]" || event.key === "[") && selection.length > 0) {
        event.preventDefault();
        commit((current) =>
          reorderNodes(
            current,
            selection,
            event.key === "]" ? "front" : "back",
          ),
        );
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [boardId, commit, redo, selection, setSelection, store, undo]);
}
