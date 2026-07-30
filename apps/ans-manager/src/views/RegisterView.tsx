import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { canonicalizeName, validateLabel } from "@arch-network/ans-sdk";
import { ExplorerLink } from "../components/ExplorerLink";
import { StatusNotice } from "../components/StatusNotice";
import { WalletRecoveryActions } from "../components/WalletRecoveryActions";
import { WalletStatusNotice } from "../components/WalletStatusNotice";
import { useArchWallet } from "../hooks/useArchWallet";
import { useWalletRecovery } from "../hooks/useWalletRecovery";
import {
  accountMismatchFromError,
  ansClient,
  confirmingNotice,
  decodeArchAddress,
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
import { nameRegisteredTo } from "../lib/confirm-effects";
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
import { parseRegisterLabelParam } from "../lib/register-handoff";
import { registrationApprovalCopy } from "../lib/register-approvals";

function previewCanonical(label: string): string | null {
  const trimmed = label.trim().toLowerCase();
  if (!trimmed) return null;
  try {
    validateLabel(trimmed);
    return canonicalizeName(`${trimmed}.arch`);
  } catch {
    return null;
  }
}

export function RegisterView() {
  const { status, account, connecting, refresh, connectEpoch } = useArchWallet();
  const [searchParams] = useSearchParams();
  const labelParam = searchParams.get("label");
  const handoffLabel = parseRegisterLabelParam(labelParam);
  const [label, setLabel] = useState(handoffLabel ?? "");
  const [txid, setTxid] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  /** Set only when the wallet signed as something other than it reported. */
  const [actor, setActor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedError, setFailedError] = useState<unknown>(null);
  const [blocker, setBlocker] = useState<WalletBlockerKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusInfo, setStatusInfo] = useState<string | null>(null);
  const [progress, setProgress] = useState<SubmitProgress | null>(null);
  const recovery = useWalletRecovery();
  const [step, setStep] = useState<"connect" | "setup" | "approve" | "complete">("connect");
  const prevAccountRef = useRef<string | null>(account?.archAddress ?? null);
  // One derivation for the whole view: `cta` is null exactly when the
  // extension can sign right now, so the button cannot promise an
  // approval the wallet is in no position to give.
  const cta = walletStatusCta(status);
  const ready = cta === null;
  const needsWallet = status.state === "no_extension";
  const progressStep = busy || step === "complete" ? step : ready ? "approve" : "connect";
  const registerAction = MANAGE_ACTIONS.register;

  useEffect(() => {
    // Only react when a label query is present: valid → prefill, invalid → clear.
    // Absent query leaves in-progress edits alone (plain /register nav).
    if (labelParam == null) return;
    setLabel(handoffLabel ?? "");
  }, [labelParam, handoffLabel]);

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
    setTxid(null);
    setUnconfirmed(false);
    setStatusInfo(null);
  }, [label]);

  const fullName = previewCanonical(label);

  async function handleRecovery(action: WalletStatusAction) {
    setError(null);
    setBlocker(null);
    const result = await recovery.run(action);
    if (result.ok) {
      setStep("approve");
      // Adopting the wallet's current account is a decision the user
      // already made by clicking; making them click Register a second
      // time is the loop they were stuck in. Rebuild and resubmit.
      if (action === "adopt") {
        setStatusInfo(null);
        await runRegister();
        return;
      }
      setStatusInfo(`Wallet ready — ${mutationRetryLabel(registerAction)} again.`);
      return;
    }
    setStatusInfo(null);
    setBlocker(classifyWalletBlocker(result.error));
    setError(formatAnsMutationError(result.error));
  }

  /**
   * One click, one wallet request.
   *
   * When the wallet cannot sign yet, this runs only the unblocking step
   * (unlock / connect) and stops. It deliberately does not chain into
   * signing afterwards: the user asked to unlock, and the next thing they
   * should see is a header and a button that agree the wallet is ready.
   */
  function onRegister(event: React.FormEvent) {
    event.preventDefault();
    if (cta) {
      void handleRecovery(cta.action);
      return;
    }
    void runRegister();
  }

  async function runRegister() {
    setError(null);
    setFailedError(null);
    setBlocker(null);
    setTxid(null);
    setUnconfirmed(false);
    setActor(null);
    setStatusInfo(null);
    setProgress(null);
    try {
      validateLabel(label.trim().toLowerCase());
      const canonical = canonicalizeName(`${label.trim().toLowerCase()}.arch`);
      setBusy(true);
      setStep("connect");
      // Re-read the wallet immediately before mutating: the status the
      // button was rendered from can be seconds old, and an auto-lock in
      // between is exactly the case that used to reach the signer.
      const current = await refresh();
      if (current.state !== "connected") throw walletStatusError(current);
      const existing = await ansClient.fetchNameAccount(canonical);
      if (existing) throw new Error(`${canonical} is already registered`);
      setStep("setup");
      // The owner is whoever ends up paying, and that is not settled until
      // a signature has been checked — so the instruction is rebuilt from
      // the acting account rather than from the account the header shows.
      const outcome = await submitWithWindowArch(
        (actor) =>
          ansClient.buildRegister(decodeArchAddress(actor), label.trim().toLowerCase()),
        (next) => {
          setProgress(next);
          setStep(next.phase === "account-setup" ? "setup" : "approve");
        },
        nameRegisteredTo(canonical),
      );
      setTxid(outcome.txid);
      setUnconfirmed(!outcome.confirmed);
      setActor(outcome.adopted ? outcome.actorArchAddress : null);
      setStep("complete");
    } catch (err) {
      const kind = classifyWalletBlocker(err);
      setBlocker(kind);
      setFailedError(err);
      // Any wallet failure invalidates what the header is showing.
      void refresh();
      setStep(account ? "approve" : "connect");
      setError(formatAnsMutationError(err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

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
    ? walletBlockerNotice(blocker, mutationRetryLabel(registerAction), noticeContext)
    : null;
  const errorTitle = notice?.title ?? submitFailureTitle(failedError, registerAction);
  const errorMessage =
    notice?.message ?? "The name was not registered. Review the details or try again.";
  // The approval copy describes what the wallet is asking for, so it is only
  // right while an Approve window is the thing being waited on.
  const confirming = confirmingNotice(progress, "registration");
  const approval = registrationApprovalCopy(confirming ? null : progress, fullName);

  return (
    <section className="page-section">
      <p className="eyebrow">Create your identity</p>
      <h1 className="page-title">Register a .arch name</h1>
      <p className="page-subtitle">
        Free on testnet. Yours permanently. Review the name, connect when prompted, then approve registration.
      </p>
      <ol className="progress-steps" aria-label="Registration progress">
        <li className={progressStep === "connect" ? "current" : ""}>1. Connect</li>
        <li className={progressStep === "setup" ? "current" : ""}>2. Account setup</li>
        <li className={progressStep === "approve" || progressStep === "complete" ? "current" : ""}>
          3. Register
        </li>
      </ol>
      <aside className="approval-explainer" aria-live="polite">
        <div>
          <p className="approval-explainer-label">What you’ll approve</p>
          <p className="approval-explainer-heading">{approval.heading}</p>
          <p className="approval-explainer-detail">{approval.detail}</p>
        </div>
        <details>
          <summary>Technical detail</summary>
          <p>
            First-time account setup is created and funded on testnet by the faucet.
            It is needed only once per Arch account.
          </p>
        </details>
      </aside>
      {error ? null : (
        <WalletStatusNotice
          status={status}
          working={recovery.working}
          disabled={busy}
          onRun={(next) => void handleRecovery(next)}
        />
      )}
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
            aria-invalid={Boolean(label.trim()) && !fullName}
            aria-describedby="label-help"
          />
          <p className="field-help" id="label-help">
            {label.trim() && !fullName
              ? "Use letters, numbers, or single hyphens; do not include .arch."
              : "Your name will end in .arch."}
          </p>
        </div>
        {fullName ? (
          <div className="preview">
            Registering <span className="mono">{fullName}</span>
          </div>
        ) : null}
        <button
          className="btn btn-primary btn-full"
          disabled={
            busy ||
            recovery.working !== null ||
            needsWallet ||
            status.state === "detecting" ||
            (ready && !fullName)
          }
        >
          {recovery.working === "unlock"
            ? "Waiting for wallet…"
            : (busy && step === "connect") || connecting
              ? "Connecting…"
            : busy && confirming
              ? "Confirming on Arch…"
            : busy && progress
              ? `${approval.heading}…`
            : busy && step === "setup"
              ? "Checking account setup…"
            : busy && step === "approve"
              ? "Waiting for approval…"
            : needsWallet
              ? "Install Arch Wallet to register"
            : cta
              ? cta.label
              : fullName
                ? `Approve registration for ${fullName}`
                : "Register name"}
        </button>
      </form>
      {txid ? (
        <div className="notice notice-success" role="status" aria-live="polite">
          <div className="notice-body">
            <p className="notice-title">
              {unconfirmed ? "Submitted — not confirmed yet" : "Name registered"}
            </p>
            <p className="notice-message">
              {unconfirmed
                ? pendingConfirmationMessage("registration")
                : "The transaction was submitted successfully."}{" "}
              View on Explorer: <ExplorerLink kind="tx" value={txid} className="mono" />
            </p>
            {actor ? (
              <p className="notice-message">
                Arch Wallet signed with {shortArchAddress(actor)} — its active account,
                which is not the account this site is connected to — so the name is owned
                by {shortArchAddress(actor)}.
              </p>
            ) : null}
            {fullName ? (
              <div className="notice-action">
                <Link className="btn btn-primary" to={`/manage?name=${encodeURIComponent(fullName)}`}>
                  Manage {fullName}
                </Link>
              </div>
            ) : null}
          </div>
        </div>
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
