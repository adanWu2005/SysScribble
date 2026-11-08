/**
 * PostgREST (and therefore supabase-js) represents `bytea` as a `\x`-prefixed hex string
 * on read and accepts the same format on write. These helpers are the only place that
 * conversion happens.
 */

const HEX = '0123456789abcdef';

export function bytesToBytea(bytes: Uint8Array): string {
  let out = '\\x';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] as number;
    out += HEX[b >> 4];
    out += HEX[b & 0x0f];
  }
  return out;
}

export function byteaToBytes(value: string | null | undefined): Uint8Array | null {
  if (value == null || value.length === 0) return null;
  if (value.startsWith('\\x')) {
    const hex = value.slice(2);
    if (hex.length % 2 !== 0) throw new Error('bytea hex has odd length');
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
      const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      if (Number.isNaN(byte)) throw new Error('bytea hex contains a non-hex character');
      out[i] = byte;
    }
    return out;
  }
  // Defensive: some drivers return base64.
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
