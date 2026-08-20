import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";

import {
  allowEditsAtom,
  heldEditAtom,
  releaseHeldEditAtom,
} from "@/sync/edit-guard";
import { syncStatusAtom } from "@/sync/use-sync";
import { useGoogleAccount } from "@/sync/use-google-account";
import { useTranslation } from "@/translations";

/**
 * The choice a held edit is waiting on (D74).
 *
 * Reconnecting has to happen from a button inside this dialog and nowhere
 * else: Google's token model only issues a token from inside a click, so the
 * one thing that could fix this state is a thing only the user can start.
 */
export function StaleEditDialog() {
  const held = useAtomValue(heldEditAtom);
  const status = useAtomValue(syncStatusAtom);
  const allow = useSetAtom(allowEditsAtom);
  const release = useSetAtom(releaseHeldEditAtom);
  const { isConfigured, signIn } = useGoogleAccount();
  const { t } = useTranslation();

  const [connecting, setConnecting] = useState(false);
  // When the wait began. The round that releases the edit has to be one that
  // finished *after* the reconnect — an "idle" left over from a round earlier
  // in the session would let the edit through having pulled nothing.
  const since = useRef(0);

  useEffect(() => {
    if (
      connecting &&
      status.state === "idle" &&
      (status.at ?? 0) > since.current
    ) {
      setConnecting(false);
      release();
    }
  }, [connecting, release, status]);

  async function reconnect() {
    since.current = Date.now();
    setConnecting(true);
    await signIn();
  }

  return (
    <AlertDialog.Root open={held !== null}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 bg-neutral-950/70 backdrop-blur-sm" />
        <AlertDialog.Popup
          data-testid="stale-edit-dialog"
          className="glass-strong fixed top-1/2 left-1/2 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg p-5"
        >
          <AlertDialog.Title className="text-sm font-semibold text-neutral-100">
            {t("guard.title")}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-neutral-400">
            {t("guard.body")}
          </AlertDialog.Description>
          <p className="mt-2 text-sm text-neutral-300">{t("guard.held")}</p>
          {status.state === "failed" && (
            <p
              data-testid="stale-edit-error"
              className="mt-2 text-sm text-red-400"
            >
              {status.message}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              data-testid="edit-anyway"
              onClick={() => held && allow(held.boardId)}
              className="rounded-md border border-neutral-800 px-3 py-1.5 text-sm text-neutral-300 transition-colors duration-150 hover:bg-neutral-800 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
            >
              {t("guard.anyway")}
            </button>
            {/* A build with no client id can never reconnect, so it is not
                offered one — the dialog still tells the truth about the board,
                and "edit anyway" is then the only honest way out. */}
            {isConfigured && (
              <button
                type="button"
                data-testid="reconnect-and-sync"
                disabled={connecting}
                onClick={() => void reconnect()}
                className="rounded-md bg-sky-500/15 px-3 py-1.5 text-sm text-sky-400 transition-colors duration-150 hover:bg-sky-500/25 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none disabled:opacity-60"
              >
                {connecting ? t("guard.syncing") : t("guard.reconnect")}
              </button>
            )}
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
