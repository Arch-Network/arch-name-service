/**
 * Read-only live smoke against the frozen testnet manifest.
 * Usage (from apps/ans-manager): node scripts/smoke-read.mjs
 */
import {
  AnsClient,
  createArchRpcTransport,
  loadTestnetManifest,
} from "@arch-network/ans-sdk";

async function main() {
  const manifest = loadTestnetManifest();
  const client = new AnsClient(manifest, createArchRpcTransport(manifest.rpcUrl));
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

  const smokeName = manifest.smokeEvidence?.canonicalName ?? "smoke1785070093.arch";
  try {
    const owner = await client.resolveOwner(smokeName);
    console.log("resolveOwner ok", { name: smokeName, ownerBytes: owner.length });
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
