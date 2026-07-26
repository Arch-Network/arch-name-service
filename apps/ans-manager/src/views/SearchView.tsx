import { useState } from "react";
import { AnsError, canonicalizeName } from "@arch-network/ans-sdk";
import { ansClient, encodeArchAddress } from "../lib/ans";

export function SearchView() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSearch(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setOwner(null);
    setStatus(null);
    try {
      const input = query.includes(".") ? query.trim() : `${query.trim()}.arch`;
      const canonical = canonicalizeName(input.toLowerCase());
      const existing = await ansClient.fetchNameAccount(canonical);
      if (!existing) {
        setStatus(`${canonical} is available to register.`);
        return;
      }
      const resolved = await ansClient.resolveOwner(canonical);
      setOwner(encodeArchAddress(resolved));
      setStatus(`${canonical} is registered.`);
    } catch (err) {
      setError(err instanceof AnsError ? err.code : err instanceof Error ? err.message : String(err));
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
          <p className="status-ok">{status}</p>
          {owner ? <p className="mono" style={{ marginTop: 8 }}>Owner: {owner}</p> : null}
        </div>
      ) : null}
      {error ? <p className="status-err">{error}</p> : null}
    </section>
  );
}
