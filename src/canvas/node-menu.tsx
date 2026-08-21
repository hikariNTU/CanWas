import { ContextMenu } from "@base-ui/react/context-menu";
import { useAtomValue, useStore } from "jotai";
import { useState } from "react";

import { encodeNodes } from "@/board/clipboard";
import { useBoardHistory, useSelection } from "@/board/history";
import { deleteNodes, reorderNodes } from "@/board/mutations";
import { boardNodesAtom } from "@/board/store";
import type { Asset, BoardNode } from "@/board/types";
import { useTranslation, type TranslationsKey } from "@/translations";
import { textOf } from "@/canvas/ocr-overlay";
import { syncTransportAtom } from "@/sync/use-sync";
import { Icon } from "@/ui/icon";
import { menuItemClass } from "@/ui/panel";

/**
 * What a right-click or a long press on a node offers (D83).
 *
 * The menu exists for the phone. On a desktop every item here is already a
 * keystroke — Cmd+C, Delete, `[` and `]` — and a phone has none of those, so
 * the board's whole vocabulary was unreachable by touch. Long press is handled
 * by the primitive, which starts a timer on `pointerdown` and cancels it if the
 * finger travels; nothing here has to know about touch at all.
 */

/**
 * `Cmd` on a Mac, `Ctrl` everywhere else.
 *
 * Read from the user agent because there is nothing better: the platform APIs
 * that answered this were deprecated without a replacement. Getting it wrong
 * costs a wrong glyph in a hint, which is why a guess is acceptable here and
 * would not be in a key handler — `useBoardShortcuts` accepts either modifier
 * from everyone, whatever this says.
 */
const APPLE =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.userAgent);

/**
 * Puts nodes on the system clipboard, outside a `copy` event.
 *
 * The keyboard path writes synchronously into `event.clipboardData` (D21),
 * which is not available here: a menu click is not a clipboard event. The async
 * API is, and a click is the user gesture it requires. Same two flavours, so a
 * node copied from the menu and a node copied with Cmd+C are the same bytes.
 *
 * `execCommand` is the fallback rather than the primary, for the browsers whose
 * `clipboard.write` refuses `text/html`. It fires a real `copy` event, which
 * lands in the handler `useBoardShortcuts` already installed — so the fallback
 * is the keyboard path, reached from a click.
 */
async function copyNodes(nodes: readonly BoardNode[]): Promise<void> {
  const flavours = encodeNodes(nodes);
  if (!flavours) {
    return;
  }
  const items: Record<string, Blob> = {
    "text/html": new Blob([flavours.html], { type: "text/html" }),
  };
  // Images carry no text of their own, and an empty `text/plain` would clear
  // whatever a text editor was about to paste.
  if (flavours.text !== "") {
    items["text/plain"] = new Blob([flavours.text], { type: "text/plain" });
  }
  try {
    await navigator.clipboard.write([new ClipboardItem(items)]);
  } catch {
    document.execCommand("copy");
  }
}

function Item({
  label,
  icon,
  testId,
  hint,
  danger,
  onClick,
}: {
  label: TranslationsKey;
  icon: string;
  testId: string;
  /** The keyboard or pointer route to the same action, if there is one. */
  hint?: string;
  danger?: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ContextMenu.Item
      data-testid={testId}
      className={
        danger
          ? `${menuItemClass} data-[highlighted]:text-red-400`
          : menuItemClass
      }
      onClick={onClick}
    >
      <Icon name={icon} size={18} className="shrink-0 text-neutral-500" />
      <span className="truncate">{t(label)}</span>
      {/* Hidden on a touch screen, where naming a key nobody has is noise in
          the one place the menu is not a convenience but the only route. Done
          with a variant rather than in JavaScript so it costs no state and
          follows a mouse plugged in mid-session. */}
      {hint !== undefined && (
        <span className="ml-auto hidden pl-4 font-mono text-xs text-neutral-500 pointer-fine:block">
          {hint}
        </span>
      )}
    </ContextMenu.Item>
  );
}

