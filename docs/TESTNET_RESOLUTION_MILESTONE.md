# Testnet Resolution Milestone

This milestone implements protocol foundations only. It provides a Rust crate,
`ans-protocol`, that can be used unchanged by a testnet client, indexer, and
the future Arch program. It does not perform RPC calls, host a resolver, hold
private keys, or imply a deployment.

## Deterministic API

`resolve_owner`, `resolve_record`, and `resolve_primary` consume the
caller-provided account addresses and decoded Borsh state. Before returning a
value, they verify:

1. the `.arch` name is canonical and its SHA-256 domain-separated hash matches;
2. registry, name, record, and reverse account addresses are Arch PDAs derived
   from the configured namespace and program ID;
3. the name is active at the caller-supplied Arch slot;
4. a record is owned by the current name owner and its record epoch matches;
5. a reverse pointer references an active name owned by the reverse account
   owner with the same binding nonce.

The resolver is therefore a reference validator for RPC/indexer account data,
not a centralized source of truth. A production client must fetch the account
data from an Arch node and supply the canonical slot; it must not treat an
indexer's result as authoritative without these checks.

## Codec and derivation contract

- State and instruction payloads use Borsh's canonical little-endian encoding.
  `decode_state` rejects trailing bytes.
- Every account starts with an eight-byte discriminator, initialized marker,
  and `state_version = 1`.
- `name_hash = SHA256("arch-name-service:name-hash:v1\0" || canonical_name)`.
- Namespace values are represented in PDA seeds by
  `SHA256("arch-name-service:namespace:v1\0" || namespace)`.
- The PDA seed tags are `ans:config:v1`, `ans:name:v1`, `ans:record:v1`, and
  `ans:reverse:v1`; address derivation uses `arch_program::Pubkey::find_program_address`.
- A Taproot record stores only the 32-byte v1 witness program. Its Bech32m
  string is parsed/re-encoded against the configured Bitcoin network.
- A token record contains a token ID and ATA. Its ATA is re-derived from
  `(owner, configured token-program ID, token ID)` under the configured
  associated-token-program ID.

## Future on-chain program prerequisites

The Arch repository supports Rust programs built against `arch_program` and
Borsh. The `NameInstruction` enum is the wire-level interface for phase 2;
the actual program must enforce signer authorization, reallocation/rent, clock
access, payment policy, and atomic account writes.

Before a testnet deployment, provide and review:

- a unique program ID and `RegistryConfig` PDA;
- testnet `network_id`, `.arch` namespace, Bitcoin address policy, configured
  token and ATA program IDs, registrar/pricing policy, and grace period;
- an admin/multisig and upgrade authority distinct from any future mainnet
  authority;
- an Arch testnet RPC endpoint plus a funded deployment signer;
- integration tests against the deployed program for registration, transfer,
  expiry/reclaim, revision conflicts, and reverse binding changes.

No deployment manifest, program ID, funded signer, or on-chain registry
program is present in this milestone, so it is not deployable by itself.
