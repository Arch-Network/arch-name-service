#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   PROGRAM_KEY_PATH=... DEPLOYER_KEY_PATH=... NAMESPACE_AUTHORITY_KEY_PATH=... \
#     ./scripts/deploy-mainnet.sh --dry-run
#
# Mainnet has no faucet. Payers must already be funded before a live deploy.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DRY_RUN=false
for arg in "$@"; do
  if [ "$arg" = "--dry-run" ]; then
    DRY_RUN=true
  else
    echo "Unknown argument: $arg" >&2
    exit 2
  fi
done

: "${PROGRAM_KEY_PATH:?PROGRAM_KEY_PATH is required}"
: "${DEPLOYER_KEY_PATH:?DEPLOYER_KEY_PATH is required}"
: "${NAMESPACE_AUTHORITY_KEY_PATH:?NAMESPACE_AUTHORITY_KEY_PATH is required}"
export NETWORK=mainnet
export ARCH_RPC_URL="${ARCH_RPC_URL:-https://rpc.mainnet.arch.network}"
export OUTPUT_PATH="${OUTPUT_PATH:-deployments/mainnet.json}"

if [ "$DRY_RUN" = false ]; then
  (cd programs/ans-registry && cargo-build-sbf --features entrypoint)
fi

cargo build --locked -q --manifest-path tools/ans-deploy/Cargo.toml
if [ "$DRY_RUN" = true ]; then
  tools/ans-deploy/target/debug/ans-deploy --dry-run
else
  tools/ans-deploy/target/debug/ans-deploy
fi
