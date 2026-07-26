/**
 * Wallet digest signing adapter — same contract as arch-swap-engine's
 * makeSwapSigner, without a hard dependency on that package.
 */

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

/**
 * Returns a compact BIP-322 witness blob (base64) containing the 64-byte
 * Schnorr signature. Callers that need only the raw 64 bytes can decode it.
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
    // Return raw 64-byte hex for maximum portability. Manager/submit helpers
    // can wrap into BIP-322 witness if the RPC path requires it.
    return signature64Hex;
  };
}
