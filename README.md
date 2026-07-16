# Arch Name Service

An on-chain naming protocol for the `.arch` namespace on Arch Network. It is testnet-first, with explicit network configuration and migration gates so the same protocol can graduate to mainnet without changing name semantics.

## Scope

- Register and renew normalized `.arch` names.
- Transfer names through owner-authorized instructions.
- Resolve a name to its Arch owner address.
- Resolve an Arch owner address back to its primary `.arch` name.
- Publish typed, versioned, owner-bound records for:
  - Arch owner addresses
  - Bitcoin Taproot addresses
  - token associated token accounts (ATAs)

This project takes architectural inspiration from Solana Name Service's account-oriented naming model, but is an independent design. In particular, records cannot outlive a transfer: their authority is bound to the current name owner and every mutation advances an on-chain version.

## Protocol

The implementation contract is specified in [docs/PROTOCOL.md](docs/PROTOCOL.md). It defines the account state, instruction surface, canonical encoding, validation rules, security assumptions, rollout controls, and milestones.

## Repository plan

1. Implement deterministic derivation, state codecs, and pure validation tests.
2. Implement the registry program and testnet integration suite.
3. Release testnet client/CLI and operate through expiry and transfer scenarios.
4. Complete audit, mainnet readiness review, and deploy under a separately approved mainnet configuration.

## Status

Protocol specification phase. No production deployment, token, or mainnet launch is implied by this repository.
