/**
 * Human labels for ANS instructions, so Activity reads as events rather than
 * bare transaction ids.
 */

import {
  decodeInstruction,
  hexToBytes,
  type NameInstruction,
  type RecordType,
} from "@arch-network/ans-sdk";
import { encodeArchAddress } from "./ans";
import { formatQuoteAmount } from "./domain-profile";
import { truncateMiddle } from "./explorer";

export type ActivityAction = {
  title: string;
  /** Extra context worth showing beside the title (price, counterparty, record). */
  detail: string | null;
};

const RECORD_LABELS: Record<RecordType, string> = {
  ArchOwner: "Arch address",
  BitcoinTaproot: "Bitcoin address",
  TokenAta: "Token account",
  Text: "text record",
};

function shortAddress(bytes: Uint8Array): string {
  return truncateMiddle(encodeArchAddress(bytes), 6, 6);
}

export function describeAnsInstruction(ix: NameInstruction): ActivityAction {
  switch (ix.kind) {
    case "Register":
      return { title: "Registered", detail: null };
    case "Renew":
      return { title: "Renewed", detail: null };
    case "Transfer":
      return { title: "Transferred", detail: `to ${shortAddress(ix.newOwner)}` };
    case "SetRecord":
      return { title: "Record set", detail: RECORD_LABELS[ix.recordType] };
    case "DeleteRecord":
      return { title: "Record removed", detail: RECORD_LABELS[ix.recordType] };
    case "SetPrimary":
      return { title: "Set as primary", detail: null };
    case "ClearPrimary":
      return { title: "Primary cleared", detail: null };
    case "ReclaimExpired":
      return { title: "Reclaimed after expiry", detail: null };
    case "ListName":
      return { title: "Listed", detail: formatQuoteAmount(ix.price, ix.currency) };
    case "CancelListing":
      return { title: "Listing cancelled", detail: null };
    case "BuyName":
      return { title: "Sold", detail: null };
    case "MakeOffer":
      return { title: "Offer made", detail: formatQuoteAmount(ix.price, ix.currency) };
    case "CancelOffer":
      return { title: "Offer cancelled", detail: null };
    case "AcceptOffer":
      return { title: "Offer accepted", detail: `buyer ${shortAddress(ix.buyer)}` };
    case "InitializeRegistry":
      return { title: "Registry initialized", detail: null };
    case "UpdateConfig":
      return { title: "Registry config updated", detail: null };
  }
}

/** Decode hex instruction data from the Explorer; null when it is not an ANS instruction. */
export function describeInstructionData(hexData: string): ActivityAction | null {
  try {
    return describeAnsInstruction(decodeInstruction(hexToBytes(hexData)));
  } catch {
    return null;
  }
}
