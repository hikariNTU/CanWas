import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { useEffect } from "react";

import { isBoardDeleted } from "@/board/types";
import { Canvas } from "@/canvas/canvas";
import { boardSlug, parseBoardId } from "@/lib/slug";
import { resolveLandingBoard } from "@/storage/board-actions";
import { boardsMetaAtom } from "@/storage/boards-atom";
import { useBoardPersistence } from "@/storage/use-board-persistence";
import { useTranslation } from "@/translations";

export const Route = createFileRoute("/$boardSlug")({
  component: BoardScreen,
});

function BoardScreen() {
  const { boardSlug: segment } = Route.useParams();
  const navigate = useNavigate();

  // The id is the authoritative part; the trailing slug is decoration.
  const boardId = parseBoardId(segment);
  const { hydrated } = useBoardPersistence(boardId);
  const meta = useAtomValue(boardsMetaAtom)[boardId];

  // Deleted while it was on screen — which only happens from another device,
  // since deleting it here navigates away first. Leaving the user on it would
  // let the next edit revive a board they cannot see in the menu, so the
  // screen steps off it. `replace`, because Back must not return to a grave.
  const { t } = useTranslation();
  useEffect(() => {
    if (!meta || !isBoardDeleted(meta)) {
      return;
    }
    void resolveLandingBoard(t("home.untitled")).then((target) =>
      navigate({
        to: "/$boardSlug",
        params: { boardSlug: boardSlug(target.id, target.name) },
        replace: true,
      }),
    );
  }, [meta, navigate, t]);

  // Rewrite the URL to the canonical id-plus-slug form: after a rename, and
  // for any link that arrived with a stale or missing slug. `replace` keeps it
  // out of history, so Back still leaves the board rather than bouncing.
  useEffect(() => {
    if (!meta || isBoardDeleted(meta)) {
      return;
    }
    const canonical = boardSlug(meta.id, meta.name);
    if (canonical !== segment) {
      void navigate({
        to: "/$boardSlug",
        params: { boardSlug: canonical },
        replace: true,
      });
    }
  }, [meta, navigate, segment]);

  // Rendering before the board has loaded would let an edit write an empty
  // node list over stored content.
  return (
    <div className="h-full">{hydrated && <Canvas boardId={boardId} />}</div>
  );
}
