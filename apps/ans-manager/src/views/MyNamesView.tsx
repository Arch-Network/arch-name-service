import { useEffect, useMemo, useRef, useState } from "react";
import { AnsError } from "@arch-network/ans-sdk";
import { Link } from "react-router-dom";
import { ExplorerLink } from "../components/ExplorerLink";
import { StatusNotice } from "../components/StatusNotice";
import { WalletStatusNotice } from "../components/WalletStatusNotice";
import { useArchWallet } from "../hooks/useArchWallet";
import { useWalletRecovery } from "../hooks/useWalletRecovery";
import { ansClient } from "../lib/ans";
import { archIdentitiesEqual, shortArchAddress } from "../lib/arch-identity";
import {
  connectedAccountNames,
  firstLookupError,
  loadOwnedNames,
  otherAccountNames,
  totalNameCount,
  type AccountNames,
  type OwnedName,
  type OwnedNamesResult,
} from "../lib/owned-names";
import { statusAccount, walletStatusError } from "../lib/wallet-status";

function isAccountNotFound(error: unknown): boolean {
  if (error instanceof AnsError && error.code === "AccountNotFound") return true;
  const message = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
  return (
    message.includes("account is not in database") ||
    message.includes("account not found") ||
    /account [0-9a-f]+ not found/.test(message)
  );
}

function recordSummary(entry: OwnedName): string {
  if (entry.recordCount === null) return "Records unavailable";
  if (entry.recordCount === 0) return "No records";
  return `${entry.recordCount} record${entry.recordCount === 1 ? "" : "s"}`;
}

