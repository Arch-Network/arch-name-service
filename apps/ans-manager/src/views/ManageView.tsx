import { useState } from "react";
import { canonicalizeName } from "@arch-network/ans-sdk";
import { useArchWallet } from "../hooks/useArchWallet";
import {
  ansClient,
  decodeArchAddress,
  explorerTxUrl,
  submitWithWindowArch,
} from "../lib/ans";

export function ManageView() {
  const { account, connect } = useArchWallet();
  const [name, setName] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [taproot, setTaproot] = useState("");
  const [txid, setTxid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  async function ensureAccount() {
    if (account) return account;
    return connect();
  }

  async function run(action: string, build: (archAddress: string) => Promise<unknown> | unknown) {
    setBusy(true);
    setError(null);
    setTxid(null);
    try {
      const connected = await ensureAccount();
      const canonical = canonicalizeName(name.includes(".") ? name : `${name}.arch`);
      setPreview(`${action}: ${canonical}`);
      const ix = (await build(connected.archAddress)) as ReturnType<typeof ansClient.buildSetPrimary>;
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
      <h1 className="page-title">Manage</h1>
      <p className="page-subtitle">
        Set records, primary binding, or transfer ownership. Transfers invalidate prior records.
      </p>
      <div className="card stack">
        <div>
          <label className="input-label" htmlFor="manage-name">Name</label>
          <input
            id="manage-name"
            className="input mono"
            placeholder="alice.arch"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {preview ? <div className="preview">{preview}</div> : null}
        <div className="actions">
          <button
            className="btn btn-primary"
            disabled={busy || !name.trim()}
            onClick={() =>
              void run("Set ARCH_OWNER", async (archAddress) => {
                const owner = decodeArchAddress(archAddress);
                const existing = await ansClient.fetchRecord(
                  canonicalizeName(name.includes(".") ? name : `${name}.arch`),
                  "ArchOwner",
                );
                return ansClient.buildSetRecord(
                  owner,
                  canonicalizeName(name.includes(".") ? name : `${name}.arch`),
                  "ArchOwner",
                  { kind: "ArchOwner", owner },
                  existing?.revision ?? 0n,
                );
              })
            }
          >
            Set ARCH_OWNER
          </button>
          <button
            className="btn btn-secondary"
            disabled={busy || !name.trim()}
            onClick={() =>
              void run("Set primary", (archAddress) =>
                ansClient.buildSetPrimary(
                  decodeArchAddress(archAddress),
                  canonicalizeName(name.includes(".") ? name : `${name}.arch`),
                ),
              )
            }
          >
            Set primary
          </button>
          <button
            className="btn btn-secondary"
            disabled={busy}
            onClick={() =>
              void run("Clear primary", (archAddress) =>
                ansClient.buildClearPrimary(decodeArchAddress(archAddress)),
              )
            }
          >
            Clear primary
          </button>
        </div>
      </div>

      <div className="card stack">
        <div className="card-title">Bitcoin Taproot record</div>
        <input
          className="input mono"
          placeholder="tb1p…"
          value={taproot}
          onChange={(e) => setTaproot(e.target.value)}
        />
        <button
          className="btn btn-full btn-secondary"
          disabled={busy || !name.trim() || !taproot.trim()}
          onClick={() =>
            void run("Set BitcoinTaproot", async (archAddress) => {
              const { parseTaprootAddress } = await import("@arch-network/ans-sdk");
              const canonical = canonicalizeName(name.includes(".") ? name : `${name}.arch`);
              const value = parseTaprootAddress(taproot.trim(), "testnet");
              const existing = await ansClient.fetchRecord(canonical, "BitcoinTaproot");
              return ansClient.buildSetRecord(
                decodeArchAddress(archAddress),
                canonical,
                "BitcoinTaproot",
                value,
                existing?.revision ?? 0n,
              );
            })
          }
        >
          Update Taproot record
        </button>
      </div>

      <div className="card stack">
        <div className="card-title">Transfer ownership</div>
        <p className="status-warn">
          Irreversible. The new owner must republish records. Prior reverse bindings become invalid.
        </p>
        <input
          className="input mono"
          placeholder="New owner Arch address (base58 or hex)"
          value={transferTo}
          onChange={(e) => setTransferTo(e.target.value)}
        />
        <button
          className="btn btn-full btn-primary"
          disabled={busy || !name.trim() || !transferTo.trim()}
          onClick={() => {
            if (!window.confirm(`Transfer ${name} to ${transferTo}? This cannot be undone.`)) {
              return;
            }
            void run("Transfer", (archAddress) =>
              ansClient.buildTransfer(
                decodeArchAddress(archAddress),
                canonicalizeName(name.includes(".") ? name : `${name}.arch`),
                decodeArchAddress(transferTo),
              ),
            );
          }}
        >
          Transfer name
        </button>
      </div>

      {txid ? (
        <p className="status-ok">
          Submitted.{" "}
          <a href={explorerTxUrl(txid)} target="_blank" rel="noreferrer">
            View transaction
          </a>
        </p>
      ) : null}
      {error ? <p className="status-err">{error}</p> : null}
    </section>
  );
}
