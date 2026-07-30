import { useEffect, useMemo, useRef, useState } from "react";
import {
  canonicalizeName,
  parseTaprootAddress,
} from "@arch-network/ans-sdk";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ExplorerLink } from "../components/ExplorerLink";
import { ProfileRecords } from "../components/ProfileRecords";
import { QuoteAmountSelector } from "../components/QuoteAmountSelector";
import { ResolutionSummary } from "../components/ResolutionSummary";
import { StatusNotice } from "../components/StatusNotice";
import { WalletRecoveryActions } from "../components/WalletRecoveryActions";
import { WalletStatusNotice } from "../components/WalletStatusNotice";
import { useArchWallet } from "../hooks/useArchWallet";
import { useWalletRecovery } from "../hooks/useWalletRecovery";
import {
  accountMismatchFromError,
  actingArchAddress,
  ansClient,
  archAddressesEqual,
  confirmingNotice,
  decodeArchAddress,
  approvalNotice,
  formatAnsMutationError,
  MANAGE_ACTIONS,
  mutationRetryLabel,
  pendingConfirmationMessage,
  signerMismatchFromError,
  submitFailureTitle,
  submitWithWindowArch,
  type SubmitProgress,
} from "../lib/ans";
import { shortArchAddress } from "../lib/arch-identity";
import {
  nameOwnedBy,
  primaryNameCleared,
  primaryNameIs,
  recordRevisionPast,
  type ConfirmEffect,
} from "../lib/confirm-effects";
import {
  invalidateNameProfile,
  loadNameProfile,
  type LoadedProfile,
} from "../lib/name-profile";
import { formatQuoteAmount } from "../lib/domain-profile";
import { parseQuoteAmount } from "../lib/quote-amount";
import {
  buildProfileRows,
  groupProfileRows,
  validateDraft,
  type ProfileRecordRow,
} from "../lib/records";
import { viewPathForName } from "../lib/register-handoff";
import {
  classifyWalletBlocker,
  walletBlockerNotice,
  type WalletBlockerKind,
} from "../lib/wallet-state";
import {
  walletStatusCta,
  walletStatusError,
  type WalletStatusAction,
} from "../lib/wallet-status";

