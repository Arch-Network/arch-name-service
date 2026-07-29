import {
  AnsClient,
  ArchRpcError,
  archRpcParams,
  createSplitAnsTransport,
  isTransactionNotIndexedError,
  isTransactionPendingError,
  loadTestnetManifest,
  makeAnsSigner,
  signAndSendInstruction,
  waitForTransaction,
  type BuiltInstruction,
} from "@arch-network/ans-sdk";
import bs58 from "bs58";
import {
  archIdentitiesEqual,
  archIdentityFingerprint,
  canonicalArchKey,
  shortArchAddress,
} from "./arch-identity";
import { checkArchSignature, type SignatureCheck } from "./bip322";
import { debugLog } from "./debug";
import {
  createArchExtensionHashSigner,
  type AnsHashSigner,
} from "./ans-wallet-port";
import { getActiveAnsWalletPort } from "./ans-wallet-session";
import {
  preferredSigner,
  rememberSignerObservation,
  signerCandidates,
} from "./signer-registry";
import { walletRequest } from "./wallet-gateway";
import {
  isSignableAccount,
  normalizeAccount,
  probeWalletStatus,
  statusAccount,
  walletStatusError,
  type ConnectedAccount,
} from "./wallet-status";

// Production routes through CloudFront → Lambda → the authenticated testnet
// indexer. RPC is reserved for writes and raw account-state reads that the
// native Explorer REST API does not expose.
const rpcUrl = import.meta.env.VITE_ARCH_RPC_URL ?? "/rpc";
const explorerUrl = import.meta.env.VITE_EXPLORER_URL ?? "/explorer";

let cachedClient: AnsClient | null = null;

export function getAnsClient(): AnsClient {
  if (!cachedClient) {
    cachedClient = new AnsClient(
      loadTestnetManifest(),
      createSplitAnsTransport({ rpcUrl, explorerUrl }),
    );
  }
  return cachedClient;
}

export const ansClient = {
  get transport() {
    return getAnsClient().transport;
  },
  fetchRegistryConfig: (...args: Parameters<AnsClient["fetchRegistryConfig"]>) =>
    getAnsClient().fetchRegistryConfig(...args),
  fetchNameAccount: (...args: Parameters<AnsClient["fetchNameAccount"]>) =>
    getAnsClient().fetchNameAccount(...args),
  resolveOwner: (...args: Parameters<AnsClient["resolveOwner"]>) =>
    getAnsClient().resolveOwner(...args),
  resolveRecord: (...args: Parameters<AnsClient["resolveRecord"]>) =>
    getAnsClient().resolveRecord(...args),
  resolvePrimary: (...args: Parameters<AnsClient["resolvePrimary"]>) =>
    getAnsClient().resolvePrimary(...args),
  listOwnedNames: (...args: Parameters<AnsClient["listOwnedNames"]>) =>
    getAnsClient().listOwnedNames(...args),
  buildRegister: (...args: Parameters<AnsClient["buildRegister"]>) =>
    getAnsClient().buildRegister(...args),
  buildTransfer: (...args: Parameters<AnsClient["buildTransfer"]>) =>
    getAnsClient().buildTransfer(...args),
  buildSetRecord: (...args: Parameters<AnsClient["buildSetRecord"]>) =>
    getAnsClient().buildSetRecord(...args),
  buildSetPrimary: (...args: Parameters<AnsClient["buildSetPrimary"]>) =>
    getAnsClient().buildSetPrimary(...args),
  buildClearPrimary: (...args: Parameters<AnsClient["buildClearPrimary"]>) =>
    getAnsClient().buildClearPrimary(...args),
  fetchRecord: (...args: Parameters<AnsClient["fetchRecord"]>) =>
    getAnsClient().fetchRecord(...args),
  fetchNameProfile: (...args: Parameters<AnsClient["fetchNameProfile"]>) =>
    getAnsClient().fetchNameProfile(...args),
  fetchReverse: (...args: Parameters<AnsClient["fetchReverse"]>) =>
    getAnsClient().fetchReverse(...args),
};

export function decodeArchAddress(value: string): Uint8Array {
  const trimmed = value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      out[i] = Number.parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }
  return bs58.decode(trimmed);
}

