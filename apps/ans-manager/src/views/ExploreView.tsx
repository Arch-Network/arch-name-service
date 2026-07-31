import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { bytesToHex } from "@arch-network/ans-sdk";
import bs58 from "bs58";
import { StatusNotice } from "../components/StatusNotice";
import { ansClient } from "../lib/ans";
import { shortArchAddress } from "../lib/arch-identity";
import { formatQuoteBaseUnits, quoteSymbol } from "../lib/quote-amount";
import {
  MARKETPLACE_COLLECTIONS,
  collectionFloors,
  collectionStats,
  explorePathForCollection,
  filterMarketplaceEntries,
  lengthBadge,
  listedCount,
  marketplaceFloors,
  newestListings,
  parseCollectionId,
  sortMarketplaceEntries,
  topListingsByPrice,
  type CollectionId,
  type MarketplaceEntry,
  type MarketplaceSort,
} from "../lib/marketplace";
import { viewPathForName } from "../lib/register-handoff";
import {
  EMPTY_REGISTRY_TIMELINE,
  fetchRegistryTimeline,
} from "../lib/registry-activity";

function formatCapacity(registered: number, capacity: number | null): string {
  if (capacity == null) return String(registered);
  return `${registered.toLocaleString()} / ${capacity.toLocaleString()}`;
}

function formatListingPrice(entry: MarketplaceEntry): string {
  const listing = entry.listing;
  if (!listing) return "—";
  return `${formatQuoteBaseUnits(listing.price, listing.currency)} ${quoteSymbol(listing.currency)}`;
}

