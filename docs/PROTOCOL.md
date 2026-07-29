# Arch Name Service Protocol Specification

## 1. Goals and terminology

Arch Name Service (ANS) provides a canonical, expiring registry for the `.arch` namespace. A **name** is the normalized label plus `.arch`; its **owner** is an Arch address authorized to manage the name; and a **record** is a typed resolution value managed only by the current owner.

This specification is intentionally implementation-oriented while remaining independent of a specific SDK or framework. The deployed program must use Arch's canonical account, signer, and transaction primitives and must not substitute off-chain state for authorization or resolution.

## 2. Canonical names and identifiers

The program accepts a label, not a free-form domain. Initial policy:

- lowercase ASCII `a-z`, digits `0-9`, and single interior hyphens only;
- length 1–63 bytes;
- no leading/trailing hyphen and no `--`;
- suffix is fixed by the program configuration as `.arch`.

The canonical name is UTF-8 `label + ".arch"`. `name_hash` is a domain-separated hash of that canonical value. Program-derived registry and record account addresses use domain-separated seeds, including the configured namespace and `name_hash`; the exact hash and derivation algorithm are versioned program constants. Clients must derive addresses rather than trust indexes supplied by an RPC response.

## 3. Account model

All state includes `state_version`, a discriminator, and an initialization marker. Fixed-width fields use explicitly documented byte order; variable values are length-prefixed and bounded.

### 3.1 `RegistryConfig`

One account per deployment:

- `program_version`, `network_id`, `namespace`, `state_version`
- `admin` and optional `pending_admin`
- `registrar` authority or pricing-policy account
- `grace_period_slots`, minimum/maximum registration duration
- registration and renewal policy identifiers
- `paused` and irreversible `mainnet_enabled` gates

The config does not hold mutable per-name authority.

### 3.2 `NameAccount`

One deterministic account per canonical name:

- `name_hash`, canonical-label commitment, `state_version`
- `owner: ArchAddress`
- `registered_at_slot`, `expires_at_slot`
- `record_epoch: u64`
- `primary_binding_nonce: u64`

An unregistered or expired name may have a tombstone only if required by Arch account allocation rules. It must never be resolved as active.

### 3.3 `RecordAccount`

One deterministic account per `(name_hash, record_type)`:

- `name_hash`, `record_type`, `state_version`
- `owner_snapshot: ArchAddress`
- `record_epoch: u64`
- `revision: u64`
- `value_hash` and bounded encoded `value`
- `updated_at_slot`

`owner_snapshot` must equal `NameAccount.owner`, and `record_epoch` must equal `NameAccount.record_epoch` for a record to resolve. A transfer increments the name epoch, invalidating every prior record without requiring an unbounded deletion loop. A new owner must explicitly republish records.

### 3.4 `ReverseAccount`

One deterministic account per Arch owner address:

- `owner: ArchAddress`
- `primary_name_hash`
- `binding_nonce`
- `updated_at_slot`, `state_version`

The reverse account is valid only when its referenced name is active and owned by `owner`; clients must verify this relationship. It is a convenience pointer, not an independent ownership claim.

## 4. Instructions

Each instruction checks program version, account derivations, state versions, and all signer requirements before state changes. Instructions emit structured events containing a name hash, actor, and relevant version/epoch values.

| Instruction | Required signer | Effects |
| --- | --- | --- |
| `register(label, duration)` | new owner | Validates availability and duration, collects policy-defined payment, initializes or reclaims the name, assigns owner, expiry, and a fresh record epoch. |
| `renew(name, duration)` | current owner or approved renewal payer | Extends an active name, or a name in the configured grace period, within duration and pricing policy. Does not alter records. |
| `transfer(name, new_owner)` | current owner | Requires active name and nonzero destination, changes owner, increments `record_epoch`, clears primary binding eligibility, and emits a transfer event. |
| `set_record(name, type, value, expected_revision)` | current owner | Requires active name; validates typed value; creates or updates the record with current owner/epoch and monotonically increases revision. |
| `delete_record(name, type, expected_revision)` | current owner | Deletes only a record bound to the current owner/epoch. |
| `set_primary(name)` | current owner | Requires active name; writes the caller's reverse pointer after checking the name owner; replaces the caller's former pointer atomically. |
| `clear_primary()` | Arch owner | Removes the caller's reverse pointer. |
| `reclaim_expired(label)` | new owner | May run only after expiry plus grace period. Reinitializes lifecycle fields and invalidates prior records via a fresh epoch. |
| `update_config(...)` | config admin | Testnet-only governance operation subject to delay/multisig policy; mainnet controls are restricted before launch. |

