import {
  AnsClient,
  createArchRpcTransport,
  loadTestnetManifest,
  makeAnsSigner,
  signAndSendInstruction,
  type BuiltInstruction,
} from "@arch-network/ans-sdk";
import bs58 from "bs58";

const rpcUrl =
  import.meta.env.VITE_ARCH_RPC_URL ?? loadTestnetManifest().rpcUrl;

let cachedClient: AnsClient | null = null;

export function getAnsClient(): AnsClient {
  if (!cachedClient) {
    cachedClient = new AnsClient(
      loadTestnetManifest(),
      createArchRpcTransport(rpcUrl),
    );
  }
  return cachedClient;
}

export const ansClient = {
  get transport() {
    return getAnsClient().transport;
  },
  fetchRegistryConfig: (...args: Parameters<AnsClient["fetchRegistryConfig"]>) =>
    getAnsClient().fetchRegistryConfig(...args),
  fetchNameAccount: (...args: Parameters<AnsClient["fetchNameAccount"]>) =>
    getAnsClient().fetchNameAccount(...args),
  resolveOwner: (...args: Parameters<AnsClient["resolveOwner"]>) =>
    getAnsClient().resolveOwner(...args),
  resolveRecord: (...args: Parameters<AnsClient["resolveRecord"]>) =>
    getAnsClient().resolveRecord(...args),
  resolvePrimary: (...args: Parameters<AnsClient["resolvePrimary"]>) =>
    getAnsClient().resolvePrimary(...args),
  listOwnedNames: (...args: Parameters<AnsClient["listOwnedNames"]>) =>
    getAnsClient().listOwnedNames(...args),
  buildRegister: (...args: Parameters<AnsClient["buildRegister"]>) =>
    getAnsClient().buildRegister(...args),
  buildTransfer: (...args: Parameters<AnsClient["buildTransfer"]>) =>
    getAnsClient().buildTransfer(...args),
  buildSetRecord: (...args: Parameters<AnsClient["buildSetRecord"]>) =>
    getAnsClient().buildSetRecord(...args),
  buildSetPrimary: (...args: Parameters<AnsClient["buildSetPrimary"]>) =>
    getAnsClient().buildSetPrimary(...args),
  buildClearPrimary: (...args: Parameters<AnsClient["buildClearPrimary"]>) =>
    getAnsClient().buildClearPrimary(...args),
  fetchRecord: (...args: Parameters<AnsClient["fetchRecord"]>) =>
    getAnsClient().fetchRecord(...args),
  fetchReverse: (...args: Parameters<AnsClient["fetchReverse"]>) =>
    getAnsClient().fetchReverse(...args),
};

export function decodeArchAddress(value: string): Uint8Array {
  const trimmed = value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      out[i] = Number.parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }
  return bs58.decode(trimmed);
}

export function encodeArchAddress(bytes: Uint8Array): string {
  return bs58.encode(bytes);
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

async function signMessageHashHex(messageHashHex: string): Promise<string> {
  if (!window.arch?.signArchMessageHash) {
    throw new Error("Arch Wallet is not available. Install/enable the Chrome extension.");
  }
  // Provider API takes the 32-byte digest and re-hexes it for the wallet.
  // Challenge from SanitizedMessageUtil.hash is already that lowercase hex.
  const hashBytes = fromHex(messageHashHex);
  if (hashBytes.length !== 32) {
    throw new Error(`Expected 32-byte message hash, got ${hashBytes.length}`);
  }
  const result = await window.arch.signArchMessageHash(hashBytes);
  if (result instanceof Uint8Array) {
    return toHex(result);
  }
  if ("signature64Hex" in result && typeof result.signature64Hex === "string") {
    return result.signature64Hex.replace(/^0x/, "");
  }
  if ("signature" in result) {
    if (typeof result.signature === "string") {
      return result.signature.replace(/^0x/, "");
    }
    return toHex(result.signature);
  }
  throw new Error("Wallet returned an unrecognized signature payload");
}

async function signAndAdjustMessageHashHex(messageHashHex: string): Promise<string> {
  const { SignatureUtil } = await import("@saturnbtcio/arch-sdk");
  const raw = await signMessageHashHex(messageHashHex);
  return toHex(SignatureUtil.adjustSignature(fromHex(raw)));
}

/**
 * Ensure the connected Arch account exists on-chain (testnet faucet create).
 * Required before the account can fee-pay ANS mutations.
 */
export async function ensureArchAccount(archAddress: string): Promise<void> {
  const pubkey = decodeArchAddress(archAddress);
  const existing = await getAnsClient().transport.readAccountInfo(pubkey);
  if (existing) return;

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "create_account_with_faucet",
      params: Array.from(pubkey),
    }),
  });
  if (!response.ok) {
    throw new Error(`Arch faucet HTTP ${response.status}`);
  }
  const body = (await response.json()) as {
    result?: {
      version: number;
      signatures: number[][];
      message: unknown;
    };
    error?: { message?: string };
  };
  if (body.error || !body.result) {
    throw new Error(
      body.error?.message ??
        "Could not create your Arch account via the testnet faucet. Open Arch Wallet and complete onboarding first.",
    );
  }

  const { SanitizedMessageUtil } = await import("@saturnbtcio/arch-sdk");
  const message = body.result.message as {
    header: unknown;
    account_keys: number[][];
    recent_blockhash: number[];
    instructions: Array<{ program_id_index: number; accounts: number[]; data: number[] }>;
  };
  const sdkMessage = {
    header: message.header,
    account_keys: message.account_keys.map((key) => Uint8Array.from(key)),
    recent_blockhash: Uint8Array.from(message.recent_blockhash),
    instructions: message.instructions.map((instruction) => ({
      program_id_index: instruction.program_id_index,
      accounts: instruction.accounts,
      data: Uint8Array.from(instruction.data),
    })),
  };
  const messageHashHex = new TextDecoder().decode(SanitizedMessageUtil.hash(sdkMessage as never));
  const userSigHex = await signAndAdjustMessageHashHex(messageHashHex);
  const signed = {
    ...body.result,
    signatures: [...body.result.signatures, Array.from(fromHex(userSigHex))],
  };
  const txid = await getAnsClient().transport.sendTransaction(signed);
  for (let attempt = 0; attempt < 30; attempt++) {
    const again = await getAnsClient().transport.readAccountInfo(pubkey);
    if (again) return;
    const processed = await getAnsClient().transport.getProcessedTransaction(txid);
    if (processed?.status === "Failed") {
      throw new Error(processed.error ?? "Arch account creation failed");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    "Arch account creation submitted but not visible yet. Wait a few seconds and retry.",
  );
}

export async function submitWithWindowArch(
  instruction: BuiltInstruction,
  archAddress: string,
): Promise<string> {
  await ensureArchAccount(archAddress);
  const feePayer = decodeArchAddress(archAddress);
  const signer = makeAnsSigner({
    async signArchMessageHash({ messageHashHex }) {
      return { signature64Hex: await signMessageHashHex(messageHashHex) };
    },
  });
  return signAndSendInstruction({
    transport: getAnsClient().transport,
    instruction,
    feePayer,
    signer,
  });
}

export function explorerTxUrl(txid: string): string {
  return `https://explorer.arch.network/testnet/tx/${txid}`;
}
