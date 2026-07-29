# Testnet deployment runbook

The first ANS deployment is one `ans-registry` program for the permanent,
free `.arch` testnet namespace. It has no expiry, renewal, subdomains, pricing,
or lending/oracle dependencies. Names transfer immediately; transferring a name
increments its record epoch and invalidates every prior record.

## Secrets and custody

Create a GitHub Environment named `testnet`. Add these Environment secrets as
base64-encoded keypair files:

- `PROGRAM_KEYPAIR_B64` — persistent program key; its public key is the ANS
  program id.
- `DEPLOYER_KEYPAIR_B64` — deployment and upgrade authority. Before deployment,
  it must be an on-chain, system-owned, funded account because Arch SDK
  `ProgramDeployer` uses this key as the transaction fee payer.
- `NAMESPACE_AUTHORITY_KEYPAIR_B64` — dedicated temporary authority that signs
  the one-time registry initialization instruction and pays that transaction's
  fee. It too must be an on-chain, system-owned, funded account. It has no
  authority over registered names.
- `ARCH_RPC_URL` — optional testnet RPC override. It defaults to the
  authenticated Explorer proxy at `https://id.arch.network/rpc`.

Keep the raw keys out of the repository. The deployer key must remain unchanged
for in-place upgrades. The program derives addresses from its runtime program
id, so there is deliberately no compiled-in program id and no program-id sync
script.

### Local key bootstrap

Generate the three fresh testnet-only keys locally:

```bash
./scripts/bootstrap-testnet-keys.sh
```

The script writes private key files and `bootstrap.env` to the gitignored
`.ans-testnet-keys/` directory with owner-only permissions. It never prints
private key material. It validates the Arch SDK key format with the local
deploy tool and displays only the role-to-public-ID mapping; no transaction or
deployment is sent.

Use `--key-dir /secure/path` to choose another directory. A directory inside
this repository must be gitignored; an external directory is also accepted.
The script refuses unsafe destinations and existing bootstrap files unless
`--force` is supplied.

After reviewing the public IDs in `.ans-testnet-keys/deployment-manifest.json`,
explicitly upload the prepared values to GitHub:

```bash
./scripts/bootstrap-testnet-keys.sh --apply-github-secrets
```

This requires an authenticated `gh` session with permission to set Environment
secrets. It sets `PROGRAM_KEYPAIR_B64`, `DEPLOYER_KEYPAIR_B64`, and
`NAMESPACE_AUTHORITY_KEYPAIR_B64` in the `testnet` Environment only. It does
not trigger this repository's deployment workflow.

Keep the directory out of sync folders, email, chat, and source control. Make
an encrypted offline backup of the whole key directory, store its decryption
credential separately in an approved secret manager, and retain the deployer
and program keys for upgrades. Anyone with a copied key can act as that role.

## First deployment

1. Generate and custody the three testnet keypairs with the local bootstrap
   script. Record the public IDs.
2. Upload the three prepared secrets with
   `./scripts/bootstrap-testnet-keys.sh --apply-github-secrets`, or manually
   base64 encode each complete keypair file without line wrapping and add the
   required secrets to the `testnet` Environment.
3. In Actions, run `ans-testnet-deploy` with `operation=preflight` and
   `dry_run=true`. Verify the printed program id, deployer, namespace authority,
   RPC URL, config address, and payer fields. A deployer or namespace authority
   with `present=false`, `system_owned=false`, or `suitable=false` must not be
   used for a deployment or initialization.
4. Run `operation=fund` with `dry_run=false` to create/fund the two testnet
   payer accounts through the Arch SDK faucet. It requests five 1,000,000
   lamport rounds for the deployer (the same large-ELF heuristic used by
   Autara) and one round for the namespace authority. Then re-run
   `operation=preflight` and require both payer `suitable` fields to be true
   before continuing.
5. Run `operation=deploy` with `dry_run=false`. The workflow builds
   `programs/ans-registry` with `cargo-build-sbf` and uploads it through the
   Arch SDK. The deployer is the SDK authority and fee payer; no distinct payer
   can be supplied to `ProgramDeployer`.
6. Run `operation=initialize` with `dry_run=false`. This constructs and signs
   `InitializeRegistry { network_id: 2, namespace_authority }` with the
   namespace authority as both signer and fee payer. It derives the config
   account, skips the transaction when an exact expected config already exists,
   and verifies `.arch`, `BitcoinNetwork::Testnet`, zero expiry policy, and the
   configured authority after a successful transaction. The artifact records
   the config address, initialization state, payer evidence, and initialization
   transaction id.
7. Run `operation=smoke` with `dry_run=false`. This registers a unique
   `smoke{unix}.arch` name (override with `SMOKE_LABEL`), writes an
   `ARCH_OWNER` record, sets primary, transfers ownership to the deployer
   pubkey, and asserts resolution: owner updates, the prior record is stale,
   and the prior reverse binding is invalid. The artifact records label,
   PDA addresses, four transaction ids, and `smoke.passed=true`.

For a local preflight, supply filesystem paths rather than secrets:

```bash
PROGRAM_KEY_PATH=/secure/program.json \
DEPLOYER_KEY_PATH=/secure/deployer.json \
NAMESPACE_AUTHORITY_KEY_PATH=/secure/namespace-authority.json \
cargo run --locked --manifest-path tools/ans-deploy/Cargo.toml -- preflight --dry-run
```

## Upgrades

Every production-facing testnet upgrade must follow this checklist. Keep each
step as a separate `workflow_dispatch` run so artifacts stay auditable:

1. `operation=preflight` — confirm both payers are `suitable` and the program
   id / config address still match the custody manifest.
2. `operation=fund` with `dry_run=false` if either payer is below the minimum.
3. `operation=upgrade` with `dry_run=false` — rebuilds the SBF ELF and uploads
   it with the persistent program and deployer keys (`upgrade` is an alias of
   the guarded deploy action for audit visibility and artifact naming).
4. `operation=smoke` with `dry_run=false` — must pass before treating the
   upgrade as ready for client use.

Mainnet is a separate gated deployment and configuration approval. Testnet
keys and workflows must not automatically control mainnet.