function PulseColumn({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: MarketplaceEntry[];
}) {
  return (
    <div className="explore-pulse-col">
      <p className="explore-pulse-heading">{title}</p>
      {rows.length === 0 ? (
        <p className="explore-pulse-empty">{empty}</p>
      ) : (
        <ul className="explore-pulse-list">
          {rows.map((entry) => (
            <li key={`${title}-${entry.name}`}>
              <Link className="explore-pulse-row" to={viewPathForName(entry.name)}>
                <span className="explore-pulse-name mono">{entry.name}</span>
                <span className="explore-pulse-price mono">{formatListingPrice(entry)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ExploreView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const collectionId = parseCollectionId(searchParams.get("collection"));
  const [entries, setEntries] = useState<MarketplaceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<MarketplaceSort>("price-asc");
  const [listedOnly, setListedOnly] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([
      ansClient.listNameAccounts(),
      ansClient.listActiveListings(),
      // Recency lives in the Explorer, not on chain (see registry-activity).
      // A missing feed only costs ordering, so it must not fail the page.
      fetchRegistryTimeline().catch(() => EMPTY_REGISTRY_TIMELINE),
    ])
      .then(([rows, listings, timeline]) => {
        if (cancelled) return;
        const byName = new Map(
          listings.map((row) => [
            row.name,
            {
              currency: row.listing.currency,
              price: row.listing.price,
              listedAtSlot: row.listing.createdAtSlot,
              listedAt:
                timeline.listedAtByNameHash.get(bytesToHex(row.listing.nameHash)) ??
                null,
            },
          ]),
        );
        setEntries(
          rows.map((row) => ({
            name: row.name,
            ownerDisplay: bs58.encode(row.account.owner),
            registeredAtSlot: row.account.registeredAtSlot,
            registeredAt: timeline.registeredAtByName.get(row.name) ?? null,
            listing: byName.get(row.name) ?? null,
          })),
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const globalStats = useMemo(() => {
    const owners = new Set(entries.map((e) => e.ownerDisplay)).size;
    return {
      registered: entries.length,
      owners,
      listed: listedCount(entries),
      floors: marketplaceFloors(entries),
    };
  }, [entries]);

  const pulse = useMemo(
    () => ({
      lowest: topListingsByPrice(entries, "asc", 3),
      highest: topListingsByPrice(entries, "desc", 3),
      newest: newestListings(entries, 3),
      collectionFloors: collectionFloors(entries),
    }),
    [entries],
  );

  const collectionFilters = useMemo(
    () =>
      MARKETPLACE_COLLECTIONS.map((collection) => {
        const stats = collectionStats(entries, collection);
        const listed = listedCount(
          entries.filter((e) => entryMatches(e, collection.id)),
        );
        return { collection, stats, listed };
      }),
    [entries],
  );

  function entryMatches(entry: MarketplaceEntry, id: CollectionId): boolean {
    return filterMarketplaceEntries([entry], { collectionId: id }).length > 0;
  }

  const visible = useMemo(() => {
    let rows = filterMarketplaceEntries(entries, { collectionId, query });
    if (listedOnly) rows = rows.filter((e) => !!e.listing);
    return sortMarketplaceEntries(rows, sort);
  }, [collectionId, entries, listedOnly, query, sort]);

  function selectCollection(id: CollectionId) {
    if (id === "all") {
      setSearchParams({}, { replace: true });
      return;
    }
    setSearchParams({ collection: id }, { replace: true });
  }

  const resultLabel = loading
    ? "Loading…"
    : listedOnly
      ? `${visible.length.toLocaleString()} for sale`
      : `${visible.length.toLocaleString()} registered`;

  const floorArch = globalStats.floors.Arch;
  const floorBtc = globalStats.floors.Btc;

  return (
    <section className="page-section page-section-wide explore-page">
      <div className="hero explore-hero">
        <p className="eyebrow">Marketplace</p>
        <h1 className="page-title hero-title">Explore .arch names</h1>
        <p className="page-subtitle hero-copy">
          Fixed-price listings settle on-chain with ownership transfer.
        </p>
      </div>

      <div className="explore-stats" aria-label="Marketplace overview">
        <div className="explore-stat">
          <span className="explore-stat-label">Registered</span>
          <span className="explore-stat-value mono">
            {loading ? "…" : globalStats.registered.toLocaleString()}
          </span>
        </div>
        <div className="explore-stat">
          <span className="explore-stat-label">Owners</span>
          <span className="explore-stat-value mono">
            {loading ? "…" : globalStats.owners.toLocaleString()}
          </span>
        </div>
        <div className="explore-stat">
          <span className="explore-stat-label">Listed</span>
          <span className="explore-stat-value mono">
            {loading ? "…" : globalStats.listed.toLocaleString()}
          </span>
        </div>
        <div className="explore-stat">
          <span className="explore-stat-label">Floor</span>
          <span className="explore-stat-value mono explore-stat-floor">
            {loading
              ? "…"
              : !floorArch && !floorBtc
                ? "—"
                : [floorArch, floorBtc]
                    .filter(Boolean)
                    .map((entry) => formatListingPrice(entry!))
                    .join(" · ")}
          </span>
        </div>
      </div>

      {error ? (
        <StatusNotice
          tone="error"
          title="Could not load marketplace"
          message="The name index is temporarily unavailable. Try again in a moment."
          detail={error}
        />
      ) : null}

      {!loading && globalStats.listed > 0 ? (
        <section className="explore-pulse" aria-label="Marketplace highlights">
          <div className="explore-pulse-grid">
            <PulseColumn
              title="Lowest asks"
              empty="No listings yet."
              rows={pulse.lowest}
            />
            <PulseColumn
              title="Highest asks"
              empty="No listings yet."
              rows={pulse.highest}
            />
            <PulseColumn
              title="Newest listings"
              empty="No listings yet."
              rows={pulse.newest}
            />
          </div>
          {pulse.collectionFloors.length > 0 ? (
            <div className="explore-collection-floors" aria-label="Collection floors">
              {pulse.collectionFloors.map(({ collectionId: id, entry }) => {
                const title =
                  MARKETPLACE_COLLECTIONS.find((c) => c.id === id)?.title ?? id;
                return (
                  <Link
                    key={id}
                    className="explore-collection-floor"
                    to={explorePathForCollection(id)}
                  >
                    <span className="explore-collection-floor-label">{title} floor</span>
                    <span className="explore-collection-floor-price mono">
                      {formatListingPrice(entry)}
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : null}
          <p className="explore-pulse-note">
            Live asks from active on-chain listings. Completed sales will appear here once
            names start trading.
          </p>
        </section>
      ) : null}

      <div className="explore-collections" aria-label="Name collections">
        {collectionFilters.map(({ collection, stats, listed }) => {
          const selected = collection.id === collectionId;
          const count = listedOnly ? listed : stats.registered;
          const empty = !loading && count === 0 && collection.id !== "all";
          return (
            <button
              key={collection.id}
              type="button"
              className={`explore-collection-filter${selected ? " is-selected" : ""}${empty ? " is-empty" : ""}`}
              onClick={() => selectCollection(collection.id)}
              aria-pressed={selected}
              aria-disabled={empty}
              disabled={empty}
            >
              <span className="explore-collection-title">{collection.title}</span>
              <span className="explore-collection-count mono">
                {loading
                  ? "…"
                  : listedOnly
                    ? listed.toLocaleString()
                    : formatCapacity(stats.registered, stats.capacity)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="explore-browse">
        <div className="explore-toolbar">
          <p className="explore-toolbar-count">{resultLabel}</p>
          <div className="explore-toolbar-controls">
            <input
              className="input explore-toolbar-search"
              placeholder="Search names or owners"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
              aria-label="Search names or owners"
            />
            <select
              className="input explore-toolbar-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as MarketplaceSort)}
              aria-label="Sort listings"
            >
              <option value="price-asc">Price · low to high</option>
              <option value="price-desc">Price · high to low</option>
              <option value="listed-recent">Newest listings</option>
              <option value="recent">Recently registered</option>
              <option value="name-asc">Name A → Z</option>
              <option value="name-desc">Name Z → A</option>
              <option value="length-asc">Shortest first</option>
              <option value="length-desc">Longest first</option>
            </select>
            <div className="explore-segmented" role="group" aria-label="Availability">
              <button
                type="button"
                className={listedOnly ? "is-active" : undefined}
                aria-pressed={listedOnly}
                onClick={() => setListedOnly(true)}
              >
                For sale
              </button>
              <button
                type="button"
                className={!listedOnly ? "is-active" : undefined}
                aria-pressed={!listedOnly}
                onClick={() => setListedOnly(false)}
              >
                All
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <p className="explore-empty">Scanning on-chain name accounts…</p>
        ) : visible.length === 0 ? (
          <p className="explore-empty">
            {listedOnly
              ? "No names for sale in this collection."
              : "No names in this collection yet."}
            {collectionId !== "all" ? (
              <>
                {" "}
                <Link to={explorePathForCollection("all")}>View all</Link>
              </>
            ) : listedOnly ? (
              <>
                {" "}
                <button
                  type="button"
                  className="linkish"
                  onClick={() => setListedOnly(false)}
                >
                  Browse all registered
                </button>
              </>
            ) : null}
          </p>
        ) : (
          <>
            <div className="explore-list-head" aria-hidden="true">
              <span>Name</span>
              <span>Length</span>
              <span>Owner</span>
              <span className="explore-col-price">Price</span>
              <span />
            </div>
            <ul className="explore-list">
              {visible.map((entry) => {
                const href = viewPathForName(entry.name);
                return (
                  <li key={entry.name}>
                    <Link className="explore-name-row" to={href}>
                      <span className="explore-name-label mono">{entry.name}</span>
                      <span className="explore-length-badge">{lengthBadge(entry.name)}</span>
                      <span className="explore-name-owner mono" title={entry.ownerDisplay}>
                        {shortArchAddress(entry.ownerDisplay)}
                      </span>
                      {entry.listing ? (
                        <span className="explore-name-price">
                          <span className="explore-price-amount mono">
                            {formatQuoteBaseUnits(entry.listing.price, entry.listing.currency)}
                          </span>
                          <span className="explore-price-unit">
                            {quoteSymbol(entry.listing.currency)}
                          </span>
                        </span>
                      ) : (
                        <span className="explore-name-meta explore-col-price">—</span>
                      )}
                      <span className="explore-row-action">
                        {entry.listing ? "Buy" : "View"}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            {listedOnly && visible.length > 0 ? (
              <p className="explore-footnote">
                Mixed ARCH / aBTC prices sort by displayed amount until a reference rate is
                available. Open a name to buy or make an offer.
              </p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
