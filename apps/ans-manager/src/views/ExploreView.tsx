import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import bs58 from "bs58";
import { StatusNotice } from "../components/StatusNotice";
import { ansClient } from "../lib/ans";
import { shortArchAddress } from "../lib/arch-identity";
import { formatQuoteAmount } from "../lib/domain-profile";
import {
  MARKETPLACE_COLLECTIONS,
  collectionStats,
  explorePathForCollection,
  filterMarketplaceEntries,
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
  const [sort, setSort] = useState<MarketplaceSort>("name-asc");
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

  const activeCollection =
    MARKETPLACE_COLLECTIONS.find((c) => c.id === collectionId) ??
    MARKETPLACE_COLLECTIONS[0];

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

  return (
    <section className="page-section page-section-wide explore-page">
      <div className="hero explore-hero">
        <p className="eyebrow">Marketplace</p>
        <h1 className="page-title hero-title">Explore .arch names</h1>
        <p className="page-subtitle hero-copy">
          Browse names listed by their owners. Fixed-price purchases settle on-chain with ownership
          transfer.
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
          <span className="explore-stat-label">Collections</span>
          <span className="explore-stat-value mono">{globalStats.collections}</span>
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
          return (
            <button
              key={collection.id}
              type="button"
              className={`explore-collection-filter${selected ? " is-selected" : ""}`}
              onClick={() => selectCollection(collection.id)}
              aria-pressed={selected}
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
        <div className="explore-browse-header">
          <div>
            <h2 className="card-title">{activeCollection.title}</h2>
            <p className="explore-browse-sub">
              {loading
                ? "Loading names…"
                : `${visible.length.toLocaleString()} ${listedOnly ? "active listings" : "registered names"}`}
            </p>
          </div>
          <div className="explore-browse-controls">
            <label className="explore-control">
              <span className="input-label">Search</span>
              <input
                className="input mono"
                placeholder="Filter by name or owner"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="explore-control explore-control-sort">
              <span className="input-label">Sort</span>
              <select
                className="input"
                value={sort}
                onChange={(e) => setSort(e.target.value as MarketplaceSort)}
              >
                <option value="name-asc">Name A → Z</option>
                <option value="name-desc">Name Z → A</option>
                <option value="length-asc">Shortest first</option>
                <option value="length-desc">Longest first</option>
              </select>
            </label>
            <label className="explore-control explore-control-sort">
              <span className="input-label">Filter</span>
              <select
                className="input"
                value={listedOnly ? "listed" : "all"}
                onChange={(e) => setListedOnly(e.target.value === "listed")}
              >
                <option value="listed">For sale</option>
                <option value="all">All registered</option>
              </select>
            </label>
          </div>
        </div>

        {loading ? (
          <p className="explore-empty">Scanning on-chain name accounts…</p>
        ) : visible.length === 0 ? (
          <p className="explore-empty">
            No names in this collection yet.
            {collectionId !== "all" ? (
              <>
                {" "}
                <Link to={explorePathForCollection("all")}>View all names</Link>
              </>
            ) : null}
          </p>
        ) : (
          <>
            <div className="explore-list-head" aria-hidden="true">
              <span>Name</span>
              <span>Owner</span>
              <span>Status</span>
              <span>Price</span>
              <span />
            </div>
            <ul className="explore-list">
              {visible.map((entry) => (
                <li key={entry.name}>
                  <Link className="explore-name-row" to={viewPathForName(entry.name)}>
                    <span className="explore-name-identity">
                      <span className="explore-name-avatar" aria-hidden="true">
                        {entry.name.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="explore-name-label mono">{entry.name}</span>
                    </span>
                    <span className="explore-name-owner mono" title={entry.ownerDisplay}>
                      {shortArchAddress(entry.ownerDisplay)}
                    </span>
                    {entry.listing ? (
                      <span className="explore-listing-status">For sale</span>
                    ) : (
                      <span className="explore-unlisted-status">Registered</span>
                    )}
                    {entry.listing ? (
                      <span className="explore-name-price mono">
                        {formatQuoteAmount(entry.listing.price, entry.listing.currency)}
                      </span>
                    ) : (
                      <span className="explore-name-meta">—</span>
                    )}
                    <span className="explore-row-action" aria-hidden="true">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
