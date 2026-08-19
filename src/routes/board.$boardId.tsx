import { createFileRoute, Link } from "@tanstack/react-router";
import { useAtomValue } from "jotai";

import { Canvas } from "@/canvas/canvas";
import { boardsMetaAtom } from "@/storage/boards-atom";
import { useBoardPersistence } from "@/storage/use-board-persistence";
import { useTranslation } from "@/translations";

export const Route = createFileRoute("/board/$boardId")({
  component: BoardScreen,
});

function BoardScreen() {
  const { boardId } = Route.useParams();
  const { t } = useTranslation();
  const { hydrated } = useBoardPersistence(boardId);
  const meta = useAtomValue(boardsMetaAtom)[boardId];

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 px-4 py-2">
        <Link
          to="/"
          className="rounded-md px-2 py-1 text-sm text-neutral-400 transition-colors duration-150 hover:text-neutral-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
        >
          {t("board.back")}
        </Link>
        <span
          className="truncate text-sm text-neutral-500"
          data-testid="board-id"
        >
          {meta?.name ?? boardId}
        </span>
      </div>
      <div className="min-h-0 flex-1 border-t border-neutral-800">
        {/* Rendering before the board is loaded would let an edit write an
            empty node list over stored content. */}
        {hydrated && <Canvas boardId={boardId} />}
      </div>
    </div>
  );
}