function NameRows({ names, primary }: { names: OwnedName[]; primary: string | null }) {
  return (
    <div className="names-table" role="table" aria-label="Owned names">
      <div className="names-table-header" role="row">
        <span role="columnheader">Name</span>
        <span role="columnheader">Status</span>
        <span role="columnheader">Action</span>
      </div>
      {names.map((entry) => (
        <div className="name-row" role="row" key={entry.name}>
          <span className="name-identity" role="cell">
            <strong className="name-value">{entry.name}</strong>
            {entry.name === primary ? <span className="primary-badge">Primary</span> : null}
          </span>
          <span className="record-health" role="cell">{recordSummary(entry)}</span>
          <span className="name-actions" role="cell">
            <ExplorerLink kind="account" value={entry.ownerArchAddress}>Owner</ExplorerLink>
            <Link className="btn btn-secondary btn-small" to={`/manage?name=${encodeURIComponent(entry.name)}`}>
              Manage
            </Link>
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Names held by an account the wallet has reported here but is not
 * reporting now.
 *
 * Shown because the alternative is worse: the extension signs with its
 * active account rather than the one bound to this origin, so a name the
 * user just registered can legitimately sit on an account the header is
 * not showing. Suppressing it reads as "you own nothing".
 */
function OtherAccountNames({ account }: { account: AccountNames }) {
  const label = shortArchAddress(account.archAddress);
  return (
    <div className="card names-panel">
      <div className="names-summary">
        <div className="names-summary-content">
          <div className="card-title">Owned by another account in this wallet</div>
          <p className="names-account-copy">
            Arch Wallet has reported <strong>{label}</strong> to this site before. These
            names are registered to it, not to the account currently connected. To change
            them, make {label} the active account in Arch Wallet.
          </p>
          <div className="owner-account">
            <span>Owner account</span>
            <ExplorerLink
              className="owner-account-link mono"
              kind="account"
              value={account.archAddress}
              truncate={false}
            />
          </div>
        </div>
        <span className="count-badge" aria-label={`${account.names.length} names owned by ${label}`}>
          {account.names.length} {account.names.length === 1 ? "name" : "names"}
        </span>
      </div>
      <NameRows names={account.names} primary={account.primary} />
    </div>
  );
}

export function MyNamesView() {
  const { status, reportedAccount, refresh } = useArchWallet();
  const recovery = useWalletRecovery();
  const [result, setResult] = useState<OwnedNamesResult | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const autoLoadedAccount = useRef<string | null>(null);
  // Reading ownership needs an account to read *about*, not one that can
  // sign. A watch-only or linked-external account cannot mutate anything
  // and used to block this page outright, which showed the user no names
  // for a reason that has nothing to do with names.
  const canRead = reportedAccount !== null;

  async function load() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      // Reading names needs a live account, not the last one we saw.
      const current = await refresh();
      const account = statusAccount(current);
      if (!account) throw walletStatusError(current);
      setResult(await loadOwnedNames(ansClient, account.archAddress));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!reportedAccount) return;
    if (
      autoLoadedAccount.current &&
      archIdentitiesEqual(autoLoadedAccount.current, reportedAccount.archAddress)
    ) {
      return;
    }
    autoLoadedAccount.current = reportedAccount.archAddress;
    void load();
  }, [reportedAccount]);

  const lookupError = result ? firstLookupError(result) : null;
  const shownError = error ?? lookupError;
  const errorMessage =
    shownError instanceof Error ? shownError.message : shownError ? String(shownError) : null;
  const missingAccount = isAccountNotFound(shownError);
  const connected = result ? connectedAccountNames(result) : null;
  const others = result ? otherAccountNames(result) : [];
  const connectedNames = connected?.names ?? [];
  const filteredNames = useMemo(
    () => connectedNames.filter((entry) => entry.name.toLowerCase().includes(filter.trim().toLowerCase())),
    [filter, connectedNames],
  );

  return (
    <section className="page-section page-section-wide">
      <div className="page-heading-row">
        <div>
          <h1 className="page-title">My names</h1>
          <p className="page-subtitle">
            Your .arch identities, verified against on-chain state.
          </p>
        </div>
        {canRead ? (
          <button className="btn btn-secondary" disabled={loading} onClick={() => void load()}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        ) : null}
      </div>

      <WalletStatusNotice
        status={status}
        working={recovery.working}
        disabled={loading}
        onRun={(next) => void recovery.run(next)}
      />

      {errorMessage ? (
        <StatusNotice
          tone={missingAccount ? "warning" : "error"}
          title={missingAccount ? "Account not initialized" : "Names could not be loaded"}
          message={
            missingAccount
              ? "This wallet does not have an initialized Arch account on testnet yet."
              : "The ownership lookup failed, so this page cannot tell you whether you own " +
                "any names. This is not the same as owning none — try again."
          }
          detail={errorMessage}
          action={
            canRead ? (
              <button className="btn btn-secondary" disabled={loading} onClick={() => void load()}>
                {loading ? "Retrying…" : "Try again"}
              </button>
            ) : undefined
          }
        />
      ) : null}

      {loading ? (
        <div className="card empty-state" role="status" aria-live="polite">
          <p className="empty-state-title">Loading your names…</p>
          <p className="empty-state-copy">Verifying ownership and records against Arch testnet.</p>
        </div>
      ) : result ? (
        <>
          <div className="card names-panel">
            <div className="names-summary">
              <div>
                <div className="card-title">Primary identity</div>
                <p className="primary-name">{connected?.primary ?? "Not set"}</p>
              </div>
              {/* A count is a claim about ownership. When the lookup failed we
                  do not have one, and printing "0 names" makes the claim anyway. */}
              {connected?.error ? (
                <span className="count-badge" aria-label="Owned name count unknown">
                  ? names
                </span>
              ) : (
                <span className="count-badge" aria-label={`${connectedNames.length} owned names`}>
                  {connectedNames.length} {connectedNames.length === 1 ? "name" : "names"}
                </span>
              )}
            </div>
            {connectedNames.length > 1 ? (
              <div className="names-filter">
                <label className="input-label" htmlFor="names-filter">Filter names</label>
                <input
                  id="names-filter"
                  className="input"
                  type="search"
                  placeholder="Search your names"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                />
              </div>
            ) : null}
            {connected?.error ? (
              <div className="empty-state">
                <p className="empty-state-title">Ownership for this account is unknown</p>
                <p className="empty-state-copy">
                  The lookup for {shortArchAddress(connected.archAddress)} failed. See the
                  details above — this page is not saying you own nothing.
                </p>
              </div>
            ) : connectedNames.length > 0 ? (
              <>
                <NameRows names={filteredNames} primary={connected?.primary ?? null} />
                {filteredNames.length === 0 ? (
                  <div className="empty-state">
                    <p className="empty-state-title">No names match “{filter}”</p>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="empty-state">
                <p className="empty-state-title">
                  No names on {shortArchAddress(connected?.archAddress)}
                </p>
                <p className="empty-state-copy">
                  {others.length > 0
                    ? "The account Arch Wallet has connected to this site owns no .arch names. " +
                      "Names you registered with another account in this wallet are listed below."
                    : "The account Arch Wallet has connected to this site owns no .arch names yet."}
                </p>
                <Link className="btn btn-primary empty-state-action" to="/">Find a name</Link>
              </div>
            )}
          </div>
          {others.map((account) => (
            <OtherAccountNames key={account.archAddress} account={account} />
          ))}
          {others.length > 0 ? (
            <p className="page-subtitle">
              {totalNameCount(result)} names total across {result.accounts.length} accounts this
              wallet has reported to this site.
            </p>
          ) : null}
        </>
      ) : canRead ? (
        <div className="card empty-state">
          <p className="empty-state-title">Load your names</p>
          <p className="empty-state-copy">
            We will verify ownership on-chain for every account this wallet has reported here.
          </p>
          <button className="btn btn-primary empty-state-action" onClick={() => void load()}>
            Load names
          </button>
        </div>
      ) : null}
    </section>
  );
}
