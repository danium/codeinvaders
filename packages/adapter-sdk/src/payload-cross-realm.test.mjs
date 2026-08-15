import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  buildAgentStateChangedPayload,
  buildToolStartedPayload,
  categorizeTool,
  PayloadBuilderError,
} from './index.js';

describe('cross-realm canonical payload inputs', () => {
  it('accepts genuine cross-realm plain records without copying metadata', () => {
    const input = runInNewContext(
      "({ name: 'shell', command: 'PRIVATE_CROSS_REALM_CANARY', unknown: { value: 1 } })",
    );
    expect(categorizeTool(input)).toBe('shell');
    expect(buildToolStartedPayload(input)).toEqual({ name: 'shell', category: 'shell' });
    expect(JSON.stringify(buildToolStartedPayload(input))).not.toContain(
      'PRIVATE_CROSS_REALM_CANARY',
    );
  });

  it('accepts cross-realm plain and null-prototype records but rejects cross-realm proxies', () => {
    const plain = runInNewContext("({ to: 'working' })");
    const nullPrototype = runInNewContext("Object.assign(Object.create(null), { to: 'working' })");
    const proxy = runInNewContext("new Proxy({ name: 'shell' }, {})");
    const nestedProxy = runInNewContext("new Proxy(new Proxy({ name: 'shell' }, {}), {})");
    const stateProxy = runInNewContext("new Proxy({ to: 'working' }, {})");

    for (const input of [plain, nullPrototype]) {
      const payload = buildAgentStateChangedPayload(input);
      expect(payload).toEqual({ to: 'working' });
      expect(Object.getPrototypeOf(payload)).toBe(null);
      expect(Object.isFrozen(payload)).toBe(true);
    }

    expect(categorizeTool(proxy)).toBe('other');
    expect(categorizeTool(nestedProxy)).toBe('other');
    expect(buildToolStartedPayload(proxy)).toEqual({ name: 'other', category: 'other' });
    expect(() => buildAgentStateChangedPayload(stateProxy)).toThrow(PayloadBuilderError);
  });
});