export function encodeArchAddress(bytes: Uint8Array): string {
  return bs58.encode(bytes);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function signMessageHashHex(messageHashHex: string): Promise<string> {
  const port = getActiveAnsWalletPort();
  if (port) return port.signMessageHash(messageHashHex);
  // Fallback when the React bridge has not registered a port yet.
  return createArchExtensionHashSigner()(messageHashHex);
}

/** Signs a 64-char SanitizedMessage hash and returns 64-byte (r||s) hex. */
export type ArchHashSigner = AnsHashSigner;

/**
 * The 32-byte account key behind a wallet-supplied address.
 *
 * Everything that touches the chain goes through here rather than
 * `decodeArchAddress`: the wallet may hand back a compressed key whose
 * parity byte is not part of the identity, and a 33-byte fee payer is
 * rejected by the node long after the user has approved it.
 */
function requireArchKey(archAddress: string): Uint8Array {
  const key = canonicalArchKey(archAddress);
  if (!key) {
    throw new Error(
      `Arch Wallet returned an address this app cannot read as an account key: ${archAddress}`,
    );
  }
  return key;
}

/** True when the Arch account already exists on-chain (no faucet setup needed). */
export async function archAccountExists(archAddress: string): Promise<boolean> {
  const pubkey = requireArchKey(archAddress);
  return Boolean(await getAnsClient().transport.readAccountInfo(pubkey));
}

/**
 * Create the connected Arch account on-chain via the testnet faucet.
 * Required before the account can fee-pay ANS mutations, and it costs the
 * user a wallet approval of its own: the faucet hands back an unsigned
 * account-creation transaction that the new account itself must co-sign.
 *
 * `signHash` is injected rather than calling the wallet directly so the
 * caller can pin every signature in a multi-approval flow to the same
 * origin-bound account that fee-pays the follow-up mutation.
 */
export async function createArchAccountWithFaucet(
  archAddress: string,
  signHash: ArchHashSigner,
): Promise<void> {
  const pubkey = requireArchKey(archAddress);

  // This is the one ANS RPC call that does not go through the SDK transport
  // (the faucet hands back an unsigned transaction rather than a result the
  // transport models), so it borrows the transport's params builder. The shape
  // is flat and method-specific — see `archRpcParams` for the verified table.
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "create_account_with_faucet",
      params: archRpcParams.create_account_with_faucet(pubkey),
    }),
  });
  if (!response.ok) {
    throw new Error(`Arch faucet HTTP ${response.status}`);
  }
  const body = (await response.json()) as {
    result?: {
      version: number;
      signatures: number[][];
      message: unknown;
    };
    error?: { message?: string };
  };
  if (body.error || !body.result) {
    throw new Error(
      body.error?.message ??
        "Could not create your Arch account via the testnet faucet. Open Arch Wallet and complete onboarding first.",
    );
  }

  const { SanitizedMessageUtil, SignatureUtil } = await import("@saturnbtcio/arch-sdk");
  const message = body.result.message as {
    header: unknown;
    account_keys: number[][];
    recent_blockhash: number[];
    instructions: Array<{ program_id_index: number; accounts: number[]; data: number[] }>;
  };
  const sdkMessage = {
    header: message.header,
    account_keys: message.account_keys.map((key) => Uint8Array.from(key)),
    recent_blockhash: Uint8Array.from(message.recent_blockhash),
    instructions: message.instructions.map((instruction) => ({
      program_id_index: instruction.program_id_index,
      accounts: instruction.accounts,
      data: Uint8Array.from(instruction.data),
    })),
  };
  const messageHashHex = new TextDecoder().decode(SanitizedMessageUtil.hash(sdkMessage as never));
  const userSigHex = toHex(SignatureUtil.adjustSignature(fromHex(await signHash(messageHashHex))));
  const signed = {
    ...body.result,
    signatures: [...body.result.signatures, Array.from(fromHex(userSigHex))],
  };
  const txid = await getAnsClient().transport.sendTransaction(signed);
  debugLog("faucet:submitted", { txid });

  // The account becoming readable is the signal that matters — the next step
  // needs it as fee payer. A status lookup that fails along the way is not a
  // failed account creation and must never abort the wait.
  const outcome = await waitForTransaction({
    transport: getAnsClient().transport,
    txid,
    isComplete: async () => Boolean(await getAnsClient().transport.readAccountInfo(pubkey)),
    // Two live testnet runs on 2026-07-28 took 24.6s and 63.7s, so the spread
    // here is wide and a tight deadline is the wrong bet: giving up early
    // strands the user between the two approvals of a single action, having
    // already paid for an account that does exist.
    timeoutMs: 180_000,
  });
  if (outcome.status === "complete") return;
  debugLog("faucet:timeout", { txid, lastLookupError: outcome.lastLookupError?.message });
  // "Not indexed yet" is the expected answer during the whole wait and says
  // nothing about why it ran out; quoting it here only puts a JSON-RPC error
  // in front of a user who cannot act on it.
  const lookupDetail =
    outcome.lastLookupError && !isTransactionNotIndexedError(outcome.lastLookupError)
      ? ` Last status lookup failed: ${outcome.lastLookupError.message}`
      : "";
  throw new Error(
    "Arch account creation was submitted but the account is not visible yet " +
      `(transaction ${txid}). Wait a few seconds and retry — retrying is safe, ` +
      "it will not create a second account." +
      lookupDetail,
  );
}

/**
 * Same signing key? Compares the canonical 32-byte x-only form, so hex
 * vs base58, `0x` prefixes, casing, and a 33-byte compressed key with its
 * parity byte all resolve to the same identity instead of reading as an
 * account switch.
 */
export function archAddressesEqual(a: string, b: string): boolean {
  return archIdentitiesEqual(a, b);
}

export type ConnectedArchAccount = ConnectedAccount;

/** Manage / Register action labels used for busy state and failure titles. */
export const MANAGE_ACTIONS = {
  setPrimary: "Set as primary name",
  clearPrimary: "Cleared primary name",
  setArchOwner: "Updated Arch wallet record",
  setTaproot: "Updated Bitcoin Taproot record",
  transfer: "Transferred name",
  register: "Register name",
} as const;

const FAILURE_TITLES: Record<string, string> = {
  [MANAGE_ACTIONS.setPrimary]: "Set as primary failed",
  [MANAGE_ACTIONS.clearPrimary]: "Clear primary failed",
  [MANAGE_ACTIONS.setArchOwner]: "Update Arch wallet record failed",
  [MANAGE_ACTIONS.setTaproot]: "Update Taproot record failed",
  [MANAGE_ACTIONS.transfer]: "Transfer failed",
  [MANAGE_ACTIONS.register]: "Registration failed",
};

const RETRY_LABELS: Record<string, string> = {
  [MANAGE_ACTIONS.setPrimary]: "Set as primary",
  [MANAGE_ACTIONS.clearPrimary]: "Clear primary",
  [MANAGE_ACTIONS.setArchOwner]: "Use connected wallet",
  [MANAGE_ACTIONS.setTaproot]: "Update Taproot record",
  [MANAGE_ACTIONS.transfer]: "Transfer name",
  [MANAGE_ACTIONS.register]: "Register",
};

export function mutationFailureTitle(action: string | null | undefined): string {
  if (!action) return "Update failed";
  return FAILURE_TITLES[action] ?? "Update failed";
}

