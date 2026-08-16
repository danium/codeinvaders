import { coreEventFixtureTypes, validEventFixture } from '@codeinvaders/protocol/fixtures';
import {
  canonicalUtf8ByteLength,
  serializeCanonicalEvent,
  validateEvent,
  type CoreEventType,
} from '@codeinvaders/protocol';
import { describe, expect, it } from 'vitest';
import {
  type CanonicalIngressJson,
  MAX_INGRESS_RECORD_BYTES,
  OPAQUE_ID_KEY_BYTES,
  StableRetryEventIdError,
  createOpaqueIdDeriver,
  deriveStableRetryEventId,
  sanitizeIngressRecord,
} from './index.js';

const key = new Uint8Array(OPAQUE_ID_KEY_BYTES);
for (let index = 0; index < key.length; index += 1) key[index] = index;

function acceptedEvent(): Record<string, unknown> {
  return ingressFixture('task.created');
}

const OPAQUE_IDS = {
  event: 'oid1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  stream: 'oid1_EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE',
  epoch: 'oid1_IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII',
  workspace: 'oid1_MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
  session: 'oid1_QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ',
  turn: 'oid1_UUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUU',
  agent: 'oid1_YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY',
  task: 'oid1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  operation: 'oid1_EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE',
  permission: 'oid1_IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII',
  group: 'oid1_MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
} as const;

function ingressFixture(type: CoreEventType): Record<string, unknown> {
  const event = validEventFixture(type);
  event.eventId = OPAQUE_IDS.event;
  const source = event.source as Record<string, unknown>;
  source.streamId = OPAQUE_IDS.stream;
  source.epochId = OPAQUE_IDS.epoch;
  const scope = event.scope as Record<string, unknown>;
  scope.workspaceId = OPAQUE_IDS.workspace;
  scope.sessionId = OPAQUE_IDS.session;
  const scopeIds: Record<string, string> = {
    turnId: OPAQUE_IDS.turn,
    agentId: OPAQUE_IDS.agent,
    taskId: OPAQUE_IDS.task,
    operationId: OPAQUE_IDS.operation,
    permissionId: OPAQUE_IDS.permission,
  };
  for (const key of Object.keys(scopeIds)) if (scope[key] !== undefined) scope[key] = scopeIds[key];
  const data = event.data as Record<string, unknown>;
  if (type === 'task.assigned') data.assigneeAgentId = OPAQUE_IDS.agent;
  if (type === 'task.corrected') {
    data.correctedEventId = OPAQUE_IDS.event;
    data.correctedEntityId = OPAQUE_IDS.task;
    const semantic = event.semantic as Record<string, unknown>;
    semantic.correctionOfEventId = OPAQUE_IDS.event;
    semantic.correctionOfEntityId = OPAQUE_IDS.task;
  }
  if (type === 'task.plan.reconciled') {
    const items = data.items as Array<Record<string, unknown>>;
    for (const item of items) item.taskId = OPAQUE_IDS.task;
  }
  if (type === 'tool.requested') data.parallelGroupId = OPAQUE_IDS.group;
  return event;
}

