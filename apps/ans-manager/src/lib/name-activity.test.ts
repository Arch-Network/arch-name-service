import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchNameActivity } from "./name-activity";

describe("fetchNameActivity", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps explorer transaction rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            transactions: [
              {
                txid: "abc",
                created_at: "2026-07-30T00:00:00Z",
                block_height: 12,
              },
              { txid: "" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const rows = await fetchNameActivity("1".repeat(64));
    expect(rows).toEqual([
      {
        txid: "abc",
        createdAt: "2026-07-30T00:00:00Z",
        blockHeight: 12,
      },
    ]);
  });
});
