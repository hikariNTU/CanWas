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

// Read through `?.` because this module is also loaded outside Vite: the sync
// tests that run in Node import it directly, and there `import.meta.env` does
// not exist at all — a plain read throws at module scope, before any test can
// say what it wanted to test. In a real build the field is always there.
const CLIENT_ID =
  (import.meta.env as ImportMetaEnv | undefined)?.VITE_GOOGLE_CLIENT_ID ?? "";

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
  name?: string;
  /** URL of the account picture, hosted by Google. */
  photo?: string;
  storageUsed?: number;
  storageLimit?: number;
}

/**
 * What is remembered about the last account between sessions.
 *
 * Not a credential and not usable as one — it opens nothing and proves nothing.
 * It exists so a signed-out browser can say *who* it would reconnect as, which
 * turns a generic Connect button into a recognisable one, and matters most on
 * the machine where two Google accounts are both plausible.
 *
 * It is ordinary personal data on a shared computer, so signing out erases it.
 */
export interface RememberedAccount {
  email?: string;
  name?: string;
  photo?: string;
}

export type AuthState =
  | { status: "unconfigured" }
  | { status: "signedOut" }
  | { status: "connecting" }
  | { status: "signedIn"; session: Session }
  /** Had a token, no longer does. Distinct from `signedOut` because the fix is
   *  one click with no consent screen, and saying so is the whole difference
   *  between an annoyance and a mystery. */
  | { status: "expired" }
  | { status: "failed"; error: string };

export const authAtom = atom<AuthState>(
  CLIENT_ID === "" ? { status: "unconfigured" } : { status: "signedOut" },
);

/** True once a client id has been configured at build time. */
export const isConfigured = CLIENT_ID !== "";

let client: TokenClient | null = null;
let pending:
  | ((response: {
      token?: string;
      expiresIn?: number;
      /** Google's own error identifier, e.g. `access_denied`, `popup_closed`. */
      code?: string;
      message?: string;
    }) => void)
  | null = null;

/**
 * A failed sign-in, with Google's error code intact.
 *
 * The code is the difference between "this browser no longer has a grant" and
 * "someone closed the popup", and the caller has to tell those apart: only the
 * first is a reason to forget which account was here (D108).
 */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Asks Google for an access token.
 *
 * **This must be called from a user gesture.** Google's token model has no
 * silent path: "only the dialog UX is supported", and every token comes from a
 * popup that a browser will block unless a click opened it. There is no refresh
 * token in a browser flow either — nothing to exchange in the background.
 *
 * The prompt is always `""`, which is Google's *default*, not its silent mode:
 * a chooser or a consent screen appears exactly when Google needs one, and not
 * otherwise. Asking for `"consent"` ourselves used to be how a first
 * connection was handled, which meant a second device asked again for consent
 * the account had already given — a redundant consent screen and a redundant
 * security email, for a grant that was never missing (D108).
 */
export async function requestToken(): Promise<Session> {
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
        code: response.error,
        message: response.error_description ?? response.error,
      });
      pending = null;
    },
    error_callback: (error) => {
      pending?.({
        code: error.type,
        message: error.message ?? error.type ?? "sign-in failed",
      });
      pending = null;
    },
  });

  // Which account, when this browser already knows. Without it, Google shows
  // its account chooser to anyone signed into more than one account — every
  // time, however often they have already chosen, because the default prompt
  // only suppresses the chooser when there is no ambiguity to resolve. The
  // hint is the answer to that ambiguity (D82).
  //
  // A browser only knows once it has connected, and signing out forgets. So
  // someone deliberately choosing a different account is never hinted back at
  // the one they left — there is nothing left to hint with.
  const hint = lastAccount()?.email ?? "";

  const result = await new Promise<{
    token?: string;
    expiresIn?: number;
    code?: string;
    message?: string;
  }>((resolve) => {
    pending = resolve;
    client!.requestAccessToken({ prompt: "", ...(hint ? { hint } : {}) });
  });

  if (!result.token) {
    throw new AuthError(result.message ?? "sign-in was dismissed", result.code);
  }
  return {
    accessToken: result.token,
    // A minute short of the real expiry, so a request started just before the
    // boundary does not arrive just after it.
    expiresAt: Date.now() + ((result.expiresIn ?? 3600) - 60) * 1000,
  };
}

/**
 * A flag, not a credential: "this browser has connected before".
 *
 * The token still never touches disk. What is stored is a boolean, which tells
 * the app it is worth *asking* Google for a token silently on load rather than
 * showing a Connect button to someone who has already connected. Google
 * answers from a grant it holds and a session cookie on its own origin, and
 * neither of those is anything this app could have written.
 *
 * Worth having because the alternative is worse than a click: sync that is off
 * until noticed is sync that is off, and a board edited before someone thinks
 * to reconnect is a board that has to be merged later instead of now.
 */
const ACCOUNT_KEY = "canwas.drive.account";

/**
 * The last account this browser connected with, if any.
 *
 * Its presence is also the answer to "has this browser connected before",
 * which decides two things: whether the button offers to *reconnect* rather
 * than connect, and whether the token request can pass `prompt: ""` and skip
 * the consent screen. Neither grants anything — at worst a request is refused.
 */
export function lastAccount(): RememberedAccount | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    // Anything could be under that key — another version of this app, or a
    // hand-edited value. Only strings survive.
    if (parsed === null || typeof parsed !== "object") {
      return null;
    }
    const { email, name, photo } = parsed as Record<string, unknown>;
    return {
      email: typeof email === "string" ? email : undefined,
      name: typeof name === "string" ? name : undefined,
      photo: typeof photo === "string" ? photo : undefined,
    };
  } catch {
    // Storage can be denied outright, and the value can be malformed. Not
    // remembering costs one consent screen.
    return null;
  }
}

export function hasConnectedBefore(): boolean {
  return lastAccount() !== null;
}

export function rememberAccount(account: RememberedAccount | null): void {
  try {
    if (account) {
      localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
    } else {
      localStorage.removeItem(ACCOUNT_KEY);
    }
  } catch {
    // Nothing to do and nothing worth saying: the cost is one extra dialog.
  }
}

/** Whether a session still has time on it. */
export function isLive(session: Session): boolean {
  return session.expiresAt > Date.now();
}