export function mutationRetryLabel(action: string | null | undefined): string {
  if (!action) return "your action";
  return RETRY_LABELS[action] ?? "your action";
}

/**
 * Failure title that names the phase. A faucet/account-setup failure is not
 * a registration failure — reporting it as one sends the user off looking
 * for a problem with the name.
 */
export function submitFailureTitle(
  error: unknown,
  action: string | null | undefined,
): string {
  if (error instanceof AnsStepError && error.phase === "account-setup") {
    return "Arch account setup failed";
  }
  return mutationFailureTitle(action);
}

/** Short "what the wallet is asking for" caption, e.g. "Approval 2 of 2". */
export function approvalCaption(progress: SubmitProgress | null): string | null {
  if (!progress || progress.approvalTotal < 2) return null;
  return `Approval ${progress.approvalIndex} of ${progress.approvalTotal}`;
}

/**
 * What to tell the user while an Approve window is open — and nothing at
 * all in the ordinary case.
 *
 * One approval is the normal cost of an ANS update, so a notice here is
 * only earned when the flow is asking for more than that. There are
 * exactly two such cases, and they are not interchangeable: the account
 * has never existed on-chain (a setup transaction has to come first), or
 * the wallet signed as somebody other than the account it reported and
 * the transaction was rebuilt around the real signer. The second one used
 * to be silent, which is what makes a second Approve window look like the
 * app asking twice for no reason.
 *
 * @param subject What the user set out to do, e.g. "update" / "registration".
 */
export function approvalNotice(
  progress: SubmitProgress | null,
  subject: string,
): { title: string; message: string } | null {
  if (!progress || progress.stage === "confirming") return null;
  if (progress.attempt > 1) {
    return {
      title: "One more approval needed",
      message:
        "Arch Wallet signed with a different account than the one it reports to " +
        `this site, so the ${subject} was rebuilt to pay with the account that ` +
        "actually signed. The first signature was checked here and never " +
        "submitted — nothing was sent to the network. Approve once more in Arch " +
        "Wallet; later actions will ask only once.",
    };
  }
  if (progress.approvalTotal < 2) return null;
  return {
    title: `${approvalCaption(progress)} — approve in Arch Wallet`,
    message:
      progress.phase === "account-setup"
        ? "Your Arch account does not exist on-chain yet, so it cannot pay for " +
          `this ${subject} until it is created. Approve the account-setup ` +
          `transaction now; a second approval follows for the ${subject} itself. ` +
          "This happens once per wallet account."
        : `Approve the ${subject} in the Arch Wallet window. Both approvals use ` +
          "the same account shown in the header.",
  };
}

/**
 * What to show once the approvals are done and only the network is left.
 *
 * Confirmation can take the better part of a minute on testnet, and for that
 * whole stretch the page used to keep saying it was waiting for an approval
 * the user had already given.
 */
export function confirmingNotice(
  progress: SubmitProgress | null,
  subject: string,
): { title: string; message: string } | null {
  if (progress?.stage !== "confirming") return null;
  return {
    title: "Waiting for the network to confirm…",
    message:
      `Arch has your ${subject} — nothing more to approve. Confirmation on testnet ` +
      "usually takes a few seconds and occasionally up to a minute. Leave this page open.",
  };
}

/**
 * Copy for a transaction the node accepted but has not confirmed yet.
 *
 * This is not a failure and must never be worded as one: the transaction is on
 * the network and generally lands moments later. Saying otherwise is what told
 * a user their primary name had not been set while it was already set
 * on-chain.
 */
export function pendingConfirmationMessage(subject: string): string {
  return (
    `Arch accepted the ${subject}, but it had not shown up as confirmed by the time ` +
    "this page stopped waiting. That is usually just indexing lag — the change may " +
    "well have landed. Reload in a minute to see the current state. Trying again is " +
    "safe either way."
  );
}

/**
 * Where the fee payer came from, and what had already happened when the
 * wallet stopped agreeing with it.
 *
 * This is the difference between "the page was holding a stale account"
 * and "the user genuinely switched wallets between two approvals of one
 * action" — indistinguishable in the copy, and the only two readings a
 * support conversation cares about. Carried on the error so the
 * technical-details block can state it instead of implying it.
 */
export type AccountSwitchContext = {
  /** `reported` = this action's own status read; `observed` = a learned signer. */
  pinSource: "reported" | "observed";
  /** Epoch ms the fee payer was fixed for this action. */
  pinnedAt: number;
  /** Wallet approvals already granted under the old account. */
  approvalsCompleted: number;
  /** Which pre-signature check tripped, e.g. `approval-2-of-2`. */
  checkpoint: string;
};

function describeSwitchContext(context: AccountSwitchContext): string {
  const age = Math.max(0, Math.round((Date.now() - context.pinnedAt) / 1000));
  return (
    `Fee payer fixed ${age}s ago from the ${context.pinSource} account, at ` +
    `${context.checkpoint}, after ${context.approvalsCompleted} approval` +
    `${context.approvalsCompleted === 1 ? "" : "s"}.`
  );
}

/**
 * Thrown when the wallet changes the account it reports *between two
 * approvals of one action*, after a signature already exists for the
 * old one.
 *
 * Deliberately not thrown before the first approval. The extension can
 * report a different account than it signs with, and it can report a
 * different account than it did a moment ago; neither is a problem the
 * user caused or can act on, and raising it as an error there produced
 * a "wallet switched accounts" notice on a page where nothing had
 * switched. Before anything is signed the fee payer is simply re-derived
 * from the current read.
 *
 * The message carries both identities and the pin context on purpose: it
 * is what the UI shows under "Technical details", and a mismatch report
 * is unactionable for support without knowing which two accounts were
 * involved and whether a signature already existed.
 */
