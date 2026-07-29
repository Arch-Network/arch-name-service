import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AnsError, canonicalizeName, validateLabel } from "@arch-network/ans-sdk";
import { useArchWallet } from "../hooks/useArchWallet";
import {
  ansClient,
  decodeArchAddress,
  explorerTxUrl,
  formatRegistrationError,
  submitWithWindowArch,
} from "../lib/ans";

type AvailabilityUi =
  | { kind: "idle" }
  | { kind: "invalid"; message: string }
  | { kind: "checking"; canonical: string }
  | { kind: "available"; canonical: string }
  | { kind: "taken"; canonical: string }
  | { kind: "blocked"; canonical: string; message: string }
  | { kind: "error"; message: string };

function normalizeLabel(raw: string): string {
  return raw.trim().toLowerCase();
}

export function RegisterView() {
  const { account, connect } = useArchWallet();
  const [searchParams] = useSearchParams();
  const [label, setLabel] = useState(() => normalizeLabel(searchParams.get("label") ?? ""));
  const [availability, setAvailability] = useState<AvailabilityUi>({ kind: "idle" });
  const [txid, setTxid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const normalized = normalizeLabel(label);
    if (!normalized) {
      setAvailability({ kind: "idle" });
      return;
    }

    let cancelled = false;
    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          validateLabel(normalized);
          const canonical = canonicalizeName(`${normalized}.arch`);
          if (!cancelled) setAvailability({ kind: "checking", canonical });
          const status = await ansClient.getNameAvailability(canonical);
          if (cancelled) return;
          if (status.availability === "taken") {
            setAvailability({ kind: "taken", canonical: status.canonical });
            return;
          }
          if (status.availability === "unavailable") {
            setAvailability({
              kind: "blocked",
              canonical: status.canonical,
              message: `${status.canonical} cannot be registered right now`,
            });
            return;
          }
          setAvailability({ kind: "available", canonical: status.canonical });
        } catch (err) {
          if (cancelled) return;
          if (err instanceof AnsError) {
            setAvailability({ kind: "invalid", message: err.message || err.code });
            return;
          }
          setAvailability({
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      })();
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [label]);

  async function onRegister(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setTxid(null);
    const normalized = normalizeLabel(label);
    try {
      validateLabel(normalized);
      const canonical = canonicalizeName(`${normalized}.arch`);
      if (availability.kind === "taken") {
        throw new AnsError("NameTaken", `${canonical} is already registered`);
      }
      let connected = account;
      if (!connected) connected = await connect();
      setBusy(true);
      // Fresh check immediately before submit to shrink the race window.
      await ansClient.assertNameAvailable(canonical);
      const ix = ansClient.buildRegister(
        decodeArchAddress(connected.archAddress),
        normalized,
      );
      const result = await submitWithWindowArch(ix, connected.archAddress);
      setTxid(result);
      setAvailability({ kind: "taken", canonical });
    } catch (err) {
      setError(formatRegistrationError(err, normalizeLabel(label)));
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    !busy &&
    availability.kind === "available" &&
    Boolean(normalizeLabel(label));

  return (
    <section>
      <h1 className="page-title">Register</h1>
      <p className="page-subtitle">
        Free permanent `.arch` names on testnet. Availability is checked against
        the on-chain name PDA before you submit. If your Arch account is new, the
        first mutation will create it via the testnet faucet (one wallet approval),
        then register the name.
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
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <AvailabilityStatus availability={availability} />
        <button className="btn btn-primary btn-full" disabled={!canSubmit}>
          {busy
            ? "Submitting…"
            : availability.kind === "taken"
              ? "Name already registered"
              : "Register name"}
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
      {availability.kind === "taken" ? (
        <p className="page-subtitle" style={{ marginTop: 16 }}>
          <Link to={`/?q=${encodeURIComponent(availability.canonical)}`}>
            View {availability.canonical} in search
          </Link>
        </p>
      ) : null}
    </section>
  );
}

function AvailabilityStatus({ availability }: { availability: AvailabilityUi }) {
  switch (availability.kind) {
    case "idle":
      return null;
    case "checking":
      return <div className="preview">Checking {availability.canonical}…</div>;
    case "available":
      return (
        <div className="preview status-ok">
          {availability.canonical} is available to register.
        </div>
      );
    case "taken":
      return (
        <div className="preview status-err">
          {availability.canonical} is already registered.
        </div>
      );
    case "blocked":
      return <div className="preview status-warn">{availability.message}</div>;
    case "invalid":
      return <div className="preview status-err">{availability.message}</div>;
    case "error":
      return <div className="preview status-err">{availability.message}</div>;
  }
}
