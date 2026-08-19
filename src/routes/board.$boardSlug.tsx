import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { useEffect } from "react";

import { Canvas } from "@/canvas/canvas";
import { boardSlug, parseBoardId } from "@/lib/slug";
import { boardsMetaAtom } from "@/storage/boards-atom";
import { useBoardPersistence } from "@/storage/use-board-persistence";

export const Route = createFileRoute("/board/$boardSlug")({
  component: BoardScreen,
});

function BoardScreen() {
  const { boardSlug: segment } = Route.useParams();
  const navigate = useNavigate();

  // The id is the authoritative part; the trailing slug is decoration.
  const boardId = parseBoardId(segment);
  const { hydrated } = useBoardPersistence(boardId);
  const meta = useAtomValue(boardsMetaAtom)[boardId];

  // Rewrite the URL to the canonical id-plus-slug form: after a rename, and
  // for any link that arrived with a stale or missing slug. `replace` keeps it
  // out of history, so Back still leaves the board rather than bouncing.
  useEffect(() => {
    if (!meta) {
      return;
    }
    const canonical = boardSlug(meta.id, meta.name);
    if (canonical !== segment) {
      void navigate({
        to: "/board/$boardSlug",
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