export class WalletAccountChangedError extends Error {
  readonly code = "WALLET_ACCOUNT_CHANGED" as const;
  readonly previousArchAddress: string;
  readonly currentArchAddress: string;
  readonly currentAccount?: ConnectedArchAccount;
  readonly context: AccountSwitchContext;

  constructor(params: {
    previousArchAddress: string;
    currentArchAddress: string;
    currentAccount?: ConnectedArchAccount;
    context: AccountSwitchContext;
  }) {
    super(
      "Connected wallet account changed mid-flow. This action was set up to pay " +
        `with ${archIdentityFingerprint(params.previousArchAddress)}, but Arch ` +
        `Wallet is now offering ${archIdentityFingerprint(params.currentArchAddress)}. ` +
        `${describeSwitchContext(params.context)} ` +
        "Nothing further was signed and nothing was submitted.",
    );
    this.name = "WalletAccountChangedError";
    this.previousArchAddress = params.previousArchAddress;
    this.currentArchAddress = params.currentArchAddress;
    this.currentAccount = params.currentAccount;
    this.context = params.context;
  }
}

/** One candidate key a signature was tested against, and the verdict. */
export type SignerProbe = { fingerprint: string; result: SignatureCheck };

/**
 * Thrown when the wallet produced a valid signature — from the wrong key.
 *
 * On the released extension the Approve window signs with the account
 * that is *active* in the wallet, while `getAccount()` reports the
 * account this origin is connected to. When those differ the node throws
 * the transaction out with "error checking transaction sigs" after the
 * user has already approved it. Checking the signature locally moves
 * that discovery to before submission, where it is still fixable.
 */
export class SignerMismatchError extends Error {
  readonly code = "SIGNER_MISMATCH" as const;

  constructor(
    /** The fee payer the transaction was built for. */
    readonly payerArchAddress: string,
    /** The key that actually signed, when a candidate matched. */
    readonly signerArchAddress: string | null,
    /** Every key tried, for the technical-details block. */
    readonly probes: SignerProbe[],
    readonly approvalsCompleted: number,
  ) {
    super(
      signerArchAddress
        ? `Arch Wallet signed with ${archIdentityFingerprint(signerArchAddress)}, not ` +
            `${archIdentityFingerprint(payerArchAddress)}, which is paying for this ` +
            "transaction. Verified locally before submitting; nothing was sent to the " +
            "network and nothing changed on-chain."
        : `Arch Wallet's signature does not verify against ` +
            `${archIdentityFingerprint(payerArchAddress)}, the account paying for this ` +
            "transaction, and does not match any account this browser has seen the " +
            "wallet report. Verified locally before submitting; nothing was sent to " +
            "the network and nothing changed on-chain.",
    );
    this.name = "SignerMismatchError";
  }
}

export function isSignerMismatchError(error: unknown): error is SignerMismatchError {
  const target = error instanceof AnsStepError ? error.cause : error;
  return (
    target instanceof SignerMismatchError ||
    (target instanceof Error && (target as { code?: string }).code === "SIGNER_MISMATCH")
  );
}

/** The two identities behind a mismatch, for copy and support details. */
export type AccountMismatch = {
  pinnedArchAddress: string;
  currentArchAddress: string;
  pinnedShort: string;
  currentShort: string;
  currentKind?: string;
};

export function accountMismatchFromError(error: unknown): AccountMismatch | null {
  const target =
    error instanceof AnsStepError ? error.cause : error;
  if (!(target instanceof WalletAccountChangedError)) return null;
  return {
    pinnedArchAddress: target.previousArchAddress,
    currentArchAddress: target.currentArchAddress,
    pinnedShort: shortArchAddress(target.previousArchAddress),
    currentShort: shortArchAddress(target.currentArchAddress),
    currentKind: target.currentAccount?.kind,
  };
}

/** Both sides of a signer divergence, for the notice copy. */
export type SignerMismatch = {
  payerShort: string;
  signerShort: string | null;
};

export function signerMismatchFromError(error: unknown): SignerMismatch | null {
  const target = error instanceof AnsStepError ? error.cause : error;
  if (!(target instanceof SignerMismatchError)) return null;
  return {
    payerShort: shortArchAddress(target.payerArchAddress),
    signerShort: target.signerArchAddress
      ? shortArchAddress(target.signerArchAddress)
      : null,
  };
}

/**
 * Which phase of a mutation failed. A first-ever mutation for an Arch
 * account needs two wallet approvals — the faucet account-creation
 * co-signature, then the mutation itself — and the two failure modes need
 * different copy: "account setup" failures leave nothing registered and are
 * usually retryable as-is, while a mutation failure after a successful
 * setup means only the second signature has to be redone.
 */
export type SubmitPhase = "account-setup" | "mutation";

/** What the wallet is about to prompt for, and where it sits in the flow. */
export type SubmitProgress = {
  phase: SubmitPhase;
  /**
   * `"confirming"` once the node has the transaction and the flow is only
   * waiting for it to settle. Absent means an Approve window is what the user
   * is waiting on. Optional so the approval emissions stay the shape every
   * caller already reads.
   */
  stage?: "confirming";
  /** 1-based position of this wallet approval within the whole flow. */
  approvalIndex: number;
  /** Total approvals this flow needs (2 when the Arch account is new). */
  approvalTotal: number;
  /**
   * 1 on the first run. 2 means the wallet signed as an account other than
   * the one it reported, so the transaction was rebuilt around the real
   * signer — the one case where an approval the user already gave is
   * discarded and a further one is needed.
   */
  attempt: number;
};

/**
 * Wraps a failure with the phase it happened in so the UI can name the
 * step instead of reporting every problem as "registration failed".
 */
export class AnsStepError extends Error {
  readonly code = "ANS_STEP_FAILED" as const;

