import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  OPAQUE_ID_KEY_BYTES,
  createOpaqueIdDeriver,
  deriveStableRetryEventId,
  sanitizeIngressRecord,
} from './index.js';

const key = new Uint8Array(OPAQUE_ID_KEY_BYTES);
for (let index = 0; index < key.length; index += 1) key[index] = index;

function crossRealmEvent() {
  return runInNewContext(`({
    spec: 'io.github.danium.codeinvaders.aap',
    version: '1.0.0',
    eventId: 'oid1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    type: 'session.started',
    occurredAt: '2026-08-15T14:22:31.120Z',
    observedAt: '2026-08-15T14:22:31.127Z',
    sequence: 1,
    source: {
      adapterId: 'adapter-1', adapterVersion: '0.1.0',
      streamId: 'oid1_EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE', epochId: 'oid1_IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII',
      nativeEvent: 'CROSS_REALM_NATIVE_CANARY'
    },
    scope: { workspaceId: 'oid1_MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM', sessionId: 'oid1_QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ' },
    fidelity: 'observed',
    finality: 'confirmed',
    data: { resume: false, label: 'CROSS_REALM_LABEL_CANARY' }
  })`);
}

describe('cross-realm sanitized ingress', () => {
  it('accepts genuine records while omitting native-bearing fields', () => {
    const result = sanitizeIngressRecord(crossRealmEvent());
    expect(result.status).toBe('accepted');
    if (result.status !== 'accepted') return;
    const text = result.canonicalJson;
    expect(text).not.toContain('CROSS_REALM_NATIVE_CANARY');
    expect(text).not.toContain('CROSS_REALM_LABEL_CANARY');
    expect(Object.getPrototypeOf(result.record)).toBe(null);
  });

  it('rejects cross-realm proxies without invoking their traps', () => {
    const proxy = runInNewContext(`new Proxy({}, {
      ownKeys() { throw new Error('CROSS_REALM_PROXY_CANARY'); },
      getPrototypeOf() { throw new Error('CROSS_REALM_PROXY_CANARY'); }
    })`);
    expect(() => sanitizeIngressRecord(proxy)).not.toThrow();
    expect(sanitizeIngressRecord(proxy).status).toBe('rejected');
  });

  it('snapshots a cross-realm retry key before asynchronous derivation', async () => {
    const deriver = await createOpaqueIdDeriver(key);
    const logicalKey = runInNewContext("['tool.completed', 'cross-realm-use-1']");
    const id = await deriveStableRetryEventId(deriver, logicalKey);
    expect(id).toMatch(/^oid1_[A-Za-z0-9_-]{43}$/);
    expect(id).not.toContain('cross-realm-use-1');
  });
});
