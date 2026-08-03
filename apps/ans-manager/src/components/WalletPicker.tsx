import {
  PROVIDER_BY_ID,
  useWallet,
  useWalletSigner,
  walletKitStore,
  selectConnectionIdentity,
  type WalletId,
} from "@arch-network/wallet-connect-kit";
import { useStore } from "zustand";
import { useEffect, useId, useState } from "react";
import {
  createArchExtensionPort,
  createKitLaserEyesPort,
  providerLabelFor,
} from "../lib/ans-wallet-port";
import { setActiveAnsWalletPort } from "../lib/ans-wallet-session";
import { ARCH_EXTENSION_STORE_URL } from "../lib/chrome-store";
import { hasArchProvider } from "../lib/wallet-gateway";
import { useArchWallet } from "../hooks/useArchWallet";

type PickerWallet = {
  id: WalletId;
  name: string;
  iconSrc: string;
  installUrl?: string;
  /** Arch extension uses our status machine; others use kit LaserEyes. */
  kind: "arch" | "lasereyes";
};

const PICKER_WALLETS: PickerWallet[] = [
  {
    id: "arch",
    name: "Arch Wallet",
    iconSrc: "/arch-icon.jpeg",
    installUrl: ARCH_EXTENSION_STORE_URL,
    kind: "arch",
  },
  {
    id: "xverse",
    name: "Xverse",
    iconSrc: "/xverse-logo.png",
    installUrl: "https://www.xverse.app/download",
    kind: "lasereyes",
  },
  {
    id: "unisat",
    name: "UniSat",
    iconSrc: "/unisat-logo.png",
    installUrl: "https://unisat.io/download",
    kind: "lasereyes",
  },
  {
    id: "leather",
    name: "Leather",
    iconSrc: "/leather-icon.svg",
    installUrl: "https://leather.io/install-extension",
    kind: "lasereyes",
  },
  {
    id: "phantom",
    name: "Phantom",
    iconSrc: "/phantom-icon.svg",
    installUrl: "https://phantom.com/download",
    kind: "lasereyes",
  },
];

/**
 * Keeps {@link setActiveAnsWalletPort} aligned with the live session.
 *
 * LaserEyes kit identity wins when present; otherwise the Arch extension
 * account from our status machine. Fee payer + signer always come from this
 * port at submit time.
 */
export function AnsWalletPortBridge() {
  const { account, status } = useArchWallet();
  const { wallet: kitWallet } = useWallet();
  const kitSigner = useWalletSigner();
  const connectionIdentity = useStore(walletKitStore, selectConnectionIdentity);

  useEffect(() => {
    const providerId = connectionIdentity?.providerId;
    const kitIsLaserEyes =
      Boolean(kitWallet?.isConnected) &&
      Boolean(providerId) &&
      providerId !== "arch-extension" &&
      !String(providerId).startsWith("turnkey-");

    if (kitIsLaserEyes && kitWallet && providerId) {
      setActiveAnsWalletPort(
        createKitLaserEyesPort({
          identity: {
            archAddress: kitWallet.archAddress,
            address: kitWallet.address,
            publicKey: kitWallet.pubkey,
            providerId,
            providerLabel: providerLabelFor(providerId),
          },
          signer: kitSigner,
        }),
      );
      return;
    }

    if (status.state === "connected" && account) {
      setActiveAnsWalletPort(
        createArchExtensionPort({
          archAddress: account.archAddress,
          address: account.address,
          publicKey: account.publicKey,
          kind: account.kind,
        }),
      );
      return;
    }

    setActiveAnsWalletPort(null);
  }, [account, status, kitWallet, kitSigner, connectionIdentity]);

  return null;
}

export function WalletPicker({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const { connect, connecting } = useArchWallet();
  const {
    handleConnect,
    handleDisconnect,
    connectionPhase,
    connectionError,
    detectedWallets,
    laserEyes,
  } = useWallet();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setBusyId(null);
      setLocalError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const kitBusy = connectionPhase.status !== "idle";
  const archInstalled = hasArchProvider();

  const detected = (id: WalletId): boolean => {
    if (id === "arch") return archInstalled;
    if (id === "xverse") return laserEyes.hasXverse;
    if (id === "unisat") return laserEyes.hasUnisat;
    if (id === "leather") return laserEyes.hasLeather;
    if (id === "phantom") return laserEyes.hasPhantom;
    return detectedWallets.includes(PROVIDER_BY_ID[id] ?? id);
  };

  const pick = async (wallet: PickerWallet) => {
    setLocalError(null);
    setBusyId(wallet.id);
    try {
      if (wallet.kind === "arch") {
        if (!archInstalled) {
          window.open(ARCH_EXTENSION_STORE_URL, "_blank", "noopener,noreferrer");
          return;
        }
        // Drop any LaserEyes session so Arch becomes the effective fee payer.
        handleDisconnect();
        await connect("connect");
        onClose();
        return;
      }
      await handleConnect(wallet.id);
      onClose();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="wallet-picker-backdrop" role="presentation" onClick={onClose}>
      <div
        className="wallet-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="wallet-picker-header">
          <h2 id={titleId}>Connect wallet</h2>
          <button type="button" className="wallet-picker-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <p className="wallet-picker-lead">
          Arch Wallet is the default. Xverse, UniSat, Leather, and Phantom sign
          ANS updates directly via BIP-322.
        </p>
        <ul className="wallet-picker-list">
          {PICKER_WALLETS.map((wallet) => {
            const present = detected(wallet.id);
            const busy = busyId === wallet.id || (kitBusy && busyId === wallet.id);
            return (
              <li key={wallet.id}>
                <button
                  type="button"
                  className="wallet-picker-option"
                  disabled={connecting || kitBusy || busyId !== null}
                  onClick={() => void pick(wallet)}
                >
                  <img src={wallet.iconSrc} alt="" width={28} height={28} />
                  <span className="wallet-picker-option-text">
                    <span className="wallet-picker-option-name">{wallet.name}</span>
                    <span className="wallet-picker-option-meta">
                      {busy
                        ? "Waiting…"
                        : present
                          ? "Detected"
                          : wallet.kind === "arch"
                            ? "Install / open"
                            : "Extension"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {(localError || connectionError) && (
          <p className="wallet-picker-error" role="alert">
            {localError || connectionError}
          </p>
        )}
        <p className="wallet-picker-note">
          Linked Xverse or UniSat accounts inside Arch Wallet can sign ANS
          updates — Approve in Arch Wallet, then confirm in that Bitcoin wallet.
        </p>
      </div>
    </div>
  );
}