  constructor(
    readonly phase: SubmitPhase,
    readonly progress: SubmitProgress | null,
    readonly cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause ?? "Unknown error"));
    this.name = "AnsStepError";
  }
}

export function unwrapStepError(error: unknown): unknown {
  return error instanceof AnsStepError ? error.cause : error;
}

export class UnsupportedWalletKindError extends Error {
  readonly code = "UNSUPPORTED_WALLET_KIND" as const;

  constructor(readonly kind: string) {
    super(
      kind === "watch"
        ? "Watch-only wallets cannot sign ANS updates. Switch to a Turnkey Arch Wallet account (passkey or email)."
        : "Linked external wallets cannot sign ANS updates yet. Use a Turnkey Arch Wallet account (passkey or email).",
    );
    this.name = "UnsupportedWalletKindError";
  }
}

export function isWalletAccountChangedError(
  error: unknown,
): error is WalletAccountChangedError {
  return (
    error instanceof WalletAccountChangedError ||
    (error instanceof Error &&
      (error as { code?: string }).code === "WALLET_ACCOUNT_CHANGED") ||
    (error instanceof Error && /wallet account changed/i.test(error.message))
  );
}

export function isUnsupportedWalletKindError(
  error: unknown,
): error is UnsupportedWalletKindError {
  return (
    error instanceof UnsupportedWalletKindError ||
    (error instanceof Error &&
      (error as { code?: string }).code === "UNSUPPORTED_WALLET_KIND")
  );
}

export function isSignatureMismatchError(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  return /error checking transaction sigs|bip322 signature verification failed|signature did not match/i.test(
    raw,
  );
}

export function isLinkedExternalSigningError(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  return /linked external|raw arch message-hash signing is not yet supported for linked external/i.test(
    raw,
  );
}

/** True when the UI should offer Reconnect + Turnkey guidance. */
export function needsWalletReconnect(error: unknown): boolean {
  return (
    isWalletAccountChangedError(error) ||
    isSignatureMismatchError(error) ||
    isLinkedExternalSigningError(error) ||
    isUnsupportedWalletKindError(error)
  );
}

export function accountMismatchUserMessage(
  action: string | null | undefined,
  mismatch?: AccountMismatch | null,
): string {
  const retry = mutationRetryLabel(action);
  if (mismatch) {
    return (
      `This page was set up to pay with ${mismatch.pinnedShort}, but Arch Wallet ` +
      `is now offering ${mismatch.currentShort}. Nothing was signed and no funds ` +
      `moved. Switch this page to ${mismatch.currentShort} and ${retry} again, or ` +
      `reconnect the site to pick a different account.`
    );
  }
  return (
    `Arch Wallet offered a different account than this page was set up to pay ` +
    `with, so nothing was signed and no funds moved. Reconnect the site to the ` +
    `account you want to use, then ${retry} again.`
  );
}

export function assertAnsSigningSupported(account: {
  kind?: string;
}): void {
  // Only a kind the extension actually reported can disqualify an
  // account. An unreported kind is unknown, not unsupported.
  if (!isSignableAccount(account)) {
    throw new UnsupportedWalletKindError(account.kind!);
  }
}

/**
 * Resolve the Arch account the extension currently has connected to this
 * origin, or fail with the state that stopped us.
 *
 * This never prompts. It used to fall through to `connect()` whenever the
 * read came back empty, which meant a click on "Approve registration"
 * could open a wallet window the header said was unnecessary — and, if
 * the flow retried, a second one. Determining the state is now separate
 * from acting on it: the caller decides whether to show "Unlock Arch
 * Wallet" or proceed, and exactly one wallet window opens per click.
 *
 * Prefer this over a React `account` snapshot before anything that
 * signs — a stale archAddress as fee payer produces BIP322 verification
 * failures at send_transaction, long after the user approved.
 */
export async function requireConnectedArchAccount(
  expectedArchAddress?: string,
  /** Where in the flow this check runs, for the diagnostics trail. */
  checkpoint = "read",
  /**
   * Only set once an approval exists for `expectedArchAddress`. Absent,
   * a disagreement is recorded and ignored: before anything is signed
   * there is nothing to protect, and the wallet reporting a different
   * account is not by itself something the user did.
   */
  switchContext?: AccountSwitchContext,
): Promise<ConnectedArchAccount> {
  // Kit LaserEyes / Hub sessions own identity in the active port — do not
  // re-probe window.arch (which may be absent or a different account).
  const port = getActiveAnsWalletPort();
  if (port && port.providerId !== "arch-extension") {
    const connected: ConnectedArchAccount = {
      address: port.address,
      publicKey: port.publicKey,
      archAddress: port.archAddress,
      providerId: port.providerId,
      providerLabel: port.providerLabel,
    };
    const matches = expectedArchAddress
      ? archAddressesEqual(expectedArchAddress, connected.archAddress)
      : null;
    debugLog("account-check", {
      checkpoint,
      state: "connected",
      source: "kit-port",
      providerId: port.providerId,
      pinned: expectedArchAddress ? archIdentityFingerprint(expectedArchAddress) : null,
      current: archIdentityFingerprint(connected.archAddress),
      match: matches,
      enforced: Boolean(switchContext),
    });
    if (expectedArchAddress && matches === false && switchContext) {
      throw new WalletAccountChangedError({
        previousArchAddress: expectedArchAddress,
        currentArchAddress: connected.archAddress,
        currentAccount: connected,
        context: switchContext,
      });
    }
    return connected;
  }

  const status = await probeWalletStatus();
  const connected = statusAccount(status);
  if (!connected) {
    debugLog("account-check-blocked", { checkpoint, state: status.state });
    throw walletStatusError(status);
  }
  const matches = expectedArchAddress
    ? archAddressesEqual(expectedArchAddress, connected.archAddress)
    : null;
  // Fingerprints, not raw values, so a support console paste stays useful
  // without turning into a list of the user's addresses.
  debugLog("account-check", {
    checkpoint,
    state: status.state,
    pinned: expectedArchAddress ? archIdentityFingerprint(expectedArchAddress) : null,
    current: archIdentityFingerprint(connected.archAddress),
    currentKind: connected.kind ?? "(not reported)",
    match: matches,
    enforced: Boolean(switchContext),
  });
  if (expectedArchAddress && matches === false && switchContext) {
    throw new WalletAccountChangedError({
      previousArchAddress: expectedArchAddress,
      currentArchAddress: connected.archAddress,
      currentAccount: connected,
      context: switchContext,
    });
  }
  assertAnsSigningSupported(connected);
  return connected;
}

