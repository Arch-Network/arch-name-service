import { labelFromCanonical } from "./register-handoff";
import { QUOTE_DECIMALS } from "./quote-amount";

export type MarketplaceEntry = {
  name: string;
  ownerDisplay: string;
  registeredAtSlot: bigint;
  listing?: {
    currency: "Arch" | "Btc";
    price: bigint;
  } | null;
};

export type CollectionId =
  | "all"
  | "1-char"
  | "2-char"
  | "3-char"
  | "4-char"
  | "5-plus";

export type MarketplaceCollection = {
  id: CollectionId;
  title: string;
  description: string;
  /** Estimated namespace size for progress (letters+digits only for short lengths). */
  capacity: number | null;
};

export type MarketplaceSort =
  | "price-asc"
  | "price-desc"
  | "name-asc"
  | "name-desc"
  | "length-asc"
  | "length-desc"
  | "recent";

export const MARKETPLACE_COLLECTIONS: MarketplaceCollection[] = [
  {
    id: "all",
    title: "All names",
    description: "Every registered .arch name on testnet.",
    capacity: null,
  },
  {
    id: "1-char",
    title: "1 Character",
    description: "Single-character labels — the scarcest set.",
    capacity: 36,
  },
  {
    id: "2-char",
    title: "2 Characters",
    description: "Two-character labels.",
    capacity: 36 ** 2,
  },
  {
    id: "3-char",
    title: "3 Characters",
    description: "Three-character labels.",
    capacity: 36 ** 3,
  },
  {
    id: "4-char",
    title: "4 Characters",
    description: "Four-character labels — SNS-style short names.",
    capacity: 36 ** 4,
  },
  {
    id: "5-plus",
    title: "5+ Characters",
    description: "Longer readable identities.",
    capacity: null,
  },
];

export function parseCollectionId(raw: string | null | undefined): CollectionId {
  switch (raw) {
    case "1-char":
    case "2-char":
    case "3-char":
    case "4-char":
    case "5-plus":
    case "all":
      return raw;
    default:
      return "all";
  }
}

export function labelLength(name: string): number {
  try {
    return labelFromCanonical(name).length;
  } catch {
    const trimmed = name.trim().toLowerCase();
    if (trimmed.endsWith(".arch")) return Math.max(0, trimmed.length - ".arch".length);
    return trimmed.length;
  }
}

export function lengthBadge(name: string): string {
  const len = labelLength(name);
  return len >= 5 ? "5+" : `${len}`;
}

/**
 * Sort key from the human-readable amount (display units × 1e8).
 * Mixed ARCH/aBTC ranks by magnitude until a real FX oracle exists.
 */
export function listingPriceSortKey(
  listing: NonNullable<MarketplaceEntry["listing"]>,
): bigint {
  const decimals = QUOTE_DECIMALS[listing.currency];
  const scale = 10n ** BigInt(decimals);
  return (listing.price * 100_000_000n) / scale;
}

export function entryMatchesCollection(
  entry: MarketplaceEntry,
  collectionId: CollectionId,
): boolean {
  if (collectionId === "all") return true;
  const len = labelLength(entry.name);
  switch (collectionId) {
    case "1-char":
      return len === 1;
    case "2-char":
      return len === 2;
    case "3-char":
      return len === 3;
    case "4-char":
      return len === 4;
    case "5-plus":
      return len >= 5;
    default:
      return true;
  }
}

export function uniqueOwnerCount(entries: ReadonlyArray<MarketplaceEntry>): number {
  return new Set(entries.map((e) => e.ownerDisplay)).size;
}

export function collectionStats(
  entries: ReadonlyArray<MarketplaceEntry>,
  collection: MarketplaceCollection,
): { registered: number; owners: number; capacity: number | null } {
  const filtered = entries.filter((e) => entryMatchesCollection(e, collection.id));
  return {
    registered: filtered.length,
    owners: uniqueOwnerCount(filtered),
    capacity: collection.capacity,
  };
}

export function filterMarketplaceEntries(
  entries: ReadonlyArray<MarketplaceEntry>,
  opts: {
    collectionId: CollectionId;
    query?: string;
  },
): MarketplaceEntry[] {
  const q = opts.query?.trim().toLowerCase() ?? "";
  return entries.filter((entry) => {
    if (!entryMatchesCollection(entry, opts.collectionId)) return false;
    if (!q) return true;
    return (
      entry.name.toLowerCase().includes(q) ||
      entry.ownerDisplay.toLowerCase().includes(q)
    );
  });
}

function compareBigint(a: bigint, b: bigint): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

export function sortMarketplaceEntries(
  entries: ReadonlyArray<MarketplaceEntry>,
  sort: MarketplaceSort,
): MarketplaceEntry[] {
  const next = [...entries];
  next.sort((a, b) => {
    switch (sort) {
      case "price-asc":
      case "price-desc": {
        const aKey = a.listing ? listingPriceSortKey(a.listing) : null;
        const bKey = b.listing ? listingPriceSortKey(b.listing) : null;
        if (aKey === null && bKey === null) return a.name.localeCompare(b.name);
        if (aKey === null) return 1;
        if (bKey === null) return -1;
        const d = compareBigint(aKey, bKey);
        if (d !== 0) return sort === "price-asc" ? d : -d;
        return a.name.localeCompare(b.name);
      }
      case "name-desc":
        return a.name > b.name ? -1 : a.name < b.name ? 1 : 0;
      case "length-asc": {
        const d = labelLength(a.name) - labelLength(b.name);
        return d !== 0 ? d : a.name.localeCompare(b.name);
      }
      case "length-desc": {
        const d = labelLength(b.name) - labelLength(a.name);
        return d !== 0 ? d : a.name.localeCompare(b.name);
      }
      case "recent": {
        const d = compareBigint(b.registeredAtSlot, a.registeredAtSlot);
        return d !== 0 ? d : a.name.localeCompare(b.name);
      }
      case "name-asc":
      default:
        return a.name.localeCompare(b.name);
    }
  });
  return next;
}

export function listedCount(entries: ReadonlyArray<MarketplaceEntry>): number {
  return entries.filter((e) => !!e.listing).length;
}

export function explorePathForCollection(collectionId: CollectionId = "all"): string {
  if (collectionId === "all") return "/explore";
  return `/explore?collection=${encodeURIComponent(collectionId)}`;
}
