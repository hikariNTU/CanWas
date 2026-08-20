import { useAtom } from "jotai";
import { useCallback, useEffect, useRef } from "react";

import {
  authAtom,
  hasConnectedBefore,
  isConfigured,
  rememberConnected,
  requestToken,
  revoke,
  type Session,
} from "@/sync/auth";
import { fetchAccount } from "@/sync/drive";

/**
 * Signing in and out, and nothing else.
 *
 * What to do with the token afterwards belongs to `useSync`; keeping the two
 * apart is what lets sync be tested against a fake remote with no Google in
 * sight. Renewal is not here either — it happens under the transport, where a
 * 401 is visible (`renewToken`).
 */
export function useGoogleAccount() {
  const [state, setState] = useAtom(authAtom);

  const signIn = useCallback(async () => {
    setState({ status: "connecting" });
    try {
      // Consent is asked for explicitly here. A silent request works only once
      // the account has already agreed, and this is the moment it has not.
      // It is also the only call in a real user gesture, which is what lets it
      // open a window at all.
      const session = await requestToken("consent");
      // Who signed in, and how full their Drive is. Failing this is not failing
      // the sign-in: the token is valid either way, and the name is decoration.
      const account = await fetchAccount(session).catch(() => ({}));
      rememberConnected(true);
      setState({ status: "signedIn", session: { ...session, ...account } });
    } catch (error) {
      setState({
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [setState]);

  /**
   * Picks the connection back up on load, without a dialog and without a click.
   *
   * `prompt: ""` asks Google to answer from the grant it already holds. If it
   * can, nothing is shown at all and sync is live before the board finishes
   * rendering. If it cannot — the grant was revoked, the Google session
   * expired, a password changed elsewhere — it fails, and the failure is
   * surfaced rather than swallowed: a Connect button sitting there quietly is
   * indistinguishable from sync working.
   *
   * Only attempted where a grant plausibly exists. A silent request that has to
   * become a window would be a window opened outside a user gesture, which the
   * browser blocks — so a browser that has never connected is left alone.
   */
  const resumed = useRef(false);
  useEffect(() => {
    if (
      resumed.current ||
      !isConfigured ||
      !hasConnectedBefore() ||
      state.status !== "signedOut"
    ) {
      return;
    }
    resumed.current = true;
    setState({ status: "connecting" });
    void (async () => {
      try {
        const session = await requestToken("");
        const account = await fetchAccount(session).catch(() => ({}));
        setState({ status: "signedIn", session: { ...session, ...account } });
      } catch (error) {
        // The grant is gone. Forgetting the flag stops this from retrying on
        // every load, and the next connection is a deliberate one.
        rememberConnected(false);
        setState({
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  }, [setState, state.status]);

  const signOut = useCallback(async () => {
    if (state.status === "signedIn") {
      // Revoked rather than forgotten, so the grant does not outlive the
      // session on Google's side as well as ours.
      await revoke(state.session).catch(() => undefined);
    }
    rememberConnected(false);
    setState({ status: "signedOut" });
  }, [setState, state]);

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
    signOut: () => Promise<void>;
    session: Session | undefined;
  };
}
