import { AnsError } from "../errors.js";

export class BorshReader {
  private offset = 0;

  constructor(private readonly data: Uint8Array) {}

  remaining(): number {
    return this.data.length - this.offset;
  }

  finish(): void {
    if (this.offset !== this.data.length) {
      throw new AnsError("CodecError", "trailing bytes after decode");
    }
  }

  u8(): number {
    this.require(1);
    return this.data[this.offset++];
  }

  bool(): boolean {
    return this.u8() !== 0;
  }

  u16(): number {
    this.require(2);
    const value = this.data[this.offset] | (this.data[this.offset + 1] << 8);
    this.offset += 2;
    return value;
  }

  u32(): number {
    this.require(4);
    const view = new DataView(this.data.buffer, this.data.byteOffset + this.offset, 4);
    const value = view.getUint32(0, true);
    this.offset += 4;
    return value;
  }

  u64(): bigint {
    this.require(8);
    let value = 0n;
    for (let i = 0; i < 8; i++) {
      value |= BigInt(this.data[this.offset + i]) << BigInt(i * 8);
    }
    this.offset += 8;
    return value;
  }

  bytes(length: number): Uint8Array {
    this.require(length);
    const slice = this.data.slice(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  pubkey(): Uint8Array {
    return this.bytes(32);
  }

  string(): string {
    const length = this.u32();
    return new TextDecoder().decode(this.bytes(length));
  }

  private require(n: number): void {
    if (this.offset + n > this.data.length) {
      throw new AnsError("CodecError", "unexpected end of buffer");
    }
  }
}
