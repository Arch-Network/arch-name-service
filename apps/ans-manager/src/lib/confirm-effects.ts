import type { RecordType } from "@arch-network/ans-sdk";
import {
  ansClient,
  archAddressesEqual,
  decodeArchAddress,
  encodeArchAddress,
} from "./ans";

/**
 * "Is the change visible yet?", asked of account state rather than of the
 * transaction index.
 *
 * Every ANS mutation used to confirm by polling `get_processed_transaction`,
 * which the Explorer indexer cannot answer until it has ingested the txid —
 * and until then it returns `-32602 Invalid params`, not a not-found. Probed
 * exhaustively against the live endpoint: five different `params` encodings
 * all behave that way, upstream and through the proxy alike, so there is no
 * request shape that avoids it. Confirmation therefore cannot be built on the
 * txid lookup without inheriting the indexer's lag, and a set-primary that had
 * already been applied on-chain was reported to the user as a failure.
 *
 * These probes read the accounts the mutation writes, which is both earlier
 * and stronger: they answer the question the user actually has ("did my change
 * take effect?") rather than a proxy for it, and it is the very same read the
 * page performs to render the result. The txid lookup stays on as the
 * secondary signal, where its one unique contribution — a definite `Failed`
 * status — still ends the wait immediately.
 *
 * A probe may throw; a failed read is not a failed transaction, and the caller
 * treats it as "not yet" and retries.
 */
export type ConfirmEffect = (actorArchAddress: string) => Promise<boolean>;

/** Set primary: the owner's reverse record now resolves to this name. */
export function primaryNameIs(canonicalName: string): ConfirmEffect {
  return async (actor) =>
    (await ansClient.resolvePrimary(decodeArchAddress(actor))) === canonicalName;
}

/** Clear primary: the owner no longer resolves to any name. */
export function primaryNameCleared(): ConfirmEffect {
  return async (actor) =>
    (await ansClient.resolvePrimary(decodeArchAddress(actor))) === null;
}

/**
 * Set record: the record account's revision has moved past what the write was
 * built against. Revision rather than value because it is one comparison for
 * every record type, and because re-saving an unchanged value still has to
 * confirm — a value check would report that one complete before it landed.
 */
export function recordRevisionPast(
  canonicalName: string,
  recordType: RecordType,
  previousRevision: bigint,
  textKey?: string,
): ConfirmEffect {
  return async () => {
    const record = await ansClient.fetchRecord(canonicalName, recordType, textKey);
    return record != null && record.revision > previousRevision;
  };
}

async function nameOwnerEquals(canonicalName: string, expected: string): Promise<boolean> {
  const account = await ansClient.fetchNameAccount(canonicalName);
  if (!account) return false;
  return archAddressesEqual(expected, encodeArchAddress(account.owner));
}

/** Register: the name account exists and belongs to whoever signed. */
export function nameRegisteredTo(canonicalName: string): ConfirmEffect {
  return (actor) => nameOwnerEquals(canonicalName, actor);
}

/** Transfer: the name account names the new owner. */
export function nameOwnedBy(canonicalName: string, newOwner: string): ConfirmEffect {
  return () => nameOwnerEquals(canonicalName, newOwner);
}
