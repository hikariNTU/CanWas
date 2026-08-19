import { useAtomValue } from "jotai";

import { authAtom } from "@/sync/auth";
import { useGoogleAccount } from "@/sync/use-google-account";
import { syncStatusAtom, type SyncStatus } from "@/sync/use-sync";
import { useTranslation, type TranslationsKey } from "@/translations";
import { Icon } from "@/ui/icon";

/**
 * Sync, as one floating button beside the info button.
 *
 * It is its own control rather than a line inside the info panel because it is
 * the only piece of chrome that answers "is my work anywhere but here". A state
 * you have to open a panel to read is a state nobody reads, and a board that
 * looks backed up and is not is only discovered on the day it matters.
 *
 * So it is never hidden. The resting state says "not syncing" out loud instead
 * of showing nothing at all, which would be indistinguishable from working.
 */

interface Appearance {
  icon: string;
  label: TranslationsKey;
  tone: string;
}

function appearanceFor(status: SyncStatus, connectable: boolean): Appearance {
  switch (status.state) {
    case "syncing":
      return {
        icon: "cloud_sync",
        label: "sync.syncing",
        tone: "text-sky-400",
      };
    case "idle":
      return {
        icon: "cloud_done",
        label: "sync.idle",
        tone: "text-neutral-400 hover:text-neutral-100",
      };
    case "failed":
      return {
        icon: "sync_problem",
        label: "sync.failed",
        tone: "text-amber-400 hover:text-amber-300",
      };
    case "off":
      return connectable
        ? {
            icon: "cloud_upload",
            label: "sync.connect",
            tone: "text-neutral-500 hover:text-neutral-100",
          }
        : {
            icon: "cloud_off",
            label: "sync.unconfigured",
            tone: "text-neutral-700",
          };
  }
}

export function SyncButton({ onSync }: { onSync: () => void }) {
  const { t } = useTranslation();
  const status = useAtomValue(syncStatusAtom);
  const auth = useAtomValue(authAtom);
  const { isConfigured, signIn } = useGoogleAccount();

  const connectable = isConfigured && auth.status !== "connecting";
  const { icon, label, tone } = appearanceFor(status, connectable);

  // Off means there is no transport, which is a sign-in away. Anything else
  // means sync is live, and pressing it asks for a round now rather than at the
  // next quiet moment — the thing you press before closing a laptop.
  const disabled =
    (status.state === "off" && !connectable) ||
    auth.status === "connecting" ||
    status.state === "syncing";

  return (
    <button
      type="button"
      data-testid="sync-button"
      data-sync-state={status.state}
      aria-label={t(label)}
      // The message, not the label: a failure that only says "failed" sends
      // whoever hits it to the console.
      title={status.state === "failed" ? status.message : t(label)}
      disabled={disabled}
      onClick={() => {
        if (status.state === "off") {
          void signIn();
          return;
        }
        onSync();
      }}
      className={`pointer-events-auto flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900/80 backdrop-blur transition-colors focus-visible:outline-2 focus-visible:outline-sky-500 disabled:pointer-events-none ${tone}`}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}
