import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AnsError, canonicalizeName } from "@arch-network/ans-sdk";
import { ansClient, encodeArchAddress } from "../lib/ans";

export function SearchView() {
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  const [availableName, setAvailableName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSearch(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setOwner(null);
    setStatus(null);
    setAvailableName(null);
    try {
      const input = query.includes(".") ? query.trim() : `${query.trim()}.arch`;
      const canonical = canonicalizeName(input.toLowerCase());
      const result = await ansClient.getNameAvailability(canonical);
      if (result.availability === "available") {
        setAvailableName(result.canonical);
        setStatus(`${result.canonical} is available to register.`);
        return;
      }
      if (result.availability === "unavailable") {
        setError(`${result.canonical} has an invalid on-chain name account`);
        return;
      }
      const resolved = await ansClient.resolveOwner(result.canonical);
      setOwner(encodeArchAddress(resolved));
      setStatus(`${result.canonical} is registered.`);
    } catch (err) {
      setError(err instanceof AnsError ? err.message || err.code : err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <h1 className="page-title">Arch Name Service</h1>
      <p className="page-subtitle">
        Search `.arch` names on testnet. Resolution validates on-chain predicates locally — indexers
        are never the source of truth.
      </p>
      <form className="card stack" onSubmit={(e) => void onSearch(e)}>
        <div>
          <label className="input-label" htmlFor="name">Name</label>
          <input
            id="name"
            className="input mono"
            placeholder="alice or alice.arch"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button className="btn btn-primary btn-full" disabled={loading || !query.trim()}>
          {loading ? "Searching…" : "Search"}
        </button>
      </form>
      {status ? (
        <div className="card">
          <div className="card-title">Result</div>
          <p className={availableName ? "status-ok" : "status-err"}>{status}</p>
          {owner ? <p className="mono" style={{ marginTop: 8 }}>Owner: {owner}</p> : null}
          {availableName ? (
            <p style={{ marginTop: 12 }}>
              <Link
                className="btn btn-primary"
                to={`/register?label=${encodeURIComponent(availableName.replace(/\.arch$/, ""))}`}
              >
                Register {availableName}
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="status-err">{error}</p> : null}
    </section>
  );
}
