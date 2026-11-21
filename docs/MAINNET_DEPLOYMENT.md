# Mainnet deployment runbook

Mainnet ANS is a separate deployment from testnet. It uses a distinct program
keypair, deployer, namespace authority, GitHub Environment, and frozen SDK
manifest. Testnet keys and workflows must never control mainnet.

## Network constants

| Field | Value |
| --- | --- |
| `NETWORK` | `mainnet` |
| `network_id` | `1` |
| Namespace | `.arch` |
| Bitcoin policy | mainnet (`bc1p…` Taproot) |
| `mainnet_enabled` | `true` |
| Default RPC | `https://rpc.mainnet.arch.network` |
| Faucet | unavailable — fund payers manually |

Testnet remains `network_id = 2` with Bitcoin testnet policy.

## Secrets and custody

Create a GitHub Environment named `mainnet` (required reviewers recommended).
Add these Environment secrets as base64-encoded keypair files:

- `PROGRAM_KEYPAIR_B64` — persistent program key; its public key is the mainnet
  ANS program id.
- `DEPLOYER_KEYPAIR_B64` — deployment and upgrade authority / fee payer.
- `NAMESPACE_AUTHORITY_KEYPAIR_B64` — one-time registry initializer and fee
  payer for `initialize`.
- `ARCH_RPC_URL` — optional override; defaults to
  `https://rpc.mainnet.arch.network`.

Generate keys locally (never reuse testnet keys):

```bash
./scripts/bootstrap-mainnet-keys.sh
./scripts/bootstrap-mainnet-keys.sh --apply-github-secrets
```

The bootstrap directory defaults to `.ans-mainnet-keys/` (gitignored). Keep an
encrypted offline backup of the program and deployer keys for upgrades.

## First deployment (GitHub Actions)

Run `ans-mainnet-deploy` as separate `workflow_dispatch` steps:

1. `operation=preflight`, `dry_run=true` — confirm program id, config PDA,
   RPC, and payer suitability.
2. Fund the deployer and namespace authority on mainnet outside CI (no faucet).
3. `operation=preflight`, `dry_run=false` — require both payers `suitable=true`.
4. `operation=deploy`, `dry_run=false` — builds `programs/ans-registry` with
   `--features entrypoint` and uploads the ELF.
5. `operation=initialize`, `dry_run=false` — initializes the registry with
   `network_id: 1` and `mainnet_enabled: true`.
6. `operation=smoke`, `dry_run=false`, `confirm_mainnet_smoke=true` — optional
   but recommended before treating the deploy as client-ready. Writes a real
   `smoke{unix}.arch` name.
7. Record the artifact `deployments/mainnet.json`, update
   `packages/ans-sdk/manifests/mainnet.json`, and cut a mainnet SDK release.

## Upgrades

1. `preflight` — program id / config PDA / payers still match custody.
2. Fund deployer if below the minimum.
3. `upgrade` (`dry_run=false`) — rebuild + upload with the same program key.
4. `smoke` with `confirm_mainnet_smoke=true` before client cutover.

## Client enablement

The SDK ships a mainnet manifest template. Clients must only load it after the
live program id and registry config PDA are written into
`packages/ans-sdk/manifests/mainnet.json` and `src/config/mainnet.ts`.

BTC marketplace quotes remain disabled on mainnet until a mainnet aBTC mint is
wired into the registry program.
