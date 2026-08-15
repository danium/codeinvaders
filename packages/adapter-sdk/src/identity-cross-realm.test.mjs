import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { deriveOpaqueId } from './index.js';

const key = Uint8Array.from({ length: 32 }, (_, index) => index);

describe('cross-realm opaque ID keys', () => {
  it('accepts genuine cross-realm Uint8Array and other one-byte views', async () => {
    const expected = await deriveOpaqueId(key, 'stream', 'cross-realm-key');
    const crossRealmUint8 = runInNewContext('Uint8Array.from({ length: 32 }, (_, index) => index)');
    const crossRealmInt8 = runInNewContext('Int8Array.from({ length: 32 }, (_, index) => index)');
    const crossRealmClamped = runInNewContext(
      'Uint8ClampedArray.from({ length: 32 }, (_, index) => index)',
    );

    expect(await deriveOpaqueId(crossRealmUint8, 'stream', 'cross-realm-key')).toBe(expected);
    expect(await deriveOpaqueId(crossRealmInt8, 'stream', 'cross-realm-key')).toBe(expected);
    expect(await deriveOpaqueId(crossRealmClamped, 'stream', 'cross-realm-key')).toBe(expected);
    expect(await deriveOpaqueId(new Int8Array(key), 'stream', 'cross-realm-key')).toBe(expected);
    expect(await deriveOpaqueId(new Uint8ClampedArray(key), 'stream', 'cross-realm-key')).toBe(
      expected,
    );
  });
});
