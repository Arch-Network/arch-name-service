import { Buffer } from "buffer";

// @saturnbtcio/arch-sdk PDA helpers (PubkeyUtil.findProgramAddress) use Node's
// Buffer. Search/register derive name PDAs before any wallet is involved, so
// browsers without an extension-injected Buffer crash with "Buffer is not defined".
const g = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
if (!g.Buffer) {
  g.Buffer = Buffer;
}
