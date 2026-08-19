import { Popover } from "@base-ui/react/popover";
import { useAtomValue } from "jotai";

import { authAtom } from "@/sync/auth";
import { useGoogleAccount } from "@/sync/use-google-account";
import { syncStatusAtom, type SyncStatus } from "@/sync/use-sync";
import { useTranslation, type TranslationsKey } from "@/translations";
import { Icon } from "@/ui/icon";

/**
 * Sync: one floating button, and everything sync has to say behind it.
 *
 * It is its own control rather than a line inside the info panel because it is
 * the only piece of chrome that answers "is my work anywhere but here". A state
 * you have to open the *info* panel to read is a state nobody reads, and a
 * board that looks backed up and is not is only discovered on the day it
 * matters.
 *
 * So the icon is never hidden and always carries the state, while the words —
 * which account, how full it is, what went wrong, sign in, sign out — live in
 * the popup. The one-glance answer costs nothing to look at; the detail costs
 * a click, and only when something needs deciding.
 */

interface Appearance {
  icon: string;
  label: TranslationsKey;
  tone: string;
}

function appearanceFor(status: SyncStatus, connectable: boolean): Appearance {
  switch (status.state) {
    // Sky is the selection and focus accent (see the palette in
    // docs/ui-guidelines.md). Spending it on a status makes a button in the
    // middle of a round look like the thing the user just clicked into. The
    // glyph already says which state this is.
    case "syncing":
      return {
        icon: "cloud_sync",
        label: "sync.syncing",
        tone: "text-neutral-400",
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

/** Bytes as something readable, not as a number with ten digits. */
function bytes(value: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let scaled = value;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit++;
  }
  return `${scaled < 10 ? scaled.toFixed(1) : Math.round(scaled)} ${units[unit]}`;
}

const action =
  "w-full rounded-md border border-neutral-800 px-2 py-1.5 text-neutral-300 transition-colors hover:border-neutral-700 hover:text-neutral-100 focus-visible:outline-2 focus-visible:outline-sky-500 disabled:opacity-50";

export function SyncButton({ onSync }: { onSync: () => void }) {
  const { t } = useTranslation();
  const status = useAtomValue(syncStatusAtom);
  const auth = useAtomValue(authAtom);
  const { state, isConfigured, signIn, signOut } = useGoogleAccount();

  const connectable = isConfigured && auth.status !== "connecting";
  const { icon, label, tone } = appearanceFor(status, connectable);

  return (
    <Popover.Root>
      <Popover.Trigger
        data-testid="sync-button"
        data-sync-state={status.state}
        aria-label={t(label)}
        // The message, not the label: a failure that only says "failed" sends
        // whoever hits it to the console. The popup repeats it, but a tooltip
        // is cheaper than a click when all you wanted was to check.
        title={status.state === "failed" ? status.message : t(label)}
        className={`glass pointer-events-auto flex h-9 w-9 items-center justify-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-sky-500 ${tone}`}
      >
        <Icon name={icon} size={18} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="end">
          <Popover.Popup
            data-testid="sync-panel"
            className="glass-strong w-72 rounded-lg p-3 text-sm focus:outline-none"
          >
            <Popover.Title className="mb-2 font-bold text-neutral-100">
              {t("sync.title")}
            </Popover.Title>

            {!isConfigured ? (
              // Said out loud rather than hidden. A sign-in button that cannot
              // work is worse than none, and a missing one is a mystery to
              // whoever built it.
              <p
                data-testid="sync-unconfigured"
                className="text-xs text-neutral-500"
              >
                {t("sync.unconfigured")}
              </p>
            ) : state.status === "signedIn" ? (
              <div data-testid="sync-signed-in">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="truncate text-neutral-300">
                    {state.session.email ?? "—"}
                  </span>
                  <button
                    data-testid="sync-sign-out"
                    className="shrink-0 text-neutral-500 underline-offset-2 hover:text-neutral-200 hover:underline"
                    onClick={() => void signOut()}
                  >
                    {t("sync.signOut")}
                  </button>
                </div>
                {state.session.storageUsed !== undefined && (
                  <p className="mt-1 font-mono text-xs text-neutral-500 tabular-nums">
                    {bytes(state.session.storageUsed)}
                    {state.session.storageLimit !== undefined &&
                      ` / ${bytes(state.session.storageLimit)}`}
                  </p>
                )}
                <button
                  data-testid="sync-now"
                  disabled={status.state === "syncing"}
                  onClick={onSync}
                  className={`mt-3 ${action}`}
                >
                  {t("sync.now")}
                </button>
              </div>
            ) : (
              <>
                <button
                  data-testid="sync-sign-in"
                  disabled={state.status === "connecting"}
                  onClick={() => void signIn()}
                  className={action}
                >
                  {t(
                    state.status === "connecting"
                      ? "sync.connecting"
                      : "sync.connect",
                  )}
                </button>
                {state.status === "failed" && (
                  <p
                    data-testid="sync-error"
                    className="mt-1 text-xs text-amber-500"
                  >
                    {state.error}
                  </p>
                )}
              </>
            )}

            {/* Where the last round got to. A failure is worth colour;
                success is not. */}
            <p
              data-testid="sync-state"
              data-sync-state={status.state}
              className={
                status.state === "failed"
                  ? "mt-2 text-xs text-amber-500/80"
                  : "mt-2 text-xs text-neutral-500"
              }
            >
              {status.state === "syncing"
                ? t("sync.syncing")
                : status.state === "idle"
                  ? t("sync.idle")
                  : status.state === "failed"
                    ? status.message
                    : t("sync.off")}
            </p>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