describe('sanitized adapter ingress', () => {
  it('keeps only protocol-safe fields and never persists native text', () => {
    const canary = 'INGRESS_NATIVE_CANARY prompt command /private/path https://secret.invalid';
    const event = acceptedEvent();
    const source = event.source as Record<string, unknown>;
    const data = event.data as Record<string, unknown>;
    source.nativeEvent = canary;
    source.nativeToken = 'native-token';
    data.label = canary;
    data.description = canary;
    data.command = canary;
    data.output = canary;
    event.extra = canary;

    const result = sanitizeIngressRecord(event);
    expect(result.status).toBe('accepted');
    if (result.status !== 'accepted') return;
    const serialized = result.canonicalJson;
    expect(serialized).not.toContain(canary);
    expect(serialized).not.toContain('nativeEvent');
    expect(serialized).not.toContain('nativeToken');
    expect(serialized).not.toContain('description');
    expect(result.record.data).not.toHaveProperty('label');
    expect(Object.getPrototypeOf(result.record)).toBeNull();
    expect(Object.isFrozen(result.record)).toBe(true);
  });

  it('validates before exposing any transport representation and reports bounded diagnostics', () => {
    const event = acceptedEvent();
    delete event.scope;
    const result = sanitizeIngressRecord(event);
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') return;
    expect(result).not.toHaveProperty('canonicalJson');
    expect(result).not.toHaveProperty('handoff');
    expect(result).not.toHaveProperty('record');
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toEqual({
      code: 'native-field-invalid',
      severity: 'error',
      boundary: 'adapter',
    });
    expect(JSON.stringify(result)).not.toContain('INGRESS_NATIVE_CANARY');
  });

  it('enforces the explicit UTF-8 per-record limit', () => {
    const event = acceptedEvent();
    const oversized = 'x'.repeat(MAX_INGRESS_RECORD_BYTES + 1);
    (event as Record<string, unknown>).oversized = oversized;
    const result = sanitizeIngressRecord(event);
    expect(result.status).toBe('accepted');
    // Unknown fields are allowlist-dropped, so a native oversized field cannot
    // inflate a sanitized record. A known protocol field is still bounded.
    const knownOversized = acceptedEvent();
    (knownOversized.data as Record<string, unknown>).description = oversized;
    const knownResult = sanitizeIngressRecord(knownOversized);
    expect(knownResult.status).toBe('accepted');
    if (knownResult.status === 'accepted')
      expect(knownResult.byteLength).toBeLessThanOrEqual(MAX_INGRESS_RECORD_BYTES);
  });

  it('derives deterministic opaque retry IDs without returning the logical key', async () => {
    const deriver = await createOpaqueIdDeriver(key);
    const first = await deriveStableRetryEventId(deriver, ['tool.completed', 'native-use-7']);
    const second = await deriveStableRetryEventId(deriver, ['tool.completed', 'native-use-7']);
    const different = await deriveStableRetryEventId(deriver, ['tool.completed', 'native-use-8']);
    expect(first).toBe(second);
    expect(first).not.toBe(different);
    expect(first).toMatch(/^oid1_[A-Za-z0-9_-]{43}$/);
    expect(first).not.toContain('native-use-7');
  });

  it('uses a stable retry ID in the sanitized event and keeps it across retries', async () => {
    const deriver = await createOpaqueIdDeriver(key);
    const stableEventId = await deriveStableRetryEventId(deriver, [
      'session.started',
      'checkpoint-1',
    ]);
    const first = sanitizeIngressRecord(acceptedEvent(), { stableEventId });
    const second = sanitizeIngressRecord(acceptedEvent(), { stableEventId });
    expect(first.status).toBe('accepted');
    expect(second.status).toBe('accepted');
    if (first.status !== 'accepted' || second.status !== 'accepted') return;
    expect(first.eventId).toBe(stableEventId);
    expect(second.eventId).toBe(stableEventId);
    expect(first.canonicalJson).toBe(second.canonicalJson);
  });

  it('accepts every canonical core fixture and preserves safe tool names', () => {
    for (const type of coreEventFixtureTypes) {
      const result = sanitizeIngressRecord(ingressFixture(type));
      expect(result.status, type).toBe('accepted');
      if (result.status !== 'accepted') continue;
      expect(validateEvent(JSON.parse(result.canonicalJson)).status, type).toBe('accepted');
      expect(result.canonicalJson).toBe(serializeCanonicalEvent(result.record));
      if (type.startsWith('tool.')) {
        const data = result.record.data as Record<string, unknown>;
        expect(data.name, type).toBe('shell');
        expect(data.category, type).toBe('shell');
      }
    }
  });

  it('exposes only immutable canonical text and an exact text handoff', () => {
    const result = sanitizeIngressRecord(acceptedEvent());
    expect(result.status).toBe('accepted');
    if (result.status !== 'accepted') return;
    const canonicalJson = result.canonicalJson;
    const handedOff: string[] = [];
    expect(
      result.handoff((text: CanonicalIngressJson) => {
        handedOff.push(text);
        expect(validateEvent(JSON.parse(text)).status).toBe('accepted');
      }),
    ).toEqual({ status: 'written' });
    expect(handedOff).toEqual([canonicalJson]);
    expect(result.canonicalJson).toBe(canonicalJson);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.record)).toBe(true);
    expect('bytes' in result).toBe(false);
    expect(Reflect.set(result, 'canonicalJson', 'tampered')).toBe(false);
    expect(Reflect.set(result.record, 'eventId', 'tampered')).toBe(false);
    expect(result.canonicalJson).toBe(canonicalJson);
  });

  it('makes invalid, throwing, and reentrant handoffs observable without native errors', () => {
    const result = sanitizeIngressRecord(acceptedEvent());
    expect(result.status).toBe('accepted');
    if (result.status !== 'accepted') return;
    expect(result.handoff(undefined)).toEqual({ status: 'rejected', code: 'writer-invalid' });
    const secret = 'HANDOFF_NATIVE_ERROR_CANARY';
    expect(
      result.handoff(() => {
        throw new Error(secret);
      }),
    ).toEqual({ status: 'rejected', code: 'writer-failed' });
    let nested: ReturnType<typeof result.handoff> | undefined;
    const handedOff: string[] = [];
    const outer = result.handoff((text: CanonicalIngressJson) => {
      handedOff.push(text);
      nested = result.handoff(() => handedOff.push(text));
    });
    expect(outer).toEqual({ status: 'written' });
    expect(nested).toEqual({ status: 'rejected', code: 'writer-reentrant' });
    expect(handedOff).toEqual([result.canonicalJson]);
    expect(
      JSON.stringify(
        result.handoff(() => {
          throw new Error(secret);
        }),
      ),
    ).not.toContain(secret);
  });

  it('rejects every raw identity slot and keeps closed metadata closed', () => {
    const cases: readonly [CoreEventType, (event: Record<string, unknown>) => void][] = [
      [
        'session.started',
        (event) => {
          event.eventId = 'Credential_CANARY';
        },
      ],
      [
        'session.started',
        (event) => {
          (event.source as Record<string, unknown>).streamId = 'Credential_CANARY';
        },
      ],
      [
        'session.started',
        (event) => {
          (event.source as Record<string, unknown>).epochId = 'Credential_CANARY';
        },
      ],
      [
        'session.started',
        (event) => {
          (event.scope as Record<string, unknown>).workspaceId = 'Credential_CANARY';
        },
      ],
      [
        'session.started',
        (event) => {
          (event.scope as Record<string, unknown>).sessionId = 'Credential_CANARY';
        },
      ],
      [
        'session.started',
        (event) => {
          (event.source as Record<string, unknown>).adapterId = 'Credential_CANARY';
        },
      ],
      [
        'session.started',
        (event) => {
          (event.source as Record<string, unknown>).adapterVersion = '1.0.0+Credential_CANARY';
        },
      ],
      [
        'session.started',
        (event) => {
          event.version = '1.0.0+Credential_CANARY';
        },
      ],
      [
        'source.connected',
        (event) => {
          (event.data as Record<string, unknown>).agentKind = 'Credential_CANARY';
        },
      ],
      [
        'source.connected',
        (event) => {
          (event.data as Record<string, unknown>).agentVersion = '1.0.0+Credential_CANARY';
        },
      ],
      [
        'source.connected',
        (event) => {
          const capabilities = (event.data as Record<string, unknown>).capabilities as Record<
            string,
            unknown
          >;
          const platform = capabilities.platform as Record<string, unknown>;
          platform.configId = 'Credential_CANARY';
        },
      ],
      [
        'source.connected',
        (event) => {
          const capabilities = (event.data as Record<string, unknown>).capabilities as Record<
            string,
            unknown
          >;
          const session = capabilities.session as Record<string, unknown>;
          session.configurationId = 'Credential_CANARY';
        },
      ],
      [
        'session.started',
        (event) => {
          event.links = { correlationId: 'Credential_CANARY' };
        },
      ],
      [
        'task.corrected',
        (event) => {
          event.semantic = {
            kind: 'correction',
            terminal: false,
            correctionOfEventId: 'Credential_CANARY',
            correctionOfEntityId: OPAQUE_IDS.task,
          };
        },
      ],
      [
        'task.assigned',
        (event) => {
          (event.data as Record<string, unknown>).assigneeAgentId = 'Credential_CANARY';
        },
      ],
      [
        'task.plan.reconciled',
        (event) => {
          const first = (
            (event.data as Record<string, unknown>).items as Array<Record<string, unknown>>
          )[0];
          if (first !== undefined) first.taskId = 'Credential_CANARY';
        },
      ],
      [
        'task.corrected',
        (event) => {
          (event.data as Record<string, unknown>).correctedEventId = 'Credential_CANARY';
        },
      ],
      [
        'task.corrected',
        (event) => {
          (event.data as Record<string, unknown>).correctedEntityId = 'Credential_CANARY';
        },
      ],
      [
        'tool.requested',
        (event) => {
          (event.data as Record<string, unknown>).parallelGroupId = 'Credential_CANARY';
        },
      ],
    ];
    for (const [type, poison] of cases) {
      const event = ingressFixture(type);
      poison(event);
      const result = sanitizeIngressRecord(event);
      expect(JSON.stringify(result), type).not.toContain('Credential_CANARY');
      expect(result.status, type).toBe('rejected');
    }
  });

  it('maps arbitrary tool names to the closed generic code', () => {
    const event = ingressFixture('tool.completed');
    const data = event.data as Record<string, unknown>;
    data.name = 'vendor_tool_PRIVATE_CANARY';
    data.category = 'shell';
    const result = sanitizeIngressRecord(event);
    expect(result.status).toBe('accepted');
    if (result.status !== 'accepted') return;
    expect(result.record.data).toEqual({
      name: 'other',
      category: 'other',
      durationMs: 1,
      resultClass: 'success',
    });
    expect(result.canonicalJson).not.toContain('vendor_tool_PRIVATE_CANARY');
  });

  it('resists TextEncoder.prototype.encode poisoning after module import', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(TextEncoder.prototype, 'encode');
    expect(originalDescriptor).toBeDefined();
    const baseline = sanitizeIngressRecord(acceptedEvent());
    expect(baseline.status).toBe('accepted');
    if (baseline.status !== 'accepted') return;
    try {
      Object.defineProperty(TextEncoder.prototype, 'encode', {
        configurable: originalDescriptor?.configurable ?? true,
        enumerable: originalDescriptor?.enumerable ?? false,
        writable: originalDescriptor?.writable ?? true,
        value: () => new Uint8Array([0x58, 0x2d, 0x50, 0x4f, 0x49, 0x53, 0x4f, 0x4e]),
      });
      const result = sanitizeIngressRecord(acceptedEvent());
      expect(result.status).toBe('accepted');
      if (result.status !== 'accepted') return;
      expect(result.canonicalJson).toBe(baseline.canonicalJson);
      expect(validateEvent(JSON.parse(result.canonicalJson)).status).toBe('accepted');
      expect(result.canonicalJson).not.toBe('X-POISON');
    } finally {
      if (originalDescriptor === undefined)
        delete (TextEncoder.prototype as { encode?: unknown }).encode;
      else Object.defineProperty(TextEncoder.prototype, 'encode', originalDescriptor);
    }
  });

  it('fails safely for accessors, proxies, cycles, wide values, and mutable input races', async () => {
    const event = acceptedEvent();
    let reads = 0;
    Object.defineProperty(event, 'eventId', {
      configurable: true,
      enumerable: true,
      get: () => {
        reads += 1;
        throw new Error('INGRESS_ACCESSOR_CANARY');
      },
    });
    const accessorResult = sanitizeIngressRecord(event);
    expect(accessorResult.status).toBe('rejected');
    expect(reads).toBe(0);

    const revoked = Proxy.revocable(acceptedEvent(), {});
    revoked.revoke();
    expect(sanitizeIngressRecord(revoked.proxy).status).toBe('rejected');

    const cyclic = acceptedEvent();
    cyclic.cycle = cyclic;
    expect(() => sanitizeIngressRecord(cyclic)).not.toThrow();

    const wide = acceptedEvent();
    for (let index = 0; index < 2_000; index += 1) wide[`unknown-${index}`] = index;
    expect(() => sanitizeIngressRecord(wide)).not.toThrow();

    const deriver = await createOpaqueIdDeriver(key);
    const logicalKey = ['event', 'race'];
    const idPromise = deriveStableRetryEventId(deriver, logicalKey);
    logicalKey[1] = 'changed-after-snapshot';
    expect(await idPromise).toBe(await deriveStableRetryEventId(deriver, ['event', 'race']));
  });

  it('rejects hostile retry keys and derivers with fixed errors', async () => {
    const secret = 'RETRY_SECRET_SHOULD_NOT_ESCAPE';
    const accessorKey: unknown[] = [];
    Object.defineProperty(accessorKey, '0', {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error(secret);
      },
    });
    let caught: unknown;
    try {
      await deriveStableRetryEventId(await createOpaqueIdDeriver(key), accessorKey);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(StableRetryEventIdError);
    expect((caught as Error).message).not.toContain(secret);
    expect((caught as Error).stack ?? '').not.toContain(secret);

    const hostileDeriver = {
      derive: () => {
        throw new Error(secret);
      },
    };
    try {
      await deriveStableRetryEventId(hostileDeriver as never, 'safe-key');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(StableRetryEventIdError);
    expect((caught as Error).message).not.toContain(secret);
  });

  it('bounds retry-key work without scanning attacker-wide properties', async () => {
    const wide = ['wide-key'];
    for (let index = 0; index < 100_000; index += 1)
      Object.defineProperty(wide, `wide-${index}`, { configurable: true, value: index });
    const originalOwnKeys = Reflect.ownKeys;
    try {
      Reflect.ownKeys = (() => {
        throw new Error('RETRY_OWN_KEYS_CANARY');
      }) as typeof Reflect.ownKeys;
      const started = performance.now();
      const id = await deriveStableRetryEventId(await createOpaqueIdDeriver(key), wide);
      const elapsed = performance.now() - started;
      expect(id).toMatch(/^oid1_[A-Za-z0-9_-]{43}$/);
      expect(elapsed).toBeLessThan(1_000);
    } finally {
      Reflect.ownKeys = originalOwnKeys;
    }
  });

  it('uses exact UTF-8 lengths and genuine intrinsics after global poisoning', () => {
    const multibyte = '😀'.repeat(MAX_INGRESS_RECORD_BYTES / 4);
    expect(canonicalUtf8ByteLength(multibyte)).toBe(MAX_INGRESS_RECORD_BYTES);
    const oversizedPlan = ingressFixture('task.plan.reconciled');
    const items = (oversizedPlan.data as Record<string, unknown>).items as Array<
      Record<string, unknown>
    >;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    items.length = 1_024;
    for (let index = 0; index < items.length; index += 1) {
      const first = alphabet[Math.floor(index / alphabet.length) % alphabet.length];
      const second = alphabet[index % alphabet.length];
      items[index] = {
        taskId: `oid1_${first}${second}${'A'.repeat(41)}`,
        status: 'pending',
        ordinal: index,
        identityBasis: 'stable-native-id',
      };
    }
    const originalByteLength = Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'byteLength');
    const originalFreeze = Object.freeze;
    try {
      Object.defineProperty(Uint8Array.prototype, 'byteLength', {
        configurable: true,
        get: () => 0,
      });
      Object.freeze = (() => {
        throw new Error('FREEZE_POISON');
      }) as typeof Object.freeze;
      const result = sanitizeIngressRecord(acceptedEvent());
      expect(result.status).toBe('accepted');
      if (result.status === 'accepted') {
        expect(result.byteLength).toBe(canonicalUtf8ByteLength(result.canonicalJson));
        expect(Object.isFrozen(result.record)).toBe(true);
        const nested = result.record.scope as object;
        expect(Object.isFrozen(nested)).toBe(true);
      }
      expect(sanitizeIngressRecord(oversizedPlan).status).toBe('rejected');
    } finally {
      Object.freeze = originalFreeze;
      if (originalByteLength === undefined)
        delete (Uint8Array.prototype as { byteLength?: unknown }).byteLength;
      else Object.defineProperty(Uint8Array.prototype, 'byteLength', originalByteLength);
    }
  });

  it('does not depend on mutable global freeze or array mutation helpers', () => {
    const originalFreeze = Object.freeze;
    const originalPush = Array.prototype.push;
    try {
      Array.prototype.push = (() => {
        throw new Error('INGRESS_PUSH_CANARY');
      }) as typeof Array.prototype.push;
      for (const poisonedFreeze of [
        () => undefined,
        () => {
          throw new Error('INGRESS_FREEZE_CANARY');
        },
      ]) {
        Object.freeze = poisonedFreeze as unknown as typeof Object.freeze;
        const result = sanitizeIngressRecord(acceptedEvent());
        expect(result.status).toBe('accepted');
        if (result.status === 'accepted') {
          expect(Object.isFrozen(result.record)).toBe(true);
          expect(Object.isFrozen(result.record.scope)).toBe(true);
          expect(result.canonicalJson).toBe(serializeCanonicalEvent(result.record));
        }
        expect(JSON.stringify(result)).not.toContain('INGRESS_FREEZE_CANARY');
        expect(JSON.stringify(result)).not.toContain('INGRESS_PUSH_CANARY');
      }
    } finally {
      Object.freeze = originalFreeze;
      Array.prototype.push = originalPush;
    }
  });

  it('keeps accepted ingress exact after post-import serializer poisoning', () => {
    const baseline = sanitizeIngressRecord(acceptedEvent());
    expect(baseline.status).toBe('accepted');
    if (baseline.status !== 'accepted') return;
    const hostileEvent = acceptedEvent();
    const originalKeys = Object.keys;
    const originalStringify = JSON.stringify;
    const originalCall = Function.prototype.call;
    const originalApply = Function.prototype.apply;
    const originalReflectApply = Reflect.apply;
    let result: ReturnType<typeof sanitizeIngressRecord> | undefined;
    let thrown: unknown;
    try {
      Object.keys = (() => []) as typeof Object.keys;
      JSON.stringify = (() => '{"INGRESS_SERIALIZER_POISON_CANARY":true}') as typeof JSON.stringify;
      Function.prototype.call = (() => {
        throw new Error('INGRESS_FUNCTION_CALL_POISON_CANARY');
      }) as typeof Function.prototype.call;
      Function.prototype.apply = (() => {
        throw new Error('INGRESS_FUNCTION_APPLY_POISON_CANARY');
      }) as typeof Function.prototype.apply;
      Reflect.apply = (() => {
        throw new Error('INGRESS_REFLECT_APPLY_POISON_CANARY');
      }) as typeof Reflect.apply;
      try {
        result = sanitizeIngressRecord(hostileEvent);
      } catch (error) {
        thrown = error;
      }
    } finally {
      Object.keys = originalKeys;
      JSON.stringify = originalStringify;
      Function.prototype.call = originalCall;
      Function.prototype.apply = originalApply;
      Reflect.apply = originalReflectApply;
    }

    expect(thrown).toBeUndefined();
    expect(result?.status).toBe('accepted');
    if (result?.status !== 'accepted') return;
    expect(result.canonicalJson).toBe(baseline.canonicalJson);
    expect(result.canonicalJson).toBe(serializeCanonicalEvent(result.record));
    expect(result.byteLength).toBe(canonicalUtf8ByteLength(result.canonicalJson));
    const parsed = JSON.parse(result.canonicalJson);
    expect(validateEvent(parsed).status).toBe('accepted');
    expect(parsed).toEqual(result.record);
    expect(result.canonicalJson).not.toContain('POISON_CANARY');
  });

  it('rejects native SemVer canaries after RegExp.prototype.test poisoning', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(RegExp.prototype, 'test');
    expect(originalDescriptor).toBeDefined();
    const canary = 'ADAPTER_REGEXP_NATIVE_CANARY';
    const event = acceptedEvent();
    (event.source as Record<string, unknown>).adapterVersion = canary;
    let result: ReturnType<typeof sanitizeIngressRecord> | undefined;
    let thrown: unknown;
    try {
      Object.defineProperty(RegExp.prototype, 'test', {
        configurable: originalDescriptor?.configurable ?? true,
        enumerable: originalDescriptor?.enumerable ?? false,
        writable: originalDescriptor?.writable ?? true,
        value: () => true,
      });
      try {
        result = sanitizeIngressRecord(event);
      } catch (error) {
        thrown = error;
      }
    } finally {
      if (originalDescriptor === undefined) delete (RegExp.prototype as { test?: unknown }).test;
      else Object.defineProperty(RegExp.prototype, 'test', originalDescriptor);
    }
    expect(thrown).toBeUndefined();
    expect(result?.status).toBe('rejected');
    expect(JSON.stringify(result)).not.toContain(canary);
    expect(originalDescriptor).toEqual(Object.getOwnPropertyDescriptor(RegExp.prototype, 'test'));
  });
});
