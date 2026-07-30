/**
 * The probes that decide a mutation landed.
 *
 * They exist because no `get_processed_transaction` params shape makes the
 * Explorer indexer answer for a txid it has not ingested — verified against
 * the live endpoint for `{tx_id}`, `[hex]`, `{txid}`, `[[bytes]]` and
 * `{tx_id: [bytes]}`, upstream and through the proxy alike. Confirmation had
 * to stop depending on the transaction index, so these read the accounts the
 * mutation writes instead. If they answer wrongly, the UI goes back to
 * reporting changes that landed as failures.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import bs58 from "bs58";

const client = vi.hoisted(() => ({
  resolvePrimary: vi.fn(),
  fetchRecord: vi.fn(),
  fetchNameAccount: vi.fn(),
}));

vi.mock("./ans", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ans")>()),
  ansClient: client,
}));

const {
  nameOwnedBy,
  nameRegisteredTo,
  primaryNameCleared,
  primaryNameIs,
  recordRevisionPast,
} = await import("./confirm-effects");

const OWNER_HEX = "11".repeat(32);
const OWNER_BYTES = Uint8Array.from(Array(32).fill(0x11));
const OTHER_HEX = "22".repeat(32);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("primaryNameIs", () => {
  it("is complete once the owner resolves to the name", async () => {
    client.resolvePrimary.mockResolvedValue("alice.arch");
    await expect(primaryNameIs("alice.arch")(OWNER_HEX)).resolves.toBe(true);
  });

  it("is not complete while the owner has no primary yet", async () => {
    client.resolvePrimary.mockResolvedValue(null);
    await expect(primaryNameIs("alice.arch")(OWNER_HEX)).resolves.toBe(false);
  });

  it("is not complete when some other name is primary", async () => {
    client.resolvePrimary.mockResolvedValue("bob.arch");
    await expect(primaryNameIs("alice.arch")(OWNER_HEX)).resolves.toBe(false);
  });

  it("probes the account that actually signed, whatever encoding it came in", async () => {
    client.resolvePrimary.mockResolvedValue("alice.arch");
    await primaryNameIs("alice.arch")(bs58.encode(OWNER_BYTES));
    expect(client.resolvePrimary).toHaveBeenCalledWith(OWNER_BYTES);
  });
});

describe("primaryNameCleared", () => {
  it("is complete once the owner resolves to nothing", async () => {
    client.resolvePrimary.mockResolvedValue(null);
    await expect(primaryNameCleared()(OWNER_HEX)).resolves.toBe(true);
  });

  it("is not complete while the old primary still resolves", async () => {
    client.resolvePrimary.mockResolvedValue("alice.arch");
    await expect(primaryNameCleared()(OWNER_HEX)).resolves.toBe(false);
  });
});

describe("recordRevisionPast", () => {
  it("is complete once the revision moves past what the write was built on", async () => {
    client.fetchRecord.mockResolvedValue({ revision: 3n });
    await expect(
      recordRevisionPast("alice.arch", "ArchOwner", 2n)(OWNER_HEX),
    ).resolves.toBe(true);
  });

  /**
   * Re-saving an unchanged value still writes, and still has to confirm. A
   * value comparison would call that complete before the transaction landed;
   * the revision cannot.
   */
  it("is not complete while the revision is unchanged", async () => {
    client.fetchRecord.mockResolvedValue({ revision: 2n });
    await expect(
      recordRevisionPast("alice.arch", "ArchOwner", 2n)(OWNER_HEX),
    ).resolves.toBe(false);
  });

  it("is not complete while the record does not exist yet", async () => {
    client.fetchRecord.mockResolvedValue(null);
    await expect(
      recordRevisionPast("alice.arch", "ArchOwner", 0n)(OWNER_HEX),
    ).resolves.toBe(false);
  });

  it("scopes a Text probe to its own key", async () => {
    client.fetchRecord.mockResolvedValue({ revision: 1n });
    await recordRevisionPast("alice.arch", "Text", 0n, "com.twitter")(OWNER_HEX);
    expect(client.fetchRecord).toHaveBeenCalledWith("alice.arch", "Text", "com.twitter");
  });
});

describe("nameRegisteredTo", () => {
  it("is complete once the name exists and belongs to the signer", async () => {
    client.fetchNameAccount.mockResolvedValue({ owner: OWNER_BYTES });
    await expect(nameRegisteredTo("alice.arch")(OWNER_HEX)).resolves.toBe(true);
  });

  it("is not complete while the name account is absent", async () => {
    client.fetchNameAccount.mockResolvedValue(null);
    await expect(nameRegisteredTo("alice.arch")(OWNER_HEX)).resolves.toBe(false);
  });

  it("does not accept a name registered to somebody else", async () => {
    client.fetchNameAccount.mockResolvedValue({ owner: OWNER_BYTES });
    await expect(nameRegisteredTo("alice.arch")(OTHER_HEX)).resolves.toBe(false);
  });
});

describe("nameOwnedBy", () => {
  // Transfer is the one probe that ignores the signer: it watches the
  // destination, because the account that signed is the one giving the name up.
  it("is complete once ownership has moved to the destination", async () => {
    client.fetchNameAccount.mockResolvedValue({ owner: OWNER_BYTES });
    await expect(nameOwnedBy("alice.arch", OWNER_HEX)(OTHER_HEX)).resolves.toBe(true);
  });

  it("is not complete while the old owner still holds the name", async () => {
    client.fetchNameAccount.mockResolvedValue({ owner: OWNER_BYTES });
    await expect(nameOwnedBy("alice.arch", OTHER_HEX)(OWNER_HEX)).resolves.toBe(false);
  });
});
