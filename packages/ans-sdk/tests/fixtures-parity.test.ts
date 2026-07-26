import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  assertManifestConsistency,
  canonicalizeName,
  decodeInstruction,
  decodeNameAccount,
  decodeRecordAccount,
  decodeRegistryConfig,
  decodeReverseAccount,
  deriveConfigAddress,
  deriveNameAddress,
  deriveRecordAddress,
  deriveReverseAddress,
  deriveTokenAta,
  encodeInstruction,
  encodeNameAccount,
  encodeRecordAccount,
  encodeRegistryConfig,
  encodeReverseAccount,
  encodeTaprootAddress,
  hexToBytes,
  loadTestnetManifest,
  nameHash,
  resolveOwner,
  resolvePrimary,
  resolveRecord,
} from "../src/index.js";
import { namespaceHash as hashNamespace } from "../src/hash.js";

const fixtures = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../fixtures/protocol.json"),
    "utf8",
  ),
) as {
  program_id: string;
  owner: string;
  names: { canonical: string; name_hash: string; namespace_hash: string };
  derivations: {
    config: string;
    name: string;
    record_arch_owner: string;
    reverse: string;
    token_ata: string;
  };
  accounts: {
    registry_config: string;
    name_account: string;
    record_account: string;
    reverse_account: string;
  };
  instructions: Record<string, string>;
  resolution: {
    owner_active_ok: boolean;
    owner_inactive_error: string;
    stale_record_error: string;
    primary_ok: string;
  };
  taproot: { witness_program: string; testnet_address: string };
};

describe("Rust fixture parity", () => {
  const programId = hexToBytes(fixtures.program_id);
  const owner = hexToBytes(fixtures.owner);

  it("matches name hashing and canonicalization", () => {
    expect(canonicalizeName("alice.arch")).toBe(fixtures.names.canonical);
    expect(Buffer.from(nameHash("alice.arch")).toString("hex")).toBe(
      fixtures.names.name_hash,
    );
    expect(Buffer.from(hashNamespace(".arch")).toString("hex")).toBe(
      fixtures.names.namespace_hash,
    );
  });

  it("matches PDA derivations", () => {
    const config = decodeRegistryConfig(hexToBytes(fixtures.accounts.registry_config));
    const hash = nameHash("alice.arch");
    expect(
      Buffer.from(
        deriveConfigAddress(programId, config.networkId, config.namespace),
      ).toString("hex"),
    ).toBe(fixtures.derivations.config);
    expect(
      Buffer.from(deriveNameAddress(programId, ".arch", hash)).toString("hex"),
    ).toBe(fixtures.derivations.name);
    expect(
      Buffer.from(
        deriveRecordAddress(programId, ".arch", hash, "ArchOwner"),
      ).toString("hex"),
    ).toBe(fixtures.derivations.record_arch_owner);
    expect(
      Buffer.from(deriveReverseAddress(programId, ".arch", owner)).toString("hex"),
    ).toBe(fixtures.derivations.reverse);
    expect(
      Buffer.from(
        deriveTokenAta(owner, hexToBytes("03".repeat(32)), hexToBytes("02".repeat(32)), hexToBytes("04".repeat(32))),
      ).toString("hex"),
    ).toBe(fixtures.derivations.token_ata);
  });

  it("round-trips account codecs against Rust bytes", () => {
    const registryBytes = hexToBytes(fixtures.accounts.registry_config);
    const nameBytes = hexToBytes(fixtures.accounts.name_account);
    const recordBytes = hexToBytes(fixtures.accounts.record_account);
    const reverseBytes = hexToBytes(fixtures.accounts.reverse_account);

    expect(Buffer.from(encodeRegistryConfig(decodeRegistryConfig(registryBytes))).toString("hex")).toBe(
      fixtures.accounts.registry_config,
    );
    expect(Buffer.from(encodeNameAccount(decodeNameAccount(nameBytes))).toString("hex")).toBe(
      fixtures.accounts.name_account,
    );
    expect(Buffer.from(encodeRecordAccount(decodeRecordAccount(recordBytes))).toString("hex")).toBe(
      fixtures.accounts.record_account,
    );
    expect(Buffer.from(encodeReverseAccount(decodeReverseAccount(reverseBytes))).toString("hex")).toBe(
      fixtures.accounts.reverse_account,
    );
  });

  it("matches instruction encodings", () => {
    const hash = nameHash("alice.arch");
    expect(
      Buffer.from(
        encodeInstruction({
          kind: "InitializeRegistry",
          networkId: 2,
          namespaceAuthority: hexToBytes("08".repeat(32)),
        }),
      ).toString("hex"),
    ).toBe(fixtures.instructions.initialize_registry);
    expect(
      Buffer.from(
        encodeInstruction({ kind: "Register", label: "alice", durationSlots: 0n }),
      ).toString("hex"),
    ).toBe(fixtures.instructions.register);
    expect(
      Buffer.from(
        encodeInstruction({
          kind: "Transfer",
          nameHash: hash,
          newOwner: hexToBytes("05".repeat(32)),
        }),
      ).toString("hex"),
    ).toBe(fixtures.instructions.transfer);
    expect(
      Buffer.from(
        encodeInstruction({
          kind: "SetRecord",
          nameHash: hash,
          recordType: "ArchOwner",
          value: { kind: "ArchOwner", owner },
          expectedRevision: 0n,
        }),
      ).toString("hex"),
    ).toBe(fixtures.instructions.set_record_arch_owner);
    expect(
      Buffer.from(encodeInstruction({ kind: "SetPrimary", nameHash: hash })).toString("hex"),
    ).toBe(fixtures.instructions.set_primary);
    expect(Buffer.from(encodeInstruction({ kind: "ClearPrimary" })).toString("hex")).toBe(
      fixtures.instructions.clear_primary,
    );

    for (const [key, hex] of Object.entries(fixtures.instructions)) {
      expect(decodeInstruction(hexToBytes(hex)).kind.length).toBeGreaterThan(0);
      void key;
    }
  });

  it("matches resolution predicates", () => {
    const config = {
      address: hexToBytes(fixtures.derivations.config),
      state: decodeRegistryConfig(hexToBytes(fixtures.accounts.registry_config)),
    };
    const name = {
      address: hexToBytes(fixtures.derivations.name),
      state: decodeNameAccount(hexToBytes(fixtures.accounts.name_account)),
    };
    const record = {
      address: hexToBytes(fixtures.derivations.record_arch_owner),
      state: decodeRecordAccount(hexToBytes(fixtures.accounts.record_account)),
    };
    const reverse = {
      address: hexToBytes(fixtures.derivations.reverse),
      state: decodeReverseAccount(hexToBytes(fixtures.accounts.reverse_account)),
    };

    expect(resolveOwner(programId, config, "alice.arch", name, 199n)).toEqual(owner);
    expect(() => resolveOwner(programId, config, "alice.arch", name, 200n)).toThrowError(
      /InactiveName/,
    );
    expect(() =>
      resolveRecord(programId, config, "alice.arch", name, record, "ArchOwner", 150n),
    ).toThrowError(/StaleRecord/);
    expect(resolvePrimary(programId, config, reverse, name, 150n)).toBe(
      fixtures.resolution.primary_ok,
    );
  });

  it("matches taproot encoding", () => {
    expect(
      encodeTaprootAddress(hexToBytes(fixtures.taproot.witness_program), "testnet"),
    ).toBe(fixtures.taproot.testnet_address);
  });

  it("validates the frozen testnet manifest PDA", () => {
    const manifest = loadTestnetManifest();
    expect(() => assertManifestConsistency(manifest)).not.toThrow();
  });
});
