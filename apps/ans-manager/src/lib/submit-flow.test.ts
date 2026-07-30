/**
 * End-to-end shape of a wallet-signed ANS mutation.
 *
 * Two invariants are under test here.
 *
 * The first produced "two transactions approved, then it failed": a
 * first-ever mutation needs TWO wallet approvals (faucet account
 * creation, then the mutation), and Arch verifies each signature against
 * the transaction's fee payer. A second approval served by a different
 * account is rejected by the node only after the user approved it.
 *
 * The second is the released extension's split brain: `getAccount()`
 * answers from the origin binding while the Approve window signs with
 * the wallet's active account. The flow must notice that from the
 * signature itself, before submitting, and re-run around whoever really
 * signed — and it must never treat a stale page-side account as a
 * "wallet switched accounts" error.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import bs58 from "bs58";

const MESSAGE_HASH_HEX = "ab".repeat(32);
const SIGNATURE_HEX = "cd".repeat(64);

const transport = {
  readAccountInfo: vi.fn(),
  sendTransaction: vi.fn(),
  getProcessedTransaction: vi.fn(),
  getBestBlockHash: vi.fn(),
};

vi.mock("@saturnbtcio/arch-sdk", () => ({
  SanitizedMessageUtil: {
    hash: () => new TextEncoder().encode(MESSAGE_HASH_HEX),
  },
  SignatureUtil: {
    adjustSignature: (sig: Uint8Array) => sig,
  },
}));

/**
 * Set per-test to make the shared confirmation path report "accepted, not
 * confirmed" — the state a set-primary lands in whenever the indexer has not
 * ingested the txid before the deadline.
 */
const confirmation = vi.hoisted(() => ({
  pending: false,
  /** The effect probe the flow handed to the shared confirmation wait. */
  isComplete: undefined as undefined | (() => Promise<boolean>),
}));

vi.mock("@arch-network/ans-sdk", async (importOriginal) => {
  // The RPC params builders and error classes stay real. They are the whole
  // point of centralising the wire shapes: a mock of the faucet payload could
  // not catch the faucet payload being wrong.
  const actual = await importOriginal<typeof import("@arch-network/ans-sdk")>();
  return {
    ...actual,
    AnsClient: class {
      transport = transport;
    },
    createArchRpcTransport: () => transport,
    loadTestnetManifest: () => ({}),
    makeAnsSigner:
      (wallet: {
        signArchMessageHash(o: { messageHashHex: string }): Promise<{ signature64Hex: string }>;
      }) =>
      async (challenge: string) =>
        (await wallet.signArchMessageHash({ messageHashHex: challenge })).signature64Hex,
    signAndSendInstruction: async (params: {
      signer: (c: string) => Promise<string>;
      onSubmitted?: (txid: string) => void;
      isComplete?: () => Promise<boolean>;
    }) => {
      await params.signer(MESSAGE_HASH_HEX);
      confirmation.isComplete = params.isComplete;
      params.onSubmitted?.("mutation-txid");
      if (confirmation.pending) {
        throw new actual.TransactionPendingError(
          "mutation-txid",
          new actual.ArchRpcError("get_processed_transaction", {
            code: -32602,
            message: "Invalid params",
            data: "invalid type: sequence, expected a string at line 1 column 0",
          }),
        );
      }
      return "mutation-txid";
    },
  };
});

/**
 * Real BIP-340 verification lives in `bip322.test.ts` against vectors from
 * the extension's own implementation. Here it is a lookup table so a test
 * can say "the wallet signed as B" without holding a private key.
 */
const signerForSignature = new Map<string, string>();
vi.mock("./bip322", () => ({
  checkArchSignature: (archAddress: string, _hash: string, signature: string) => {
    const actual = signerForSignature.get(signature);
    if (!actual) return "unverifiable";
    const key = (v: string) => {
      const trimmed = v.length === 66 ? v.slice(2) : v;
      if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
      return Array.from(bs58.decode(trimmed), (b) => b.toString(16).padStart(2, "0")).join("");
    };
    return key(archAddress) === key(actual) ? "match" : "mismatch";
  },
}));

const { approvalNotice, submitWithWindowArch, WalletAccountChangedError, SignerMismatchError } =
  await import("./ans");
