import { useGoogleAccount } from "@/sync/use-google-account";
import { useTranslation } from "@/translations";

/**
 * Sign in, sign out, and an honest statement of what that currently buys.
 *
 * It lives in the info panel rather than the menu because that is where the
 * rest of "what this app is doing with your stuff" already is — storage,
 * weights, build.
 */

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

export function GoogleAccount() {
  const { t } = useTranslation();
  const { state, isConfigured, signIn, signOut } = useGoogleAccount();

  if (!isConfigured) {
    // Said out loud rather than hidden. A sign-in button that cannot work is
    // worse than none, and a missing one is a mystery to whoever built it.
    return (
      <p
        data-testid="sync-unconfigured"
        className="py-1 text-xs text-neutral-500"
      >
        {t("sync.unconfigured")}
      </p>
    );
  }

  if (state.status === "signedIn") {
    const { session } = state;
    return (
      <div data-testid="sync-signed-in" className="py-1">
        <div className="flex items-baseline justify-between gap-4">
          <span className="truncate text-neutral-300">
            {session.email ?? "—"}
          </span>
          <button
            data-testid="sync-sign-out"
            className="shrink-0 text-neutral-500 underline-offset-2 hover:text-neutral-200 hover:underline"
            onClick={() => void signOut()}
          >
            {t("sync.signOut")}
          </button>
        </div>
        {session.storageUsed !== undefined && (
          <p className="mt-1 font-mono text-xs text-neutral-500 tabular-nums">
            {bytes(session.storageUsed)}
            {session.storageLimit !== undefined &&
              ` / ${bytes(session.storageLimit)}`}
          </p>
        )}
        {/* The one thing worth saying while sync is unbuilt: being signed in
            has not backed anything up. */}
        <p className="mt-1 text-xs text-amber-500/80">{t("sync.notSyncing")}</p>
      </div>
    );
  }

  return (
    <div className="py-1">
      <button
        data-testid="sync-sign-in"
        disabled={state.status === "connecting"}
        onClick={() => void signIn()}
        className="w-full rounded-md border border-neutral-800 px-2 py-1.5 text-neutral-300 transition-colors hover:border-neutral-700 hover:text-neutral-100 focus-visible:outline-2 focus-visible:outline-sky-500 disabled:opacity-50"
      >
        {t(state.status === "connecting" ? "sync.connecting" : "sync.signIn")}
      </button>
      {state.status === "failed" && (
        <p data-testid="sync-error" className="mt-1 text-xs text-amber-500">
          {state.error}
        </p>
      )}
    </div>
  );
}
