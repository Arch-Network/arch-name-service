import { describe, expect, it } from "vitest";
import {
  formatQuoteAmount,
  labelLengthCategory,
  parseDomainProfileTab,
  sortOffersByPriceDesc,
} from "./domain-profile";

describe("domain-profile helpers", () => {
  it("parses profile tabs", () => {
    expect(parseDomainProfileTab("offers")).toBe("offers");
    expect(parseDomainProfileTab("nope")).toBe("details");
  });

  it("labels length collections", () => {
    expect(labelLengthCategory("ab.arch")).toBe("2 Characters");
    expect(labelLengthCategory("alice.arch")).toBe("5+ Characters");
  });

  it("formats quote amounts and sorts offers", () => {
    expect(formatQuoteAmount(1000n, "Arch")).toBe("1000 ARCH");
    expect(
      sortOffersByPriceDesc([
        { price: 1n },
        { price: 5n },
        { price: 3n },
      ]).map((o) => o.price),
    ).toEqual([5n, 3n, 1n]);
  });
});
