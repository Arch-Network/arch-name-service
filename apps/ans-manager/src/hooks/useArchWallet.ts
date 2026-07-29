import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  selectConnectionIdentity,
  useWallet,
  walletKitStore,
} from "@arch-network/wallet-connect-kit";
import { useStore } from "zustand";
import { providerLabelFor } from "../lib/ans-wallet-port";
import { hasArchProvider, isCurrentWalletPrompt } from "../lib/wallet-gateway";
import {
  probeWalletStatus,
  REPROMPT_AFTER_MS,
  startWalletConnect,
  statusAccount,
  walletStatusError,
  type ConnectedAccount,
  type WalletPromptIntent,
  type WalletStatus,
} from "../lib/wallet-status";
import {
  isBlockedWalletStatus,
  nextPollDelay,
  sameWalletStatus,
  shouldAdoptProbe,
  WALLET_POLL_ATTEMPTS,
} from "../lib/wallet-watch";

export type { ConnectedAccount };

/** How long to wait for the extension to inject its provider, at 250ms. */
const DETECT_ATTEMPTS = 40;

type ArchWalletContextValue = {
  /** Effective wallet state (Arch extension or kit LaserEyes). */
  status: WalletStatus;
  /** Set only while a usable, signable account is connected. */
  account: ConnectedAccount | null;
  /** Reported account — safe to display. */
  reportedAccount: ConnectedAccount | null;
  available: boolean;
  detecting: boolean;
  /** Opens the Arch Wallet approval window. `intent` only changes the copy. */
  connect: (intent?: WalletPromptIntent) => Promise<ConnectedAccount>;
  /** Opens the multi-wallet picker (Arch + LaserEyes). */
  openWalletPicker: () => void;
  closeWalletPicker: () => void;
  walletPickerOpen: boolean;
  connecting: boolean;
  error: string | null;
  refresh: () => Promise<WalletStatus>;
  /** Increments when the user starts Connect / reconnect so views can clear stale notices. */
  connectEpoch: number;
  bumpConnectEpoch: () => void;
};

const ArchWalletContext = createContext<ArchWalletContextValue | null>(null);

function kitLaserEyesAccount(
  kitWallet: { address: string; pubkey: string; archAddress: string; isConnected: boolean } | null,
  providerId: string | null | undefined,
): ConnectedAccount | null {
  if (!kitWallet?.isConnected || !providerId) return null;
  if (providerId === "arch-extension" || providerId.startsWith("turnkey-")) return null;
  return {
    address: kitWallet.address,
    publicKey: kitWallet.pubkey,
    archAddress: kitWallet.archAddress,
    providerId,
    providerLabel: providerLabelFor(providerId),
  };
}

/**
 * Holds the wallet status and keeps it honest.
 *
 * Kit LaserEyes sessions (Xverse / UniSat / …) override the Arch extension
 * probe when connected — fee payer identity comes from the kit store.
 */
