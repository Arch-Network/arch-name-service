import type { QuoteCurrency } from "@arch-network/ans-sdk";

export const QUOTE_DECIMALS: Record<QuoteCurrency, number> = {
  Arch: 9,
  Btc: 8,
};

export function quoteSymbol(currency: QuoteCurrency): string {
  return currency === "Btc" ? "aBTC" : "ARCH";
}

export function quoteBaseUnit(currency: QuoteCurrency): string {
  return currency === "Btc" ? "sats" : "lamports";
}

export function parseQuoteAmount(
  value: string,
  currency: QuoteCurrency,
): bigint | null {
  const normalized = value.trim();
  const decimals = QUOTE_DECIMALS[currency];
  const match = normalized.match(/^(\d*)(?:\.(\d*))?$/);
  if (
    !match ||
    (!match[1] && !match[2]) ||
    (match[2]?.length ?? 0) > decimals
  ) {
    return null;
  }

  const whole = match[1] || "0";
  const fraction = (match[2] ?? "").padEnd(decimals, "0");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction || "0");
}

export function formatQuoteBaseUnits(
  amount: bigint,
  currency: QuoteCurrency,
): string {
  const decimals = QUOTE_DECIMALS[currency];
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = (amount % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