const { __resetSignerRegistry, rememberSeenAccount, signerObservation } = await import(
  "./signer-registry"
);
type SubmitProgress = import("./ans").SubmitProgress;

const ACCOUNT_A = {
  address: "tb1pa",
  publicKey: "02".padEnd(66, "a"),
  archAddress: "11".repeat(32),
  kind: "turnkey",
};
const ACCOUNT_B = { ...ACCOUNT_A, address: "tb1pb", archAddress: "22".repeat(32) };
/** Same signing key as A, spelled the way `getAccount()` returns it. */
const ACCOUNT_A_BASE58 = {
  ...ACCOUNT_A,
  archAddress: bs58.encode(
    Uint8Array.from(ACCOUNT_A.archAddress.match(/.{2}/g)!.map((b) => parseInt(b, 16))),
  ),
};
/** Same signing key as A, carrying the compressed-key parity byte. */
const ACCOUNT_A_COMPRESSED = {
  ...ACCOUNT_A,
  archAddress: `02${ACCOUNT_A.archAddress}`,
};

/**
 * A fake extension.
 *
 * `reported` is the queue `getAccount()` walks through (one entry per
 * read, last entry repeats). `signsAs` is who the Approve window
 * actually signs as — independent of `reported`, which is the whole
 * point of these tests.
 */
function installWallet(
  reported: Array<typeof ACCOUNT_A>,
  signsAs: string = reported[0].archAddress,
) {
  const signedBy: string[] = [];
  let index = 0;
  const current = () => reported[Math.min(index, reported.length - 1)];
  (globalThis as unknown as { window: Record<string, unknown> }).window ??= {};
  (window as unknown as { arch: unknown }).arch = {
    getAccount: async () => current(),
    connect: async () => current(),
    signArchMessageHash: async () => {
      signedBy.push(current().archAddress);
      index += 1;
      const signature = `${signedBy.length.toString(16).padStart(2, "0")}${SIGNATURE_HEX.slice(2)}`;
      signerForSignature.set(signature, signsAs);
      return { signature64Hex: signature };
    },
  };
  return { signedBy };
}

