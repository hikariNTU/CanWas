import { createFileRoute } from "@tanstack/react-router";

import { Canvas } from "@/canvas/canvas";
import { useBoardPersistence } from "@/storage/use-board-persistence";

export const Route = createFileRoute("/board/$boardId")({
  component: BoardScreen,
});

function BoardScreen() {
  const { boardId } = Route.useParams();
  const { hydrated } = useBoardPersistence(boardId);

  // Rendering before the board has loaded would let an edit write an empty
  // node list over stored content.
  return (
    <div className="h-full">{hydrated && <Canvas boardId={boardId} />}</div>
  );
}
