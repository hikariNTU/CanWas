/**
 * Taking the new build, for the case where asking politely is not enough.
 *
 * `updateServiceWorker(true)` is one line and works on iOS. It does not always
 * work on Android, and the reason is a single guard inside workbox-window:
 *
 *     messageSkipWaiting() {
 *       this.registration && this.registration.waiting && messageSW(...)
 *     }
 *
 * The waiting worker is read from the registration object captured when the
 * page registered, and if it is gone the call is a silent no-op — no message,
 * no `controlling` event, no reload, no error. Chrome on Android reaches that
 * state on its own: it freezes and discards workers under memory pressure, and
 * it can activate a waiting worker while the app is backgrounded, at which
 * point the prompt is still on screen with nothing behind the button. The
 * update then appears at the next launch, which is exactly what was reported
 * (D94).
 *
 * So this asks three times, in increasing order of rudeness: the library's own
 * path, then a registration fetched fresh at click time, then a plain reload.
 * The last one is not a fix, it is a guarantee — a button that reloads the page
 * when it cannot do better is still honest, and if the new worker has already
 * taken over in the background that reload is all that was ever needed.
 */
export interface ApplyUpdateOptions {
  /** The library's path, tried first because it is the one built for this. */
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
  /** `navigator.serviceWorker`, absent on a browser without support. */
  container?: ServiceWorkerContainer;
  /** Separated from `location.reload` so a test can watch it. */
  reload: () => void;
  /** How long to wait for the new worker before reloading anyway. */
  timeoutMs?: number;
}

export async function applyUpdate({
  updateServiceWorker,
  container,
  reload,
  timeoutMs = 2000,
}: ApplyUpdateOptions): Promise<void> {
  let reloaded = false;
  const reloadOnce = () => {
    if (!reloaded) {
      reloaded = true;
      reload();
    }
  };

  // The new worker taking control is the good outcome, and it can arrive from
  // any of the three attempts below — so this is armed before any of them.
  container?.addEventListener("controllerchange", reloadOnce, { once: true });

  try {
    await updateServiceWorker(true);
  } catch {
    // A failure here is not the end of the attempt; the paths below do not
    // depend on it.
  }

  try {
    // Fetched now rather than reused from registration time: the whole point
    // is that the captured one may be describing a worker that no longer
    // exists. `update()` re-checks the server, which also covers a prompt that
    // has been sitting on screen long enough for a further build to ship.
    const registration = await container?.getRegistration();
    await registration?.update();
    registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
  } catch {
    // Offline, or the registration is gone. The timeout still answers.
  }

  // Deliberately not cancelled when the message above is sent: the message may
  // reach a worker that never activates, and this button must never be a
  // button that does nothing.
  setTimeout(reloadOnce, timeoutMs);
}
