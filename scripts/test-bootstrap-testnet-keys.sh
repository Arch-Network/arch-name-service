#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
BOOTSTRAP="$ROOT/scripts/bootstrap-testnet-keys.sh"
KEY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ans-testnet-bootstrap.XXXXXX")"
trap 'rm -rf "$KEY_DIR"' EXIT

file_mode() {
  if stat -f '%Lp' "$1" >/dev/null 2>&1; then
    stat -f '%Lp' "$1"
  else
    stat -c '%a' "$1"
  fi
}

"$BOOTSTRAP" --key-dir "$KEY_DIR" > "$KEY_DIR/output.txt"

test "$(file_mode "$KEY_DIR")" = 700
test "$(file_mode "$KEY_DIR/program.key")" = 600
test "$(file_mode "$KEY_DIR/deployer.key")" = 600
test "$(file_mode "$KEY_DIR/namespace-authority.key")" = 600
test "$(file_mode "$KEY_DIR/bootstrap.env")" = 600
test "$(file_mode "$KEY_DIR/deployment-manifest.json")" = 600
test -s "$KEY_DIR/deployment-manifest.json"
rg -q '"network": "testnet"' "$KEY_DIR/deployment-manifest.json"
rg -q 'DRY RUN: no transaction sent.' "$KEY_DIR/output.txt"

if "$BOOTSTRAP" --key-dir "$KEY_DIR" >/dev/null 2>&1; then
  echo "bootstrap unexpectedly overwrote existing keys" >&2
  exit 1
fi

if "$BOOTSTRAP" --key-dir "$ROOT" >/dev/null 2>&1; then
  echo "bootstrap accepted the repository root as a key directory" >&2
  exit 1
fi

echo "Bootstrap validation passed."