/**
 * The account a submission will actually act as, without asking the wallet.
 *
 * Not always the account the header shows: when this browser has watched
 * the wallet sign as somebody else while reporting `reportedArchAddress`,
 * that learned signer is what the next flow pays and acts with. Views need
 * the same answer `submitWithWindowArch` will reach — a warning about who
 * owns what is worse than useless if it names the wrong account.
 */
export function actingArchAddress(
  reportedArchAddress: string | null | undefined,
): string | null {
  if (!reportedArchAddress) return null;
  return preferredSigner(reportedArchAddress).archAddress;
}

/**
 * Adopt whatever account the wallet is offering right now.
 *
 * This is the resolution for a mismatch that the user did not cause and
 * cannot see: the page pinned one account, the extension is handing back
 * another, and both are perfectly usable. Re-reading the account is all
 * it takes — the caller then rebuilds the transaction around it, so the
 * fee payer and the signature agree again. Dropping the site connection
 * (the old advice) would cost an approval the user already gave.
 *
 * Refuses only when the current account genuinely cannot sign, which is
 * the one case where reconnecting to a different account is the point.
 */
export async function adoptCurrentArchAccount(): Promise<ConnectedArchAccount> {
  const connected = await requireConnectedArchAccount(undefined, "adopt");
  debugLog("account-adopted", {
    current: archIdentityFingerprint(connected.archAddress),
    kind: connected.kind ?? "(not reported)",
  });
  return connected;
}

/**
 * Re-align the header chip and the fee-payer after Manage/Register detect a
 * mid-flow account change.
 *
 * What went stale in that case is the archAddress the caller pinned, not
 * the site connection: reading the wallet's *current* account is enough,
 * and the retry re-pins it. So try that first — dropping the connection
 * would force the user through a wallet approval they already gave.
 *
 * We only disconnect when there is nothing usable to adopt: no account at
 * all (revoked site), or one that can't sign ANS transactions (watch-only /
 * linked external). Then the reconnect prompt is the point — it's how the
 * user picks a Turnkey account instead.
 */
export async function reconnectArchWallet(): Promise<ConnectedArchAccount> {
  const provider = window.arch;
  if (!provider?.connect) {
    throw new Error("Arch Wallet is not available. Install/enable the Chrome extension.");
  }
  // Any read failure here just means "we have nothing to adopt"; this is
  // already the recovery path, so fall through to the prompt.
  const current = statusAccount(await probeWalletStatus());
  if (current && isSignableAccount(current)) return current;
  try {
    await walletRequest("disconnect", async () => provider.disconnect?.());
  } catch {
    // Disconnect can fail if already disconnected; continue to connect.
  }
  const connected = normalizeAccount(
    await walletRequest("connect", () => provider.connect()),
  );
  if (!connected) {
    throw new Error("Arch Wallet did not return an archAddress after reconnect.");
  }
  assertAnsSigningSupported(connected);
  return connected;
}

/**
 * Rebuilds the instruction around whichever account ends up acting.
 *
 * A builder rather than a finished instruction because the acting
 * account is not known until a signature has been checked: for Register
 * the fee payer is also the owner, so adopting the real signer means the
 * instruction itself has to change.
 */
export type InstructionBuilder = (
  actorArchAddress: string,
) => BuiltInstruction | Promise<BuiltInstruction>;

export type SubmitOutcome = {
  txid: string;
  /** The account that signed and paid — not necessarily the reported one. */
  actorArchAddress: string;
  /** True when the wallet signed with something other than what it reported. */
  adopted: boolean;
  /**
   * False when the node accepted the transaction but it had not settled by the
   * confirmation deadline. Still an outcome, not an error: the transaction is
   * on the network and the caller must say "not confirmed yet", not "failed".
   */
  confirmed: boolean;
};

/**
 * Test which known key produced a signature the fee payer did not.
 *
 * There is no provider call that lists the wallet's accounts, so the
 * candidate set is everything this browser has watched the wallet report,
 * newest first. A signature is the only ground truth available, and it is
 * cheap to test offline.
 */
function identifySigner(
  payerArchAddress: string,
  reportedArchAddress: string,
  messageHashHex: string,
  signature64Hex: string,
): { signer: string | null; probes: SignerProbe[] } {
  const probes: SignerProbe[] = [];
  for (const candidate of signerCandidates(payerArchAddress, [reportedArchAddress])) {
    const result = checkArchSignature(candidate, messageHashHex, signature64Hex);
    probes.push({ fingerprint: archIdentityFingerprint(candidate), result });
    if (result === "match") return { signer: candidate, probes };
  }
  return { signer: null, probes };
}

