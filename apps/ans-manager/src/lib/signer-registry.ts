/**
 * What this browser has learned about which key Arch Wallet signs with.
 *
 * The released extension answers `getAccount()` from the origin binding
 * but signs with the wallet's globally active account, so the account a
 * page is told about is not reliably the account that will sign. The
 * page cannot enumerate the wallet's accounts, and there is no read API
 * for "which one is active" — the only ground truth available is a
 * signature, checked locally against a candidate key.
 *
 * So this module keeps two things, and nothing else:
 *
 * 1. **Seen accounts.** Every Arch account the wallet has ever reported
 *    to this origin. These are the candidate keys a signature can be
 *    tested against when the fee payer turns out not to be the signer.
 * 2. **One observation.** "Last time the wallet *reported* R, the
 *    signature was actually produced by S." Nothing more: not a pin, not
 *    an identity, not something the UI renders.
 *
 * Neither is ever trusted. A remembered observation only changes which
 * key is tried *first*; every signature is still verified before it is
 * submitted, so a stale entry costs an extra approval at worst and can
 * never send a transaction the node would reject — or produce a
 * "switched accounts" error the user did not cause.
 */

import { archIdentitiesEqual, canonicalArchKeyHex } from "./arch-identity";

const SEEN_KEY = "ans:wallet-accounts";
const OBSERVATION_KEY = "ans:wallet-signer";
/** Enough to cover a wallet a person actually switches between. */
const MAX_SEEN = 8;

/** "When the wallet said R, S is who signed." */
export type SignerObservation = {
  reportedArchAddress: string;
  signerArchAddress: string;
  /** Epoch ms, so support can tell a fresh divergence from an old one. */
  at: number;
};

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Private mode / blocked storage: the app degrades to "learns nothing".
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function clearStorage(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Arch accounts this wallet has reported here, most recent first. */
export function seenAccounts(): string[] {
  const raw = readStorage(SEEN_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string" && v.length > 0);
  } catch {
    return [];
  }
}

export function rememberSeenAccount(archAddress: string | null | undefined): void {
  if (!archAddress || !canonicalArchKeyHex(archAddress)) return;
  const existing = seenAccounts().filter((a) => !archIdentitiesEqual(a, archAddress));
  writeStorage(SEEN_KEY, JSON.stringify([archAddress, ...existing].slice(0, MAX_SEEN)));
}

export function signerObservation(): SignerObservation | null {
  const raw = readStorage(OBSERVATION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SignerObservation>;
    if (
      typeof parsed?.reportedArchAddress !== "string" ||
      typeof parsed?.signerArchAddress !== "string"
    ) {
      return null;
    }
    return {
      reportedArchAddress: parsed.reportedArchAddress,
      signerArchAddress: parsed.signerArchAddress,
      at: typeof parsed.at === "number" ? parsed.at : 0,
    };
  } catch {
    return null;
  }
}

export function rememberSignerObservation(
  reportedArchAddress: string,
  signerArchAddress: string,
): void {
  rememberSeenAccount(signerArchAddress);
  writeStorage(
    OBSERVATION_KEY,
    JSON.stringify({
      reportedArchAddress,
      signerArchAddress,
      at: Date.now(),
    } satisfies SignerObservation),
  );
}

export function forgetSignerObservation(): void {
  clearStorage(OBSERVATION_KEY);
}

/**
 * Which key to try as fee payer first, given what the wallet reports now.
 *
 * Only diverges from the reported account when we have already watched
 * this exact reported account be served by a different signer. Anything
 * looser would guess, and a guess here costs the user an approval.
 */
export function preferredSigner(reportedArchAddress: string): {
  archAddress: string;
  source: "reported" | "observed";
  observedAt?: number;
} {
  const observation = signerObservation();
  if (
    observation &&
    archIdentitiesEqual(observation.reportedArchAddress, reportedArchAddress) &&
    !archIdentitiesEqual(observation.signerArchAddress, reportedArchAddress)
  ) {
    return {
      archAddress: observation.signerArchAddress,
      source: "observed",
      observedAt: observation.at,
    };
  }
  return { archAddress: reportedArchAddress, source: "reported" };
}

/**
 * Keys a signature may be tested against, most likely first, deduped.
 *
 * The already-failed payer is deliberately not included: the caller has
 * tested it, and repeating that work only makes the diagnostics noisier.
 */
export function signerCandidates(exclude: string, extra: Array<string | null | undefined>): string[] {
  const observed = signerObservation()?.signerArchAddress;
  const ordered = [...extra, observed, ...seenAccounts()];
  const out: string[] = [];
  for (const candidate of ordered) {
    if (!candidate || !canonicalArchKeyHex(candidate)) continue;
    if (archIdentitiesEqual(candidate, exclude)) continue;
    if (out.some((existing) => archIdentitiesEqual(existing, candidate))) continue;
    out.push(candidate);
  }
  return out;
}

/** Test-only: forget everything this browser has learned. */
export function __resetSignerRegistry(): void {
  clearStorage(SEEN_KEY);
  clearStorage(OBSERVATION_KEY);
}
