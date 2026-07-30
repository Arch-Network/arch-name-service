import { describe, expect, it } from "vitest";
import { describeInstructionData } from "./activity-labels";

/** Instruction payloads captured from testnet Explorer transactions. */
const REGISTER_MATT = "01040000006d6174740000000000000000";
const LIST_FOR_35_ABTC =
  "0a98431db7f27f98256d86de54cd60847ee5be393a21cc46c79fbfecac012f94910100c39dd000000000";

describe("describeInstructionData", () => {
  it("labels a registration", () => {
    expect(describeInstructionData(REGISTER_MATT)).toEqual({
      title: "Registered",
      detail: null,
    });
  });

  it("labels a listing with its human price", () => {
    expect(describeInstructionData(LIST_FOR_35_ABTC)).toEqual({
      title: "Listed",
      detail: "35 aBTC",
    });
  });

  it("returns null for data it cannot decode", () => {
    expect(describeInstructionData("ff00")).toBeNull();
    expect(describeInstructionData("nothex")).toBeNull();
  });
});
