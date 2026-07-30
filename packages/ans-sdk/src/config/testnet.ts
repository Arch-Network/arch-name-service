import type { AnsDeploymentManifest } from "../types.js";

/** Frozen testnet deployment. Keep in sync with manifests/testnet.json. */
export const TESTNET_MANIFEST: AnsDeploymentManifest = {
  network: "testnet",
  rpcUrl: "https://id.arch.network/rpc",
  programId: "3d9fbaa282268d8453a924692f254ad6c610668f36512db9fb50325ac2e4e079",
  registryConfig: "29691c11fb04be3e25c5f236dc7971cbb3293fc0f7a3bed288dc4cd476320521",
  networkId: 2,
  namespace: ".arch",
  programVersion: 1,
  bitcoinNetwork: "testnet",
  tokenPrograms: [],
  mainnetEnabled: false,
  smokePassed: true,
  features: {
    textRecords: true,
  },
};
