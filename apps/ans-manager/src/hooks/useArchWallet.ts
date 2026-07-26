import { useCallback, useEffect, useState } from "react";

export type ConnectedAccount = {
  address: string;
  publicKey: string;
  archAddress: string;
};

export function useArchWallet() {
  const [account, setAccount] = useState<ConnectedAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const available = typeof window !== "undefined" && Boolean(window.arch);

  const refresh = useCallback(async () => {
    if (!window.arch?.getAccount) return;
    try {
      const next = await window.arch.getAccount();
      setAccount(next);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      if (!window.arch) {
        throw new Error("Arch Wallet extension not detected.");
      }
      const next = await window.arch.connect();
      setAccount(next);
      return next;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      throw err;
    } finally {
      setConnecting(false);
    }
  }, []);

  return { available, account, connect, connecting, error, refresh };
}
