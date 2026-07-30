/**
 * Spendable balance for marketplace quote currencies.
 *
 * ARCH offers escrow lamports in the offer PDA, so the offer cannot consume the
 * whole account: the PDA's rent plus the transaction fee must stay behind.
 */

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TESTNET_ABTC_MINT,
  TOKEN_PROGRAM_ID,
  deriveTokenAta,
  type QuoteCurrency,
} from "@arch-network/ans-sdk";
import { ansClient, decodeArchAddress } from "./ans";

/** Offer-PDA rent plus fee headroom kept out of the ARCH spendable balance. */
export const ARCH_OFFER_RESERVE_LAMPORTS = 10_000_000n;

/** `amount` sits after `mint` (32) and `owner` (32) in an APL token account. */
const TOKEN_AMOUNT_OFFSET = 64;

export type QuoteBalance = {
  /** Raw balance held by the account, in base units. */
  total: bigint;
  /** Base units that may actually be offered. */
  spendable: bigint;
  /** Base units withheld for rent and fees. */
  reserved: bigint;
};

export function readTokenAccountAmount(data: Uint8Array): bigint {
  if (data.length < TOKEN_AMOUNT_OFFSET + 8) return 0n;
  let amount = 0n;
  for (let i = 7; i >= 0; i--) {
    amount = (amount << 8n) | BigInt(data[TOKEN_AMOUNT_OFFSET + i]!);
  }
  return amount;
}

export function spendableFrom(total: bigint, reserved: bigint): QuoteBalance {
  return {
    total,
    reserved,
    spendable: total > reserved ? total - reserved : 0n,
  };
}

export async function fetchQuoteBalance(
  ownerArchAddress: string,
  currency: QuoteCurrency,
): Promise<QuoteBalance> {
  const owner = decodeArchAddress(ownerArchAddress);

  if (currency === "Arch") {
    const info = await ansClient.transport.readAccountInfo(owner);
    const lamports = BigInt(info?.lamports ?? 0);
    return spendableFrom(lamports, ARCH_OFFER_RESERVE_LAMPORTS);
  }

  const ata = deriveTokenAta(
    owner,
    TESTNET_ABTC_MINT,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const info = await ansClient.transport.readAccountInfo(ata);
  const amount = info?.data ? readTokenAccountAmount(info.data) : 0n;
  return spendableFrom(amount, 0n);
}
