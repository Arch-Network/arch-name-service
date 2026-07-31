import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchRecentRegistrations,
  fetchRegistryTimeline,
  orderNamesByRegistration,
} from "./registry-activity";

const ANS_PROGRAM_HEX =
  "3d9fbaa282268d8453a924692f254ad6c610668f36512db9fb50325ac2e4e079";
/** Register("matt"), Register("1504king") and a ListName, as the Explorer serves them. */
const REGISTER_MATT = "01040000006d6174740000000000000000";
const REGISTER_1504KING = "0108000000313530346b696e670000000000000000";
const LIST_35_ABTC =
  "0a98431db7f27f98256d86de54cd60847ee5be393a21cc46c79fbfecac012f94910100c39dd000000000";
const LISTED_NAME_HASH =
  "98431db7f27f98256d86de54cd60847ee5be393a21cc46c79fbfecac012f9491";

function row(opts: {
  txid: string;
  createdAt: string;
  data: string;
  status?: unknown;
}) {
  return {
    txid: opts.txid,
    created_at: opts.createdAt,
    status: opts.status ?? "Processed",
    data: {
      message: {
        instructions: [{ program_id: ANS_PROGRAM_HEX, data: opts.data }],
      },
    },
  };
}

function stubExplorer(transactions: unknown[]) {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ transactions }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("fetchRegistryTimeline", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads registration and listing recency from the program feed", async () => {
    stubExplorer([
      row({
        txid: "reg-1504king",
        createdAt: "2026-07-31T11:51:25Z",
        data: REGISTER_1504KING,
      }),
      row({ txid: "listed", createdAt: "2026-07-31T10:00:00Z", data: LIST_35_ABTC }),
      row({ txid: "reg-matt", createdAt: "2026-07-30T10:42:26Z", data: REGISTER_MATT }),
    ]);

    const timeline = await fetchRegistryTimeline({ pages: 1 });

    expect(timeline.registrations.map((r) => r.name)).toEqual([
      "1504king.arch",
      "matt.arch",
    ]);
    expect(timeline.registeredAtByName.get("1504king.arch")).toBe(
      Date.parse("2026-07-31T11:51:25Z"),
    );
    expect(timeline.listedAtByNameHash.get(LISTED_NAME_HASH)).toBe(
      Date.parse("2026-07-31T10:00:00Z"),
    );
  });

  it("ignores failed transactions so a rejected register cannot set the order", async () => {
    stubExplorer([
      row({
        txid: "rejected",
        createdAt: "2026-07-31T12:00:00Z",
        data: REGISTER_1504KING,
        status: { Failed: "Incorrect authority provided" },
      }),
      row({ txid: "reg-matt", createdAt: "2026-07-30T10:42:26Z", data: REGISTER_MATT }),
    ]);

    const timeline = await fetchRegistryTimeline({ pages: 1 });

    expect(timeline.registrations.map((r) => r.name)).toEqual(["matt.arch"]);
  });

  it("keeps the newest tenure when a name was registered more than once", async () => {
    stubExplorer([
      row({ txid: "recent", createdAt: "2026-07-31T09:00:00Z", data: REGISTER_MATT }),
      row({ txid: "older", createdAt: "2026-07-01T09:00:00Z", data: REGISTER_MATT }),
    ]);

    const timeline = await fetchRegistryTimeline({ pages: 1 });

    expect(timeline.registrations).toHaveLength(1);
    expect(timeline.registrations[0]!.txid).toBe("recent");
  });

  it("stops paging once a short page arrives", async () => {
    const fetchMock = stubExplorer([
      row({ txid: "reg-matt", createdAt: "2026-07-30T10:42:26Z", data: REGISTER_MATT }),
    ]);

    await fetchRegistryTimeline({ pages: 3 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("fetchRecentRegistrations", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("caps the feed", async () => {
    stubExplorer([
      row({
        txid: "reg-1504king",
        createdAt: "2026-07-31T11:51:25Z",
        data: REGISTER_1504KING,
      }),
      row({ txid: "reg-matt", createdAt: "2026-07-30T10:42:26Z", data: REGISTER_MATT }),
    ]);

    expect((await fetchRecentRegistrations(1)).map((r) => r.name)).toEqual([
      "1504king.arch",
    ]);
    expect(await fetchRecentRegistrations(0)).toEqual([]);
  });
});

describe("orderNamesByRegistration", () => {
  const onChain = [
    { name: "1504king.arch" },
    { name: "matt.arch" },
    { name: "tree.arch" },
    { name: "satoshi.arch" },
  ];

  it("puts the newest registration first even when its label sorts last", () => {
    const at = new Map([
      ["1504king.arch", Date.parse("2026-07-31T11:51:25Z")],
      ["matt.arch", Date.parse("2026-07-30T10:42:26Z")],
    ]);

    expect(orderNamesByRegistration(onChain, at, 4).map((e) => e.name)).toEqual([
      "1504king.arch",
      "matt.arch",
      // Undated names keep the SDK's reverse-alphabetical fallback.
      "tree.arch",
      "satoshi.arch",
    ]);
  });

  it("never ranks an undated name above a dated one", () => {
    const at = new Map([["1504king.arch", Date.parse("2026-01-01T00:00:00Z")]]);

    expect(orderNamesByRegistration(onChain, at, 1).map((e) => e.name)).toEqual([
      "1504king.arch",
    ]);
  });

  it("caps the list", () => {
    expect(orderNamesByRegistration(onChain, new Map(), 2)).toHaveLength(2);
    expect(orderNamesByRegistration(onChain, new Map(), 0)).toEqual([]);
  });
});
