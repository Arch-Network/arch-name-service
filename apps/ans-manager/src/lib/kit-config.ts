import type { WalletKitConfig } from "@arch-network/wallet-connect-kit";

/**
 * ANS testnet uses Bitcoin testnet4 prefixes for LaserEyes / Xverse.
 * Hub is omitted on purpose — no same-origin proxy in this static SPA yet.
 */
export const ANS_WALLET_KIT_CONFIG: WalletKitConfig = {
  network: "testnet4",
  appName: "Arch Name Service",
  storagePrefix: "ans",
  debug: false,
};
