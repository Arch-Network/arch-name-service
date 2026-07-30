/**
 * "My names" showed an empty list to a user who owned four names.
 *
 * Two causes, both under test here. The wallet reports the account bound
 * to this origin while signing with its active account, so registrations
 * land on an account the header is not showing — a lookup scoped to the
 * reported account alone is correct about one account and wrong about the
 * wallet. And a lookup that throws must never render as "no names": that
 * is the single outcome a user cannot tell apart from the truth.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import bs58 from "bs58";
import { canonicalArchKeyHex } from "./arch-identity";
import {
  connectedAccountNames,
  firstLookupError,
  loadOwnedNames,
  nameLookupAccounts,
  otherAccountNames,
  totalNameCount,
  type OwnedNamesReader,
} from "./owned-names";
import { __resetSignerRegistry, rememberSeenAccount } from "./signer-registry";

/** The two accounts from the live testnet report this module was written for. */
const REPORTED_HEX = "77d742653408dc836b269d0ba9d1448108c1c782fb544e5d4fa1538c64199d95";
const SIGNER_HEX = "786fbe3257bceb51a07e4f1b26f1c76ea31fc8698f7cef782c42f6b7a64b1681";
function bytesOf(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g)!.map((byte) => Number.parseInt(byte, 16)));
}

