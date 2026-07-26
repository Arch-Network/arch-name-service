import { SanitizedMessageUtil } from "@saturnbtcio/arch-sdk";

import type { AnsTransport } from "../transport/types.js";
import type { ArchAddress, BuiltInstruction } from "../types.js";

export type RuntimeTransaction = {
  version: number;
  signatures: number[][];
  message: unknown;
};

export async function buildTransaction(
  transport: AnsTransport,
  instructions: BuiltInstruction[],
  feePayer: ArchAddress,
): Promise<{ transaction: RuntimeTransaction; messageHashHex: string }> {
  const recentBlockhash = await transport.getBestBlockHash();
  const sdkInstructions = instructions.map((ix) => ({
    program_id: ix.programId,
    accounts: ix.accounts.map((account) => ({
      pubkey: account.pubkey,
      is_signer: account.isSigner,
      is_writable: account.isWritable,
    })),
    data: ix.data,
  }));

  const messageResult = SanitizedMessageUtil.createSanitizedMessage(
    sdkInstructions,
    feePayer,
    recentBlockhash,
  );
  if (typeof messageResult === "string") {
    throw new Error(`Failed to compile ANS transaction: ${messageResult}`);
  }

  const hashBytes = SanitizedMessageUtil.hash(messageResult);
  const messageHashHex = new TextDecoder().decode(hashBytes);
  const transaction: RuntimeTransaction = {
    version: 0,
    signatures: [],
    message: messageResult,
  };
  return { transaction, messageHashHex };
}
