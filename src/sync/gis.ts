/**
 * The slice of Google Identity Services this app uses, typed by hand.
 *
 * There is an `@types/google.accounts` package; this is four declarations and
 * one script tag, and a dependency that exists to describe someone else's
 * global is a dependency that goes stale on their schedule rather than ours.
 */

export interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

export interface TokenClient {
  requestAccessToken(overrides?: {
    prompt?: "" | "none" | "consent";
    /**
     * Which account to assume, as an email address.
     *
     * Passed per request rather than baked into `initTokenClient`, because the
     * client is created once and cached for the life of the page: a hint fixed
     * at construction could never be changed, and signing out to switch
     * accounts would keep offering the old one.
     */
    hint?: string;
  }): void;
}

interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    prompt?: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: { type?: string; message?: string }) => void;
  }): TokenClient;
  /**
   * Not used, and deliberately (D108).
   *
   * Revoking is account-wide: it ends the grant on every device, not the one
   * that asked. Signing out here forgets locally and leaves the grant alone,
   * and the panel links to Google's own permissions page for anyone who wants
   * the grant itself gone. Kept in this type as the record of that choice.
   */
  revoke(token: string, done?: () => void): void;
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } };
  }
}

const SCRIPT_URL = "https://accounts.google.com/gsi/client";

let loading: Promise<GoogleOAuth2> | null = null;

/**
 * Loads the Google script on demand.
 *
 * Not in `index.html`: it is a third-party request on every page load for a
 * feature most sessions never touch, and this app opens straight onto a board
 * rather than a sign-in screen.
 */
export function loadGoogleOAuth(): Promise<GoogleOAuth2> {
  loading ??= new Promise<GoogleOAuth2>((resolve, reject) => {
    const existing = window.google?.accounts?.oauth2;
    if (existing) {
      resolve(existing);
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      const oauth2 = window.google?.accounts?.oauth2;
      if (oauth2) {
        resolve(oauth2);
      } else {
        reject(new Error("Google Identity Services loaded without oauth2"));
      }
    };
    script.onerror = () => reject(new Error(`could not load ${SCRIPT_URL}`));
    document.head.append(script);
  });
  return loading;
}
