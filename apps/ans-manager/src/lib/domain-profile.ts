/**
 * Domain profile tab helpers (SNS-style Details / Offers / Activity).
 */

import { formatQuoteBaseUnits, quoteSymbol } from "./quote-amount";

export type DomainProfileTab = "details" | "offers" | "activity";

export function parseDomainProfileTab(
  raw: string | null | undefined,
): DomainProfileTab {
  if (raw === "offers" || raw === "activity" || raw === "details") return raw;
  return "details";
}

export function formatQuoteAmount(
  price: bigint,
  currency: "Arch" | "Btc",
): string {
  return `${formatQuoteBaseUnits(price, currency)} ${quoteSymbol(currency)}`;
}

export function labelLengthCategory(canonicalName: string): string {
  const label = canonicalName.endsWith(".arch")
    ? canonicalName.slice(0, -".arch".length)
    : canonicalName;
  const len = label.length;
  if (len <= 1) return "1 Character";
  if (len === 2) return "2 Characters";
  if (len === 3) return "3 Characters";
  if (len === 4) return "4 Characters";
  return "5+ Characters";
}

export type ActivityRow = {
  txid: string;
  createdAt: string | null;
  blockHeight: number | null;
  kind: "transaction";
};

export function sortOffersByPriceDesc<
  T extends { price: bigint; createdAtSlot?: bigint },
>(offers: T[]): T[] {
  return [...offers].sort((a, b) => {
    if (a.price === b.price) {
      const as = a.createdAtSlot ?? 0n;
      const bs = b.createdAtSlot ?? 0n;
      return as > bs ? -1 : as < bs ? 1 : 0;
    }
    return a.price > b.price ? -1 : 1;
  });
}