/** One end-to-end run of the flow with a fixed acting account. */
async function runSubmitAttempt(params: {
  build: InstructionBuilder;
  actorArchAddress: string;
  reportedArchAddress: string;
  pinSource: "reported" | "observed";
  attempt: number;
  onProgress?: (progress: SubmitProgress) => void;
  confirmEffect?: (actorArchAddress: string) => Promise<boolean>;
}): Promise<{ txid: string; confirmed: boolean }> {
  const { actorArchAddress, reportedArchAddress, attempt } = params;
  const pinnedAt = Date.now();
  const needsAccountSetup = !(await archAccountExists(actorArchAddress));
  const approvalTotal = needsAccountSetup ? 2 : 1;
  debugLog("submit:attempt", {
    attempt,
    actor: archIdentityFingerprint(actorArchAddress),
    reported: archIdentityFingerprint(reportedArchAddress),
    pinSource: params.pinSource,
    approvalTotal,
  });

  let approvalIndex = 0;
  let phase: SubmitPhase = needsAccountSetup ? "account-setup" : "mutation";
  let progress: SubmitProgress | null = null;
  /** Set once some key has verified here, proving the check itself works. */
  let verifierProven = false;

  const signWithActor: ArchHashSigner = async (messageHashHex) => {
    const checkpoint = `attempt-${attempt}-approval-${approvalIndex + 1}-of-${approvalTotal}`;
    // Still usable? Locked / disconnected has to stop the flow here, with
    // the state that caused it. The account-changed abort is armed only
    // once a signature exists: a second approval taken after the wallet
    // moved is the case that leaves a half-signed transaction, and the
    // only one worth interrupting for.
    //
    // What is watched is the *reported* account, not the fee payer. When
    // the payer came from a learned signer the two differ by design, and
    // comparing against the payer would abort every second approval.
    await requireConnectedArchAccount(
      reportedArchAddress,
      checkpoint,
      approvalIndex > 0
        ? {
            pinSource: params.pinSource,
            pinnedAt,
            approvalsCompleted: approvalIndex,
            checkpoint,
          }
        : undefined,
    );
    approvalIndex += 1;
    progress = { phase, approvalIndex, approvalTotal, attempt };
    params.onProgress?.(progress);

    const signature = await signMessageHashHex(messageHashHex);
    const check = checkArchSignature(actorArchAddress, messageHashHex, signature);
    debugLog("submit:signature-check", {
      checkpoint,
      payer: archIdentityFingerprint(actorArchAddress),
      result: check,
    });
    if (check === "match") verifierProven = true;
    if (check !== "mismatch") return signature;

    const { signer, probes } = identifySigner(
      actorArchAddress,
      reportedArchAddress,
      messageHashHex,
      signature,
    );
    if (signer) verifierProven = true;
    debugLog("submit:signer-identified", {
      signer: signer ? archIdentityFingerprint(signer) : null,
      verifierProven,
      probes,
    });
    // Refuse only on evidence, and "this signature is not the payer's" is
    // not evidence on its own — it is also what a verifier with a bug in
    // it would say about every signature in the world. So we stop when
    // some key in this flow has already verified (the check demonstrably
    // works, and this really is the wrong signer) and otherwise hand the
    // transaction to the node, which is the authority anyway. That keeps
    // a mistake in this module from becoming an outage: the worst case is
    // the pre-existing behaviour, a rejected transaction that moves no
    // funds and now carries the right recovery copy.
    if (verifierProven) {
      throw new SignerMismatchError(actorArchAddress, signer, probes, approvalIndex - 1);
    }
    debugLog("submit:unproven-mismatch-submitted", {
      payer: archIdentityFingerprint(actorArchAddress),
    });
    return signature;
  };

  try {
    if (needsAccountSetup) {
      await createArchAccountWithFaucet(actorArchAddress, signWithActor);
      phase = "mutation";
    }
    const txid = await signAndSendInstruction({
      transport: getAnsClient().transport,
      instruction: await params.build(actorArchAddress),
      feePayer: requireArchKey(actorArchAddress),
      signer: makeAnsSigner({
        async signArchMessageHash({ messageHashHex }) {
          return { signature64Hex: await signWithActor(messageHashHex) };
        },
      }),
      onSubmitted: () => {
        if (!progress) return;
        progress = { ...progress, stage: "confirming" };
        params.onProgress?.(progress);
      },
      // Reads the account the mutation writes, so confirmation does not have
      // to wait for the Explorer indexer to ingest the txid.
      isComplete: params.confirmEffect
        ? () => params.confirmEffect!(actorArchAddress)
        : undefined,
    });
    return { txid, confirmed: true };
  } catch (error) {
    // Accepted but not yet confirmed. The transaction exists on the network,
    // so this is an outcome to report, not a step that failed.
    if (isTransactionPendingError(error)) {
      debugLog("submit:pending", { txid: error.txid });
      return { txid: error.txid, confirmed: false };
    }
    if (
      error instanceof WalletAccountChangedError ||
      error instanceof SignerMismatchError ||
      error instanceof UnsupportedWalletKindError
    ) {
      throw error;
    }
    throw new AnsStepError(phase, progress, new Error(formatAnsMutationError(error)));
  }
}

/**
 * Sign and submit an ANS mutation, paying with an account we have proven
 * the wallet will actually sign as.
 *
 * Two things make this more than "build, sign, send":
 *
 * 1. **The fee payer is established here, now.** Not carried in from a
 *    React snapshot, not read from storage — a status probe at the moment
 *    the user acts. Whatever the page was showing a minute ago is
 *    irrelevant and must not be able to produce an account-mismatch
 *    error.
 * 2. **Every signature is verified before it is used.** The released
 *    extension signs with the wallet's active account regardless of which
 *    account it reported to this origin, so the fee payer and the signer
 *    can be different keys. Arch catches that at `send_transaction`,
 *    after the approval; verifying locally catches it before, identifies
 *    who really signed, and re-runs the flow around that account. That
 *    costs one extra approval the first time and none afterwards, versus
 *    a registration that simply cannot be completed.
 */