export function NodeMenu({
  boardId,
  node,
  asset,
  reading,
  onRead,
  children,
}: {
  boardId: string;
  node: BoardNode;
  /** The pixels behind an image node, when this device has them. */
  asset: Asset | null;
  /** Whether this node is the one being read, which a long press belongs to. */
  reading: boolean;
  /** Reading mode belongs to the canvas, which owns the state it turns on. */
  onRead: () => void;
  children: React.ReactElement;
}) {
  const { t } = useTranslation();
  const store = useStore();
  const { commit } = useBoardHistory(boardId);
  const { selection, setSelection } = useSelection(boardId);
  const transport = useAtomValue(syncTransportAtom);

  /**
   * Where this image lives on the remote, resolved while the menu opens.
   *
   * Resolved then rather than on click because the answer is a promise and a
   * tab opened after an `await` is a pop-up as far as Safari is concerned. It
   * also means the item can be absent rather than dead: an asset this device
   * has not pushed yet has no link, and nor does the fake remote, which is an
   * IndexedDB database with no page to open.
   *
   * Usually a microtask — the folder listing it reads is cached for the
   * session, and by the time anyone right-clicks a node the sync loop has
   * already made it.
   */
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);

  // Right-clicking outside the selection acts on what was clicked, as every
  // other application does. Inside it, the selection is left alone: a menu that
  // collapsed a five-node selection to one node on the way to Delete would
  // delete the wrong four.
  const targets = selection.includes(node.id) ? selection : [node.id];

  // Recognition that finished and found nothing is not something to offer: an
  // empty "Copy text" copies an empty string, and reading mode over no words is
  // a mode with nothing in it. A blank screenshot reaches `done` like any other.
  const words =
    asset?.ocr.status === "done" && asset.ocr.words.length > 0
      ? asset.ocr.words
      : null;

  return (
    <ContextMenu.Root
      onOpenChange={(open, details) => {
        // A node being read has no menu, on any device and by any gesture.
        // Reading is where the text is selected, and every way of asking for a
        // menu — a held finger, a right-click — lands on a selection being
        // made. It is also a mode you leave: a press outside, or Escape, and
        // the node is an ordinary node with its ordinary menu again. Nothing
        // is unreachable, it is one press further away while reading (D97).
        if (open && reading) {
          details.cancel();
          return;
        }
        setRemoteUrl(null);
        if (!open || node.kind !== "image" || !transport) {
          return;
        }
        void transport.assetUrl(node.assetId).then(
          (url) => {
            setRemoteUrl(url);
          },
          () => {
            // A failed lookup is a missing menu item, not an error: the item is
            // a convenience, and the picture is already on the board.
            setRemoteUrl(null);
          },
        );
      }}
    >
      <ContextMenu.Trigger
        // Base UI merges its handlers into the element rather than wrapping it,
        // so the node keeps its own gestures and this costs no extra box in the
        // layout — which matters, since every node on the board has one.
        render={children}
        onContextMenu={() => {
          if (!selection.includes(node.id)) {
            setSelection([node.id]);
          }
        }}
      />
      <ContextMenu.Portal>
        <ContextMenu.Positioner>
          <ContextMenu.Popup
            data-testid="node-menu"
            // The popup itself takes focus when it opens, and the browser's
            // default ring on a box this size reads as an error state rather
            // than as focus. The items inside carry the highlight that
            // actually says where you are.
            className="min-w-48 rounded-lg glass-strong p-1 text-sm outline-none"
          >
            <Item
              testId="node-menu-copy"
              label="node.copy"
              icon="content_copy"
              hint={APPLE ? "\u2318C" : "Ctrl C"}
              onClick={() => {
                const nodes = store.get(boardNodesAtom)[boardId] ?? [];
                void copyNodes(
                  nodes.filter((candidate) => targets.includes(candidate.id)),
                );
              }}
            />
            {/* Recognised text, when there is any. Dragging across the overlay
                does the same thing, but doing it with a finger on a board that
                pans under the touch is the hardest interaction in the app —
                and this is the reason someone put the picture here. */}
            {words !== null && (
              <Item
                testId="node-menu-copy-text"
                label="node.copyText"
                icon="subject"
                onClick={() => {
                  void navigator.clipboard.writeText(textOf(words));
                }}
              />
            )}
            {words !== null && (
              <Item
                testId="node-menu-read"
                label="node.read"
                icon="menu_book"
                hint={t("node.doubleClick")}
                onClick={() => {
                  setSelection([node.id]);
                  onRead();
                }}
              />
            )}

            <ContextMenu.Separator className="my-1 h-px bg-white/10" />

            <Item
              testId="node-menu-front"
              label="node.front"
              icon="flip_to_front"
              hint="]"
              onClick={() => {
                commit((current) => reorderNodes(current, targets, "front"));
              }}
            />
            <Item
              testId="node-menu-back"
              label="node.back"
              icon="flip_to_back"
              hint="["
              onClick={() => {
                commit((current) => reorderNodes(current, targets, "back"));
              }}
            />

            {remoteUrl !== null && (
              <>
                <ContextMenu.Separator className="my-1 h-px bg-white/10" />
                <Item
                  testId="node-menu-drive"
                  label="node.openInDrive"
                  icon="open_in_new"
                  onClick={() => {
                    window.open(remoteUrl, "_blank", "noopener,noreferrer");
                  }}
                />
              </>
            )}

            <ContextMenu.Separator className="my-1 h-px bg-white/10" />

            <Item
              testId="node-menu-delete"
              label="node.delete"
              icon="delete"
              hint={APPLE ? "\u232B" : "Del"}
              danger
              onClick={() => {
                commit((current) => deleteNodes(current, targets));
                setSelection([]);
              }}
            />
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
