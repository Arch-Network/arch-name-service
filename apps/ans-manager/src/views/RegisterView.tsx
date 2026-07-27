import { useState } from "react";
import { canonicalizeName, validateLabel } from "@arch-network/ans-sdk";
import { useArchWallet } from "../hooks/useArchWallet";
import {
  ansClient,
  decodeArchAddress,
  explorerTxUrl,
  submitWithWindowArch,
} from "../lib/ans";

export function RegisterView() {
  const { account, connect } = useArchWallet();
  const [label, setLabel] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [txid, setTxid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onRegister(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setTxid(null);
    try {
      validateLabel(label.trim().toLowerCase());
      const canonical = canonicalizeName(`${label.trim().toLowerCase()}.arch`);
      setPreview(`Register permanent name ${canonical}`);
      let connected = account;
      if (!connected) connected = await connect();
      setBusy(true);
      const existing = await ansClient.fetchNameAccount(canonical);
      if (existing) throw new Error(`${canonical} is already registered`);
      const ix = ansClient.buildRegister(
        decodeArchAddress(connected.archAddress),
        label.trim().toLowerCase(),
      );
      const result = await submitWithWindowArch(ix, connected.archAddress);
      setTxid(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h1 className="page-title">Register</h1>
      <p className="page-subtitle">
        Free permanent `.arch` names on testnet. If your Arch account is new, the
        first mutation will create it via the testnet faucet (one wallet approval),
        then register the name. Linked external wallets cannot sign ANS message
        hashes yet — use a Turnkey-backed Arch Wallet account.
      </p>
      <form className="card stack" onSubmit={(e) => void onRegister(e)}>
        <div>
          <label className="input-label" htmlFor="label">Label</label>
          <input
            id="label"
            className="input mono"
            placeholder="alice"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        {preview ? <div className="preview">{preview}</div> : null}
        <button className="btn btn-primary btn-full" disabled={busy || !label.trim()}>
          {busy ? "Submitting…" : "Register name"}
        </button>
      </form>
      {txid ? (
        <p className="status-ok">
          Registered.{" "}
          <a href={explorerTxUrl(txid)} target="_blank" rel="noreferrer">
            View transaction
          </a>
        </p>
      ) : null}
      {error ? <p className="status-err">{error}</p> : null}
    </section>
  );
}
