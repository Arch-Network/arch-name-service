export class BorshWriter {
  private readonly chunks: number[] = [];

  u8(value: number): this {
    this.chunks.push(value & 0xff);
    return this;
  }

  bool(value: boolean): this {
    return this.u8(value ? 1 : 0);
  }

  u16(value: number): this {
    this.chunks.push(value & 0xff, (value >> 8) & 0xff);
    return this;
  }

  u32(value: number): this {
    this.chunks.push(
      value & 0xff,
      (value >> 8) & 0xff,
      (value >> 16) & 0xff,
      (value >>> 24) & 0xff,
    );
    return this;
  }

  u64(value: bigint): this {
    let v = value;
    for (let i = 0; i < 8; i++) {
      this.chunks.push(Number(v & 0xffn));
      v >>= 8n;
    }
    return this;
  }

  bytes(value: Uint8Array): this {
    for (const byte of value) this.chunks.push(byte);
    return this;
  }

  pubkey(value: Uint8Array): this {
    if (value.length !== 32) {
      throw new Error("pubkey must be 32 bytes");
    }
    return this.bytes(value);
  }

  string(value: string): this {
    const encoded = new TextEncoder().encode(value);
    this.u32(encoded.length);
    return this.bytes(encoded);
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}
