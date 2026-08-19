import { createFileRoute, redirect } from "@tanstack/react-router";

import { boardSlug } from "@/lib/slug";
import { resolveLandingBoard } from "@/storage/board-actions";
import { translate } from "@/translations";

/**
 * There is no home screen. Opening the app lands directly on a board — the one
 * edited most recently, or a fresh empty one if there are none.
 *
 * The board list lives in the board menu (D31); a separate index page would be
 * a stop on the way to the only screen that does anything.
 */
export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const board = await resolveLandingBoard(translate("home.untitled"));
    throw redirect({
      to: "/$boardSlug",
      params: { boardSlug: boardSlug(board.id, board.name) },
    });
  },
});
