/**
 * Vitest runs in Node and cannot resolve the kit's extensionless ESM
 * imports. Unit tests mock the kit; the Vite browser build resolves it.
 */
import { vi } from "vitest";

vi.mock("@arch-network/wallet-connect-kit", () => {
  const laserEyes = {
    address: undefined,
    paymentAddress: undefined,
    publicKey: undefined,
    paymentPublicKey: undefined,
    provider: null,
    connected: false,
    isConnecting: false,
    hasXverse: false,
    hasPhantom: false,
    hasUnisat: false,
    hasLeather: false,
    connect: async () => undefined,
    disconnect: () => undefined,
    requestAccounts: async () => [],
    getPublicKey: async () => undefined,
    signMessage: async () => "",
  };

  const state = {
    wallet: null as null | {
      address: string;
      pubkey: string;
      archAddress: string;
      isConnected: boolean;
    },
    connectionIdentity: null as null | { providerId?: string },
  };

  return {
    ArchWalletKitProvider: ({ children }: { children: unknown }) => children,
    useWallet: () => ({
      wallet: state.wallet,
      laserEyes,
      connectionPhase: { status: "idle" as const },
      connectionError: null,
      showConnect: false,
      setShowConnect: () => undefined,
      detectedWallets: [] as string[],
      openConnectModal: () => undefined,
      handleConnect: async () => undefined,
      handleRetry: async () => undefined,
      handleCancel: () => undefined,
      handleDisconnect: () => {
        state.wallet = null;
        state.connectionIdentity = null;
      },
      repairOnboarding: async () => ({ ok: true as const }),
    }),
    useWalletSigner: () => ({
      signDigest: async () => {
        throw new Error("Cannot sign without a connected wallet.");
      },
    }),
    walletKitStore: {
      getState: () => state,
      setState: (partial: Partial<typeof state>) => Object.assign(state, partial),
      subscribe: () => () => undefined,
    },
    selectConnectionIdentity: (s: typeof state) => s.connectionIdentity,
    selectWallet: (s: typeof state) => s.wallet,
    PROVIDER_BY_ID: {
      xverse: "xverse",
      unisat: "unisat",
      leather: "leather",
      phantom: "phantom",
    },
  };
});

vi.mock("zustand", () => ({
  useStore: (
    store: { getState: () => unknown },
    selector: (s: unknown) => unknown,
  ) => selector(store.getState()),
}));
