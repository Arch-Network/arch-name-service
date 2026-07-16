#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   PROGRAM_KEY_PATH=... DEPLOYER_KEY_PATH=... NAMESPACE_AUTHORITY_KEY_PATH=... \
#     ./scripts/deploy-testnet.sh --dry-run
#
# The program derives all PDAs from the runtime program id, so no source rewrite
# or program-id sync is required.

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
export NETWORK=testnet

if [ "$DRY_RUN" = false ]; then
  (cd programs/ans-registry && cargo-build-sbf --features entrypoint)
fi

cargo build --locked -q --manifest-path tools/ans-deploy/Cargo.toml
if [ "$DRY_RUN" = true ]; then
  tools/ans-deploy/target/debug/ans-deploy --dry-run
else
  tools/ans-deploy/target/debug/ans-deploy
fi
