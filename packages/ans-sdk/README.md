# `@arch-network/ans-sdk`

TypeScript SDK for Arch Name Service (`.arch`) resolution and mutations.

## Install

```bash
npm install @arch-network/ans-sdk
```

## Resolve a name

```ts
import {
  AnsClient,
  createArchRpcTransport,
  loadTestnetManifest,
} from "@arch-network/ans-sdk";

const client = new AnsClient(
  loadTestnetManifest(),
  createArchRpcTransport("https://id.arch.network/rpc"),
);

const owner = await client.resolveOwner("alice.arch");
const primary = await client.resolvePrimary(owner);
```

## Mutate (register / record / primary / transfer)

Build instructions with `client.buildRegister(...)` etc., then sign the
message hash with `window.arch.signArchMessageHash` and submit through the
SDK transport. See `signAndSendInstruction` and `makeAnsSigner`.

## Protocol parity

Fixtures in `fixtures/protocol.json` are generated from Rust:

```bash
cargo run -p ans-fixtures -- packages/ans-sdk/fixtures
cd packages/ans-sdk && npm test
```

Mainnet manifests are supported after a successful `ans-mainnet-deploy` records
the live program id into `manifests/mainnet.json`. Until then,
`loadMainnetManifest()` refuses all-zero placeholders. See
`docs/MAINNET_DEPLOYMENT.md`.
