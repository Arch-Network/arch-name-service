/**
 * ANS wallet port — the only shape submit/faucet need from a connected wallet.
 *
 * Kit wallets expose either a DigestSigner (Arch extension / Turnkey Hub) or a
 * ChallengeSigner (LaserEyes BIP-322). Arch Wallet's kit DigestSigner still
 * calls `signMessage`, which is the wrong Approve path for Arch L2 txs; ANS
 * keeps `signArchMessageHash` for the extension. LaserEyes / Turnkey Hub
 * witness blobs are unwrapped to 64-byte Schnorr hex here.
 */

import type {
  ChallengeSigner,
  DigestSigner,
  TransactionSigner,
} from "@arch-network/wallet-connect-kit";
import { extractSchnorrHexFromWalletSignature } from "./bip322-witness";
import { walletRequest } from "./wallet-gateway";

export type AnsWalletProviderId =
  | "arch-extension"
  | "xverse"
  | "unisat"
  | "leather"
  | "phantom"
  | "turnkey-hub"
  | string;

export type AnsWalletIdentity = {
  archAddress: string;
  address: string;
  publicKey: string;
  kind?: string;
  providerId: AnsWalletProviderId;
  providerLabel: string;
};

/** Signs a 64-char SanitizedMessage hash; returns 64-byte (r||s) hex. */
export type AnsHashSigner = (messageHashHex: string) => Promise<string>;

export type AnsWalletPort = AnsWalletIdentity & {
  signMessageHash: AnsHashSigner;
};

export function isDigestSigner(signer: TransactionSigner): signer is DigestSigner {
  return typeof signer === "object" && signer !== null && "signDigest" in signer;
}

/**
 * Map a kit TransactionSigner into the hex Schnorr signer ANS submit needs.
 *
 * - DigestSigner: `signDigest` may return raw 64-byte hex OR a BIP-322 witness
 *   (Turnkey Hub wraps with Witness.serialize). Always run extract.
 * - ChallengeSigner: BIP-322 witness from LaserEyes / Xverse / UniSat.
 *
 * Arch extension must NOT use the kit DigestSigner — use
 * {@link createArchExtensionHashSigner} instead.
 */
export function kitSignerToAnsHashSigner(signer: TransactionSigner): AnsHashSigner {
  return async (messageHashHex: string) => {
    const raw = isDigestSigner(signer)
      ? await signer.signDigest(messageHashHex)
      : await (signer as ChallengeSigner)(messageHashHex);
    // Already-canonical 64-byte hex (Arch extension path if ever used):
    // extract still accepts it via the raw-bytes fallback.
    if (/^[0-9a-fA-F]{128}$/.test(raw.trim().replace(/^0x/i, ""))) {
      try {
        return extractSchnorrHexFromWalletSignature(raw);
      } catch {
        return raw.trim().replace(/^0x/i, "").toLowerCase();
      }
    }
    return extractSchnorrHexFromWalletSignature(raw);
  };
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Arch Wallet extension signer — uses SIGN_ARCH_MESSAGE_HASH, not the kit's
 * `signMessage`-based DigestSigner (different Approve handler / digest).
 */
export function createArchExtensionHashSigner(): AnsHashSigner {
  return async (messageHashHex: string) => {
    type ArchSignResult =
      | Uint8Array
      | { signature: Uint8Array | string; signature64Hex?: string }
      | { signature64Hex: string };
    type ArchSignerProvider = {
      signArchMessageHash(messageHash: Uint8Array): Promise<ArchSignResult>;
    };
    const provider = (window as Window & { arch?: ArchSignerProvider }).arch;
    if (!provider?.signArchMessageHash) {
      throw new Error("Arch Wallet is not available. Install/enable the Chrome extension.");
    }
    const hashBytes = fromHex(messageHashHex);
    if (hashBytes.length !== 32) {
      throw new Error(`Expected 32-byte message hash, got ${hashBytes.length}`);
    }
    const result = await walletRequest(null, () => provider.signArchMessageHash(hashBytes));
    if (result instanceof Uint8Array) return toHex(result);
    if ("signature64Hex" in result && typeof result.signature64Hex === "string") {
      return result.signature64Hex.replace(/^0x/, "");
    }
    if ("signature" in result) {
      if (typeof result.signature === "string") return result.signature.replace(/^0x/, "");
      return toHex(result.signature);
    }
    throw new Error("Wallet returned an unrecognized signature payload");
  };
}

export function createArchExtensionPort(identity: {
  archAddress: string;
  address: string;
  publicKey: string;
  kind?: string;
}): AnsWalletPort {
  return {
    providerId: "arch-extension",
    providerLabel: "Arch Wallet",
    archAddress: identity.archAddress,
    address: identity.address,
    publicKey: identity.publicKey,
    kind: identity.kind,
    signMessageHash: createArchExtensionHashSigner(),
  };
}

export function createKitLaserEyesPort(params: {
  identity: AnsWalletIdentity;
  signer: TransactionSigner;
}): AnsWalletPort {
  return {
    ...params.identity,
    signMessageHash: kitSignerToAnsHashSigner(params.signer),
  };
}

/** Provider display labels for the header chip. */
export const WALLET_PROVIDER_LABELS: Record<string, string> = {
  "arch-extension": "Arch Wallet",
  arch: "Arch Wallet",
  xverse: "Xverse",
  unisat: "UniSat",
  leather: "Leather",
  phantom: "Phantom",
  "turnkey-passkey": "Arch Hub",
  "turnkey-email": "Arch Hub",
  "turnkey-hub": "Arch Hub",
};

export function providerLabelFor(providerId: string | null | undefined): string {
  if (!providerId) return "Wallet";
  return WALLET_PROVIDER_LABELS[providerId] ?? providerId;
}
