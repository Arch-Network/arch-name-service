import { deriveConfigAddress } from "../derive.js";
import { AnsError } from "../errors.js";
import { bytesEqual, hexToBytes } from "../hex.js";
import type { AnsDeploymentManifest, ArchAddress } from "../types.js";
import { MAINNET_MANIFEST } from "./mainnet.js";
import { TESTNET_MANIFEST } from "./testnet.js";

const ZERO_PROGRAM_ID = "0".repeat(64);

export function loadTestnetManifest(): AnsDeploymentManifest {
  return { ...TESTNET_MANIFEST };
}

/** Throws until mainnet programId/registryConfig are filled after deploy. */
export function loadMainnetManifest(): AnsDeploymentManifest {
  const manifest = { ...MAINNET_MANIFEST };
  assertManifestConsistency(manifest);
  return manifest;
}

export function loadManifest(
  network: AnsDeploymentManifest["network"] = "testnet",
): AnsDeploymentManifest {
  return network === "mainnet" ? loadMainnetManifest() : loadTestnetManifest();
}

export function programIdBytes(manifest: AnsDeploymentManifest): ArchAddress {
  return hexToBytes(manifest.programId);
}

export function registryConfigBytes(manifest: AnsDeploymentManifest): ArchAddress {
  return hexToBytes(manifest.registryConfig);
}

function isUnsetProgramId(programId: string): boolean {
  return programId.toLowerCase() === ZERO_PROGRAM_ID;
}

export function assertManifestConsistency(manifest: AnsDeploymentManifest): void {
  if (manifest.network === "mainnet") {
    if (!manifest.mainnetEnabled) {
      throw new AnsError(
        "ManifestMismatch",
        "mainnet manifests require mainnetEnabled=true",
      );
    }
    if (isUnsetProgramId(manifest.programId) || isUnsetProgramId(manifest.registryConfig)) {
      throw new AnsError(
        "ManifestMismatch",
        "mainnet programId/registryConfig are unset; record them after ans-mainnet-deploy",
      );
    }
    if (manifest.networkId !== 1 || manifest.bitcoinNetwork !== "mainnet") {
      throw new AnsError(
        "ManifestMismatch",
        "mainnet manifests must use networkId=1 and bitcoinNetwork=mainnet",
      );
    }
  } else if (manifest.mainnetEnabled) {
    throw new AnsError(
      "ManifestMismatch",
      "testnet manifests must keep mainnetEnabled=false",
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
