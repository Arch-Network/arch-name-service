import { useCallback, useEffect, useState } from "react";

export type ConnectedAccount = {
  address: string;
  publicKey: string;
  archAddress: string;
};

function hasArchProvider(): boolean {
  return typeof window !== "undefined" && Boolean(window.arch);
}

export function useArchWallet() {
  const [account, setAccount] = useState<ConnectedAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  // Extension injects after document_start; track availability in state so we
  // re-render when `arch-wallet#initialized` fires (or a short poll succeeds).
  const [available, setAvailable] = useState(hasArchProvider);

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
    const markAvailable = () => {
      if (!hasArchProvider()) return;
      setAvailable(true);
      void refresh();
    };

    markAvailable();
    window.addEventListener("arch-wallet#initialized", markAvailable);

    // Race: content script may inject after first paint without the event
    // being observed (SPA already mounted). Poll briefly.
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      markAvailable();
      if (hasArchProvider() || attempts >= 40) {
        window.clearInterval(timer);
      }
    }, 250);

    return () => {
      window.removeEventListener("arch-wallet#initialized", markAvailable);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      if (!window.arch) {
        throw new Error("Arch Wallet extension not detected. Unlock the extension and refresh this page.");
      }
      const next = await window.arch.connect();
      setAccount(next);
      setAvailable(true);
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
