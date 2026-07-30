import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import bs58 from "bs58";
import { StatusNotice } from "../components/StatusNotice";
import { ansClient } from "../lib/ans";
import { shortArchAddress } from "../lib/arch-identity";
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

function formatListingPrice(listing: NonNullable<MarketplaceEntry["listing"]>): string {
  const unit = listing.currency === "Btc" ? "aBTC" : "ARCH";
  return `${listing.price.toString()} ${unit}`;
}

export function ExploreView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const collectionId = parseCollectionId(searchParams.get("collection"));
  const [entries, setEntries] = useState<MarketplaceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<MarketplaceSort>("name-asc");
  const [listedOnly, setListedOnly] = useState(false);

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

  const collectionCards = useMemo(
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

  const activeStats = useMemo(
    () => collectionStats(entries, activeCollection),
    [activeCollection, entries],
  );

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
          Browse registered names and on-chain fixed-price listings. Sellers quote ARCH lamports or
          aBTC; buy settles atomically with ownership transfer.
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
        {collectionCards.map(({ collection, stats, listed }) => {
          const selected = collection.id === collectionId;
          return (
            <button
              key={collection.id}
              type="button"
              className={`explore-collection-card${selected ? " is-selected" : ""}`}
              onClick={() => selectCollection(collection.id)}
              aria-pressed={selected}
            >
              <div className="explore-collection-top">
                <h2 className="explore-collection-title">{collection.title}</h2>
                <span className="count-badge">
                  {loading ? "…" : formatCapacity(stats.registered, stats.capacity)}
                </span>
              </div>
              <p className="explore-collection-copy">{collection.description}</p>
              <dl className="explore-collection-metrics">
                <div>
                  <dt>Registered</dt>
                  <dd className="mono">{loading ? "…" : stats.registered.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Owners</dt>
                  <dd className="mono">{loading ? "…" : stats.owners.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Listed</dt>
                  <dd className="mono">{loading ? "…" : listed.toLocaleString()}</dd>
                </div>
              </dl>
            </button>
          );
        })}
      </div>

      <div className="card explore-browse">
        <div className="explore-browse-header">
          <div>
            <p className="eyebrow">Collection</p>
            <h2 className="card-title">{activeCollection.title}</h2>
            <p className="explore-browse-sub">
              {loading
                ? "Loading names…"
                : `${activeStats.registered.toLocaleString()} registered · ${visible.length.toLocaleString()} shown`}
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
                <option value="all">All names</option>
                <option value="listed">Listed only</option>
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
          <ul className="explore-grid">
            {visible.map((entry) => (
              <li key={entry.name}>
                <Link className="explore-name-card" to={viewPathForName(entry.name)}>
                  <span className="explore-name-label mono">{entry.name}</span>
                  {entry.listing ? (
                    <span className="explore-name-price mono">
                      {formatListingPrice(entry.listing)}
                    </span>
                  ) : (
                    <span className="explore-name-meta">Not listed</span>
                  )}
                  <span className="explore-name-owner mono" title={entry.ownerDisplay}>
                    {shortArchAddress(entry.ownerDisplay)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
