import { describe, expect, it } from 'vitest';
import {
  createOpaqueIdDeriver,
  deriveOpaqueId,
  isOpaqueId,
  opaqueIdEntityTypes,
  OpaqueIdError,
  OPAQUE_ID_KEY_BYTES,
  MAX_OPAQUE_ID_COMPONENT_CODE_UNITS,
  MAX_OPAQUE_ID_COMPONENTS,
} from './index.js';

const key = Uint8Array.from({ length: OPAQUE_ID_KEY_BYTES }, (_, index) => index);
const alternateKey = Uint8Array.from({ length: OPAQUE_ID_KEY_BYTES }, (_, index) => 0xff - index);
const asKey = (value: unknown): Readonly<Uint8Array> => value as Readonly<Uint8Array>;

async function expectSafeFailure(
  action: () => unknown | Promise<unknown>,
  code: string,
  canary?: string,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(OpaqueIdError);
  const error = caught as OpaqueIdError;
  expect(error.code).toBe(code);
  expect(Object.isFrozen(error)).toBe(true);
  if (canary !== undefined) {
    expect(error.message).not.toContain(canary);
    expect(error.stack ?? '').not.toContain(canary);
    expect(JSON.stringify(error)).not.toContain(canary);
  }
}

describe('keyed opaque IDs', () => {
  it('derives a deterministic fixed-format ID for every supported identity domain', async () => {
    const deriver = await createOpaqueIdDeriver(key);
    const ids = new Set<string>();
    for (let index = 0; index < opaqueIdEntityTypes.length; index += 1) {
      const entityType = opaqueIdEntityTypes[index];
      if (entityType === undefined) throw new Error('missing test entity type');
      const id = await deriver.derive(entityType, 'native-identity');
      expect(isOpaqueId(id)).toBe(true);
      expect(id).toHaveLength(48);
      ids.add(id);
      expect(id).toBe(await deriver.derive(entityType, 'native-identity'));
    }
    expect(ids).toHaveLength(opaqueIdEntityTypes.length);
  });

  it('matches an independently fixed HMAC vector and the convenience API', async () => {
    const deriver = await createOpaqueIdDeriver(key);
    const id = await deriver.derive('installation', 'native-identity');
    expect(id).toBe('oid1_gqvR2-eIp46PuNf8w6wLW9TyW1Lpz-PwAdDU8QLvONY');
    expect(await deriveOpaqueId(key, 'installation', 'native-identity')).toBe(id);
  });

  it('separates entity domains, keys, and identifiers', async () => {
    const first = await createOpaqueIdDeriver(key);
    const second = await createOpaqueIdDeriver(alternateKey);
    const byDomain = new Set<string>();
    for (let index = 0; index < opaqueIdEntityTypes.length; index += 1) {
      const entityType = opaqueIdEntityTypes[index];
      if (entityType === undefined) throw new Error('missing test entity type');
      byDomain.add(await first.derive(entityType, 'same-input'));
    }
    expect(byDomain).toHaveLength(opaqueIdEntityTypes.length);
    expect(await first.derive('task', 'same-input')).not.toBe(
      await second.derive('task', 'same-input'),
    );
    expect(await first.derive('task', 'same-input')).not.toBe(
      await first.derive('task', 'different-input'),
    );
  });

  it('canonicalizes Unicode with NFC and preserves case, whitespace, and separators', async () => {
    const deriver = await createOpaqueIdDeriver(key);
    expect(await deriver.derive('workspace', 'café')).toBe(
      await deriver.derive('workspace', 'cafe\u0301'),
    );
    expect(await deriver.derive('workspace', 'Cafe')).not.toBe(
      await deriver.derive('workspace', 'cafe'),
    );
    expect(await deriver.derive('workspace', 'a/b')).not.toBe(
      await deriver.derive('workspace', 'a\\b'),
    );
    expect(await deriver.derive('workspace', ' value ')).not.toBe(
      await deriver.derive('workspace', 'value'),
    );
    expect(await deriver.derive('workspace', '東京/🛸')).toBe(
      await deriver.derive('workspace', '東京/🛸'),
    );
  });

  it('frames namespaces independently and snapshots inputs before asynchronous signing', async () => {
    const deriver = await createOpaqueIdDeriver(key);
    const first = await deriver.derive('task', ['session', 'ab']);
    const second = await deriver.derive('task', ['session', 'a', 'b']);
    expect(first).not.toBe(second);

    const input = ['session', 'stable-task'];
    const expected = await deriver.derive('task', input);
    const pending = deriver.derive('task', input);
    input[1] = 'changed-after-call';
    expect(await pending).toBe(expected);
    expect(await deriver.derive('task', ['session', 'stable-task'])).toBe(expected);
  });

  it('snapshots hostile array length and elements exactly once before signing', async () => {
    const deriver = await createOpaqueIdDeriver(key);
    const expected = await deriver.derive('task', ['session', 'stable-task']);
    const values: [string, string] = ['session', 'stable-task'];
    const reads: [number, number] = [0, 0];
    const input = new Array<string>(2);
    Object.defineProperty(input, '0', {
      configurable: true,
      get: () => {
        reads[0] += 1;
        if (reads[0] > 1) throw new Error('ELEMENT_READ_PRIVACY_CANARY');
        return values[0];
      },
    });
    Object.defineProperty(input, '1', {
      configurable: true,
      get: () => {
        reads[1] += 1;
        if (reads[1] > 1) throw new Error('ELEMENT_READ_PRIVACY_CANARY');
        return values[1];
      },
    });

    const pending = deriver.derive('task', input);
    values[0] = 'changed-after-call';
    values[1] = 'changed-after-call';
    expect(await pending).toBe(expected);
    expect(reads).toEqual([1, 1]);
  });

  it('maps throwing accessors and revoked arrays to bounded errors', async () => {
    const deriver = await createOpaqueIdDeriver(key);
    const throwingInput = new Array<string>(1);
    Object.defineProperty(throwingInput, '0', {
      configurable: true,
      get: () => {
        throw new Error('INPUT_ACCESSOR_PRIVACY_CANARY');
      },
    });
    await expectSafeFailure(
      () => deriver.derive('task', throwingInput),
      'invalid-identifier',
      'INPUT_ACCESSOR_PRIVACY_CANARY',
    );

    const revoked = Proxy.revocable(['session'], {});
    revoked.revoke();
    await expectSafeFailure(
      () => deriver.derive('task', revoked.proxy),
      'invalid-identifier',
      'REVOKED_PROXY_PRIVACY_CANARY',
    );
  });

  it('does not reread a dynamic proxy length or accept a hidden ninth component', async () => {
    const deriver = await createOpaqueIdDeriver(key);
    const target = Array.from(
      { length: MAX_OPAQUE_ID_COMPONENTS + 1 },
      (_, index) => `part-${index}`,
    );
    let lengthReads = 0;
    let elementReads = 0;
    const dynamic = new Proxy(target, {
      get: (current, property, receiver) => {
        if (property === 'length') {
          lengthReads += 1;
          return lengthReads === 1 ? MAX_OPAQUE_ID_COMPONENTS : MAX_OPAQUE_ID_COMPONENTS + 1;
        }
        if (typeof property === 'string' && /^\d+$/.test(property)) elementReads += 1;
        return Reflect.get(current, property, receiver);
      },
    });

    const expected = await deriver.derive('task', target.slice(0, MAX_OPAQUE_ID_COMPONENTS));
    expect(await deriver.derive('task', dynamic)).toBe(expected);
    expect(lengthReads).toBe(1);
    expect(elementReads).toBe(MAX_OPAQUE_ID_COMPONENTS);
  });

  it('has no collisions across a deterministic sanity set', async () => {
    const deriver = await createOpaqueIdDeriver(key);
    const ids = new Set<string>();
    for (let index = 0; index < 512; index += 1)
      ids.add(await deriver.derive('operation', `operation-${index}`));
    expect(ids).toHaveLength(512);
  });

  it('rejects malformed, ambiguous, and oversized inputs with bounded errors', async () => {
    const deriver = await createOpaqueIdDeriver(key);
    const expectCode = async (action: () => Promise<unknown>, code: string) => {
      await expect(action()).rejects.toMatchObject({ name: 'OpaqueIdError', code });
    };
    await expectCode(() => deriver.derive('task', ''), 'invalid-identifier');
    await expectCode(() => deriver.derive('task', '\u0000'), 'invalid-identifier');
    await expectCode(() => deriver.derive('task', '\ud800'), 'invalid-identifier');
    await expectCode(
      () => deriver.derive('task', 'x'.repeat(MAX_OPAQUE_ID_COMPONENT_CODE_UNITS + 1)),
      'identifier-too-large',
    );
    await expectCode(
      () => deriver.derive('task', new Array(MAX_OPAQUE_ID_COMPONENTS + 1).fill('x')),
      'identifier-too-large',
    );
    await expectCode(
      () => deriver.derive('task', ['🛸'.repeat(1_024), '🛸'.repeat(1_024)]),
      'identifier-too-large',
    );
    await expectCode(
      () => deriver.derive('not-a-domain' as never, 'safe-input'),
      'invalid-entity-type',
    );
  });

  it('rejects invalid key sizes before importing key material', async () => {
    await expect(createOpaqueIdDeriver(new Uint8Array(0))).rejects.toMatchObject({
      name: 'OpaqueIdError',
      code: 'invalid-key',
    });
    await expect(
      createOpaqueIdDeriver(new Uint8Array(OPAQUE_ID_KEY_BYTES - 1)),
    ).rejects.toMatchObject({
      name: 'OpaqueIdError',
      code: 'invalid-key',
    });
    await expect(
      createOpaqueIdDeriver(new Uint8Array(OPAQUE_ID_KEY_BYTES + 1)),
    ).rejects.toMatchObject({
      name: 'OpaqueIdError',
      code: 'invalid-key',
    });
  });

  it('rejects wrong-width, DataView, detached, and proxy key inputs safely', async () => {
    const canary = 'KEY_INPUT_PRIVACY_CANARY';
    await expectSafeFailure(
      () => createOpaqueIdDeriver(asKey(new Uint16Array(OPAQUE_ID_KEY_BYTES / 2))),
      'invalid-key',
      canary,
    );
    await expectSafeFailure(
      () => createOpaqueIdDeriver(asKey(new DataView(new ArrayBuffer(OPAQUE_ID_KEY_BYTES)))),
      'invalid-key',
      canary,
    );
    const detached = new Uint8Array(key);
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    await expectSafeFailure(() => createOpaqueIdDeriver(asKey(detached)), 'invalid-key', canary);
    const proxied = new Proxy(new Uint8Array(key), {});
    await expectSafeFailure(() => createOpaqueIdDeriver(asKey(proxied)), 'invalid-key', canary);
    await expectSafeFailure(
      () =>
        createOpaqueIdDeriver(
          asKey({
            get byteLength() {
              throw new Error(canary);
            },
          }),
        ),
      'invalid-key',
      canary,
    );
  });

  it('snapshots key bytes before asynchronous key import', async () => {
    const expected = await deriveOpaqueId(key, 'stream', 'synchronous-key-snapshot');
    const mutableKey = new Uint8Array(key);
    const pending = createOpaqueIdDeriver(mutableKey);
    mutableKey.fill(0xa5);
    const deriver = await pending;
    expect(await deriver.derive('stream', 'synchronous-key-snapshot')).toBe(expected);
  });

  it('copies the key and does not retain mutable raw key or identifier inputs', async () => {
    const mutableKey = new Uint8Array(key);
    const deriver = await createOpaqueIdDeriver(mutableKey);
    const expected = await deriver.derive('stream', 'stable-stream');
    mutableKey.fill(0xa5);
    expect(await deriver.derive('stream', 'stable-stream')).toBe(expected);

    const mutableInput = ['stable-stream'];
    const first = await deriver.derive('stream', mutableInput);
    mutableInput[0] = 'raw-privacy-canary';
    expect(first).toBe(await deriver.derive('stream', 'stable-stream'));
  });

  it('exposes an immutable, serialization-safe public deriver', async () => {
    const deriver = await createOpaqueIdDeriver(key);
    expect(Object.isFrozen(deriver)).toBe(true);
    expect(Object.isFrozen(opaqueIdEntityTypes)).toBe(true);
    expect(JSON.stringify(deriver)).toBe('{}');
    expect(JSON.stringify({ entityTypes: opaqueIdEntityTypes })).not.toContain(
      'raw-privacy-canary',
    );
    expect(Reflect.set(deriver as object, 'key', 'raw-privacy-canary')).toBe(false);
    expect('key' in deriver).toBe(false);
  });

  it('keeps privacy canaries out of IDs and bounded errors', async () => {
    const canary = 'PRIVATE_PATH_SECRET_PASSWORD=https://example.invalid/raw';
    const deriver = await createOpaqueIdDeriver(key);
    const id = await deriver.derive('repository', canary);
    expect(id).not.toContain(canary);
    expect(JSON.stringify({ id })).not.toContain(canary);
    await expect(deriver.derive('repository', `${canary}\u0000`)).rejects.toSatisfy((error) => {
      expect(String(error)).not.toContain(canary);
      return true;
    });
  });

  it('maps arbitrary public error codes to a frozen safe error', () => {
    const canary = 'ARBITRARY_ERROR_CODE_PRIVACY_CANARY';
    const error = new OpaqueIdError(canary as never);
    expect(error.code).toBe('derivation-failed');
    expect(error.message).toBe('opaque id derivation failed: derivation-failed');
    expect(error.message).not.toContain(canary);
    expect(error.stack ?? '').not.toContain(canary);
    expect(JSON.stringify(error)).not.toContain(canary);
    expect(JSON.stringify({ error })).not.toContain(canary);
    expect(Object.isFrozen(error)).toBe(true);
  });

  it('accepts derived IDs and rejects non-canonical final base64url bits', async () => {
    const id = await deriveOpaqueId(key, 'task', 'canonical-id');
    expect(isOpaqueId(id)).toBe(true);
    expect(isOpaqueId(`oid1_${'A'.repeat(42)}B`)).toBe(false);
    expect(isOpaqueId(`oid1_${'A'.repeat(42)}E`)).toBe(true);
    expect(isOpaqueId(`${id}\n`)).toBe(false);
  });
});
