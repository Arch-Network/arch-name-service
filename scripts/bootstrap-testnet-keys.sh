#!/usr/bin/env bash
set -euo pipefail
umask 077

# Generate local-only Arch testnet deployment keys and optionally upload them
# to the GitHub testnet Environment. This script never sends a transaction.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
DEFAULT_KEY_DIR="$ROOT/.ans-testnet-keys"
KEY_DIR="$DEFAULT_KEY_DIR"
APPLY_GITHUB_SECRETS=false
FORCE=false
RPC_URL="https://id.arch.network/rpc"
REPOSITORY="Arch-Network/arch-name-service"

usage() {
  cat <<'EOF'
Usage: ./scripts/bootstrap-testnet-keys.sh [options]

Generate fresh local-only keypairs for the ANS testnet deployment.

Options:
  --key-dir PATH              Directory for local key files (default:
                              .ans-testnet-keys in the repository root).
  --rpc-url URL               Testnet RPC URL written to bootstrap.env.
  --apply-github-secrets      Explicitly upload base64-encoded key files to
                              the Arch-Network/arch-name-service testnet
                              GitHub Environment. Does not deploy.
  --force                     Replace only this script's existing key and env
                              files in the target directory.
  -h, --help                  Show this help.

The target must be outside this repository or ignored by Git. Private key
material is never printed.
EOF
}

die() {
  echo "Error: $*" >&2
  exit 1
}

canonicalize_path() {
  python3 -c 'import os, sys; print(os.path.realpath(os.path.expanduser(sys.argv[1])))' "$1"
}

file_mode() {
  if stat -f '%Lp' "$1" >/dev/null 2>&1; then
    stat -f '%Lp' "$1"
  else
    stat -c '%a' "$1"
  fi
}

require_restricted_mode() {
  local path="$1"
  local expected_mode="$2"
  local actual_mode
  actual_mode="$(file_mode "$path")"
  [ "$actual_mode" = "$expected_mode" ] ||
    die "$path has mode $actual_mode; expected $expected_mode"
}

is_within_repository() {
  case "$1/" in
    "$ROOT/"*) return 0 ;;
    *) return 1 ;;
  esac
}

assert_safe_key_dir() {
  local home
  home="$(canonicalize_path "$HOME")"

  case "$KEY_DIR" in
    /|"$ROOT"|"$home")
      die "refusing dangerous key directory: $KEY_DIR"
      ;;
  esac

  if is_within_repository "$KEY_DIR" &&
    ! git -C "$ROOT" check-ignore -q --no-index "$KEY_DIR/"; then
    die "key directory inside the repository must be ignored by Git: $KEY_DIR"
  fi
}

assert_no_overwrite() {
  local path
  for path in "$KEY_DIR/program.key" "$KEY_DIR/deployer.key" \
    "$KEY_DIR/namespace-authority.key" "$KEY_DIR/bootstrap.env" \
    "$KEY_DIR/deployment-manifest.json"; do
    [ ! -L "$path" ] ||
      die "refusing symbolic link in key directory: $path"
    if [ -e "$path" ] && [ "$FORCE" = false ]; then
      die "$path already exists; re-run with --force to replace bootstrap files"
    fi
  done
}

generate_key() {
  local path="$1"
  openssl rand -hex 32 | tr -d '\n' > "$path"
  chmod 600 "$path"
  require_restricted_mode "$path" 600
}

validate_secret_value() {
  local path="$1"
  local encoded
  local decoded

  encoded="$(base64 < "$path" | tr -d '\n')"
  [ -n "$encoded" ] || die "could not prepare a secret value for $path"
  decoded="$(mktemp "$KEY_DIR/.secret-validation.XXXXXX")"
  trap 'rm -f "${decoded:-}"' RETURN
  printf '%s' "$encoded" | base64 -d > "$decoded"
  cmp -s "$path" "$decoded" ||
    die "base64 validation failed for $path"
  rm -f "$decoded"
  trap - RETURN
}

set_github_secret() {
  local name="$1"
  local path="$2"
  base64 < "$path" | tr -d '\n' |
    gh secret set "$name" --repo "$REPOSITORY" --env testnet
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --key-dir)
      [ "$#" -ge 2 ] || die "--key-dir requires a path"
      KEY_DIR="$2"
      shift 2
      ;;
    --rpc-url)
      [ "$#" -ge 2 ] || die "--rpc-url requires a URL"
      RPC_URL="$2"
      shift 2
      ;;
    --apply-github-secrets)
      APPLY_GITHUB_SECRETS=true
      shift
      ;;
    --force)
      FORCE=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

KEY_DIR="$(canonicalize_path "$KEY_DIR")"
assert_safe_key_dir
mkdir -p "$KEY_DIR"
chmod 700 "$KEY_DIR"
require_restricted_mode "$KEY_DIR" 700
assert_no_overwrite

generate_key "$KEY_DIR/program.key"
generate_key "$KEY_DIR/deployer.key"
generate_key "$KEY_DIR/namespace-authority.key"

{
  printf 'PROGRAM_KEY_PATH=%q\n' "$KEY_DIR/program.key"
  printf 'DEPLOYER_KEY_PATH=%q\n' "$KEY_DIR/deployer.key"
  printf 'NAMESPACE_AUTHORITY_KEY_PATH=%q\n' "$KEY_DIR/namespace-authority.key"
  printf 'ARCH_RPC_URL=%q\n' "$RPC_URL"
  printf 'NETWORK=testnet\n'
} > "$KEY_DIR/bootstrap.env"
chmod 600 "$KEY_DIR/bootstrap.env"
require_restricted_mode "$KEY_DIR/bootstrap.env" 600

for key_file in "$KEY_DIR/program.key" "$KEY_DIR/deployer.key" \
  "$KEY_DIR/namespace-authority.key"; do
  validate_secret_value "$key_file"
done

echo "Validating local key files and deriving public testnet identifiers..."
PROGRAM_KEY_PATH="$KEY_DIR/program.key" \
DEPLOYER_KEY_PATH="$KEY_DIR/deployer.key" \
NAMESPACE_AUTHORITY_KEY_PATH="$KEY_DIR/namespace-authority.key" \
ARCH_RPC_URL="$RPC_URL" \
NETWORK=testnet \
OUTPUT_PATH="$KEY_DIR/deployment-manifest.json" \
cargo run --locked --quiet --manifest-path "$ROOT/tools/ans-deploy/Cargo.toml" -- --dry-run
chmod 600 "$KEY_DIR/deployment-manifest.json"
require_restricted_mode "$KEY_DIR/deployment-manifest.json" 600

if [ "$APPLY_GITHUB_SECRETS" = true ]; then
  command -v gh >/dev/null 2>&1 || die "gh is required for --apply-github-secrets"
  gh auth status >/dev/null 2>&1 || die "authenticate gh before applying GitHub secrets"

  echo "Uploading prepared testnet secrets to the GitHub Environment..."
  set_github_secret PROGRAM_KEYPAIR_B64 "$KEY_DIR/program.key"
  set_github_secret DEPLOYER_KEYPAIR_B64 "$KEY_DIR/deployer.key"
  set_github_secret NAMESPACE_AUTHORITY_KEYPAIR_B64 "$KEY_DIR/namespace-authority.key"
  echo "GitHub testnet Environment secrets updated. No deployment was triggered."
fi

echo "Local testnet bootstrap complete."
echo "Key directory: $KEY_DIR"
echo "Environment file: $KEY_DIR/bootstrap.env"
echo "Deployment manifest contains the public role-to-ID mapping."
