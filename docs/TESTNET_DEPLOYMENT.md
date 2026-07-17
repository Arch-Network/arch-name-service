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
- `DEPLOYER_KEYPAIR_B64` — funded deployment and upgrade authority.
- `NAMESPACE_AUTHORITY_KEYPAIR_B64` — dedicated temporary authority that signs
  the one-time registry initialization instruction. It has no authority over
  registered names.
- `ARCH_RPC_URL` — optional testnet RPC override. It defaults to
  `https://rpc.testnet.arch.network`.

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
   script. Record the public IDs and fund the deployer with enough testnet
   balance for the SBF upload.
2. Upload the three prepared secrets with
   `./scripts/bootstrap-testnet-keys.sh --apply-github-secrets`, or manually
   base64 encode each complete keypair file without line wrapping and add the
   required secrets to the `testnet` Environment.
3. In Actions, run `ans-testnet-deploy` with `operation=deploy` and
   `dry_run=true`. Verify the printed program id, deployer, namespace authority,
   RPC URL, and uploaded `deployments/testnet.json` artifact.
4. Re-run with `dry_run=false`. The workflow builds
   `programs/ans-registry` with `cargo-build-sbf` and uploads it through the
   Arch SDK. It does not register names or send any transaction in dry-run mode.
5. Initialize the registry with the dedicated namespace authority using the
   `InitializeRegistry { network_id: 2, namespace_authority }` instruction and
   the derived config account. This is a one-time state transition; confirm the
   resulting config declares `.arch`, `BitcoinNetwork::Testnet`, and no expiry.
6. Exercise the instruction tests against testnet before announcing the
   namespace: register a name, write an `ARCH_OWNER` record, set primary,
   transfer, and confirm the old record and reverse binding no longer resolve.

For a local preflight, supply filesystem paths rather than secrets:

```bash
PROGRAM_KEY_PATH=/secure/program.json \
DEPLOYER_KEY_PATH=/secure/deployer.json \
NAMESPACE_AUTHORITY_KEY_PATH=/secure/namespace-authority.json \
./scripts/deploy-testnet.sh --dry-run
```

The workflow accepts `operation=upgrade` for audit visibility and artifact
naming. An upgrade uses the same program and deployer keypairs; it is otherwise
the same guarded deployment path.
