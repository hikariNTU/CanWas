import { atom } from "jotai";

import { loadGoogleOAuth, type TokenClient } from "@/sync/gis";

/**
 * Signing in to Google, with no backend.
 *
 * The token flow needs a client id and no client secret, which is what makes it
 * usable from a static site. The id is not a secret: it identifies the app, and
 * Google enforces which origins may use it.
 *
 * `drive.file` — access limited to files this app creates, in a folder the user
 * can see. Not `drive.appdata`, whose folder nobody can open when something
 * goes wrong (docs/sync.md).
 */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";

/**
 * Tokens live in memory and nowhere else.
 *
 * `localStorage` would survive a reload, which is exactly the property that
 * makes it a bad place for a bearer token: any script that runs on this origin
 * can read it, and it would outlast the tab that earned it. An hour of
 * re-consent is cheaper than that.
 */
export interface Session {
  accessToken: string;
  /** Epoch ms. */
  expiresAt: number;
  email?: string;
  storageUsed?: number;
  storageLimit?: number;
}

export type AuthState =
  | { status: "unconfigured" }
  | { status: "signedOut" }
  | { status: "connecting" }
  | { status: "signedIn"; session: Session }
  | { status: "failed"; error: string };

export const authAtom = atom<AuthState>(
  CLIENT_ID === "" ? { status: "unconfigured" } : { status: "signedOut" },
);

/** True once a client id has been configured at build time. */
export const isConfigured = CLIENT_ID !== "";

let client: TokenClient | null = null;
let pending:
  | ((response: { token?: string; expiresIn?: number; error?: string }) => void)
  | null = null;

/**
 * Asks Google for an access token.
 *
 * `prompt: ""` lets Google skip the consent screen when consent already
 * exists, which is what makes a silent renewal possible — there is no refresh
 * token in a browser flow, so an hour from now this is how the session
 * continues without another dialog.
 */
export async function requestToken(
  prompt: "" | "consent" = "",
): Promise<Session> {
  if (!isConfigured) {
    throw new Error("no Google client id was configured for this build");
  }
  const oauth2 = await loadGoogleOAuth();
  client ??= oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback: (response) => {
      pending?.({
        token: response.access_token,
        expiresIn: response.expires_in,
        error: response.error_description ?? response.error,
      });
      pending = null;
    },
    error_callback: (error) => {
      pending?.({ error: error.message ?? error.type ?? "sign-in failed" });
      pending = null;
    },
  });

  const result = await new Promise<{
    token?: string;
    expiresIn?: number;
    error?: string;
  }>((resolve) => {
    pending = resolve;
    client!.requestAccessToken({ prompt });
  });

  if (!result.token) {
    throw new Error(result.error ?? "sign-in was dismissed");
  }
  return {
    accessToken: result.token,
    // A minute short of the real expiry, so a request started just before the
    // boundary does not arrive just after it.
    expiresAt: Date.now() + ((result.expiresIn ?? 3600) - 60) * 1000,
  };
}

let renewal: Promise<Session> | null = null;

/**
 * A fresh token for an account that has already consented.
 *
 * De-duplicated, because a sync round makes many Drive calls and they can all
 * discover the expiry at once — without this, one lapsed hour would fire a
 * dozen simultaneous token requests and Google would rate-limit the lot.
 *
 * `prompt: ""` means Google answers from the existing grant without showing
 * anything. If the grant is gone this rejects rather than opening a popup the
 * browser would block anyway: renewal is not a user gesture, so it cannot be
 * allowed to turn into a dialog.
 */
export function renewToken(): Promise<Session> {
  renewal ??= requestToken("").finally(() => {
    renewal = null;
  });
  return renewal;
}

export function revoke(session: Session): Promise<void> {
  return loadGoogleOAuth().then(
    (oauth2) =>
      new Promise<void>((resolve) => {
        oauth2.revoke(session.accessToken, resolve);
      }),
  );
}

/** Whether a session still has time on it. */
export function isLive(session: Session): boolean {
  return session.expiresAt > Date.now();
}
