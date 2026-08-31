/* eslint-disable @typescript-eslint/no-explicit-any */
/** CIIP/1 framing shared with the adapter SDK: the length counts UTF-8 body bytes. */
export function encodeIpcFrame(canonicalJson: string): any {
  const body = Buffer.from(canonicalJson, 'utf8');
  return Buffer.concat([
    Buffer.from(`CIIP/1 ${body.byteLength}:`, 'ascii'),
    body,
    Buffer.from('\n', 'ascii'),
  ]);
}
export class IpcFrameDecoder {
  private data: any = Buffer.alloc(0);
  constructor(private readonly maxBytes = 64 * 1024) {}
  push(chunk: any): readonly string[] {
    this.data = Buffer.concat([this.data, typeof chunk === 'string' ? Buffer.from(chunk) : chunk]);
    if (this.data.length > this.maxBytes + 64) throw new Error('ipc-frame-too-large');
    const result: string[] = [];
    while (this.data.length) {
      const colon = this.data.indexOf(0x3a);
      const newline = this.data.indexOf(0x0a);
      if (colon < 0) {
        if (newline >= 0) throw new Error('ipc-frame-header');
        break;
      }
      const match = /^CIIP\/1 ([0-9]{1,7})$/.exec(this.data.subarray(0, colon).toString('ascii'));
      if (!match) throw new Error('ipc-frame-header');
      const length = Number(match[1]);
      if (!Number.isSafeInteger(length) || length < 2 || length > this.maxBytes)
        throw new Error('ipc-frame-length');
      const end = colon + 1 + length + 1;
      if (this.data.length < end) break;
      if (this.data[end - 1] !== 0x0a) throw new Error('ipc-frame-terminator');
      result.push(this.data.subarray(colon + 1, colon + 1 + length).toString('utf8'));
      this.data = this.data.subarray(end);
    }
    return result;
  }
}
