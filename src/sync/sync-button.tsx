import { Popover } from "@base-ui/react/popover";
import clsx from "clsx";
import { useAtomValue } from "jotai";
import { useState } from "react";

import { authAtom, lastAccount, type RememberedAccount } from "@/sync/auth";
import { useGoogleAccount } from "@/sync/use-google-account";
import { syncStatusAtom, type SyncStatus } from "@/sync/use-sync";
import { useTranslation, type TranslationsKey } from "@/translations";
import { DriveMark } from "@/ui/drive-mark";
import { Icon } from "@/ui/icon";
import { PanelButton, PanelRule } from "@/ui/panel";
import { Tip } from "@/ui/tooltip";

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
 *
 * The one exception is reconnecting. Google's token model has no silent path
 * (see docs/sync.md), so an hour or a reload always ends in a click — and
 * putting that click behind the popup makes it two. A browser that has
 * connected before gets the button beside the icon, wearing the face of the
 * account it would reconnect as.
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
    // The one state worth colouring, because it is the one people look for
    // without meaning to: work is somewhere other than this machine. Green
    // reads at the edge of vision, which grey does not, and it is the only
    // green in the app.
    case "idle":
      return {
        icon: "cloud_done",
        label: "sync.idle",
        tone: "text-emerald-400 hover:text-emerald-300",
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

/**
 * The account picture, or its initial.
 *
 * The picture is hosted by Google and can fail for reasons that have nothing to
 * do with this app — an account with no photo, a network that blocks it, a link
 * that has aged out. A broken image icon where a face should be looks like a
 * bug in the connection, so the fallback is a letter, which always works.
 *
 * `no-referrer` because Google's avatar host refuses some requests that carry
 * one, and this page has no reason to introduce itself to fetch a picture.
 */
function Avatar({
  account,
  size,
  className,
}: {
  account: RememberedAccount;
  /** Fixed pixels. Omit and pass `className` when the size has to follow a
   * media query — an inline style would win over the utility and freeze it. */
  size?: number;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const box = size === undefined ? undefined : { width: size, height: size };

  if (account.photo && !broken) {
    return (
      <img
        data-testid="sync-avatar"
        src={account.photo}
        alt=""
        style={box}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className={clsx("shrink-0 rounded-full object-cover", className)}
      />
    );
  }
  const initial = (account.name ?? account.email ?? "?")
    .trim()
    .charAt(0)
    .toUpperCase();
  return (
    <span
      data-testid="sync-avatar"
      aria-hidden
      // With a fixed box the initial is scaled from it. With a class-sized box
      // there is no number to scale from, so it takes a plain step the caller
      // can override — this is the fallback for a missing photo, not the
      // normal case.
      style={size === undefined ? undefined : { ...box, fontSize: size * 0.45 }}
      className={clsx(
        "flex shrink-0 items-center justify-center rounded-full bg-neutral-700 font-bold text-neutral-300",
        size === undefined && "text-[10px] pointer-coarse:text-xs",
        className,
      )}
    >
      {initial || "?"}
    </span>
  );
}

export function SyncButton({ onSync }: { onSync: () => void }) {
  const { t } = useTranslation();
  const status = useAtomValue(syncStatusAtom);
  const auth = useAtomValue(authAtom);
  const { state, isConfigured, signIn, signOut } = useGoogleAccount();

  const connectable = isConfigured && auth.status !== "connecting";
  const { icon, label, tone } = appearanceFor(status, connectable);

  // A failed or expired sign-in leaves no transport, which makes the status
  // "off" — and off looks like an invitation rather than like something that
  // stopped working. All three wear the same mark.
  const failure =
    status.state === "failed"
      ? status.message
      : auth.status === "failed"
        ? auth.error
        : auth.status === "expired"
          ? t("sync.expired")
          : null;

  // Who this browser would reconnect as. Remembered across reloads, and worth
  // nothing to an attacker: it opens no door, it only names one.
  const remembered = state.status === "signedIn" ? null : lastAccount();

  return (
    <Popover.Root>
      {/* The message, not the label: a failure that only says "failed" sends
            whoever hits it to the console. The popup repeats it, but a tooltip
            is cheaper than a click when all you wanted was to check. */}
      <Tip label={failure ?? t(label)}>
        <Popover.Trigger
          data-testid="sync-button"
          data-sync-state={status.state}
          data-sync-failed={failure ? "" : undefined}
          aria-label={failure ?? t(label)}
          className={`pointer-events-auto relative flex h-9 w-9 items-center justify-center rounded-full glass transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-500 pointer-coarse:h-11 pointer-coarse:w-11 ${tone}`}
        >
          <Icon name={icon} size={18} />
          {failure && (
            // Colour rather than a glyph, and on top rather than instead of
            // one: the icon still has to say which state sync is in, and a
            // badge is legible at a glance across a board without being read.
            <span
              data-testid="sync-error-dot"
              aria-hidden
              className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-400 ring-2 ring-neutral-900"
            />
          )}
        </Popover.Trigger>
      </Tip>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="end">
          <Popover.Popup
            data-testid="sync-panel"
            className="w-72 rounded-lg glass-strong p-3 text-sm focus:outline-none"
          >
            {/* State sits on the title line rather than under the panel.
                  It answers the question the panel is opened to ask, and at
                  the bottom it was the last thing read instead of the first —
                  below even Sync now, which is the button you press because of
                  what it says. Only the label lives here: a failure's actual
                  message is a sentence, and a sentence in a title row either
                  wraps it or gets cut, so it stays in the body below. */}
            <Popover.Title className="mb-3 flex items-center gap-2 font-bold text-neutral-100">
              <DriveMark size={16} />
              {t("sync.title")}
              <span
                data-testid="sync-state"
                data-sync-state={status.state}
                className={clsx(
                  "ml-auto text-xs font-normal",
                  status.state === "failed"
                    ? "text-amber-500/80"
                    : "text-neutral-500",
                )}
              >
                {status.state === "syncing"
                  ? t("sync.syncing")
                  : status.state === "idle"
                    ? t("sync.idle")
                    : status.state === "failed"
                      ? t("sync.failed")
                      : t("sync.off")}
              </span>
            </Popover.Title>

            {!isConfigured ? (
              // Said out loud rather than hidden. A sign-in button that
              // cannot work is worse than none, and a missing one is a
              // mystery to whoever built it.
              <p
                data-testid="sync-unconfigured"
                className="text-xs text-neutral-500"
              >
                {t("sync.unconfigured")}
              </p>
            ) : state.status === "signedIn" ? (
              <div data-testid="sync-signed-in">
                <Identity
                  account={state.session}
                  caption={t("sync.grantedTo")}
                  unknown={t("sync.accountUnknown")}
                />
                <Quota
                  used={state.session.storageUsed}
                  limit={state.session.storageLimit}
                />
              </div>
            ) : (
              <>
                {/* The account is named before the button that would reach
                      it, because on a machine with two Google accounts the
                      question is never "connect?" but "connect as whom?". */}
                {remembered && (
                  <div className="mb-3">
                    <Identity
                      account={remembered}
                      caption={t("sync.lastConnected")}
                      unknown={t("sync.accountUnknown")}
                    />
                  </div>
                )}
                <PanelButton
                  data-testid="sync-sign-in"
                  icon="login"
                  disabled={state.status === "connecting"}
                  onClick={() => void signIn()}
                >
                  {t(
                    state.status === "connecting"
                      ? "sync.connecting"
                      : remembered
                        ? "sync.reconnect"
                        : "sync.connect",
                  )}
                </PanelButton>
                {auth.status === "expired" && (
                  <p className="mt-1 text-xs text-neutral-500">
                    {t("sync.expiredWhy")}
                  </p>
                )}
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

            {/* Available whenever a transport is live, which is not the same
                  as being signed in — the fake remote needs no account, and a
                  round on demand is the thing you press before closing a
                  laptop. Gating this on the account left a build with working
                  sync and no way to ask for one. */}
            {status.state !== "off" && (
              <PanelButton
                data-testid="sync-now"
                icon="sync"
                className="mt-3"
                disabled={status.state === "syncing"}
                onClick={onSync}
              >
                {t("sync.now")}
              </PanelButton>
            )}

            {/* Why the last round failed, in its own words. Kept out of the
                  title row, where a sentence has nowhere to go. */}
            {status.state === "failed" && (
              <p
                data-testid="sync-message"
                className="mt-2 text-xs text-amber-500/80"
              >
                {status.message}
              </p>
            )}

            {/* Last, behind a rule, and the only thing below it. It was
                  sitting between the account and Sync now, where it read as
                  another step in using sync rather than as the end of it — and
                  a bare underlined word directly above the primary action is a
                  misclick waiting to revoke a token. */}
            {state.status === "signedIn" && (
              <>
                <PanelRule />
                <PanelButton
                  data-testid="sync-sign-out"
                  icon="logout"
                  onClick={() => void signOut()}
                  className="text-xs text-neutral-500"
                >
                  {t("sync.signOut")}
                </PanelButton>
              </>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** A face, a name and an address — as much of the three as is known. */
function Identity({
  account,
  caption,
  unknown,
}: {
  account: RememberedAccount;
  caption: string;
  unknown: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Avatar account={account} size={36} />
      <div className="min-w-0">
        <p className="text-[10px] tracking-wide text-neutral-500 uppercase">
          {caption}
        </p>
        <p
          data-testid="sync-account"
          className="truncate font-bold text-neutral-200"
        >
          {account.name ?? account.email ?? unknown}
        </p>
        {/* Only when it adds something. Repeating the address under itself is
            noise, and the panel is 18rem wide. */}
        {account.name && account.email && (
          <p className="truncate text-xs text-neutral-500">{account.email}</p>
        )}
      </div>
    </div>
  );
}

/** How full the Drive is, as a bar — a number alone means nothing at a glance. */
function Quota({ used, limit }: { used?: number; limit?: number }) {
  if (used === undefined) {
    return null;
  }
  const fraction = limit ? Math.min(used / limit, 1) : null;
  return (
    <div className="mt-3">
      {fraction !== null && (
        <div className="h-1 overflow-hidden rounded-full bg-white/10">
          <div
            data-testid="sync-quota-bar"
            // Amber rather than red near the top: a full Drive is not an error
            // yet, it is a thing to know before it becomes one.
            className={`h-full ${fraction > 0.9 ? "bg-amber-400" : "bg-neutral-500"}`}
            style={{ width: `${(fraction * 100).toFixed(1)}%` }}
          />
        </div>
      )}
      <p className="mt-1 font-mono text-xs text-neutral-500 tabular-nums">
        {bytes(used)}
        {limit !== undefined && ` / ${bytes(limit)}`}
      </p>
    </div>
  );
}

/**
 * Reconnect, on its own line under the icons.
 *
 * Beside the icon rather than inside the popup, because reconnecting is not a
 * decision — there is one account and one button — so making it cost a click to
 * reach, then a click to press, is a tax on the most common thing that happens
 * after a reload.
 *
 * On its own row because it is the widest piece of chrome in the corner, and
 * the board's name is in the opposite one: on a phone the two met in the middle
 * and the name lost, truncated to a few characters by a button that is only
 * there some of the time.
 */
export function ReconnectPill() {
  const { state, isConfigured, signIn } = useGoogleAccount();
  const { t } = useTranslation();
  const remembered = state.status === "signedIn" ? null : lastAccount();

  // Said in words, because the tooltip says it in a picture and a screen reader
  // gets none of it. Base UI keeps the popup out of the accessibility tree, so
  // the label on the control is the only place this exists.
  const reconnectLabel = remembered
    ? [t("sync.reconnectAs"), remembered.name, remembered.email]
        .filter(Boolean)
        .join(" ")
    : t("sync.reconnect");

  if (!isConfigured || !remembered) {
    return null;
  }

  return (
    <Tip
      label={
        // The whole account, not just the address. The button already says
        // "Reconnect"; what it cannot show in the width available is who
        // that would be, which is the only question worth asking on a
        // machine with two Google accounts signed in.
        <Identity
          account={remembered}
          caption={t("sync.reconnectAs")}
          unknown={t("sync.accountUnknown")}
        />
      }
    >
      <button
        data-testid="sync-reconnect"
        aria-label={reconnectLabel}
        disabled={state.status === "connecting"}
        onClick={() => void signIn()}
        className="pointer-events-auto flex h-9 items-center gap-1.5 rounded-full glass pr-2.5 pl-1.5 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-500 disabled:opacity-50 pointer-coarse:h-11 pointer-coarse:gap-2 pointer-coarse:pr-3 pointer-coarse:pl-2"
      >
        {/* Grows with the pill. At 44px tall a 22px avatar sits in the
            middle of a lot of glass, with the left padding reading as half
            the right. */}
        <Avatar
          account={remembered}
          className="size-[22px] pointer-coarse:size-7"
        />
        {/* A face and a warning rather than the word "Reconnect". The word is
            the widest thing in this corner and it says the least: the face
            answers "as whom", which is the only question on a machine with two
            accounts, and the triangle says this needs attention. The full
            sentence is still on the button — as its `aria-label`, and in the
            tooltip — so nothing is lost to anyone who cannot see the glyphs. */}
        <Icon
          name={state.status === "connecting" ? "sync" : "warning"}
          size={16}
          className={clsx(
            state.status === "connecting"
              ? "animate-spin text-neutral-400"
              : "text-amber-400",
          )}
        />
      </button>
    </Tip>
  );
}
