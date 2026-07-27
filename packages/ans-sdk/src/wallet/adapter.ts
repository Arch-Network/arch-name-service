/**
 * Wallet digest signing adapter — same contract as arch-swap-engine's
 * makeSwapSigner, without a hard dependency on that package.
 */

import { SignatureUtil } from "@saturnbtcio/arch-sdk";

export interface AnsWalletSigner {
  signArchMessageHash(opts: {
    messageHashHex: string;
  }): Promise<{ signature64Hex: string }>;
}

export type TransactionSigner = (challenge: string) => Promise<string>;

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Bridge a wallet `signArchMessageHash` into the runner callback.
 *
 * `challenge` is the lowercase 64-char hex string produced by
 * `TextDecoder().decode(SanitizedMessageUtil.hash(message))`. The wallet
 * BIP-322-signs the UTF-8 bytes of that string. Arch requires the
 * resulting Schnorr signature to be low-S normalized via
 * `SignatureUtil.adjustSignature` before inclusion in the runtime tx.
 */
export function makeAnsSigner(walletSigner: AnsWalletSigner): TransactionSigner {
  return async (challenge: string): Promise<string> => {
    const { signature64Hex } = await walletSigner.signArchMessageHash({
      messageHashHex: challenge,
    });
    const schnorrSig = hexToBytes(signature64Hex);
    if (schnorrSig.length !== 64) {
      throw new Error(
        `Wallet returned a ${schnorrSig.length}-byte signature; expected 64 bytes`,
      );
    }
    const adjusted = SignatureUtil.adjustSignature(schnorrSig);
    if (adjusted.length !== 64) {
      throw new Error(
        `adjustSignature returned ${adjusted.length} bytes; expected 64`,
      );
    }
    return bytesToHex(adjusted);
  };
}
