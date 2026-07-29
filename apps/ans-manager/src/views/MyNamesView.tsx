import { useState } from "react";
import { useArchWallet } from "../hooks/useArchWallet";
import { ansClient, decodeArchAddress, encodeArchAddress } from "../lib/ans";

export function MyNamesView() {
  const { account, connect } = useArchWallet();
  const [names, setNames] = useState<Array<{ name: string; owner: string }>>([]);
  const [primary, setPrimary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const connected = account ?? (await connect());
      const owner = decodeArchAddress(connected.archAddress);
      const owned = await ansClient.listOwnedNames(owner);
      setNames(
        owned.map((entry) => ({
          name: entry.name,
          owner: encodeArchAddress(entry.account.owner),
        })),
      );
      setPrimary(await ansClient.resolvePrimary(owner));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <h1 className="page-title">My names</h1>
      <p className="page-subtitle">
        Discovers name accounts owned by your connected wallet, then re-validates each locally.
      </p>
      <button className="btn btn-primary" disabled={loading} onClick={() => void load()}>
        {loading ? "Loading…" : "Refresh"}
      </button>
      {primary ? (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title">Primary</div>
          <p className="mono">{primary}</p>
        </div>
      ) : null}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">Owned names</div>
        {names.length === 0 ? <p className="status-warn">No validated names found.</p> : null}
        {names.map((entry) => (
          <div className="list-item" key={entry.name}>
            <strong className="mono">{entry.name}</strong>
            <span className="mono" style={{ color: "var(--text-secondary)" }}>
              {entry.owner.slice(0, 8)}…
            </span>
          </div>
        ))}
      </div>
      {error ? <p className="status-err">{error}</p> : null}
    </section>
  );
}
