import { deriveConfigAddress } from "../derive.js";
import { AnsError } from "../errors.js";
import { bytesEqual, hexToBytes } from "../hex.js";
import type { AnsDeploymentManifest, ArchAddress } from "../types.js";
import { TESTNET_MANIFEST } from "./testnet.js";

export function loadTestnetManifest(): AnsDeploymentManifest {
  return { ...TESTNET_MANIFEST };
}

export function programIdBytes(manifest: AnsDeploymentManifest): ArchAddress {
  return hexToBytes(manifest.programId);
}

export function registryConfigBytes(manifest: AnsDeploymentManifest): ArchAddress {
  return hexToBytes(manifest.registryConfig);
}

export function assertManifestConsistency(manifest: AnsDeploymentManifest): void {
  if (manifest.network === "mainnet" || manifest.mainnetEnabled) {
    throw new AnsError(
      "ManifestMismatch",
      "mainnet manifests are disabled until a separately approved mainnet freeze",
    );
  }
  const programId = programIdBytes(manifest);
  const expected = deriveConfigAddress(programId, manifest.networkId, manifest.namespace);
  if (!bytesEqual(expected, registryConfigBytes(manifest))) {
    throw new AnsError(
      "ManifestMismatch",
      "registryConfig does not match derived config PDA for programId/networkId/namespace",
    );
  }
}
