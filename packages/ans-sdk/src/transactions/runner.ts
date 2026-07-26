import type { AnsTransport } from "../transport/types.js";
import type { ArchAddress, BuiltInstruction } from "../types.js";
import type { TransactionSigner } from "../wallet/adapter.js";
import { buildTransaction, type RuntimeTransaction } from "./builder.js";

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function signAndSendInstruction(params: {
  transport: AnsTransport;
  instruction: BuiltInstruction;
  feePayer: ArchAddress;
  signer: TransactionSigner;
  confirm?: boolean;
}): Promise<string> {
  const { transaction, messageHashHex } = await buildTransaction(
    params.transport,
    [params.instruction],
    params.feePayer,
  );
  const signatureHex = await params.signer(messageHashHex);
  const signed: RuntimeTransaction = {
    ...transaction,
    signatures: [Array.from(hexToBytes(signatureHex))],
  };
  const txid = await params.transport.sendTransaction(signed);
  if (params.confirm === false) return txid;

  for (let attempt = 0; attempt < 30; attempt++) {
    const processed = await params.transport.getProcessedTransaction(txid);
    if (!processed) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    if (processed.status === "Failed") {
      throw new Error(processed.error ?? `transaction ${txid} failed`);
    }
    if (processed.status === "Processed" || processed.status.toLowerCase().includes("processed")) {
      return txid;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`transaction ${txid} did not finish processing`);
}
