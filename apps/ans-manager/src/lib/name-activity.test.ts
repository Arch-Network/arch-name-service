import { afterEach, describe, expect, it, vi } from "vitest";
import {
  actionFromExplorerRow,
  fetchNameActivity,
  isFailedStatus,
} from "./name-activity";

const ANS_PROGRAM_HEX =
  "3d9fbaa282268d8453a924692f254ad6c610668f36512db9fb50325ac2e4e079";
const REGISTER_MATT = "01040000006d6174740000000000000000";
const LIST_35_ABTC =
  "0a98431db7f27f98256d86de54cd60847ee5be393a21cc46c79fbfecac012f94910100c39dd000000000";

describe("isFailedStatus", () => {
  it("recognizes string and object failure shapes", () => {
    expect(isFailedStatus("Processed")).toBe(false);
    expect(isFailedStatus("Failed")).toBe(true);
    expect(isFailedStatus({ Failed: "boom" })).toBe(true);
  });
});

describe("actionFromExplorerRow", () => {
  it("decodes the ANS instruction from a v2 row", () => {
    expect(
      actionFromExplorerRow(
        {
          txid: "abc",
          status: "Processed",
          data: {
            message: {
              instructions: [
                { program_id: ANS_PROGRAM_HEX, data: LIST_35_ABTC },
              ],
            },
          },
        },
        ANS_PROGRAM_HEX,
      ),
    ).toEqual({ title: "Listed", detail: "35 aBTC" });
  });
});

describe("fetchNameActivity", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps enriched v2 transaction rows in one request", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("/transactions/v2?");
      return new Response(
        JSON.stringify({
          transactions: [
            {
              txid: "listed-tx",
              created_at: "2026-07-30T00:00:00Z",
              block_height: 12,
              status: "Processed",
              data: {
                message: {
                  instructions: [
                    { program_id: ANS_PROGRAM_HEX, data: LIST_35_ABTC },
                  ],
                },
              },
            },
            {
              txid: "register-tx",
              created_at: "2026-07-30T00:00:01Z",
              block_height: 11,
              status: { Failed: "Incorrect authority provided" },
              data: {
                message: {
                  instructions: [
                    { program_id: ANS_PROGRAM_HEX, data: REGISTER_MATT },
                  ],
                },
              },
            },
            { txid: "" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const rows = await fetchNameActivity("1".repeat(64));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rows).toEqual([
      {
        txid: "listed-tx",
        createdAt: "2026-07-30T00:00:00Z",
        blockHeight: 12,
        action: { title: "Listed", detail: "35 aBTC" },
        failed: false,
      },
      {
        txid: "register-tx",
        createdAt: "2026-07-30T00:00:01Z",
        blockHeight: 11,
        action: { title: "Registered", detail: null },
        failed: true,
      },
    ]);
  });
});
