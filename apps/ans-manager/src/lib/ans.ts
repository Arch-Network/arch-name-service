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

export async function submitWithWindowArch(
  instruction: BuiltInstruction,
  archAddress: string,
): Promise<string> {
  if (!window.arch?.signArchMessageHash) {
    throw new Error("Arch Wallet is not available. Install/enable the Chrome extension.");
  }
  const feePayer = decodeArchAddress(archAddress);
  const signer = makeAnsSigner({
    async signArchMessageHash({ messageHashHex }) {
      const hashBytes = new TextEncoder().encode(messageHashHex);
      const result = await window.arch!.signArchMessageHash(hashBytes);
      if (result instanceof Uint8Array) {
        return { signature64Hex: toHex(result) };
      }
      if (typeof result.signature === "string") {
        return { signature64Hex: result.signature.replace(/^0x/, "") };
      }
      return { signature64Hex: toHex(result.signature) };
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
