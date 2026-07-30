import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createArchExtensionPort,
  createKitLaserEyesPort,
  isDigestSigner,
  kitSignerToAnsHashSigner,
} from "./ans-wallet-port";
import {
  __resetActiveAnsWalletPort,
  getActiveAnsWalletPort,
  setActiveAnsWalletPort,
} from "./ans-wallet-session";

vi.mock("@saturnbtcio/arch-sdk", () => ({
  SignatureUtil: {
    adjustSignature: (sig: Uint8Array) => sig,
  },
}));

vi.mock("./bip322-witness", () => ({
  extractSchnorrHexFromWalletSignature: (raw: string) => {
    if (raw.startsWith("WITNESS:")) return raw.slice("WITNESS:".length);
    if (/^[0-9a-fA-F]{128}$/.test(raw)) return raw.toLowerCase();
    throw new Error(`unexpected raw: ${raw}`);
  },
}));

vi.mock("./wallet-gateway", () => ({
  walletRequest: async (_key: null, run: () => Promise<unknown>) => run(),
}));

describe("ans-wallet-port adapters", () => {
  beforeEach(() => {
    __resetActiveAnsWalletPort();
  });

  it("maps ChallengeSigner through witness unwrap", async () => {
    const challenge = "ab".repeat(32);
    const signer = kitSignerToAnsHashSigner(async (msg) => {
      expect(msg).toBe(challenge);
      return `WITNESS:${"cd".repeat(64)}`;
    });
    await expect(signer(challenge)).resolves.toBe("cd".repeat(64));
  });

  it("maps DigestSigner through signDigest + unwrap", async () => {
    const digest = "11".repeat(32);
    const signer = kitSignerToAnsHashSigner({
      signDigest: async (hex) => {
        expect(hex).toBe(digest);
        return `WITNESS:${"22".repeat(64)}`;
      },
    });
    expect(isDigestSigner({ signDigest: async () => "" })).toBe(true);
    await expect(signer(digest)).resolves.toBe("22".repeat(64));
  });

  it("kit LaserEyes port fee-pays with kit archAddress", async () => {
    const port = createKitLaserEyesPort({
      identity: {
        archAddress: "aa".repeat(32),
        address: "tb1ptest",
        publicKey: "02".padEnd(66, "a"),
        providerId: "xverse",
        providerLabel: "Xverse",
      },
      signer: async () => `WITNESS:${"33".repeat(64)}`,
    });
    setActiveAnsWalletPort(port);
    expect(getActiveAnsWalletPort()?.archAddress).toBe("aa".repeat(32));
    expect(getActiveAnsWalletPort()?.providerId).toBe("xverse");
    await expect(port.signMessageHash("44".repeat(32))).resolves.toBe("33".repeat(64));
  });

  it("Arch extension port uses signArchMessageHash", async () => {
    const hash = Uint8Array.from({ length: 32 }, () => 0x55);
    const sig = "66".repeat(64);
    (window as unknown as { arch: unknown }).arch = {
      signArchMessageHash: async (bytes: Uint8Array) => {
        expect(Array.from(bytes)).toEqual(Array.from(hash));
        return { signature64Hex: sig };
      },
    };
    const port = createArchExtensionPort({
      archAddress: "77".repeat(32),
      address: "tb1p",
      publicKey: "02".padEnd(66, "b"),
      kind: "turnkey",
    });
    expect(port.providerId).toBe("arch-extension");
    await expect(
      port.signMessageHash(Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("")),
    ).resolves.toBe(sig);
  });
});