export function ArchWalletProvider({ children }: { children: ReactNode }) {
  const [archStatus, setArchStatus] = useState<WalletStatus>({ state: "detecting" });
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectEpoch, setConnectEpoch] = useState(0);
  const [walletPickerOpen, setWalletPickerOpen] = useState(false);
  const mountedRef = useRef(true);

  const { wallet: kitWallet } = useWallet();
  const connectionIdentity = useStore(walletKitStore, selectConnectionIdentity);
  const kitAccount = useMemo(
    () => kitLaserEyesAccount(kitWallet, connectionIdentity?.providerId),
    [kitWallet, connectionIdentity],
  );

  const status: WalletStatus = kitAccount
    ? { state: "connected", account: kitAccount }
    : archStatus;

  const bumpConnectEpoch = useCallback(() => {
    setConnectEpoch((n) => n + 1);
  }, []);

  const openWalletPicker = useCallback(() => {
    bumpConnectEpoch();
    setError(null);
    setWalletPickerOpen(true);
  }, [bumpConnectEpoch]);

  const closeWalletPicker = useCallback(() => {
    setWalletPickerOpen(false);
  }, []);

  const refresh = useCallback(async () => {
    const next = await probeWalletStatus();
    if (!mountedRef.current) return next;
    setArchStatus((current) => {
      if (!shouldAdoptProbe(current, next)) return current;
      return sameWalletStatus(current, next) ? current : next;
    });
    return next;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (kitAccount) return;
    let attempts = 0;
    const probeIfPresent = () => {
      if (!hasArchProvider()) return false;
      void refresh();
      return true;
    };

    probeIfPresent();
    window.addEventListener("arch-wallet#initialized", probeIfPresent);

    const timer = window.setInterval(() => {
      attempts += 1;
      if (probeIfPresent() || attempts >= DETECT_ATTEMPTS) {
        window.clearInterval(timer);
        if (!hasArchProvider() && mountedRef.current) setArchStatus({ state: "no_extension" });
      }
    }, 250);

    return () => {
      window.removeEventListener("arch-wallet#initialized", probeIfPresent);
      window.clearInterval(timer);
    };
  }, [refresh, kitAccount]);

  useEffect(() => {
    if (kitAccount) return;
    const revalidate = () => {
      if (!hasArchProvider()) return;
      void refresh();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") revalidate();
    };
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh, kitAccount]);

  const blocked = !kitAccount && isBlockedWalletStatus(archStatus);
  useEffect(() => {
    if (!blocked) return;
    let attempt = 0;
    let timer = 0;
    let disposed = false;

    const clear = () => {
      if (timer) window.clearTimeout(timer);
      timer = 0;
    };

    const schedule = () => {
      clear();
      if (disposed || attempt >= WALLET_POLL_ATTEMPTS) return;
      if (document.visibilityState === "hidden") return;
      timer = window.setTimeout(run, nextPollDelay(attempt));
    };

    const run = () => {
      timer = 0;
      attempt += 1;
      void refresh().finally(schedule);
    };

    const restart = () => {
      attempt = 0;
      schedule();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") restart();
      else clear();
    };

    window.addEventListener("focus", restart);
    window.addEventListener("pointerdown", restart, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    schedule();

    return () => {
      disposed = true;
      clear();
      window.removeEventListener("focus", restart);
      window.removeEventListener("pointerdown", restart);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [blocked, refresh]);

  const connect = useCallback(
    async (intent: WalletPromptIntent = "connect") => {
      bumpConnectEpoch();
      setError(null);
      const prompt = startWalletConnect(intent);
      setConnecting(true);
      setArchStatus({ state: "awaiting_wallet", intent, canReprompt: false });

      const offerReprompt = window.setTimeout(() => {
        if (!mountedRef.current || !isCurrentWalletPrompt(prompt.id)) return;
        setArchStatus((current) =>
          current.state === "awaiting_wallet" && !current.canReprompt
            ? { ...current, canReprompt: true }
            : current,
        );
      }, REPROMPT_AFTER_MS);

      try {
        let next = await prompt.result;
        if (!isCurrentWalletPrompt(prompt.id)) {
          throw new Error("A newer Arch Wallet request replaced this one.");
        }
        if (next.state !== "connected") {
          const probed = await probeWalletStatus();
          if (probed.state === "connected" || probed.state === "unsupported_account") {
            next = probed;
          }
        }
        if (mountedRef.current && isCurrentWalletPrompt(prompt.id)) setArchStatus(next);
        if (next.state !== "connected") throw walletStatusError(next);
        setWalletPickerOpen(false);
        return {
          ...next.account,
          providerId: "arch-extension",
          providerLabel: "Arch Wallet",
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (mountedRef.current) setError(message);
        throw err;
      } finally {
        window.clearTimeout(offerReprompt);
        if (mountedRef.current && isCurrentWalletPrompt(prompt.id)) setConnecting(false);
      }
    },
    [bumpConnectEpoch],
  );

  const value = useMemo<ArchWalletContextValue>(
    () => ({
      status,
      account: status.state === "connected" ? status.account : null,
      reportedAccount: statusAccount(status),
      available:
        Boolean(kitAccount) ||
        (status.state !== "detecting" && status.state !== "no_extension"),
      detecting: !kitAccount && status.state === "detecting",
      connect,
      openWalletPicker,
      closeWalletPicker,
      walletPickerOpen,
      connecting,
      error,
      refresh,
      connectEpoch,
      bumpConnectEpoch,
    }),
    [
      status,
      kitAccount,
      connect,
      openWalletPicker,
      closeWalletPicker,
      walletPickerOpen,
      connecting,
      error,
      refresh,
      connectEpoch,
      bumpConnectEpoch,
    ],
  );

  return createElement(ArchWalletContext.Provider, { value }, children);
}

export function useArchWallet(): ArchWalletContextValue {
  const ctx = useContext(ArchWalletContext);
  if (!ctx) {
    throw new Error("useArchWallet must be used within ArchWalletProvider");
  }
  return ctx;
}
