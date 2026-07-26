# ANS client release evidence

Captured: 2026-07-26

## Components

| Component | Location | Version / status |
|-----------|----------|------------------|
| Protocol fixtures | `tools/ans-fixtures`, `packages/ans-sdk/fixtures` | Generated + CI drift check |
| TypeScript SDK | `packages/ans-sdk` | `@arch-network/ans-sdk@0.1.0-testnet.0` |
| SDK tarball | `deployments/arch-network-ans-sdk-0.1.0-testnet.0.tgz` | sha256 `7d4bdad3a0b5eab1ff45c853cde54d16bb56f47e900c34ee9f7ca64aee497f2f` |
| Manager SPA | `apps/ans-manager` | Build + unit tests green; pins SDK via `file:` until npm publish |
| AWS hosting | `infra/cdk`, `.github/workflows/deploy-ans-manager.yml` | Infra ready; **live deploy gated** |
| Chrome wallet | `arch-wallet-hub` apps/chrome-wallet | Resolve + Send freeze + Receive/Header + Approve verified name |

## Frozen testnet manifest

- Program ID: `3d9fbaa282268d8453a924692f254ad6c610668f36512db9fb50325ac2e4e079`
- Registry config: `29691c11fb04be3e25c5f236dc7971cbb3293fc0f7a3bed288dc4cd476320521`
- Source: `packages/ans-sdk/manifests/testnet.json`
- Prior smoke txids (from on-chain smoke):
  - register `26831f6053c40d347708672510bded9158d8f5d8a1c22bf87cead3702f3e2f86`
  - set_record `7794168b79c3d49d95b9be23abc8630b640aafbeb4324a26689442b79a36fdb0`
  - set_primary `5f1eb131548f67ce6a3591eeae11d505097e6d982a824123bb38e02d32e04363`
  - transfer `1426070f96185595c2f69082d88bc3b4c819e34f766f6379bb74be5ea2bf8656`

## Verification run (this release)

```text
cargo run --locked -p ans-fixtures -- packages/ans-sdk/fixtures  # ok, no drift
cd packages/ans-sdk && npm test && npm run build                 # 7/7 parity tests
cd apps/ans-manager && npm test && npm run build                 # 2/2 + production build
cd apps/ans-manager && npm run smoke:read
# {
#   "networkId": 2,
#   "namespace": ".arch",
#   "programVersion": 1,
#   "registryConfig": "29691c11fb04be3e25c5f236dc7971cbb3293fc0f7a3bed288dc4cd476320521",
#   "smokePassed": true
# }
# resolveOwner ok { name: 'smoke1785070093.arch', ownerBytes: 32 }

chrome-wallet: npm test -- --run src/utils/__tests__/name-service.test.ts  # 5/5
```

## npm publish gate

`npm whoami` currently returns `401 Unauthorized` for this environment.
Prerelease artifact is packed locally:

```bash
cd packages/ans-sdk
npm run build
npm pack --pack-destination ../../deployments
# Then, with org credentials:
npm publish ../../deployments/arch-network-ans-sdk-0.1.0-testnet.0.tgz --tag testnet
```

Until publish succeeds, manager and Chrome wallet continue to use the monorepo `file:` dependency pointing at `packages/ans-sdk@0.1.0-testnet.0`.

## AWS deploy gate

Do not deploy `id.arch.network` until:

1. Target AWS account / `arch.network` hosted zone ID confirmed
2. Cost estimate accepted (~$1–5/month low traffic)
3. `cdk deploy` outputs bucket + distribution + OIDC role ARNs stored as GitHub Environment secrets
4. Manual workflow `deploy-ans-manager` run with `confirm_domain=id.arch.network`

## Mainnet

Mainnet remains disabled in SDK/manager/wallet until a separately approved mainnet freeze, audit, and smoke gate.