function hexOf(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const REPORTED_B58 = bs58.encode(bytesOf(REPORTED_HEX));
const SIGNER_B58 = bs58.encode(bytesOf(SIGNER_HEX));

/**
 * A reader backed by a hex-keyed ownership table, so a test states "these
 * names belong to this key" and the canonicalization is what is under
 * test rather than something the fixture has to reproduce.
 */
function readerFor(
  owned: Record<string, string[]>,
  options: {
    failFor?: string[];
    records?: Record<string, number>;
    failRecords?: boolean;
    primary?: Record<string, string>;
  } = {},
): OwnedNamesReader {
  return {
    listOwnedNames: vi.fn(async (owner: Uint8Array) => {
      const hex = hexOf(owner);
      if (options.failFor?.includes(hex)) {
        throw new Error(`Arch RPC HTTP 502 for ${hex.slice(0, 8)}`);
      }
      return (owned[hex] ?? []).map((name) => ({ name, account: { owner } }));
    }),
    fetchRecord: vi.fn(async (name: string) => {
      if (options.failRecords) throw new Error("record lookup failed");
      return (options.records?.[name] ?? 0) > 0 ? {} : null;
    }),
    resolvePrimary: vi.fn(async (owner: Uint8Array) => options.primary?.[hexOf(owner)] ?? null),
  };
}

beforeEach(() => {
  __resetSignerRegistry();
});

describe("nameLookupAccounts", () => {
  it("puts the reported account first and adds every other account the wallet named", () => {
    rememberSeenAccount(SIGNER_B58);
    rememberSeenAccount(REPORTED_B58);
    expect(nameLookupAccounts(REPORTED_B58)).toEqual([REPORTED_B58, SIGNER_B58]);
  });

  it("never repeats an account that arrived in a different encoding", () => {
    rememberSeenAccount(REPORTED_HEX);
    rememberSeenAccount(`0x${SIGNER_HEX.toUpperCase()}`);
    const accounts = nameLookupAccounts(REPORTED_B58);
    expect(accounts.map(canonicalArchKeyHex)).toEqual([REPORTED_HEX, SIGNER_HEX]);
  });

  it("has nothing to look up without a reported account", () => {
    expect(nameLookupAccounts(null)).toEqual([]);
  });
});

describe("loadOwnedNames ownership matching", () => {
  it.each([
    ["base58", REPORTED_B58],
    ["lowercase hex", REPORTED_HEX],
    ["uppercase 0x hex", `0x${REPORTED_HEX.toUpperCase()}`],
    ["33-byte compressed key", bs58.encode(bytesOf(`02${REPORTED_HEX}`))],
  ])("finds the owner's names when the wallet reports %s", async (_label, address) => {
    const reader = readerFor({ [REPORTED_HEX]: ["brian.arch"] });
    const result = await loadOwnedNames(reader, address);
    expect(result.failed).toBe(false);
    expect(connectedAccountNames(result)?.names.map((n) => n.name)).toEqual(["brian.arch"]);
  });

  it("reports an address it cannot read as a key instead of as zero names", async () => {
    const reader = readerFor({});
    const result = await loadOwnedNames(reader, "not-an-arch-address");
    expect(result.failed).toBe(true);
    expect(firstLookupError(result)?.message).toContain("cannot read as an account key");
    expect(reader.listOwnedNames).not.toHaveBeenCalled();
  });

  it("returns the owner in base58 so Explorer links resolve", async () => {
    const reader = readerFor({ [REPORTED_HEX]: ["brian.arch"] });
    const result = await loadOwnedNames(reader, REPORTED_HEX);
    expect(connectedAccountNames(result)?.names[0]?.ownerArchAddress).toBe(REPORTED_B58);
  });
});

describe("loadOwnedNames failure handling", () => {
  it("surfaces a lookup failure rather than an empty list", async () => {
    const reader = readerFor({ [REPORTED_HEX]: ["brian.arch"] }, { failFor: [REPORTED_HEX] });
    const result = await loadOwnedNames(reader, REPORTED_B58);
    expect(result.failed).toBe(true);
    const connected = connectedAccountNames(result);
    expect(connected?.error).toBeInstanceOf(Error);
    expect(connected?.names).toEqual([]);
    expect(firstLookupError(result)?.message).toContain("Arch RPC HTTP 502");
  });

  it("keeps a healthy account's names when another account's lookup fails", async () => {
    rememberSeenAccount(SIGNER_B58);
    const reader = readerFor(
      { [SIGNER_HEX]: ["brian2.arch"] },
      { failFor: [REPORTED_HEX] },
    );
    const result = await loadOwnedNames(reader, REPORTED_B58);
    expect(result.failed).toBe(true);
    expect(otherAccountNames(result).map((a) => a.names.map((n) => n.name))).toEqual([
      ["brian2.arch"],
    ]);
  });

  it("prefers the connected account's failure when several fail", async () => {
    rememberSeenAccount(SIGNER_B58);
    const reader = readerFor({}, { failFor: [REPORTED_HEX, SIGNER_HEX] });
    const result = await loadOwnedNames(reader, REPORTED_B58);
    expect(firstLookupError(result)?.message).toContain(REPORTED_HEX.slice(0, 8));
  });

  it("marks record health unknown instead of dropping the name", async () => {
    const reader = readerFor({ [REPORTED_HEX]: ["brian.arch"] }, { failRecords: true });
    const result = await loadOwnedNames(reader, REPORTED_B58);
    expect(result.failed).toBe(false);
    expect(connectedAccountNames(result)?.names[0]?.recordCount).toBeNull();
  });

  it("keeps the list when the primary lookup fails", async () => {
    const reader = readerFor({ [REPORTED_HEX]: ["brian.arch"] });
    reader.resolvePrimary = vi.fn(async () => {
      throw new Error("reverse account unreadable");
    });
    const result = await loadOwnedNames(reader, REPORTED_B58);
    expect(result.failed).toBe(false);
    expect(connectedAccountNames(result)?.primary).toBeNull();
    expect(connectedAccountNames(result)?.names).toHaveLength(1);
  });
});

describe("loadOwnedNames across the wallet's accounts", () => {
  it("lists names held by a reported-but-not-current account, attributed to it", async () => {
    rememberSeenAccount(SIGNER_B58);
    const reader = readerFor(
      { [SIGNER_HEX]: ["brian2.arch", "brian3.arch", "brian4.arch"] },
      { primary: { [SIGNER_HEX]: "brian2.arch" } },
    );
    const result = await loadOwnedNames(reader, REPORTED_B58);

    expect(connectedAccountNames(result)?.names).toEqual([]);
    const others = otherAccountNames(result);
    expect(others).toHaveLength(1);
    expect(others[0]?.archAddress).toBe(SIGNER_B58);
    expect(others[0]?.connected).toBe(false);
    expect(others[0]?.primary).toBe("brian2.arch");
    expect(others[0]?.names.map((n) => n.name)).toEqual([
      "brian2.arch",
      "brian3.arch",
      "brian4.arch",
    ]);
    expect(totalNameCount(result)).toBe(3);
  });

  it("does not list an account the wallet has reported but that owns nothing", async () => {
    rememberSeenAccount(SIGNER_B58);
    const reader = readerFor({ [REPORTED_HEX]: ["brian.arch"] });
    const result = await loadOwnedNames(reader, REPORTED_B58);
    expect(otherAccountNames(result)).toEqual([]);
    expect(totalNameCount(result)).toBe(1);
  });

  it("says zero honestly when nothing failed and nothing is owned", async () => {
    const reader = readerFor({});
    const result = await loadOwnedNames(reader, REPORTED_B58);
    expect(result.failed).toBe(false);
    expect(firstLookupError(result)).toBeNull();
    expect(connectedAccountNames(result)?.names).toEqual([]);
    expect(otherAccountNames(result)).toEqual([]);
    expect(totalNameCount(result)).toBe(0);
  });
});
