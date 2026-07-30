import { describe, expect, it } from "vitest";
import { formatQuoteBaseUnits, parseQuoteAmount } from "./quote-amount";

describe("quote amounts", () => {
  it("parses human ARCH and aBTC amounts into base units", () => {
    expect(parseQuoteAmount("1.5", "Arch")).toBe(1_500_000_000n);
    expect(parseQuoteAmount(".5", "Arch")).toBe(500_000_000n);
    expect(parseQuoteAmount("0.001", "Btc")).toBe(100_000n);
  });

  it("rejects malformed and over-precise amounts", () => {
    expect(parseQuoteAmount("", "Arch")).toBeNull();
    expect(parseQuoteAmount("1.0000000001", "Arch")).toBeNull();
    expect(parseQuoteAmount("0.000000001", "Btc")).toBeNull();
  });

  it("formats base units without trailing zeroes", () => {
    expect(formatQuoteBaseUnits(1_500_000_000n, "Arch")).toBe("1.5");
    expect(formatQuoteBaseUnits(100_000n, "Btc")).toBe("0.001");
  });
});
