import { describe, expect, it } from 'vitest';
import { MAX_JSON_DEPTH, validateEvent, type CoreEventType } from '@codeinvaders/protocol';
import { validEventFixture } from '@codeinvaders/protocol/fixtures';
import {
  buildAgentFinishedPayload,
  buildAgentSpawnedPayload,
  buildAgentStateChangedPayload,
  buildPermissionPayload,
  buildPermissionRequestedPayload,
  buildPermissionResolvedPayload,
  buildSessionEndedPayload,
  buildSessionStartedPayload,
  buildTaskAbandonedPayload,
  buildTaskAssignedPayload,
  buildTaskCancelledPayload,
  buildTaskCompletedPayload,
  buildTaskCompletionRequestedPayload,
  buildTaskCreatedPayload,
  buildTaskDeniedPayload,
  buildTaskFailedPayload,
  buildTaskUpdatedPayload,
  buildToolCompletedPayload,
  buildToolFailedPayload,
  buildToolPayload,
  buildToolRequestedPayload,
  buildToolStartedPayload,
  buildTurnFinishedPayload,
  buildTurnQuiescentPayload,
  buildWorkspaceDiscoveredPayload,
  categorizeTool,
  createOpaqueIdDeriver,
  OPAQUE_ID_KEY_BYTES,
  PayloadBuilderError,
} from './index.js';

const key = Uint8Array.from({ length: OPAQUE_ID_KEY_BYTES }, (_, index) => index);

