import { useCallback, useState } from "react";
import { adoptCurrentArchAccount, reconnectArchWallet } from "../lib/ans";
import type { WalletStatusAction } from "../lib/wallet-status";
import { useArchWallet } from "./useArchWallet";

export type WalletRecoveryResult = { ok: true } | { ok: false; error: unknown };

/**
 * Runs the one-step recovery for a blocked wallet state.
 *
 * `unlock` and `connect` are the same call on purpose: the extension's
 * `connect()` is its prompt for both — the background keeps the request
 * pending and opens Approve, which shows the Unlock screen first when the
 * wallet is locked. They differ only in what the button promises.
 * `reconnect` additionally drops the existing site connection so the user
 * can rebind the origin to another account. `adopt` is the opposite of
 * that: it keeps the connection and takes the account the wallet is
 * already offering, which is what resolves an account mismatch without
 * asking the user to choose. `retry` re-reads state without prompting.
 * `reload` never touches the provider: a dead extension context can only
 * be cleared by re-injecting it, which means reloading the document.
 *
 * `unlock` and `connect` reach the provider synchronously, in the same
 * turn as the click. The others are recovery paths that already have to
 * read state first, so they queue like any other request.
 */
export function useWalletRecovery() {
  const { connect, refresh, bumpConnectEpoch, openWalletPicker } = useArchWallet();
  const [working, setWorking] = useState<WalletStatusAction | null>(null);

  const run = useCallback(
    async (action: WalletStatusAction): Promise<WalletRecoveryResult> => {
      if (action === "install") {
        openWalletPicker();
        return { ok: true };
      }
      if (action === "choose_wallet") {
        openWalletPicker();
        return { ok: true };
      }
      if (action === "reload") {
        setWorking(action);
        window.location.reload();
        return { ok: true };
      }
      if (action === "retry") {
        setWorking(action);
        try {
          const status = await refresh();
          return status.state === "connected"
            ? { ok: true }
            : { ok: false, error: new Error(`Arch Wallet is ${status.state.replace(/_/g, " ")}.`) };
        } finally {
          setWorking(null);
        }
      }
      // Multi-wallet connect opens the picker; unlock still goes straight to
      // Arch Wallet (locked keystore has nothing else to offer).
      if (action === "connect") {
        openWalletPicker();
        return { ok: true };
      }
      if (action === "unlock") {
        const pending = connect("unlock");
        bumpConnectEpoch();
        setWorking(action);
        try {
          await pending;
          return { ok: true };
        } catch (error) {
          return { ok: false, error };
        } finally {
          setWorking(null);
        }
      }
      bumpConnectEpoch();
      setWorking(action);
      try {
        if (action === "adopt") {
          await adoptCurrentArchAccount();
        } else {
          await reconnectArchWallet();
        }
        await refresh();
        return { ok: true };
      } catch (error) {
        return { ok: false, error };
      } finally {
        setWorking(null);
      }
    },
    [bumpConnectEpoch, connect, openWalletPicker, refresh],
  );

  return { working, run };
}
