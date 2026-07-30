import { describe, expect, it } from "vitest";
import { selectRecentNames } from "../src/client/ans-client.js";
import type { NameAccount } from "../src/types.js";

function name(label: string, slot: bigint): { name: string; account: NameAccount } {
  return {
    name: `${label}.arch`,
    account: {
      header: {
        discriminator: new Uint8Array(8),
        initialized: true,
        stateVersion: 1,
      },
      nameHash: new Uint8Array(32),
      canonicalLabel: label,
      owner: new Uint8Array(32),
      registeredAtSlot: slot,
      expiresAtSlot: 0n,
      recordEpoch: 1n,
      primaryBindingNonce: 0n,
    },
  };
}

describe("selectRecentNames", () => {
  it("orders by registeredAtSlot descending and caps the list", () => {
    const entries = [name("old", 10n), name("mid", 20n), name("new", 30n)];
    expect(selectRecentNames(entries, 2).map((e) => e.name)).toEqual([
      "new.arch",
      "mid.arch",
    ]);
  });

  it("breaks slot ties by name descending and ignores non-positive limits", () => {
    const entries = [name("b", 5n), name("a", 5n), name("c", 1n)];
    expect(selectRecentNames(entries, 2).map((e) => e.name)).toEqual([
      "b.arch",
      "a.arch",
    ]);
    expect(selectRecentNames(entries, 0)).toEqual([]);
    expect(selectRecentNames(entries, -3)).toEqual([]);
  });

  it("with all-zero slots, returns Z→A (reverse of alphabetical)", () => {
    const entries = [name("brian", 0n), name("test", 0n), name("alice", 0n)];
    expect(selectRecentNames(entries, 3).map((e) => e.name)).toEqual([
      "test.arch",
      "brian.arch",
      "alice.arch",
    ]);
  });
});
