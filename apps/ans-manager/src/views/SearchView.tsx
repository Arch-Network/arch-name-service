import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AnsError,
  TEXT_RECORD_CATALOG,
  canonicalizeName,
} from "@arch-network/ans-sdk";
import bs58 from "bs58";
import { ExplorerLink } from "../components/ExplorerLink";
import { ReadOnlyRecordGroups } from "../components/ReadOnlyRecordGroups";
import { StatusNotice } from "../components/StatusNotice";
import { ansClient } from "../lib/ans";
import { shortArchAddress } from "../lib/arch-identity";
import { loadNameProfile } from "../lib/name-profile";
import {
  registerPathForLabel,
  viewPathForName,
} from "../lib/register-handoff";

type ExtraRecord = { id: string; label: string; value: string };

type RecentName = {
  name: string;
  ownerDisplay: string;
};

const RECENT_LIMIT = 12;

export function SearchView() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [availableName, setAvailableName] = useState<string | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  const [canonical, setCanonical] = useState<string | null>(null);
  const [extraRecords, setExtraRecords] = useState<ExtraRecord[]>([]);
  const [showMore, setShowMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<RecentName[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentError, setRecentError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRecentLoading(true);
    setRecentError(null);
    void ansClient
      .listRecentNames(RECENT_LIMIT)
      .then((entries) => {
        if (cancelled) return;
        setRecent(
          entries.map((entry) => ({
            name: entry.name,
            ownerDisplay: bs58.encode(entry.account.owner),
          })),
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setRecentError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setRecentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSearch(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setOwner(null);
    setStatus(null);
    setAvailableName(null);
    setCanonical(null);
    setExtraRecords([]);
    setShowMore(false);
    try {
      const input = query.includes(".") ? query.trim() : `${query.trim()}.arch`;
      const name = canonicalizeName(input.toLowerCase());
      const { profile } = await loadNameProfile(name, null);
      if (!profile) {
        setAvailableName(name);
        setStatus(`${name} is available to register.`);
        return;
      }
      setOwner(profile.ownerDisplay);
      setCanonical(name);
      setStatus(`${name} is registered.`);

      const extras: ExtraRecord[] = [];
      if (profile.taprootDisplay) {
        extras.push({
          id: "bitcoin-taproot",
          label: "Bitcoin Taproot",
          value: profile.taprootDisplay,
        });
      }
      for (const spec of TEXT_RECORD_CATALOG) {
        const value = profile.textByKey[spec.key]?.value;
        if (value) {
          extras.push({ id: spec.key, label: spec.label, value });
        }
      }
      setExtraRecords(extras);
    } catch (err) {
      if (err instanceof AnsError) {
        setError(err.message && err.message !== err.code ? `${err.code}: ${err.message}` : err.code);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(String(err));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="page-section page-section-wide discover-page">
      <div className="hero">
        <p className="eyebrow">Arch Name Service</p>
        <h1 className="page-title hero-title">Your name on Arch</h1>
        <p className="page-subtitle hero-copy">
          Replace long wallet addresses with a memorable .arch identity. Search any name to get started.
        </p>
      </div>
      <form className="card search-form" onSubmit={(e) => void onSearch(e)}>
        <label className="input-label" htmlFor="name">Name</label>
        <div className="search-controls">
          <input
            id="name"
            className="input mono"
            placeholder="alice or alice.arch"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            aria-describedby="search-help"
          />
          <button className="btn btn-primary search-button" disabled={loading || !query.trim()}>
            {loading ? "Searching…" : "Search"}
          </button>
        </div>
        <p className="field-help" id="search-help">No wallet connection required.</p>
      </form>
      {status ? (
        <StatusNotice
          tone="success"
          title={availableName ? `${availableName} is available` : "Name registered"}
          message={
            availableName
              ? "Free on testnet. Yours permanently. A wallet approval is required to create your identity."
              : status
          }
          metadata={
            owner ? (
              <>
                Owner: <ExplorerLink kind="account" value={owner} truncate={false} />
                {extraRecords.length > 0 ? (
                  <div className="search-records">
                    <button
                      type="button"
                      className="btn btn-secondary btn-compact"
                      onClick={() => setShowMore((v) => !v)}
                    >
                      {showMore ? "Hide records" : `More records (${extraRecords.length})`}
                    </button>
                    {showMore ? (
                      <ReadOnlyRecordGroups records={extraRecords} />
                    ) : null}
                    {canonical ? (
                      <Link className="btn btn-secondary btn-compact" to={viewPathForName(canonical)}>
                        View {canonical}
                      </Link>
                    ) : null}
                  </div>
                ) : canonical ? (
                  <div className="search-records">
                    <Link className="btn btn-secondary btn-compact" to={viewPathForName(canonical)}>
                      View {canonical}
                    </Link>
                  </div>
                ) : null}
              </>
            ) : undefined
          }
          action={
            availableName ? (
              <Link
                className="btn btn-primary btn-full"
                to={registerPathForLabel(availableName)}
              >
                Register {availableName}
              </Link>
            ) : undefined
          }
        />
      ) : null}
      {error ? (
        <StatusNotice
          tone="error"
          title="Search failed"
          message="The name could not be checked. Try again in a moment."
          detail={error}
        />
      ) : null}

      <div className="card recent-names" aria-live="polite">
        <div className="recent-names-header">
          <div>
            <p className="eyebrow">On-chain</p>
            <h2 className="card-title">Latest registrations</h2>
          </div>
          {!recentLoading && !recentError ? (
            <span className="count-badge">
              {recent.length} {recent.length === 1 ? "name" : "names"}
            </span>
          ) : null}
        </div>
        {recentLoading ? (
          <p className="recent-names-status">Loading recent names…</p>
        ) : recentError ? (
          <p className="recent-names-status">Could not load recent names right now.</p>
        ) : recent.length === 0 ? (
          <p className="recent-names-status">No names registered yet. Be the first.</p>
        ) : (
          <ul className="recent-names-list">
            {recent.map((entry) => (
              <li key={entry.name} className="recent-name-row">
                <Link className="recent-name-link mono" to={viewPathForName(entry.name)}>
                  {entry.name}
                </Link>
                <span className="recent-name-owner mono" title={entry.ownerDisplay}>
                  {shortArchAddress(entry.ownerDisplay)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="benefit-grid" aria-label="What you can do with an Arch name">
        <article className="benefit-card">
          <span className="benefit-number">01</span>
          <h2>Share one identity</h2>
          <p>Use a readable name instead of a long Arch wallet address.</p>
        </article>
        <article className="benefit-card">
          <span className="benefit-number">02</span>
          <h2>Resolve with confidence</h2>
          <p>Records are checked against on-chain state before they are shown.</p>
        </article>
        <article className="benefit-card">
          <span className="benefit-number">03</span>
          <h2>Keep it permanently</h2>
          <p>Testnet registrations are free and do not expire.</p>
        </article>
      </div>
      <aside className="technical-proof">
        <div>
          <p className="eyebrow">Built for verification</p>
          <h2>Trust the chain, not an indexer.</h2>
        </div>
        <p>
          ANS validates resolution predicates locally against Arch testnet state. Indexers help find
          names, but they are never the source of truth.
        </p>
      </aside>
    </section>
  );
}
