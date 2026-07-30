import { describe, expect, it } from "vitest";
import {
  ARCH_OFFER_RESERVE_LAMPORTS,
  readTokenAccountAmount,
  spendableFrom,
} from "./quote-balance";

describe("quote balances", () => {
  it("withholds rent and fee headroom from spendable ARCH", () => {
    const balance = spendableFrom(
      ARCH_OFFER_RESERVE_LAMPORTS + 5_000_000n,
      ARCH_OFFER_RESERVE_LAMPORTS,
    );
    expect(balance.spendable).toBe(5_000_000n);
    expect(balance.reserved).toBe(ARCH_OFFER_RESERVE_LAMPORTS);
  });

  it("never reports negative spendable", () => {
    expect(spendableFrom(1_000n, ARCH_OFFER_RESERVE_LAMPORTS).spendable).toBe(0n);
  });

  it("reads the token amount at the APL account offset", () => {
    const data = new Uint8Array(72);
    data.set([0x40, 0x42, 0x0f, 0, 0, 0, 0, 0], 64);
    expect(readTokenAccountAmount(data)).toBe(1_000_000n);
    expect(readTokenAccountAmount(new Uint8Array(8))).toBe(0n);
  });
});