describe('allowlist-only canonical payload builders', () => {
  it('maps known native names to fixed canonical codes and ignores extra fields', () => {
    const canary = 'PAYLOAD_CANARY /workspace/repo?token=1';
    const payload = buildToolStartedPayload({
      name: 'apply_patch',
      label: canary,
      command: canary,
      arguments: canary,
      output: canary,
      hostname: canary,
      unknown: { canary },
    });
    expect(payload).toEqual({ name: 'edit', category: 'edit' });
    expect(JSON.stringify(payload)).not.toContain(canary);
    expect(Object.isFrozen(payload)).toBe(true);
  });

  it('uses generic payload defaults for unknown and MCP tools', () => {
    expect(buildToolPayload('unrecognized-native-tool')).toEqual({
      name: 'other',
      category: 'other',
    });
    expect(buildToolPayload({ name: 'mcp__private-server__private-tool' })).toEqual({
      name: 'mcp',
      category: 'mcp',
    });
    expect(buildToolPayload({ serverName: 'private-server', toolName: 'private-tool' })).toEqual({
      name: 'mcp',
      category: 'mcp',
    });
  });

  it('builds each tool phase with only its protocol fields', () => {
    expect(buildToolRequestedPayload({ name: 'shell', durationMs: 3 })).toEqual({
      name: 'shell',
      category: 'shell',
    });
    expect(buildToolStartedPayload({ name: 'shell' })).toEqual({
      name: 'shell',
      category: 'shell',
    });
    expect(
      buildToolCompletedPayload({
        name: 'shell',
        durationMs: 17,
        resultClass: 'success',
        parallelGroupId: 'oid1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB',
        output: 'x',
      }),
    ).toEqual({
      name: 'shell',
      category: 'shell',
      durationMs: 17,
      resultClass: 'success',
    });
    expect(
      Object.keys(
        buildToolCompletedPayload({
          name: 'shell',
          durationMs: 17,
          resultClass: 'success',
          parallelGroupId: 'oid1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB',
        }),
      ),
    ).toEqual(['name', 'category', 'durationMs', 'resultClass']);
    expect(buildToolFailedPayload({ name: 'shell', failureClass: 'exit_nonzero' })).toEqual({
      name: 'shell',
      category: 'shell',
      failureClass: 'exit_nonzero',
    });
    expect(
      Object.keys(
        buildToolFailedPayload({
          name: 'shell',
          failureClass: 'timeout',
          parallelGroupId: 'oid1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB',
        }),
      ),
    ).toEqual(['name', 'category', 'failureClass']);
    expect(
      buildToolFailedPayload({ name: 'unknown', failureClass: 'native exception text' }),
    ).toEqual({
      name: 'other',
      category: 'other',
      failureClass: 'unknown',
    });
  });

  it('accepts only bounded scalar optionals and opaque IDs', async () => {
    const deriver = await createOpaqueIdDeriver(key);
    const groupId = await deriver.derive('operation', 'parallel-group');
    expect(buildToolRequestedPayload({ name: 'shell', parallelGroupId: groupId })).toEqual({
      name: 'shell',
      category: 'shell',
      parallelGroupId: groupId,
    });
    expect(
      buildToolRequestedPayload({
        name: 'shell',
        parallelGroupId: 'raw-native-parallel-id',
      }),
    ).toEqual({ name: 'shell', category: 'shell' });

    expect(buildToolCompletedPayload({ name: 'shell', durationMs: 0 })).toEqual({
      name: 'shell',
      category: 'shell',
      durationMs: 0,
    });
    expect(
      buildToolCompletedPayload({ name: 'shell', durationMs: Number.MAX_SAFE_INTEGER }),
    ).toEqual({
      name: 'shell',
      category: 'shell',
      durationMs: Number.MAX_SAFE_INTEGER,
    });
    expect(buildToolCompletedPayload({ name: 'shell', durationMs: -1 })).toEqual({
      name: 'shell',
      category: 'shell',
    });
    expect(buildToolCompletedPayload({ name: 'shell', durationMs: 1.5 })).toEqual({
      name: 'shell',
      category: 'shell',
    });
    expect(buildToolCompletedPayload({ name: 'shell', durationMs: Infinity })).toEqual({
      name: 'shell',
      category: 'shell',
    });
  });

  it('builds permission payloads from categories and closed risk/outcome enums', () => {
    expect(buildPermissionPayload({ name: 'apply_patch', riskClass: 'write' })).toEqual({
      category: 'edit',
      riskClass: 'write',
    });
    expect(buildPermissionPayload({ name: 'mcp__server__tool', riskClass: 'execute' })).toEqual({
      category: 'mcp',
      riskClass: 'execute',
    });
    expect(buildPermissionPayload({ name: 'unknown', riskClass: 'command --secret' })).toEqual({
      category: 'other',
    });
    expect(buildPermissionPayload({ outcome: 'denied' }, 'resolved')).toEqual({
      outcome: 'denied',
    });
    expect(
      buildPermissionPayload({ outcome: 'raw error https://example.invalid' }, 'resolved'),
    ).toEqual({
      outcome: 'unknown',
    });
  });

  it('builds task payloads without labels, descriptions, or native IDs', async () => {
    const canary = 'TASK_CANARY source code /secret';
    const deriver = await createOpaqueIdDeriver(key);
    const agentId = await deriver.derive('agent', 'native-agent-id');

    expect(
      buildTaskCreatedPayload({
        status: 'in_progress',
        ordinal: 0,
        fallback: false,
        label: canary,
        description: canary,
        nativeId: canary,
      }),
    ).toEqual({ status: 'in_progress', ordinal: 0, fallback: false });
    expect(buildTaskCreatedPayload({ status: 'not-a-status', fallback: 'yes' })).toEqual({
      status: 'unknown',
      fallback: false,
    });
    expect(
      buildTaskUpdatedPayload({
        status: 'completed',
        ordinal: Number.MAX_SAFE_INTEGER,
        label: canary,
      }),
    ).toEqual({
      status: 'completed',
      ordinal: Number.MAX_SAFE_INTEGER,
    });
    expect(buildTaskUpdatedPayload({ status: canary, ordinal: -1 })).toEqual({});
    expect(buildTaskAssignedPayload({ assigneeAgentId: agentId, name: canary })).toEqual({
      assigneeAgentId: agentId,
    });
    expect(buildTaskAssignedPayload({ assigneeAgentId: canary })).toEqual({});
    expect(
      JSON.stringify(buildTaskCreatedPayload({ label: canary, description: canary })),
    ).not.toContain(canary);
  });

  it('keeps task lifecycle reasons and outcomes closed and conservative', () => {
    expect(buildTaskCompletionRequestedPayload({ checkpoint: 'native' })).toEqual({
      requestedStatus: 'completed',
      checkpoint: 'native',
    });
    expect(buildTaskCompletionRequestedPayload({ checkpoint: 'raw' })).toEqual({
      requestedStatus: 'completed',
      checkpoint: 'native',
    });
    expect(buildTaskCompletedPayload({ completion: 'raw' })).toEqual({ completion: 'observed' });
    expect(buildTaskFailedPayload({ category: 'validation' })).toEqual({ category: 'validation' });
    expect(buildTaskFailedPayload({ category: 'shell' })).toEqual({ category: 'unknown' });
    expect(buildTaskDeniedPayload({ reason: 'permission' })).toEqual({ reason: 'permission' });
    expect(buildTaskCancelledPayload({ reason: 'replanned' })).toEqual({ reason: 'replanned' });
    expect(buildTaskAbandonedPayload({ reason: 'telemetry-gap' })).toEqual({
      reason: 'telemetry-gap',
    });
    expect(buildTaskAbandonedPayload({ reason: 'successful' })).toEqual({ reason: 'unknown' });
  });

  it('builds other simple protocol payloads with bounded defaults', () => {
    expect(buildAgentSpawnedPayload({ role: 'worker', depth: 2, label: 'private' })).toEqual({
      role: 'worker',
      depth: 2,
    });
    expect(buildAgentSpawnedPayload({ role: 'unknown role', depth: -1 })).toEqual({
      role: 'unknown',
      depth: 0,
    });
    expect(
      buildAgentStateChangedPayload({ to: 'working', from: 'starting', reason: 'tool' }),
    ).toEqual({
      to: 'working',
      from: 'starting',
      reason: 'tool',
    });
    expect(buildAgentFinishedPayload({ outcome: 'invalid' })).toEqual({ outcome: 'unknown' });
    expect(buildTurnFinishedPayload({ outcome: 'partial' })).toEqual({ outcome: 'partial' });
    expect(buildTurnQuiescentPayload({ reason: 'permission' })).toEqual({ reason: 'permission' });
    expect(buildWorkspaceDiscoveredPayload({ vcs: 'git', label: 'private repo' })).toEqual({
      vcs: 'git',
    });
  });

  it('returns immutable deterministic snapshots and ignores later input mutation', () => {
    const input: Record<string, unknown> = {
      name: 'shell',
      durationMs: 7,
      resultClass: 'success',
    };
    const first = buildToolCompletedPayload(input);
    input.name = 'apply_patch';
    input.durationMs = 99;
    input.resultClass = 'partial';
    const second = buildToolCompletedPayload({
      name: 'shell',
      durationMs: 7,
      resultClass: 'success',
    });

    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Reflect.set(first as object, 'name', 'other')).toBe(false);
    expect(first.name).toBe('shell');
    expect(JSON.stringify(first)).toBe(
      '{"name":"shell","category":"shell","durationMs":7,"resultClass":"success"}',
    );
  });

  it('does not invoke accessors and fails closed for revoked payload proxies', () => {
    const canary = 'PAYLOAD_ACCESSOR_CANARY command --token';
    const input = {} as Record<string, unknown>;
    let reads = 0;
    Object.defineProperty(input, 'name', {
      configurable: true,
      get: () => {
        reads += 1;
        throw new Error(canary);
      },
    });
    Object.defineProperty(input, 'durationMs', {
      configurable: true,
      get: () => {
        reads += 1;
        throw new Error(canary);
      },
    });
    expect(() => buildToolCompletedPayload(input)).not.toThrow();
    expect(reads).toBe(0);
    expect(buildToolCompletedPayload(input)).toEqual({ name: 'other', category: 'other' });

    const revoked = Proxy.revocable({ name: 'shell' }, {});
    revoked.revoke();
    expect(() => buildToolFailedPayload(revoked.proxy)).not.toThrow();
    expect(buildToolFailedPayload(revoked.proxy)).toEqual({
      name: 'other',
      category: 'other',
      failureClass: 'unknown',
    });
    expect(JSON.stringify(buildToolFailedPayload(revoked.proxy))).not.toContain(canary);
  });

  it('rejects missing and invalid required agent states with a bounded error', () => {
    const canary = 'AGENT_STATE_CANARY native state text';
    const accessorInput = {} as Record<string, unknown>;
    let reads = 0;
    Object.defineProperty(accessorInput, 'to', {
      configurable: true,
      get: () => {
        reads += 1;
        throw new Error(canary);
      },
    });

    const inputs: readonly unknown[] = [undefined, {}, { to: 'not-a-state' }, accessorInput];
    for (const input of inputs) {
      let caught: unknown;
      try {
        buildAgentStateChangedPayload(input);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(PayloadBuilderError);
      const error = caught as PayloadBuilderError;
      expect(error.code).toBe('invalid-agent-state');
      expect(error.message).toBe('payload builder failed: invalid-agent-state');
      expect(error.message).not.toContain(canary);
      expect(error.stack ?? '').not.toContain(canary);
      expect(JSON.stringify(error)).not.toContain(canary);
      expect(JSON.stringify({ error })).not.toContain(canary);
      expect(Object.isFrozen(error)).toBe(true);
    }
    expect(reads).toBe(0);
  });

  it('bounds arbitrary payload builder error codes', () => {
    const canary = 'ARBITRARY_PAYLOAD_ERROR_CANARY';
    const error = new PayloadBuilderError(canary as never);
    expect(error.code).toBe('invalid-agent-state');
    expect(error.message).not.toContain(canary);
    expect(error.stack ?? '').not.toContain(canary);
    expect(JSON.stringify(error)).not.toContain(canary);
    expect(Object.isFrozen(error)).toBe(true);
  });

  it('rejects transparent and nested proxies before reading traps', () => {
    const canary = 'TRANSPARENT_PROXY_CANARY';
    const transparent = new Proxy(
      { name: 'shell' },
      {
        getOwnPropertyDescriptor: () => {
          throw new Error(canary);
        },
        getPrototypeOf: () => {
          throw new Error(canary);
        },
      },
    );
    const nested = new Proxy(transparent, {});

    expect(categorizeTool(transparent)).toBe('other');
    expect(buildToolStartedPayload(transparent)).toEqual({ name: 'other', category: 'other' });
    expect(categorizeTool(nested)).toBe('other');
    expect(buildToolStartedPayload(nested)).toEqual({ name: 'other', category: 'other' });
    const stateProxy = new Proxy(
      { to: 'working' },
      {
        getOwnPropertyDescriptor: () => {
          throw new Error(canary);
        },
        getPrototypeOf: () => {
          throw new Error(canary);
        },
      },
    );
    let caught: unknown;
    try {
      buildAgentStateChangedPayload(stateProxy);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PayloadBuilderError);
    const error = caught as PayloadBuilderError;
    expect(error.code).toBe('invalid-agent-state');
    expect(error.message).not.toContain(canary);
    expect(error.stack ?? '').not.toContain(canary);
    expect(JSON.stringify(error)).not.toContain(canary);
    expect(JSON.stringify(buildToolStartedPayload(transparent))).not.toContain(canary);
  });

  it('fails closed for hostile proxy descriptor traps and symbol metadata', () => {
    const canary = 'PROXY_DESCRIPTOR_CANARY';
    const descriptorProxy = new Proxy(
      { name: 'shell' },
      {
        getOwnPropertyDescriptor: () => {
          throw new Error(canary);
        },
      },
    );
    const symbol = Symbol('native-secret');
    const input = { name: 'shell', [symbol]: canary };
    expect(buildToolStartedPayload(descriptorProxy)).toEqual({
      name: 'other',
      category: 'other',
    });
    const payload = buildToolStartedPayload(input);
    expect(Object.getOwnPropertySymbols(payload)).toEqual([]);
    expect(JSON.stringify(payload)).not.toContain(canary);
  });

  it('constructs every public payload as a null-prototype immutable record', () => {
    const canary = 'OUTPUT_PROTO_CANARY';
    const originalToJSON = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
    const originalName = Object.getOwnPropertyDescriptor(Object.prototype, 'name');
    const originalFreeze = Object.freeze;
    const originalSetPrototypeOf = Object.setPrototypeOf;
    const cleanPayload = buildToolStartedPayload({ name: 'shell' });

    try {
      Object.defineProperty(Object.prototype, 'toJSON', {
        configurable: true,
        enumerable: false,
        value: () => canary,
        writable: true,
      });
      Object.defineProperty(Object.prototype, 'name', {
        configurable: true,
        enumerable: false,
        value: 'shell',
        writable: true,
      });
      Object.freeze = (() => {
        throw new Error('FREEZE_CANARY');
      }) as typeof Object.freeze;
      Object.setPrototypeOf = (() => {
        throw new Error('SET_PROTOTYPE_CANARY');
      }) as typeof Object.setPrototypeOf;

      const outputs: readonly object[] = [
        buildAgentFinishedPayload({}),
        buildAgentSpawnedPayload({}),
        buildAgentStateChangedPayload({ to: 'working' }),
        buildPermissionPayload({}),
        buildPermissionRequestedPayload({}),
        buildPermissionResolvedPayload({}),
        buildSessionEndedPayload({}),
        buildSessionStartedPayload({}),
        buildTaskAbandonedPayload({}),
        buildTaskAssignedPayload({}),
        buildTaskCancelledPayload({}),
        buildTaskCompletedPayload({}),
        buildTaskCompletionRequestedPayload({}),
        buildTaskCreatedPayload({}),
        buildTaskDeniedPayload({}),
        buildTaskFailedPayload({}),
        buildTaskUpdatedPayload({}),
        buildToolCompletedPayload({ name: 'shell' }),
        buildToolFailedPayload({ name: 'shell' }),
        buildToolPayload({ name: 'shell' }),
        buildToolRequestedPayload({ name: 'shell' }),
        buildToolStartedPayload({ name: 'shell' }),
        cleanPayload,
        buildTurnFinishedPayload({}),
        buildTurnQuiescentPayload({}),
        buildWorkspaceDiscoveredPayload({}),
      ];

      for (const output of outputs) {
        expect(Object.getPrototypeOf(output)).toBeNull();
        expect(Object.isFrozen(output)).toBe(true);
        expect(JSON.stringify(output)).not.toContain(canary);
        expect(Reflect.set(output, 'injected', canary)).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(output, 'injected')).toBe(false);
      }
      expect(buildToolStartedPayload({}).name).toBe('other');
    } finally {
      Object.freeze = originalFreeze;
      Object.setPrototypeOf = originalSetPrototypeOf;
      if (originalToJSON === undefined) delete (Object.prototype as { toJSON?: unknown }).toJSON;
      else Object.defineProperty(Object.prototype, 'toJSON', originalToJSON);
      if (originalName === undefined) delete (Object.prototype as { name?: unknown }).name;
      else Object.defineProperty(Object.prototype, 'name', originalName);
    }
  });

  it('bounds agent depth to the executable protocol limit', () => {
    const valid = buildAgentSpawnedPayload({ role: 'worker', depth: MAX_JSON_DEPTH });
    expect(valid.depth).toBe(12);
    expect(buildAgentSpawnedPayload({ depth: MAX_JSON_DEPTH + 1 }).depth).toBe(0);
    expect(buildAgentSpawnedPayload({ depth: -1 }).depth).toBe(0);
    expect(buildAgentSpawnedPayload({ depth: Number.NaN }).depth).toBe(0);
    expect(buildAgentSpawnedPayload({ depth: Number.POSITIVE_INFINITY }).depth).toBe(0);
    expect(buildAgentSpawnedPayload({ depth: Number.MAX_SAFE_INTEGER + 1 }).depth).toBe(0);

    const event = validEventFixture('agent.spawned');
    expect(validateEvent({ ...event, data: valid }).status).toBe('accepted');
    expect(
      validateEvent({
        ...event,
        data: { ...valid, depth: MAX_JSON_DEPTH + 1 },
      }).status,
    ).toBe('rejected');
  });

  it('survives poisoned mutable intrinsics on the builder and opaque-ID paths', async () => {
    const deriver = await createOpaqueIdDeriver(key);
    const groupId = await deriver.derive('operation', 'intrinsic-canary-group');
    const originalPush = Array.prototype.push;
    const originalStartsWith = String.prototype.startsWith;
    const originalIndexOf = String.prototype.indexOf;
    let payload: ReturnType<typeof buildToolStartedPayload> | undefined;

    try {
      Array.prototype.push = (() => {
        throw new Error('GLOBAL_PUSH_CANARY');
      }) as typeof Array.prototype.push;
      String.prototype.startsWith = (() => {
        throw new Error('GLOBAL_STARTS_WITH_CANARY');
      }) as typeof String.prototype.startsWith;
      String.prototype.indexOf = (() => {
        throw new Error('GLOBAL_INDEX_OF_CANARY');
      }) as typeof String.prototype.indexOf;

      payload = buildToolStartedPayload({ name: 'shell', parallelGroupId: groupId });
    } finally {
      Array.prototype.push = originalPush;
      String.prototype.startsWith = originalStartsWith;
      String.prototype.indexOf = originalIndexOf;
    }

    expect(payload).toEqual({
      name: 'shell',
      category: 'shell',
      parallelGroupId: groupId,
    });
  });

  it('produces payloads accepted by the actual protocol validator', () => {
    const cases: readonly (readonly [CoreEventType, object])[] = [
      ['agent.spawned', buildAgentSpawnedPayload({ depth: MAX_JSON_DEPTH })],
      ['agent.state.changed', buildAgentStateChangedPayload({ to: 'working' })],
      ['agent.finished', buildAgentFinishedPayload({})],
      ['permission.requested', buildPermissionRequestedPayload({ name: 'shell' })],
      ['permission.resolved', buildPermissionResolvedPayload({ outcome: 'denied' })],
      ['permission.requested', buildPermissionPayload({ name: 'shell' })],
      ['session.started', buildSessionStartedPayload({})],
      ['session.ended', buildSessionEndedPayload({})],
      ['task.created', buildTaskCreatedPayload({})],
      ['task.updated', buildTaskUpdatedPayload({})],
      ['task.assigned', buildTaskAssignedPayload({})],
      ['task.completion.requested', buildTaskCompletionRequestedPayload({})],
      ['task.completed', buildTaskCompletedPayload({})],
      ['task.failed', buildTaskFailedPayload({})],
      ['task.denied', buildTaskDeniedPayload({})],
      ['task.cancelled', buildTaskCancelledPayload({})],
      ['task.abandoned', buildTaskAbandonedPayload({})],
      ['tool.requested', buildToolRequestedPayload({ name: 'shell' })],
      ['tool.started', buildToolStartedPayload({ name: 'shell' })],
      ['tool.completed', buildToolCompletedPayload({ name: 'shell' })],
      ['tool.failed', buildToolFailedPayload({ name: 'shell' })],
      ['tool.started', buildToolPayload({ name: 'shell' })],
      ['tool.requested', buildToolPayload({ name: 'shell' }, 'requested')],
      ['tool.completed', buildToolPayload({ name: 'shell' }, 'completed')],
      ['tool.failed', buildToolPayload({ name: 'shell' }, 'failed')],
      ['turn.finished', buildTurnFinishedPayload({})],
      ['turn.quiescent', buildTurnQuiescentPayload({})],
      ['workspace.discovered', buildWorkspaceDiscoveredPayload({})],
    ];

    for (const [type, payload] of cases) {
      expect(validateEvent({ ...validEventFixture(type), data: payload }).status, type).toBe(
        'accepted',
      );
    }
  });
});