/** Each read advances the reported queue, like a wallet changing under us. */
function installWalletAdvancingOnRead(reported: Array<typeof ACCOUNT_A>) {
  let index = 0;
  (globalThis as unknown as { window: Record<string, unknown> }).window ??= {};
  (window as unknown as { arch: unknown }).arch = {
    getAccount: async () => reported[Math.min(index++, reported.length - 1)],
    connect: async () => reported[Math.min(index, reported.length - 1)],
    signArchMessageHash: async () => {
      const signature = `ee${SIGNATURE_HEX.slice(2)}`;
      signerForSignature.set(signature, reported[0].archAddress);
      return { signature64Hex: signature };
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  confirmation.pending = false;
  confirmation.isComplete = undefined;
  signerForSignature.clear();
  (globalThis as unknown as { window: Record<string, unknown> }).window ??= {};
  (window as unknown as { localStorage?: Storage }).localStorage ??= (() => {
    const store = new Map<string, string>();
    return {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as unknown as Storage;
  })();
  __resetSignerRegistry();
  transport.getBestBlockHash.mockResolvedValue(new Uint8Array(32));
  transport.sendTransaction.mockResolvedValue("faucet-txid");
  transport.getProcessedTransaction.mockResolvedValue({ status: "Processed" });
  globalThis.fetch = vi.fn(async () =>
    new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          version: 0,
          signatures: [Array.from(new Uint8Array(64))],
          message: {
            header: {
              num_required_signatures: 2,
              num_readonly_signed_accounts: 0,
              num_readonly_unsigned_accounts: 1,
            },
            account_keys: [Array.from(new Uint8Array(32))],
            recent_blockhash: Array.from(new Uint8Array(32)),
            instructions: [{ program_id_index: 0, accounts: [0], data: [1] }],
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  ) as unknown as typeof fetch;
});

const instruction = {
  programId: new Uint8Array(32),
  accounts: [],
  data: new Uint8Array([1]),
} as never;

/** Records which account each rebuild was asked to build for. */
function builder() {
  const builtFor: string[] = [];
  const build = (actor: string) => {
    builtFor.push(actor);
    return instruction;
  };
  return { build, builtFor };
}

describe("submitWithWindowArch approval flow", () => {
  it("needs one approval when the Arch account already exists", async () => {
    transport.readAccountInfo.mockResolvedValue({ lamports: 1 });
    const wallet = installWallet([ACCOUNT_A]);
    const progress: SubmitProgress[] = [];

    const outcome = await submitWithWindowArch(() => instruction, (p) => progress.push(p));

    expect(outcome.txid).toBe("mutation-txid");
    expect(outcome.adopted).toBe(false);
    expect(wallet.signedBy).toEqual([ACCOUNT_A.archAddress]);
    expect(progress).toEqual([
      { phase: "mutation", approvalIndex: 1, approvalTotal: 1, attempt: 1 },
      { phase: "mutation", approvalIndex: 1, approvalTotal: 1, attempt: 1, stage: "confirming" },
    ]);
  });

  it("needs two approvals for a new account, both from the fee payer", async () => {
    // Absent before setup, present afterwards.
    transport.readAccountInfo.mockResolvedValueOnce(null).mockResolvedValue({ lamports: 1 });
    const wallet = installWallet([ACCOUNT_A]);
    const progress: SubmitProgress[] = [];

    const outcome = await submitWithWindowArch(() => instruction, (p) => progress.push(p));

    expect(outcome.txid).toBe("mutation-txid");
    expect(wallet.signedBy).toEqual([ACCOUNT_A.archAddress, ACCOUNT_A.archAddress]);
    expect(progress).toEqual([
      { phase: "account-setup", approvalIndex: 1, approvalTotal: 2, attempt: 1 },
      { phase: "mutation", approvalIndex: 2, approvalTotal: 2, attempt: 1 },
      { phase: "mutation", approvalIndex: 2, approvalTotal: 2, attempt: 1, stage: "confirming" },
    ]);
  });

  /**
   * The faucet transaction is always un-indexed on the first confirmation poll,
   * so `getProcessedTransaction` reports "not visible yet" (null) before the
   * account appears. That is the normal path, not a failure: the account read is
   * the success signal and the wait has to continue.
   */
  it("keeps waiting for account setup while the faucet tx is not yet visible", async () => {
    transport.readAccountInfo
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ lamports: 1 });
    transport.getProcessedTransaction.mockResolvedValue(null);
    const wallet = installWallet([ACCOUNT_A]);

    const outcome = await submitWithWindowArch(() => instruction);

    expect(outcome.txid).toBe("mutation-txid");
    expect(transport.getProcessedTransaction).toHaveBeenCalledWith("faucet-txid");
    expect(wallet.signedBy).toHaveLength(2);
  });

  /**
   * The set-primary regression, end to end through the manager's own flow.
   *
   * The indexer answers a txid it has not ingested with `-32602 Invalid
   * params`, and every confirmation poll issued right after `send_transaction`
   * lands in that window. A set-primary that was already applied on-chain came
   * back to the user as "Set as primary failed" with the raw JSON-RPC body
   * underneath it. The transaction exists; the only unknown is when it settles,
   * and that is an outcome to report, not an error to raise.
   */
  it("reports a mutation the indexer has not caught up with as unconfirmed, not failed", async () => {
    transport.readAccountInfo.mockResolvedValue({ lamports: 1 });
    installWallet([ACCOUNT_A]);
    confirmation.pending = true;
    const progress: SubmitProgress[] = [];

    const outcome = await submitWithWindowArch(() => instruction, (p) => progress.push(p));

    expect(outcome.txid).toBe("mutation-txid");
    expect(outcome.confirmed).toBe(false);
    // And the user was told what was happening while the wait ran.
    expect(progress.at(-1)?.stage).toBe("confirming");
  });

  /**
   * The effect probe has to reach the confirmation wait, and it has to be
   * asked about the account that *signed* — which, after the flow adopts a
   * different signer, is not the account the wallet reported.
   */
  it("hands the effect probe to the confirmation wait, bound to the acting account", async () => {
    transport.readAccountInfo.mockResolvedValue({ lamports: 1 });
    rememberSeenAccount(ACCOUNT_B.archAddress);
    installWallet([ACCOUNT_A], ACCOUNT_B.archAddress);
    const probedFor: string[] = [];

    const outcome = await submitWithWindowArch(
      () => instruction,
      undefined,
      async (actor) => {
        probedFor.push(actor);
        return true;
      },
    );

    expect(outcome.actorArchAddress).toBe(ACCOUNT_B.archAddress);
    expect(confirmation.isComplete).toBeTypeOf("function");
    await confirmation.isComplete!();
    expect(probedFor).toEqual([ACCOUNT_B.archAddress]);
  });

  it("passes no probe when the caller has no observable effect", async () => {
    transport.readAccountInfo.mockResolvedValue({ lamports: 1 });
    installWallet([ACCOUNT_A]);

    await submitWithWindowArch(() => instruction);

    expect(confirmation.isComplete).toBeUndefined();
  });

  it("marks a confirmed mutation as confirmed", async () => {
    transport.readAccountInfo.mockResolvedValue({ lamports: 1 });
    installWallet([ACCOUNT_A]);

    await expect(submitWithWindowArch(() => instruction)).resolves.toMatchObject({
      confirmed: true,
    });
  });

  it("does not abort when the wallet re-encodes the same account", async () => {
    transport.readAccountInfo.mockResolvedValueOnce(null).mockResolvedValue({ lamports: 1 });
    // The wallet answers in base58, then with the compressed form of the
    // very same key. Neither is an account change.
    const wallet = installWallet(
      [ACCOUNT_A_BASE58, ACCOUNT_A_COMPRESSED],
      ACCOUNT_A.archAddress,
    );

    const outcome = await submitWithWindowArch(() => instruction);

    expect(outcome.txid).toBe("mutation-txid");
    expect(wallet.signedBy).toHaveLength(2);
  });

  it("aborts before the second approval when the wallet account changes", async () => {
    transport.readAccountInfo.mockResolvedValueOnce(null).mockResolvedValue({ lamports: 1 });
    // Account setup signs as A; the wallet then reports B for the mutation.
    const wallet = installWallet([ACCOUNT_A, ACCOUNT_B], ACCOUNT_A.archAddress);

    await expect(submitWithWindowArch(() => instruction)).rejects.toBeInstanceOf(
      WalletAccountChangedError,
    );

    // Exactly one signature was taken, and no mutation reached the node.
    expect(wallet.signedBy).toEqual([ACCOUNT_A.archAddress]);
    expect(transport.sendTransaction).toHaveBeenCalledTimes(1); // faucet only
  });

  it("reports the mid-flow switch with enough context to tell it apart", async () => {
    transport.readAccountInfo.mockResolvedValueOnce(null).mockResolvedValue({ lamports: 1 });
    installWallet([ACCOUNT_A, ACCOUNT_B], ACCOUNT_A.archAddress);

    const error = await submitWithWindowArch(() => instruction).catch((e) => e);

    expect(error).toBeInstanceOf(WalletAccountChangedError);
    expect(error.context.approvalsCompleted).toBe(1);
    expect(error.context.pinSource).toBe("reported");
    expect(error.context.checkpoint).toBe("attempt-1-approval-2-of-2");
    expect(error.message).toMatch(/after 1 approval\./i);
  });

  it("never reports a switch from a stale account seen before the action ran", async () => {
    // The page's idea of the account is old news: the very first read of
    // this action already returns B, and every later read agrees. Nothing
    // has been signed, so there is nothing to abort — the flow simply
    // pays with B.
    transport.readAccountInfo.mockResolvedValue({ lamports: 1 });
    installWalletAdvancingOnRead([ACCOUNT_B, ACCOUNT_B]);
    signerForSignature.clear();
    (window as unknown as { arch: { signArchMessageHash: () => Promise<unknown> } }).arch
      .signArchMessageHash = async () => {
      const signature = `ff${SIGNATURE_HEX.slice(2)}`;
      signerForSignature.set(signature, ACCOUNT_B.archAddress);
      return { signature64Hex: signature };
    };

    const outcome = await submitWithWindowArch(() => instruction);

    expect(outcome.actorArchAddress).toBe(ACCOUNT_B.archAddress);
    expect(outcome.adopted).toBe(false);
  });
});

describe("submitWithWindowArch signer verification", () => {
  it("rebuilds around the account that actually signed", async () => {
    transport.readAccountInfo.mockResolvedValue({ lamports: 1 });
    // The extension reports A (the origin binding) but signs as B (its
    // active account) — the exact split the released build has. B is a
    // candidate because the wallet reported it here at some earlier point.
    rememberSeenAccount(ACCOUNT_B.archAddress);
    installWallet([ACCOUNT_A], ACCOUNT_B.archAddress);
    const { build, builtFor } = builder();

    const outcome = await submitWithWindowArch(build);

    expect(outcome.txid).toBe("mutation-txid");
    expect(outcome.actorArchAddress).toBe(ACCOUNT_B.archAddress);
    expect(outcome.adopted).toBe(true);
    // First attempt built for the reported account, the retry for the
    // real signer — the register instruction has to name the new owner.
    expect(builtFor).toEqual([ACCOUNT_A.archAddress, ACCOUNT_B.archAddress]);
  });

  it("submits nothing when the first signature does not verify", async () => {
    transport.readAccountInfo.mockResolvedValue({ lamports: 1 });
    rememberSeenAccount(ACCOUNT_B.archAddress);
    installWallet([ACCOUNT_A], ACCOUNT_B.archAddress);

    await submitWithWindowArch(() => instruction);

    // Only the second attempt's mutation reached the node; the first
    // attempt's unverifiable signature never did.
    expect(transport.sendTransaction).not.toHaveBeenCalled();
  });

  it("refuses the second approval once the check has proven itself", async () => {
    // Approval 1 verifies (so the checker demonstrably works), then the
    // wallet signs approval 2 as somebody nobody has heard of. That is
    // evidence, and the flow stops before the mutation reaches the node.
    transport.readAccountInfo.mockResolvedValueOnce(null).mockResolvedValue({ lamports: 1 });
    let signatures = 0;
    (globalThis as unknown as { window: Record<string, unknown> }).window ??= {};
    (window as unknown as { arch: unknown }).arch = {
      getAccount: async () => ACCOUNT_A,
      connect: async () => ACCOUNT_A,
      signArchMessageHash: async () => {
        signatures += 1;
        const signature = `${signatures.toString(16).padStart(2, "0")}${SIGNATURE_HEX.slice(2)}`;
        signerForSignature.set(
          signature,
          signatures === 1 ? ACCOUNT_A.archAddress : "99".repeat(32),
        );
        return { signature64Hex: signature };
      },
    };

    const error = await submitWithWindowArch(() => instruction).catch((e) => e);

    expect(error).toBeInstanceOf(SignerMismatchError);
    expect(error.signerArchAddress).toBeNull();
    expect(error.probes.every((p: { result: string }) => p.result === "mismatch")).toBe(true);
    expect(transport.sendTransaction).toHaveBeenCalledTimes(1); // faucet only
  });

  it("lets the node judge a mismatch this build cannot corroborate", async () => {
    // Nothing has verified and no candidate matches, so "wrong signer" and
    // "our checker is broken" are indistinguishable. Refusing here would
    // turn a bug in the verifier into an outage, so the transaction goes
    // out and the node decides.
    transport.readAccountInfo.mockResolvedValue({ lamports: 1 });
    rememberSeenAccount(ACCOUNT_B.archAddress);
    installWallet([ACCOUNT_A], "99".repeat(32));

    const outcome = await submitWithWindowArch(() => instruction);

    expect(outcome.txid).toBe("mutation-txid");
  });

  it("remembers the divergence so the next action pays with the real signer", async () => {
    transport.readAccountInfo.mockResolvedValue({ lamports: 1 });
    rememberSeenAccount(ACCOUNT_B.archAddress);
    installWallet([ACCOUNT_A], ACCOUNT_B.archAddress);
    await submitWithWindowArch(() => instruction);

    expect(signerObservation()).toMatchObject({
      reportedArchAddress: ACCOUNT_A.archAddress,
      signerArchAddress: ACCOUNT_B.archAddress,
    });

    // Second run: one attempt, no wasted approval.
    installWallet([ACCOUNT_A], ACCOUNT_B.archAddress);
    const { build, builtFor } = builder();
    const outcome = await submitWithWindowArch(build);

    expect(builtFor).toEqual([ACCOUNT_B.archAddress]);
    expect(outcome.actorArchAddress).toBe(ACCOUNT_B.archAddress);
  });

  it("forgets a stale divergence once the reported account signs again", async () => {
    transport.readAccountInfo.mockResolvedValue({ lamports: 1 });
    rememberSeenAccount(ACCOUNT_B.archAddress);
    installWallet([ACCOUNT_A], ACCOUNT_B.archAddress);
    await submitWithWindowArch(() => instruction);

    // The user made A the active account again.
    installWallet([ACCOUNT_A], ACCOUNT_A.archAddress);
    const { build, builtFor } = builder();
    await submitWithWindowArch(build);

    expect(builtFor).toEqual([ACCOUNT_B.archAddress, ACCOUNT_A.archAddress]);
    expect(signerObservation()).toMatchObject({
      reportedArchAddress: ACCOUNT_A.archAddress,
      signerArchAddress: ACCOUNT_A.archAddress,
    });
  });

  it("survives two approvals when the payer is a learned signer", async () => {
    // The payer differs from the reported account on purpose here, so the
    // mid-flow guard has to watch the reported account rather than the
    // payer — otherwise it aborts every second approval of every flow
    // that adopted a signer.
    rememberSeenAccount(ACCOUNT_B.archAddress);
    transport.readAccountInfo.mockResolvedValue({ lamports: 1 });
    installWallet([ACCOUNT_A], ACCOUNT_B.archAddress);
    await submitWithWindowArch(() => instruction);

    transport.readAccountInfo.mockReset();
    transport.readAccountInfo.mockResolvedValueOnce(null).mockResolvedValue({ lamports: 1 });
    const wallet = installWallet([ACCOUNT_A], ACCOUNT_B.archAddress);
    const progress: SubmitProgress[] = [];

    const outcome = await submitWithWindowArch(() => instruction, (p) => progress.push(p));

    expect(outcome.actorArchAddress).toBe(ACCOUNT_B.archAddress);
    expect(wallet.signedBy).toHaveLength(2);
    expect(progress).toEqual([
      { phase: "account-setup", approvalIndex: 1, approvalTotal: 2, attempt: 1 },
      { phase: "mutation", approvalIndex: 2, approvalTotal: 2, attempt: 1 },
      { phase: "mutation", approvalIndex: 2, approvalTotal: 2, attempt: 1, stage: "confirming" },
    ]);
  });

  /**
   * The extra approval the adapt path costs used to arrive with no
   * explanation: a second Approve window for a flow the UI had described as
   * needing one. `attempt` is what lets the views say why.
   */
  it("marks the rebuilt attempt so the extra approval can be explained", async () => {
    transport.readAccountInfo.mockResolvedValue({ lamports: 1 });
    rememberSeenAccount(ACCOUNT_B.archAddress);
    installWallet([ACCOUNT_A], ACCOUNT_B.archAddress);
    const progress: SubmitProgress[] = [];

    await submitWithWindowArch(() => instruction, (p) => progress.push(p));

    expect(progress).toEqual([
      { phase: "mutation", approvalIndex: 1, approvalTotal: 1, attempt: 1 },
      { phase: "mutation", approvalIndex: 1, approvalTotal: 1, attempt: 2 },
      { phase: "mutation", approvalIndex: 1, approvalTotal: 1, attempt: 2, stage: "confirming" },
    ]);
    expect(approvalNotice(progress[0], "update")).toBeNull();
    expect(approvalNotice(progress[1], "update")?.title).toBe("One more approval needed");
    // The extra-approval explanation must not linger once the wallet is done.
    expect(approvalNotice(progress[2], "update")).toBeNull();
  });

  it("does not block on a signature shape it cannot evaluate", async () => {
    transport.readAccountInfo.mockResolvedValue({ lamports: 1 });
    // No entry in the lookup table → `unverifiable`, which must never be
    // the reason a legitimate registration fails.
    installWallet([ACCOUNT_A]);
    signerForSignature.clear();

    const outcome = await submitWithWindowArch(() => instruction);

    expect(outcome.txid).toBe("mutation-txid");
    expect(outcome.adopted).toBe(false);
  });
});
