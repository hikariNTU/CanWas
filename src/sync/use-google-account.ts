import { useAtom } from "jotai";
import { useCallback } from "react";

import {
  authAtom,
  isConfigured,
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
      const session = await requestToken("consent");
      // Who signed in, and how full their Drive is. Failing this is not failing
      // the sign-in: the token is valid either way, and the name is decoration.
      const account = await fetchAccount(session).catch(() => ({}));
      setState({ status: "signedIn", session: { ...session, ...account } });
    } catch (error) {
      setState({
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [setState]);

  const signOut = useCallback(async () => {
    if (state.status === "signedIn") {
      // Revoked rather than forgotten, so the grant does not outlive the
      // session on Google's side as well as ours.
      await revoke(state.session).catch(() => undefined);
    }
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