export async function submitWithWindowArch(
  build: InstructionBuilder,
  onProgress?: (progress: SubmitProgress) => void,
  /**
   * "Is this mutation's effect visible on-chain yet?" Supplied by the caller
   * because only it knows what the mutation was meant to change. Without one,
   * confirmation falls back to the transaction receipt and inherits the
   * indexer's ingestion lag.
   */
  confirmEffect?: (actorArchAddress: string) => Promise<boolean>,
): Promise<SubmitOutcome> {
  // LaserEyes / kit sessions: fee payer is the kit identity, not a probe of
  // window.arch (which may be missing or a different linked account).
  const port = getActiveAnsWalletPort();
  if (port && port.providerId !== "arch-extension") {
    const actorArchAddress = port.archAddress;
    debugLog("submit:pinned", {
      reported: archIdentityFingerprint(actorArchAddress),
      actor: archIdentityFingerprint(actorArchAddress),
      pinSource: "kit-port",
      providerId: port.providerId,
    });
    const { txid, confirmed } = await runSubmitAttempt({
      build,
      actorArchAddress,
      reportedArchAddress: actorArchAddress,
      pinSource: "reported",
      attempt: 1,
      onProgress,
      confirmEffect,
    });
    return {
      txid,
      actorArchAddress,
      adopted: false,
      confirmed,
    };
  }

  const reported = (await requireConnectedArchAccount(undefined, "pin")).archAddress;
  const preference = preferredSigner(reported);
  let actorArchAddress = preference.archAddress;
  let pinSource = preference.source;
  debugLog("submit:pinned", {
    reported: archIdentityFingerprint(reported),
    actor: archIdentityFingerprint(actorArchAddress),
    pinSource,
    observedAt: preference.observedAt ?? null,
  });

  // At most two attempts: the second one runs with a signer identified
  // from a real signature, so there is nothing left to learn from a third.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { txid, confirmed } = await runSubmitAttempt({
        build,
        actorArchAddress,
        reportedArchAddress: reported,
        pinSource,
        attempt,
        onProgress,
        confirmEffect,
      });
      rememberSignerObservation(reported, actorArchAddress);
      return {
        txid,
        actorArchAddress,
        adopted: !archAddressesEqual(actorArchAddress, reported),
        confirmed,
      };
    } catch (error) {
      const identified =
        attempt === 1 && error instanceof SignerMismatchError
          ? error.signerArchAddress
          : null;
      if (!identified) throw error;
      rememberSignerObservation(reported, identified);
      actorArchAddress = identified;
      pinSource = "observed";
    }
  }
  // Unreachable: the loop either returns or rethrows.
  throw new Error("Arch Wallet signing did not converge on an account.");
}

/**
 * Map raw Arch / wallet protocol errors to actionable copy for the manager UI.
 */
export function formatAnsMutationError(error: unknown): string {
  if (error instanceof AnsStepError) return formatAnsMutationError(error.cause);
  if (
    isWalletAccountChangedError(error) ||
    isUnsupportedWalletKindError(error) ||
    isSignerMismatchError(error)
  ) {
    return (error as Error).message;
  }
  const raw = error instanceof Error ? error.message : String(error);
  if (/account [0-9a-f]+ not found/i.test(raw)) {
    return "Name lookup failed unexpectedly. Refresh and try again.";
  }
  // The program checks the name's stored owner against the transaction's
  // signers, so this is what "you are signing as somebody who does not own
  // this name" looks like coming back from the node. Left raw it reads as an
  // app bug, and the user retries the same doomed action — which is exactly
  // what happened on testnet.
  if (/missing required signature/i.test(raw)) {
    return (
      "This name is owned by a different Arch account than the one that signed, " +
      "so the network rejected the update. Nothing changed on-chain and no funds " +
      "moved. Open Arch Wallet and make the owning account the active one (the " +
      "account its home screen shows), then try again — or manage a name that " +
      "belongs to the account you are signing with."
    );
  }
  if (isLinkedExternalSigningError(error)) {
    return (
      "Linked external wallets cannot sign ANS updates yet. " +
      "Use a Turnkey-backed Arch Wallet account (passkey or email)."
    );
  }
  if (isSignatureMismatchError(error)) {
    // Reconnecting is the wrong advice here and used to be what this said:
    // the released extension picks the signing account from the wallet's
    // *active* account, not from the site connection, so rebinding the
    // origin changes nothing about which key signs.
    return (
      "Arch Wallet signed with a different account than the one paying for this " +
      "transaction, so the network rejected it. Nothing changed on-chain. Open Arch " +
      "Wallet, make the account you want to use the active account (the one its home " +
      "screen shows), stay on Testnet, then try again."
    );
  }
  // Checked before the generic invalid-params branch below, because the
  // not-yet-indexed reply *is* an `Invalid params` and reading it as a broken
  // endpoint contract produced the worst message this app has ever shown: a
  // raw JSON-RPC dump telling the user retrying would not help, for a
  // transaction that had already succeeded on-chain. The transport turns this
  // into a wait at the source; this is the backstop for every path that
  // re-wraps the error on the way here.
  if (isTransactionPendingError(error) || isTransactionNotIndexedError(error)) {
    return pendingConfirmationMessage("transaction");
  }
  if (/invalid params/i.test(raw)) {
    // Every params shape ANS sends is pinned by a payload fixture against the
    // shapes the live indexer accepts, so this no longer means "the deployed
    // bundle is stale". It means the endpoint changed its contract, which a
    // refresh cannot fix and only an operator can.
    const method = error instanceof ArchRpcError ? error.method : null;
    return (
      `The Arch testnet RPC endpoint rejected a well-formed ${method ?? "RPC"} request ` +
      "as invalid params, which means the endpoint's expected request format changed. " +
      "Nothing was registered and nothing was charged. Retrying will not help — report " +
      `this to the Arch team with the technical details below. (${raw})`
    );
  }
  return raw;
}

export { explorerTxUrl, explorerAccountUrl, explorerUrl } from "./explorer";
