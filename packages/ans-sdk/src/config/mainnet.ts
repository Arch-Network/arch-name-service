import type { AnsDeploymentManifest } from "../types.js";

/**
 * Mainnet deployment manifest.
 *
 * `programId` / `registryConfig` stay all-zero until the first mainnet deploy
 * artifact is recorded. `assertManifestConsistency` / `loadMainnetManifest`
 * refuse all-zero IDs so clients cannot silently talk to a missing program.
 */
export const MAINNET_MANIFEST: AnsDeploymentManifest = {
  network: "mainnet",
  rpcUrl: "https://rpc.mainnet.arch.network",
  programId: "0000000000000000000000000000000000000000000000000000000000000000",
  registryConfig: "0000000000000000000000000000000000000000000000000000000000000000",
  networkId: 1,
  namespace: ".arch",
  programVersion: 1,
  bitcoinNetwork: "mainnet",
  tokenPrograms: [],
  mainnetEnabled: true,
  smokePassed: false,
  features: {
    textRecords: true,
  },
};