export function ManageView() {
  const { status, account, refresh, connectEpoch } = useArchWallet();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const nameParam = searchParams.get("name");
  const [name, setName] = useState(nameParam ?? "");
  const [transferTo, setTransferTo] = useState("");
  const [listPrice, setListPrice] = useState("");
  const [listCurrency, setListCurrency] = useState<"Arch" | "Btc">("Arch");
  const [activeListing, setActiveListing] = useState<{
    currency: "Arch" | "Btc";
    price: bigint;
  } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [profile, setProfile] = useState<LoadedProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [txid, setTxid] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocker, setBlocker] = useState<WalletBlockerKind | null>(null);
  const [failedAction, setFailedAction] = useState<string | null>(null);
  const [failedError, setFailedError] = useState<unknown>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [statusInfo, setStatusInfo] = useState<string | null>(null);
  const [progress, setProgress] = useState<SubmitProgress | null>(null);
  const recovery = useWalletRecovery();
  const prevAccountRef = useRef<string | null>(account?.archAddress ?? null);
  const lastRunRef = useRef<{
    action: string;
    build: (archAddress: string) => Promise<unknown> | unknown;
    confirmEffect?: ConfirmEffect;
  } | null>(null);
  const cta = walletStatusCta(status);
  const ready = cta === null;
  const busy = busyAction !== null;
  const canonicalName = useMemo(() => {
    if (!name.trim()) return null;
    try {
      return canonicalizeName(name.includes(".") ? name : `${name}.arch`);
    } catch {
      return null;
    }
  }, [name]);
  const validTransferAddress = useMemo(() => {
    if (!transferTo.trim()) return false;
    try {
      return decodeArchAddress(transferTo).length === 32;
    } catch {
      return false;
    }
  }, [transferTo]);

  useEffect(() => {
    if (nameParam != null) setName(nameParam);
  }, [nameParam]);

  useEffect(() => {
    if (connectEpoch === 0) return;
    setError(null);
    setBlocker(null);
  }, [connectEpoch]);

  useEffect(() => {
    const prev = prevAccountRef.current;
    const next = account?.archAddress ?? null;
    prevAccountRef.current = next;
    if (!prev && next) {
      setError(null);
      setBlocker(null);
    }
  }, [account?.archAddress]);

  useEffect(() => {
    setError(null);
    setBlocker(null);
    setFailedAction(null);
    setTxid(null);
    setUnconfirmed(false);
    setStatusInfo(null);
    setDrafts({});
    setProfile(null);
    setProfileError(null);
    setActiveListing(null);
  }, [canonicalName]);

  useEffect(() => {
    if (!canonicalName) return;
    let cancelled = false;
    setProfileLoading(true);
    setProfileError(null);
    void (async () => {
      try {
        if (txid) invalidateNameProfile(canonicalName);
        const { profile: next, error: loadError } = await loadNameProfile(
          canonicalName,
          account?.archAddress ?? null,
        );
        if (cancelled) return;
        if (loadError || !next) {
          setProfile(null);
          setProfileError(loadError ?? `${canonicalName} is not registered.`);
          return;
        }
        setProfile(next);
        setDrafts((prev) => ({
          ...prev,
          "bitcoin-taproot": prev["bitcoin-taproot"] ?? next.taprootDisplay ?? "",
          ...Object.fromEntries(
            Object.entries(next.textByKey).map(([key, value]) => [
              `text:${key}`,
              prev[`text:${key}`] ?? value?.value ?? "",
            ]),
          ),
        }));
        const listing = await ansClient.fetchListing(canonicalName);
        if (!cancelled) {
          setActiveListing(
            listing
              ? { currency: listing.currency, price: listing.price }
              : null,
          );
        }
      } catch (err) {
        if (!cancelled) {
          setProfileError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canonicalName, account?.archAddress, txid]);

  // Connected non-owners should use the read-only view page.
  useEffect(() => {
    if (!canonicalName || profileLoading || !profile?.ownerDisplay) return;
    const viewer = account?.archAddress;
    if (!viewer) return;
    if (archAddressesEqual(profile.ownerDisplay, viewer)) return;
    navigate(viewPathForName(canonicalName), { replace: true });
  }, [
    account?.archAddress,
    canonicalName,
    navigate,
    profile,
    profileLoading,
  ]);

  const rows = useMemo(() => {
    if (!profile || !canonicalName) return [];
    return buildProfileRows({
      ownerDisplay: profile.ownerDisplay,
      primaryName: profile.primaryName,
      canonicalName,
      archOwnerRevision: profile.archOwnerRevision,
      taprootDisplay: profile.taprootDisplay,
      taprootRevision: profile.taprootRevision,
      textByKey: profile.textByKey,
    });
  }, [profile, canonicalName]);

  const groups = useMemo(() => groupProfileRows(rows), [rows]);

  async function handleRecovery(action: WalletStatusAction) {
    setError(null);
    setBlocker(null);
    setTxid(null);
    const result = await recovery.run(action);
    if (result.ok) {
      const retry = lastRunRef.current;
      if (action === "adopt" && retry) {
        setStatusInfo(null);
        await run(retry.action, retry.build, retry.confirmEffect);
        return;
      }
      setStatusInfo(
        failedAction
          ? `Wallet ready — ${mutationRetryLabel(failedAction)} again.`
          : "Wallet ready — try your action again.",
      );
      return;
    }
    setStatusInfo(null);
    setBlocker(classifyWalletBlocker(result.error));
    setError(formatAnsMutationError(result.error));
  }

  async function run(
    action: string,
    build: (archAddress: string) => Promise<unknown> | unknown,
    /**
     * How to tell this mutation landed by reading its own accounts. Without
     * one the wait falls back to the transaction receipt, which the indexer
     * cannot serve until it ingests the txid.
     */
    confirmEffect?: ConfirmEffect,
  ) {
    lastRunRef.current = { action, build, confirmEffect };
    setBusyAction(action);
    setError(null);
    setBlocker(null);
    setFailedAction(null);
    setFailedError(null);
    setTxid(null);
    setUnconfirmed(false);
    setStatusInfo(null);
    setProgress(null);
    try {
      const current = await refresh();
      if (current.state !== "connected") throw walletStatusError(current);
      if (!canonicalName) throw new Error("Enter a valid .arch name.");
      const outcome = await submitWithWindowArch(
        async (actor) =>
          (await build(actor)) as ReturnType<typeof ansClient.buildSetPrimary>,
        setProgress,
        confirmEffect,
      );
      setTxid(outcome.txid);
      setUnconfirmed(!outcome.confirmed);
    } catch (err) {
      setFailedAction(action);
      setFailedError(err);
      const kind = classifyWalletBlocker(err);
      setBlocker(kind);
      void refresh();
      setError(formatAnsMutationError(err));
    } finally {
      setBusyAction(null);
      setProgress(null);
    }
  }

  function setDraft(id: string, value: string) {
    setDrafts((prev) => ({ ...prev, [id]: value }));
  }

  async function saveRow(row: ProfileRecordRow) {
    const draft = (drafts[row.id] ?? "").trim();
    const validation = validateDraft(row, draft);
    if (validation) {
      setError(validation);
      return;
    }
    // The revision the write is built against is also what proves it landed,
    // so it is captured here rather than read a second time. Set inside the
    // builder so a failed read still surfaces through `run`'s error handling.
    let builtAgainstRevision = 0n;
    if (row.kind === "arch-owner") {
      await run(
        MANAGE_ACTIONS.setArchOwner,
        async (archAddress) => {
          const owner = decodeArchAddress(archAddress);
          const existing = await ansClient.fetchRecord(canonicalName!, "ArchOwner");
          builtAgainstRevision = existing?.revision ?? 0n;
          return ansClient.buildSetRecord(
            owner,
            canonicalName!,
            "ArchOwner",
            { kind: "ArchOwner", owner },
            builtAgainstRevision,
          );
        },
        (actor) =>
          recordRevisionPast(canonicalName!, "ArchOwner", builtAgainstRevision)(actor),
      );
      return;
    }
    if (row.kind === "bitcoin-taproot") {
      await run(
        MANAGE_ACTIONS.setTaproot,
        async (archAddress) => {
          const value = parseTaprootAddress(draft, "testnet");
          const existing = await ansClient.fetchRecord(canonicalName!, "BitcoinTaproot");
          builtAgainstRevision = existing?.revision ?? 0n;
          return ansClient.buildSetRecord(
            decodeArchAddress(archAddress),
            canonicalName!,
            "BitcoinTaproot",
            value,
            builtAgainstRevision,
          );
        },
        (actor) =>
          recordRevisionPast(canonicalName!, "BitcoinTaproot", builtAgainstRevision)(actor),
      );
      return;
    }
    if (row.kind === "text" && row.textKey) {
      const action = `Updated ${row.label} record`;
      await run(
        action,
        async (archAddress) => {
          const existing = await ansClient.fetchRecord(canonicalName!, "Text", row.textKey);
          builtAgainstRevision = existing?.revision ?? 0n;
          return ansClient.buildSetRecord(
            decodeArchAddress(archAddress),
            canonicalName!,
            "Text",
            { kind: "Text", key: row.textKey!, value: draft },
            builtAgainstRevision,
          );
        },
        (actor) =>
          recordRevisionPast(
            canonicalName!,
            "Text",
            builtAgainstRevision,
            row.textKey,
          )(actor),
      );
    }
  }

  // Every update is authorised by the name's owner, and the account this
  // page will sign with is not always the one the header shows. Comparing
  // them here is the difference between a warning before the approval and
  // a raw "missing required signature" after it.
  const acting = actingArchAddress(account?.archAddress);
  const ownerMismatch =
    profile?.ownerDisplay && acting && !archAddressesEqual(profile.ownerDisplay, acting)
      ? { owner: profile.ownerDisplay, acting }
      : null;

  const approval = approvalNotice(progress, "update");
  const confirming = confirmingNotice(progress, "update");
  const mismatch = accountMismatchFromError(failedError);
  const signerMismatch = signerMismatchFromError(failedError);
  const noticeContext =
    mismatch ??
    (signerMismatch
      ? {
          pinnedShort: signerMismatch.payerShort,
          currentShort: signerMismatch.signerShort ?? "an unknown account",
          signerShort: signerMismatch.signerShort,
        }
      : undefined);
  const notice = blocker
    ? walletBlockerNotice(blocker, mutationRetryLabel(failedAction), noticeContext)
    : null;
  const errorTitle = notice?.title ?? submitFailureTitle(failedError, failedAction);
  const errorMessage =
    notice?.message ?? "No change was made. Review the details or try again.";

  return (
    <section className="page-section page-section-wide">
      <h1 className="page-title">Manage a name</h1>
      <p className="page-subtitle">
        Review where your Arch name points, then update one record at a time.
      </p>
      {error ? null : (
        <WalletStatusNotice
          status={status}
          working={recovery.working}
          disabled={busy}
          onRun={(next) => void handleRecovery(next)}
        />
      )}
      <div className="manage-flow">
        <div className="card manage-section">
          <div className="step-heading">
            <span className="step-number" aria-hidden>
              1
            </span>
            <div>
              <h2 className="section-heading">Choose the name</h2>
              <p className="section-copy">Enter the name you own and want to update.</p>
            </div>
          </div>
          <div>
            <label className="input-label" htmlFor="manage-name">
              Name
            </label>
            <input
              id="manage-name"
              className="input mono"
              placeholder="alice.arch"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              aria-invalid={Boolean(name.trim()) && !canonicalName}
              aria-describedby="manage-name-help"
            />
            <p className="field-help" id="manage-name-help">
              {name.trim() && !canonicalName
                ? "Enter a valid name with or without .arch."
                : "You can enter the name with or without .arch."}
            </p>
            {canonicalName ? (
              <div className="identity-preview" aria-label={`Identity preview for ${canonicalName}`}>
                <span className="identity-avatar" aria-hidden>
                  {canonicalName.slice(0, 1).toUpperCase()}
                </span>
                <div className="identity-preview-content">
                  <strong className="identity-preview-name">{canonicalName}</strong>
                  <span className="identity-preview-meta">
                    {profileLoading
                      ? "Loading resolution profile…"
                      : profile?.ownerDisplay
                        ? `Owner ${profile.ownerDisplay}`
                        : "Arch testnet identity"}
                  </span>
                </div>
              </div>
            ) : null}
            {profileError ? (
              <StatusNotice tone="warning" title="Name not ready" message={profileError} />
            ) : null}
          </div>
        </div>

        {profile ? (
          <div className="card records-card">
            {ownerMismatch ? (
              <StatusNotice
                tone="warning"
                title="A different account owns this name"
                message={
                  `${canonicalName} is owned by ${shortArchAddress(ownerMismatch.owner)}, but ` +
                  `Arch Wallet is signing as ${shortArchAddress(ownerMismatch.acting)}. Only the ` +
                  `owner can change these records, so an update from this account will be ` +
                  `rejected by the network. Open Arch Wallet and make ` +
                  `${shortArchAddress(ownerMismatch.owner)} the active account, or use My names ` +
                  `to manage a name that belongs to ${shortArchAddress(ownerMismatch.acting)}.`
                }
              />
            ) : null}
            <ResolutionSummary rows={rows} />
            <ProfileRecords
              key={canonicalName}
              groups={groups}
              drafts={drafts}
              busy={busy}
              busyAction={busyAction}
              ready={ready && Boolean(canonicalName)}
              onDraftChange={setDraft}
              onSave={(row) => void saveRow(row)}
              onSetPrimary={() =>
                void run(
                  MANAGE_ACTIONS.setPrimary,
                  (archAddress) =>
                    ansClient.buildSetPrimary(decodeArchAddress(archAddress), canonicalName!),
                  primaryNameIs(canonicalName!),
                )
              }
              onClearPrimary={() =>
                void run(
                  MANAGE_ACTIONS.clearPrimary,
                  (archAddress) =>
                    ansClient.buildClearPrimary(decodeArchAddress(archAddress)),
                  primaryNameCleared(),
                )
              }
              onUseConnectedWallet={(row) => void saveRow(row)}
            />
          </div>
        ) : null}

        <div className="card manage-section">
          <h2 className="section-heading">List for sale</h2>
          <p className="section-copy">
            Fixed-price listing in ARCH or aBTC (Arch Bitcoin). An active listing blocks
            transfers until you cancel or someone buys.
          </p>
          {activeListing ? (
            <>
              <StatusNotice
                tone="info"
                title="Listed"
                message={formatQuoteAmount(activeListing.price, activeListing.currency)}
              />
              <button
                className="btn btn-secondary"
                disabled={busy || !ready || !canonicalName}
                onClick={() =>
                  void run(
                    MANAGE_ACTIONS.cancelListing,
                    (archAddress) =>
                      ansClient.buildCancelListing(
                        decodeArchAddress(archAddress),
                        canonicalName!,
                      ),
                    async () => (await ansClient.fetchListing(canonicalName!)) == null,
                  )
                }
              >
                {busyAction === MANAGE_ACTIONS.cancelListing
                  ? "Waiting for approval…"
                  : "Cancel listing"}
              </button>
            </>
          ) : (
            <>
              <QuoteAmountSelector
                amount={listPrice}
                currency={listCurrency}
                label="Listing price"
                onAmountChange={setListPrice}
                onCurrencyChange={setListCurrency}
              />
              <button
                className="btn btn-primary"
                disabled={
                  busy ||
                  !ready ||
                  !canonicalName ||
                  (parseQuoteAmount(listPrice, listCurrency) ?? 0n) <= 0n
                }
                onClick={() => {
                  const price = parseQuoteAmount(listPrice, listCurrency);
                  if (price === null || price <= 0n) return;
                  void run(
                    MANAGE_ACTIONS.list,
                    (archAddress) =>
                      ansClient.buildListName(
                        decodeArchAddress(archAddress),
                        canonicalName!,
                        listCurrency,
                        price,
                      ),
                    async () => {
                      const listing = await ansClient.fetchListing(canonicalName!);
                      return (
                        !!listing &&
                        listing.currency === listCurrency &&
                        listing.price === price
                      );
                    },
                  );
                }}
              >
                {busyAction === MANAGE_ACTIONS.list ? "Waiting for approval…" : "List for sale"}
              </button>
            </>
          )}
        </div>

        <details className="card manage-section danger-zone">
          <summary className="danger-zone-summary">
            <span className="step-number" aria-hidden>
              2
            </span>
            <div>
              <h2 className="section-heading">Transfer ownership</h2>
              <p className="section-copy">
                Irreversible. Move this name to another Arch account — expand only when you need it.
              </p>
            </div>
          </summary>
          <div className="danger-zone-body">
            <StatusNotice
              tone="warning"
              title="This action is irreversible"
              message="The new owner must republish records. Your existing primary-name link will no longer be valid."
            />
            <div>
              <label className="input-label" htmlFor="transfer-owner">
                New owner wallet address
              </label>
              <input
                id="transfer-owner"
                className="input mono"
                placeholder="Arch address (base58 or hex)"
                value={transferTo}
                onChange={(e) => setTransferTo(e.target.value)}
                autoComplete="off"
                aria-invalid={Boolean(transferTo.trim()) && !validTransferAddress}
                aria-describedby="transfer-owner-help"
              />
              <p className="field-help mono" id="transfer-owner-help">
                {transferTo.trim() && !validTransferAddress
                  ? "Enter a valid 32-byte Arch account address."
                  : transferTo || "The full destination will be shown again before approval."}
              </p>
            </div>
            <button
              className="btn btn-full btn-danger"
              disabled={busy || !ready || !canonicalName || !validTransferAddress}
              onClick={() => {
                if (
                  !window.confirm(
                    `Transfer ${canonicalName} to ${transferTo}? This cannot be undone.`,
                  )
                ) {
                  return;
                }
                void run(
                  MANAGE_ACTIONS.transfer,
                  (archAddress) =>
                    ansClient.buildTransfer(
                      decodeArchAddress(archAddress),
                      canonicalName!,
                      decodeArchAddress(transferTo),
                    ),
                  nameOwnedBy(canonicalName!, transferTo),
                );
              }}
            >
              {busyAction === MANAGE_ACTIONS.transfer ? "Waiting for approval…" : "Transfer name"}
            </button>
          </div>
        </details>
      </div>

      {txid ? (
        <div className="notice notice-success manage-feedback" role="status" aria-live="polite">
          <div className="notice-body">
            <p className="notice-title">
              {unconfirmed ? "Submitted — not confirmed yet" : "Transaction submitted"}
            </p>
            <p className="notice-message">
              {unconfirmed
                ? pendingConfirmationMessage("update")
                : "Your update is being processed."}{" "}
              View on Explorer: <ExplorerLink kind="tx" value={txid} className="mono" />
            </p>
          </div>
        </div>
      ) : null}
      {approval ? (
        <StatusNotice tone="info" title={approval.title} message={approval.message} />
      ) : null}
      {confirming ? (
        <StatusNotice tone="info" title={confirming.title} message={confirming.message} />
      ) : null}
      {statusInfo && !error ? (
        <StatusNotice tone="info" title="Ready to continue" message={statusInfo} />
      ) : null}
      {error ? (
        <StatusNotice
          tone="error"
          title={errorTitle}
          message={errorMessage}
          detail={error}
          detailOpen={!notice}
          action={
            notice?.action ? (
              <WalletRecoveryActions
                action={notice.action}
                label={notice.actionLabel}
                secondaryAction={notice.secondaryAction}
                secondaryLabel={notice.secondaryActionLabel}
                working={recovery.working}
                disabled={busy}
                onRun={(next) => void handleRecovery(next)}
              />
            ) : undefined
          }
        />
      ) : null}
    </section>
  );
}
