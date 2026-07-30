import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import bs58 from "bs58";
import { StatusNotice } from "../components/StatusNotice";
import { ansClient } from "../lib/ans";
import { shortArchAddress } from "../lib/arch-identity";
import { formatQuoteBaseUnits, quoteSymbol } from "../lib/quote-amount";
import {
  MARKETPLACE_COLLECTIONS,
  collectionStats,
  explorePathForCollection,
  filterMarketplaceEntries,
  lengthBadge,
  listedCount,
  parseCollectionId,
  sortMarketplaceEntries,
  type CollectionId,
  type MarketplaceEntry,
  type MarketplaceSort,
} from "../lib/marketplace";
import { viewPathForName } from "../lib/register-handoff";

function formatCapacity(registered: number, capacity: number | null): string {
  if (capacity == null) return String(registered);
  return `${registered.toLocaleString()} / ${capacity.toLocaleString()}`;
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
    void Promise.all([ansClient.listNameAccounts(), ansClient.listActiveListings()])
      .then(([rows, listings]) => {
        if (cancelled) return;
        const byName = new Map(
          listings.map((row) => [
            row.name,
            { currency: row.listing.currency, price: row.listing.price },
          ]),
        );
        setEntries(
          rows.map((row) => ({
            name: row.name,
            ownerDisplay: bs58.encode(row.account.owner),
            registeredAtSlot: row.account.registeredAtSlot,
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
      collections: MARKETPLACE_COLLECTIONS.filter((c) => c.id !== "all").length,
      listed: listedCount(entries),
    };
  }, [entries]);

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
      </div>

      {error ? (
        <StatusNotice
          tone="error"
          title="Could not load marketplace"
          message="The name index is temporarily unavailable. Try again in a moment."
          detail={error}
        />
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
