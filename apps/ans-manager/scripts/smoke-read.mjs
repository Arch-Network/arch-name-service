/**
 * Read-only live smoke against the frozen testnet manifest.
 * Usage (from apps/ans-manager): node scripts/smoke-read.mjs
 *
 * Uses the same split transport as the SPA: account reads via /rpc,
 * height via Explorer REST (the RPC proxy does not allow get_block_count).
 */
import {
  AnsClient,
  createSplitAnsTransport,
  loadTestnetManifest,
} from "@arch-network/ans-sdk";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

async function main() {
  const manifest = loadTestnetManifest();
  const client = new AnsClient(
    manifest,
    createSplitAnsTransport({
      rpcUrl: "https://id.arch.network/rpc",
      explorerUrl: "https://id.arch.network/explorer",
    }),
  );
  const config = await client.fetchRegistryConfig();
  console.log(
    JSON.stringify(
      {
        networkId: config.networkId,
        namespace: config.namespace,
        programVersion: config.programVersion,
        registryConfig: manifest.registryConfig,
        smokePassed: manifest.smokePassed,
      },
      null,
      2,
    ),
  );

  const evidencePath = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../packages/ans-sdk/manifests/testnet.json",
  );
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
  const smokeName =
    evidence.smokeEvidence?.canonicalName ?? "smoke1786986685.arch";
  try {
    const owner = await client.resolveOwner(smokeName);
    console.log("resolveOwner ok", {
      name: smokeName,
      ownerBytes: owner.length,
      ownerHex: Buffer.from(owner).toString("hex"),
    });
  } catch (error) {
    console.log(
      "resolveOwner note (expected after transfer invalidated prior reverse state):",
      error instanceof Error ? error.message : error,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
