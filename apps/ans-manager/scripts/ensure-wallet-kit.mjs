#!/usr/bin/env node
/**
 * `@arch-network/wallet-connect-kit` is not on npm yet, and the GitHub
 * package's `files` field only ships `dist/` — which is not committed — so a
 * bare `github:` install lands without a usable entrypoint.
 *
 * Default: depend on the vendored packed tarball under `vendor/` (built from
 * https://github.com/Arch-Network/arch-wallet-connect-kit).
 *
 * Optional: `ANS_WALLET_KIT_FROM_GIT=1 npm run ensure:wallet-kit` clones,
 * builds, and refreshes the tarball + node_modules copy.
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const kitNm = join(root, "node_modules/@arch-network/wallet-connect-kit");
const vendorDir = join(root, "vendor");
const tarball = join(vendorDir, "arch-network-wallet-connect-kit-0.1.0.tgz");

function hasDist() {
  return existsSync(join(kitNm, "dist/index.js"));
}

if (hasDist() && process.env.ANS_WALLET_KIT_FROM_GIT !== "1") {
  process.exit(0);
}

if (process.env.ANS_WALLET_KIT_FROM_GIT === "1") {
  const work = mkdtempSync(join(tmpdir(), "awck-"));
  try {
    execSync(
      "git clone --depth 1 https://github.com/Arch-Network/arch-wallet-connect-kit.git .",
      { cwd: work, stdio: "inherit" },
    );
    execSync("npm install --ignore-scripts", { cwd: work, stdio: "inherit" });
    execSync("npx tsc -p tsconfig.build.json", { cwd: work, stdio: "inherit" });
    mkdirSync(vendorDir, { recursive: true });
    execSync("npm pack --pack-destination " + JSON.stringify(vendorDir), {
      cwd: work,
      stdio: "inherit",
    });
    execSync("npm install ./vendor/arch-network-wallet-connect-kit-0.1.0.tgz --save", {
      cwd: root,
      stdio: "inherit",
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  process.exit(0);
}

if (!hasDist()) {
  if (!existsSync(tarball)) {
    console.error(
      "[ans] wallet-connect-kit dist missing and vendor tarball not found at",
      tarball,
    );
    process.exit(1);
  }
  // Last resort: unpack tarball contents over the broken github install.
  const work = mkdtempSync(join(tmpdir(), "awck-unpack-"));
  try {
    execSync(`tar -xzf ${JSON.stringify(tarball)} -C ${JSON.stringify(work)}`);
    const pkg = join(work, "package");
    mkdirSync(kitNm, { recursive: true });
    cpSync(pkg, kitNm, { recursive: true });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (!hasDist()) {
  console.error("[ans] failed to materialize wallet-connect-kit dist");
  process.exit(1);
}
