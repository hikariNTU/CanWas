import { useStore } from "jotai";
import { useEffect } from "react";

import { encodeNodes } from "@/board/clipboard";
import { useBoardHistory, useSelection } from "@/board/history";
import { deleteNodes, reorderNodes, stepFontSize } from "@/board/mutations";
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
export function useBoardShortcuts(boardId: string, enabled = true) {
  const store = useStore();
  const { commit, undo, redo } = useBoardHistory(boardId);
  const { selection, setSelection } = useSelection(boardId);

  /**
   * Copy puts the selected nodes on the system clipboard.
   *
   * Handled on the `copy` event rather than on Cmd+C, so the menu bar's Copy
   * and a phone's edit menu reach the same code, and written synchronously
   * into `event.clipboardData` rather than through `navigator.clipboard`, for
   * the reason paste is read the same way (D21). What actually goes on the
   * clipboard is `src/board/clipboard.ts`.
   */
  useEffect(() => {
    function handleCopy(event: ClipboardEvent) {
      // Reading mode: the clipboard belongs to the recognized text, which is
      // the whole point of being in it.
      if (!enabled) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        /^(INPUT|TEXTAREA)$/.test(target?.tagName ?? "")
      ) {
        return;
      }
      // A live text selection anywhere outranks the node selection: the user
      // is copying the words they can see highlighted.
      const highlighted = window.getSelection();
      if (highlighted && !highlighted.isCollapsed) {
        return;
      }
      if (selection.length === 0 || !event.clipboardData) {
        return;
      }
      // Board order, not click order, so a paste stacks the way the original
      // did.
      const nodes = store.get(boardNodesAtom)[boardId] ?? [];
      const flavours = encodeNodes(
        nodes.filter((node) => selection.includes(node.id)),
      );
      if (!flavours) {
        return;
      }
      event.preventDefault();
      event.clipboardData.setData("text/html", flavours.html);
      // Images contribute no text — their recognition lives on the Asset — so
      // a selection of images writes the HTML flavour alone rather than an
      // empty string that would clear whatever a text editor pastes.
      if (flavours.text !== "") {
        event.clipboardData.setData("text/plain", flavours.text);
      }
    }
    window.addEventListener("copy", handleCopy);
    return () => window.removeEventListener("copy", handleCopy);
  }, [boardId, enabled, selection, store]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Suspended while an image's text is being read: there, Delete and
      // Select All belong to the text selection, not to the board.
      if (!enabled) {
        return;
      }
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

      // Cmd/Ctrl+Shift+< and > step text size, as in most editors. The key
      // value is "<" on layouts that produce it with Shift, but some report
      // the unshifted "," instead, so both spellings are accepted.
      if (accel && event.shiftKey) {
        const direction =
          event.key === ">" || event.key === "."
            ? 1
            : event.key === "<" || event.key === ","
              ? -1
              : 0;
        if (direction !== 0 && selection.length > 0) {
          event.preventDefault();
          commit((current) =>
            stepFontSize(current, selection, direction === 1 ? 1 : -1),
          );
          return;
        }
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
  }, [boardId, commit, enabled, redo, selection, setSelection, store, undo]);
}
