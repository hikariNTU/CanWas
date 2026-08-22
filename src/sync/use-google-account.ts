import { useAtom } from "jotai";
import { useCallback } from "react";

import {
  AuthError,
  authAtom,
  isConfigured,
  rememberAccount,
  requestToken,
  type Session,
} from "@/sync/auth";
import { fetchAccount } from "@/sync/drive";

/**
 * Signing in and out, and nothing else.
 *
 * What to do with the token afterwards belongs to `useSync`; keeping the two
 * apart is what lets sync be tested against a fake remote with no Google in
 * sight.
 *
 * There is no renewal, here or anywhere: Google's token model has no silent
 * path, so a token can only ever be asked for from inside a click. An expired
 * session becomes a Reconnect button rather than a background request.
 *
 * Signing out is local. It does not revoke — see `signOut` below (D108).
 */

/**
 * Errors that mean the grant is gone, as opposed to the attempt going wrong.
 *
 * Only these are worth forgetting an account over. A closed popup or a dead
 * network says nothing about whether Google still holds a grant, and forgetting
 * on those manufactures the very state that costs the next sign-in a consent
 * screen.
 */
const GRANT_FAILURES = new Set([
  "access_denied",
  "interaction_required",
  "invalid_grant",
]);
export function useGoogleAccount() {
  const [state, setState] = useAtom(authAtom);

  const signIn = useCallback(async () => {
    setState({ status: "connecting" });
    try {
      // Google decides what the popup shows. An account that has granted
      // already gets a window that opens and closes; one that has not gets the
      // consent screen. Asking for consent ourselves would demand it a second
      // time on a second device, for a grant that was never missing (D108).
      //
      // This runs inside the click. It has to — Google's token model supports
      // no other UX, so a token requested anywhere else is a popup the browser
      // blocks.
      const session = await requestToken();
      // Who signed in, and how full their Drive is. Failing this is not failing
      // the sign-in: the token is valid either way, and the name is decoration.
      const account: Awaited<ReturnType<typeof fetchAccount>> =
        await fetchAccount(session).catch(() => ({}));
      rememberAccount({
        email: account.email,
        name: account.name,
        photo: account.photo,
      });
      setState({ status: "signedIn", session: { ...session, ...account } });
    } catch (error) {
      // Forget the account only when Google says the grant is the problem.
      // Anything else — a dismissed popup, a blocked one, no network — leaves
      // the memory alone, so the next click is still the one-window kind.
      if (
        error instanceof AuthError &&
        error.code &&
        GRANT_FAILURES.has(error.code)
      ) {
        rememberAccount(null);
      }
      setState({
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [setState]);

  /**
   * Forgets. Does not revoke.
   *
   * Revoking ends the grant on Google's side, and a grant is held per account,
   * not per browser: signing out of a laptop used to log every other device out
   * of the account's grant too, so the next sign-in anywhere paid for a fresh
   * consent screen and Google mailed a fresh security alert about it. That is
   * the wrong blast radius for a button that says Sign out (D108).
   *
   * What is left behind: the access token stays valid on Google's side until it
   * expires, up to an hour. Nothing here holds it — it lived in memory and this
   * drops the only reference — so "signed out" means this browser forgot, not
   * that the token is dead. Anyone wanting the grant itself gone has the link
   * beside this button.
   */
  const signOut = useCallback(() => {
    // Signing out erases who was here. It is ordinary personal data, and this
    // is a browser someone else may use next.
    rememberAccount(null);
    setState({ status: "signedOut" });
  }, [setState]);

  return {
    state,
    isConfigured,
    signIn,
    signOut,
    session: state.status === "signedIn" ? state.session : undefined,
  } satisfies {
    state: typeof state;
    isConfigured: boolean;
    signIn: () => Promise<void>;
    signOut: () => void;
    session: Session | undefined;
  };
}
