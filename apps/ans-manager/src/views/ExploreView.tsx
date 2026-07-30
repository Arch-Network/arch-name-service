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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void ansClient
      .listNameAccounts()
      .then((rows) => {
        if (cancelled) return;
        setEntries(
          rows.map((row) => ({
            name: row.name,
            ownerDisplay: bs58.encode(row.account.owner),
            registeredAtSlot: row.account.registeredAtSlot,
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
    };
  }, [entries]);

  const collectionCards = useMemo(
    () =>
      MARKETPLACE_COLLECTIONS.map((collection) => ({
        collection,
        stats: collectionStats(entries, collection),
      })),
    [entries],
  );

  const visible = useMemo(
    () =>
      sortMarketplaceEntries(
        filterMarketplaceEntries(entries, { collectionId, query }),
        sort,
      ),
    [collectionId, entries, query, sort],
  );

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
          Browse registered names by length — like SNS Explore. Secondary sales are not on-chain yet;
          open any name to view records or contact the owner.
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
          <span className="explore-stat-value mono">0</span>
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
        {collectionCards.map(({ collection, stats }) => {
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
                  <dd className="mono">0</dd>
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
                  <span className="explore-name-meta">Owner</span>
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
