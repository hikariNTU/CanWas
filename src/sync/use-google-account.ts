import { useAtom } from "jotai";
import { useCallback } from "react";

import {
  authAtom,
  hasConnectedBefore,
  isConfigured,
  rememberAccount,
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
 * sight.
 *
 * There is no renewal, here or anywhere: Google's token model has no silent
 * path, so a token can only ever be asked for from inside a click. An expired
 * session becomes a Reconnect button rather than a background request.
 */
export function useGoogleAccount() {
  const [state, setState] = useAtom(authAtom);

  const signIn = useCallback(async () => {
    setState({ status: "connecting" });
    try {
      // A browser that has connected before has a grant already, so Google can
      // answer without an account chooser or a consent screen: the popup opens
      // and closes. The first time, there is nothing to answer from and the
      // consent screen is the point.
      //
      // Either way this runs inside the click. It has to — Google's token model
      // supports no other UX, so a token requested anywhere else is a popup the
      // browser blocks.
      const returning = hasConnectedBefore();
      const session = await requestToken(returning ? "" : "consent");
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
      // A silent attempt that failed means the grant is not what this browser
      // remembered. Forgetting it makes the next click ask properly rather than
      // failing the same way again.
      rememberAccount(null);
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
    // Signing out erases who was here. It is ordinary personal data, and this
    // is a browser someone else may use next.
    rememberAccount(null);
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