Expiry comparisons use the Arch canonical block-height or slot clock, chosen once in `RegistryConfig`; no wall-clock timestamp is trusted for validity.

## 5. Typed record validation

Records are typed for Arch-native destinations and extensible UTF-8 for
SNS-parity identity/payment/content keys. Unknown `RecordType` discriminants
are rejected. Supported types:

1. `ARCH_OWNER` — exactly one canonical Arch address. It must equal the current `NameAccount.owner`; publishing an alias is not permitted. This is the default Arch payment destination (like SNS owner when no SOL record is set).
2. `BITCOIN_TAPROOT` — a canonical Bitcoin SegWit v1, 32-byte witness-program address. Network HRP must match the configured network policy (for example, testnet/signet versus mainnet). Decode and re-encode before storage to eliminate alternate encodings.
3. `TOKEN_ATA` — `token_id` plus an ATA address. The program verifies the address is the canonical associated-token-account derivation for `(NameAccount.owner, token_id)` under the configured token-program IDs. It rejects an arbitrary token account, a mismatched authority, or an unsupported token program. Gated when `token_programs` is empty.
4. `TEXT` — UTF-8 `{ key, value }` profile rows (ETH, URL, Discord, IPFS, …). Keys are lowercase `[a-z0-9_-]{1,32}`; values are printable ASCII up to 256 bytes. PDA seeds include a domain-separated key hash so the catalog can grow without new enum variants. Client SDKs apply format checks for known keys (e.g. ETH `0x` + 40 hex); the program enforces key/value shape and size only.

The codec has a maximum value size per type. Each update requires `expected_revision`, preventing a signer from silently overwriting a value after a client observed stale state. Resolution returns the value only when the name is active, account derivations match, `owner_snapshot` and `record_epoch` match the current name, and the record codec version is supported.

## 6. Lifecycle and resolution

`available` means no active registration and no grace period. `active` means current slot is before `expires_at_slot`. `grace` permits owner renewal but does not permit normal resolution. `expired` follows grace and is reclaimable. Transfers and record writes require `active`; renewal follows the policy above.

Forward resolution performs: canonicalize input, derive `NameAccount`, verify active lifecycle, then return the owner or a requested validated record. Reverse resolution derives `ReverseAccount`, loads its `NameAccount`, and returns the name only after ownership and active-lifecycle checks. Indexers may accelerate discovery, but clients must validate these same on-chain predicates.

## 7. Testnet-first, mainnet-ready rollout

Testnet deployment starts with a hard-coded testnet `network_id`, testnet address policy, manual allowlist or zero-price registration policy, short expiries, and a clearly labeled faucet/payment path. Mainnet-sensitive constants—namespace owner, payment recipient, token-program IDs, admin threshold, pricing policy, grace period, and upgrade policy—are configured separately and never inferred from the client network.

Before mainnet, run an account-layout compatibility review, property/fuzz tests for canonicalization and codecs, lifecycle tests across expiry boundaries, transfer/record invalidation tests, multi-signer authorization tests, indexer-vs-chain resolution tests, an independent audit, and a public testnet migration/replay exercise. Mainnet launch requires a new deployment/configuration approval; testnet authority must not automatically control mainnet.

## 8. Security assumptions and non-goals

ANS relies on Arch transaction signature correctness, deterministic address derivation, the configured canonical clock, and the integrity of configured token/ATA derivation rules. Lost owner keys are not recoverable by the protocol. An owner can publish an incorrect external Bitcoin address; validation proves format and network, not control of that address.

The protocol does not provide DNS interoperability, privacy, identity verification, dispute resolution, or recovery guardians in its initial scope. Registrations must be considered namespaced resources, not trademarks or ownership claims outside the protocol.

## 9. Milestones

1. **Protocol foundations:** publish state codecs, derivation vectors, error taxonomy, and pure validator tests.
2. **Registry program:** implement accounts and instructions with unit, integration, and adversarial lifecycle tests.
3. **Testnet alpha:** deploy a versioned testnet registry, CLI/SDK resolver, event indexer, and operational dashboards.
4. **Testnet hardening:** exercise transfers, expiry/reclaim, record invalidation, reverse resolution, upgrades, and incident runbooks.
5. **Mainnet readiness:** audit remediation, frozen deployment manifest, governance/signing ceremony, migration rehearsal, and go/no-go review.
