import { describe, expect, it } from "vitest";
import {
  collectionStats,
  entryMatchesCollection,
  filterMarketplaceEntries,
  labelLength,
  lengthBadge,
  listingPriceSortKey,
  parseCollectionId,
  sortMarketplaceEntries,
  uniqueOwnerCount,
  type MarketplaceEntry,
} from "./marketplace";

const entries: MarketplaceEntry[] = [
  { name: "a.arch", ownerDisplay: "owner1", registeredAtSlot: 1n },
  { name: "ab.arch", ownerDisplay: "owner1", registeredAtSlot: 2n },
  { name: "abc.arch", ownerDisplay: "owner2", registeredAtSlot: 3n },
  { name: "abcd.arch", ownerDisplay: "owner3", registeredAtSlot: 4n },
  { name: "alice.arch", ownerDisplay: "owner3", registeredAtSlot: 5n },
];

describe("marketplace helpers", () => {
  it("parses collection ids with a safe default", () => {
    expect(parseCollectionId("3-char")).toBe("3-char");
    expect(parseCollectionId("nope")).toBe("all");
    expect(parseCollectionId(null)).toBe("all");
  });

  it("measures label length from canonical names", () => {
    expect(labelLength("alice.arch")).toBe(5);
    expect(labelLength("ab.arch")).toBe(2);
    expect(lengthBadge("alice.arch")).toBe("5+");
    expect(lengthBadge("abcd.arch")).toBe("4");
  });

  it("filters by collection length buckets", () => {
    expect(entries.filter((e) => entryMatchesCollection(e, "1-char")).map((e) => e.name)).toEqual([
      "a.arch",
    ]);
    expect(entries.filter((e) => entryMatchesCollection(e, "4-char")).map((e) => e.name)).toEqual([
      "abcd.arch",
    ]);
    expect(entries.filter((e) => entryMatchesCollection(e, "5-plus")).map((e) => e.name)).toEqual([
      "alice.arch",
    ]);
  });

  it("counts unique owners and collection stats", () => {
    expect(uniqueOwnerCount(entries)).toBe(3);
    expect(
      collectionStats(entries, {
        id: "all",
        title: "All",
        description: "",
        capacity: null,
      }),
    ).toEqual({ registered: 5, owners: 3, capacity: null });
  });

  it("filters by query and sorts", () => {
    const filtered = filterMarketplaceEntries(entries, {
      collectionId: "all",
      query: "ab",
    });
    expect(filtered.map((e) => e.name)).toEqual(["ab.arch", "abc.arch", "abcd.arch"]);

    expect(
      sortMarketplaceEntries(filtered, "length-desc").map((e) => e.name),
    ).toEqual(["abcd.arch", "abc.arch", "ab.arch"]);
  });

  it("sorts listed prices by human magnitude", () => {
    const priced: MarketplaceEntry[] = [
      {
        name: "cheap.arch",
        ownerDisplay: "a",
        registeredAtSlot: 1n,
        listing: { currency: "Arch", price: 2_500_000_000n },
      },
      {
        name: "mid.arch",
        ownerDisplay: "b",
        registeredAtSlot: 2n,
        listing: { currency: "Btc", price: 3_500_000_000n },
      },
      {
        name: "free.arch",
        ownerDisplay: "c",
        registeredAtSlot: 3n,
        listing: null,
      },
    ];
    expect(listingPriceSortKey(priced[0]!.listing!)).toBe(250_000_000n);
    expect(listingPriceSortKey(priced[1]!.listing!)).toBe(3_500_000_000n);
    expect(sortMarketplaceEntries(priced, "price-asc").map((e) => e.name)).toEqual([
      "cheap.arch",
      "mid.arch",
      "free.arch",
    ]);
    expect(sortMarketplaceEntries(priced, "price-desc").map((e) => e.name)).toEqual([
      "mid.arch",
      "cheap.arch",
      "free.arch",
    ]);
  });
});
