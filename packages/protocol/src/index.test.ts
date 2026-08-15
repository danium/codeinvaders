import { describe, expect, it } from 'vitest';
import {
  MAX_EVENT_BYTES,
  MAX_EXTENSION_BYTES,
  MAX_JSON_DEPTH,
  compileCoreEventSchemas,
  coreEventSchemas,
  extensionEventSchema,
  isCoreEvent,
  protocolId,
  validateEvent,
  type AnyCoreEvent,
  type CoreEvent,
  type CoreEventType,
} from './index.js';

// @ts-expect-error task events require taskId in addition to the common scope IDs.
const missingTaskId: CoreEvent<'task.created'>['scope'] = {
  workspaceId: 'workspace-1',
  sessionId: 'session-1',
};
const taskScope = null as unknown as CoreEvent<'task.created'>['scope'];
// @ts-expect-error tool events require operationId.
const missingOperationId: CoreEvent<'tool.started'>['scope'] = taskScope;
const toolScope = null as unknown as CoreEvent<'tool.started'>['scope'];
// @ts-expect-error permission events require permissionId.
const missingPermissionId: CoreEvent<'permission.requested'>['scope'] = toolScope;
const permissionScope = null as unknown as CoreEvent<'permission.requested'>['scope'];
// @ts-expect-error turn events require turnId.
const missingTurnId: CoreEvent<'turn.started'>['scope'] = permissionScope;
const turnScope = null as unknown as CoreEvent<'turn.started'>['scope'];
// @ts-expect-error agent events require agentId.
const missingAgentId: CoreEvent<'agent.spawned'>['scope'] = turnScope;
function assertDiscriminatedUnion(event: AnyCoreEvent): void {
  if (event.type === 'tool.started') {
    const operationId: string = event.scope.operationId;
    void operationId;
  }
}
void missingTaskId;
void missingOperationId;
void missingPermissionId;
void missingTurnId;
void missingAgentId;
void assertDiscriminatedUnion;

const capability = {
  sessions: 'observed',
  turns: 'observed',
  tasks: {
    lifecycle: 'observed',
    snapshotReconciliation: true,
    titles: 'derived',
    descriptions: 'none',
    assignment: 'observed',
    hierarchy: 'none',
  },
  agents: { lifecycle: 'observed', nesting: 'derived', toolAttribution: 'observed' },
  tools: {
    start: 'observed',
    success: 'observed',
    failure: 'observed',
    duration: 'derived',
    names: 'derived',
  },
  permissions: { request: 'observed', resolution: 'observed', operationLink: 'derived' },
};
const data: Record<CoreEventType, Record<string, unknown>> = {
  'source.connected': { agentKind: 'codex', agentVersion: '1.0.0', capabilities: capability },
  'source.heartbeat': { uptimeMs: 1 },
  'source.disconnected': { reason: 'normal' },
  'telemetry.gap': { fromSequence: 1, toSequence: 2, reason: 'dropped' },
  'workspace.discovered': { label: 'opaque', vcs: 'git' },
  'session.started': { resume: false },
  'session.ended': { reason: 'normal' },
  'turn.started': { objectiveLabel: 'opaque' },
  'turn.finished': { outcome: 'completed' },
  'agent.spawned': { role: 'worker', label: 'opaque', depth: 0 },
  'agent.state.changed': { from: 'starting', to: 'working', reason: 'native' },
  'agent.finished': { outcome: 'completed' },
  'task.created': { label: 'opaque', status: 'pending', ordinal: 0, fallback: false },
  'task.updated': { label: 'opaque', status: 'in_progress', ordinal: 0 },
  'task.assigned': { assigneeAgentId: 'agent-1' },
  'task.completed': { completion: 'observed' },
  'task.failed': { category: 'validation' },
  'task.cancelled': { reason: 'replanned' },
  'task.plan.reconciled': { revision: 1, taskIds: ['task-1'] },
  'tool.requested': { name: 'shell', category: 'shell', parallelGroupId: 'group-1' },
  'tool.started': { name: 'shell', category: 'shell' },
  'tool.completed': { name: 'shell', category: 'shell', durationMs: 1, resultClass: 'success' },
  'tool.failed': { name: 'shell', category: 'shell', durationMs: 1, failureClass: 'exit_nonzero' },
  'permission.requested': { category: 'shell', riskClass: 'execute' },
  'permission.resolved': { outcome: 'allowed' },
};
const requiredScope: Partial<Record<CoreEventType, Record<string, string>>> = {
  'turn.started': { turnId: 'turn-1' },
  'turn.finished': { turnId: 'turn-1' },
  'agent.spawned': { agentId: 'agent-1' },
  'agent.state.changed': { agentId: 'agent-1' },
  'agent.finished': { agentId: 'agent-1' },
  'task.created': { taskId: 'task-1' },
  'task.updated': { taskId: 'task-1' },
  'task.assigned': { taskId: 'task-1' },
  'task.completed': { taskId: 'task-1' },
  'task.failed': { taskId: 'task-1' },
  'task.cancelled': { taskId: 'task-1' },
  'task.plan.reconciled': { turnId: 'turn-1' },
  'tool.requested': { operationId: 'operation-1' },
  'tool.started': { operationId: 'operation-1' },
  'tool.completed': { operationId: 'operation-1' },
  'tool.failed': { operationId: 'operation-1' },
  'permission.requested': { permissionId: 'permission-1' },
  'permission.resolved': { permissionId: 'permission-1' },
};
function fixture(type: CoreEventType): Record<string, unknown> {
  return {
    spec: protocolId,
    version: '1.0.0',
    eventId: 'event-1',
    type,
    occurredAt: '2026-08-15T14:22:31.120Z',
    observedAt: '2026-08-15T14:22:31.127Z',
    sequence: 1,
    source: {
      adapterId: 'adapter-1',
      adapterVersion: '0.1.0',
      streamId: 'stream-1',
      epochId: 'epoch-1',
    },
    scope: { workspaceId: 'workspace-1', sessionId: 'session-1', ...requiredScope[type] },
    fidelity: 'observed',
    finality: 'confirmed',
    data: data[type],
  };
}

describe('AAP Draft 2020-12 conformance', () => {
  it('exports and executes every one of the 25 core discriminants', () => {
    const types = Object.keys(coreEventSchemas) as CoreEventType[];
    expect(types).toHaveLength(25);
    expect(compileCoreEventSchemas()).toHaveLength(25);
    for (const type of types) {
      expect(coreEventSchemas[type]).toMatchObject({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        'x-codeinvaders-limits': { maxBytes: MAX_EVENT_BYTES, maxDepth: MAX_JSON_DEPTH },
      });
      expect(validateEvent(fixture(type))).toMatchObject({ status: 'accepted' });
    }
  });

  it('executes each exported schema directly and rejects every nested required property', () => {
    type TestSchema = {
      required?: readonly string[];
      properties?: Record<string, TestSchema>;
    };
    const schemas = Object.values(coreEventSchemas) as TestSchema[];
    const validators = compileCoreEventSchemas();
    const removeRequired = (schema: TestSchema, path: string[] = []): string[][] => {
      const paths: string[][] = [];
      for (const property of schema.required ?? []) {
        paths.push([...path, property]);
      }
      for (const [property, child] of Object.entries(schema.properties ?? {})) {
        if (child && typeof child === 'object')
          paths.push(...removeRequired(child, [...path, property]));
      }
      return paths;
    };
    const remove = (value: Record<string, unknown>, path: string[]) => {
      const copy = structuredClone(value);
      let current: Record<string, unknown> = copy;
      for (const property of path.slice(0, -1))
        current = current[property] as Record<string, unknown>;
      delete current[path[path.length - 1]!];
      return copy;
    };
    for (const [index, type] of (Object.keys(coreEventSchemas) as CoreEventType[]).entries()) {
      const schema = schemas[index]!;
      const validator = validators[index]!;
      const event = fixture(type);
      expect(validator(event)).toBe(true);
      for (const path of removeRequired(schema)) {
        expect(validator(remove(event, path)), `${type}: ${path.join('.')}`).toBe(false);
      }
    }
  });

  it.each(Object.keys(coreEventSchemas) as CoreEventType[])(
    'enforces the complete %s contract',
    (type) => {
      const event = fixture(type);
      expect(isCoreEvent(event)).toBe(true);
      expect(
        validateEvent({
          ...event,
          data: { ...(event.data as object), invalid: 'allowed optional field' },
        }).status,
      ).toBe('accepted');
      expect(validateEvent({ ...event, data: 'wrong' }).status).toBe('rejected');
    },
  );

  it('rejects wrong types, enums, timestamps, IDs, and safe-integer sequences', () => {
    expect(validateEvent({ ...fixture('session.started'), sequence: 1.5 })).toMatchObject({
      status: 'rejected',
      diagnostics: [{ code: 'invalid-envelope' }],
    });
    expect(
      validateEvent({ ...fixture('session.started'), sequence: Number.MAX_SAFE_INTEGER + 1 }),
    ).toMatchObject({ status: 'rejected' });
    expect(
      validateEvent({ ...fixture('session.started'), occurredAt: 'not-a-date' }),
    ).toMatchObject({ status: 'rejected', diagnostics: [{ field: 'timestamps' }] });
    expect(validateEvent({ ...fixture('session.started'), eventId: '../secret' })).toMatchObject({
      status: 'rejected',
    });
    expect(
      validateEvent({ ...fixture('session.ended'), data: { reason: 'invented' } }),
    ).toMatchObject({ status: 'rejected', diagnostics: [{ code: 'invalid-data' }] });
    expect(
      validateEvent({
        ...fixture('source.connected'),
        data: { ...data['source.connected'], capabilities: { sessions: 'bad' } },
      }),
    ).toMatchObject({ status: 'rejected' });
  });

  it('checks scope requirements for every event-specific scope', () => {
    for (const [type, scope] of Object.entries(requiredScope) as [
      CoreEventType,
      Record<string, string>,
    ][]) {
      const missing = {
        ...fixture(type),
        scope: { workspaceId: 'workspace-1', sessionId: 'session-1' },
      };
      expect(validateEvent(missing)).toMatchObject({
        status: 'rejected',
        diagnostics: [{ code: 'invalid-scope' }],
      });
      expect(
        validateEvent({ ...fixture(type), scope: { ...missing.scope, ...scope } }).status,
      ).toBe('accepted');
    }
  });

  it('preflights size and depth before validation', () => {
    expect(
      validateEvent({
        ...fixture('session.started'),
        data: { resume: false, padding: 'x'.repeat(MAX_EVENT_BYTES) },
      }),
    ).toMatchObject({ status: 'rejected', diagnostics: [{ code: 'event-too-large' }] });
    let nested: unknown = false;
    for (let i = 0; i <= MAX_JSON_DEPTH; i += 1) nested = { nested };
    expect(
      validateEvent({ ...fixture('session.started'), data: { resume: false, nested } }),
    ).toMatchObject({ status: 'rejected', diagnostics: [{ code: 'event-too-deep' }] });
  });

  it('validates SemVer syntax before major compatibility and bounds diagnostics', () => {
    expect(validateEvent({ ...fixture('session.started'), version: '9.bad' })).toMatchObject({
      status: 'rejected',
      diagnostics: [{ code: 'invalid-version' }],
    });
    for (const version of ['1.0.0-rc.1', '1.0.0+build.7', '1.0.0-rc.1+build.7']) {
      expect(validateEvent({ ...fixture('session.started'), version }).status).toBe('accepted');
    }
    for (const version of ['1.0.0-01', '1.0.0-rc.01', '1.0.0-0.01']) {
      expect(validateEvent({ ...fixture('session.started'), version })).toMatchObject({
        status: 'rejected',
        diagnostics: [{ code: 'invalid-version' }],
      });
    }
    const unsupported = validateEvent({
      ...fixture('session.started'),
      version: '9.0.0',
      secret: 'PRIVATE /home/user/token',
    });
    expect(unsupported).toEqual({
      status: 'quarantined',
      diagnostics: [
        { code: 'unsupported-major', severity: 'error', field: 'version', protocolMajor: 9 },
      ],
    });
    expect(JSON.stringify(unsupported)).not.toContain('PRIVATE');
  });

  it('accepts optional compatible fields and handles only documented extensions', () => {
    expect(validateEvent({ ...fixture('session.started'), future: { ignored: true } }).status).toBe(
      'accepted',
    );
    const extension = {
      ...fixture('session.started'),
      type: 'x.io.example.telemetry',
      extension: {
        fallback: 'preserve-in-journal',
        documentation: 'Preserve as an opaque journal record.',
      },
      data: { value: 'opaque' },
    };
    expect(validateEvent(extension)).toMatchObject({
      status: 'preserved-extension',
      event: extension,
      diagnostics: [{ code: 'extension-preserved', severity: 'warning', field: 'type' }],
    });
    expect(validateEvent({ ...extension, extension: { fallback: 'drop' } })).toMatchObject({
      status: 'rejected',
      diagnostics: [{ code: 'invalid-extension' }],
    });
    expect(validateEvent({ ...extension, type: 'x.invalid' })).toMatchObject({
      status: 'rejected',
      diagnostics: [{ code: 'invalid-extension' }],
    });
    expect(
      validateEvent({ ...fixture('session.started'), type: 'vendor.secret.event' }),
    ).toMatchObject({ status: 'rejected' });
    expect(
      validateEvent({ ...extension, data: { value: 'x'.repeat(MAX_EXTENSION_BYTES) } }),
    ).toMatchObject({ status: 'rejected', diagnostics: [{ code: 'event-too-large' }] });
  });

  it('exports and validates the complete extension envelope without reducing the event', () => {
    expect(extensionEventSchema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      required: expect.arrayContaining(['spec', 'eventId', 'source', 'scope', 'extension', 'data']),
      'x-codeinvaders-limits': { maxBytes: MAX_EVENT_BYTES, maxDepth: MAX_JSON_DEPTH },
    });
    const extension = {
      ...fixture('session.started'),
      type: 'x.io.example.telemetry',
      extension: {
        fallback: 'preserve-in-journal',
        documentation: 'Opaque telemetry extension.',
        vendorField: 'forward-compatible',
      },
      data: { nested: { value: 42 }, opaque: ['a', true] },
      future: { retained: true },
    };
    const result = validateEvent(extension);
    expect(result).toEqual({
      status: 'preserved-extension',
      event: extension,
      diagnostics: [{ code: 'extension-preserved', severity: 'warning', field: 'type' }],
    });
  });

  it('rejects invalid namespaced extension envelopes with fixed diagnostics', () => {
    const extension = {
      ...fixture('session.started'),
      type: 'x.io.example.telemetry',
      extension: {
        fallback: 'preserve-in-journal',
        documentation: 'Opaque telemetry extension.',
      },
      data: { value: 'opaque' },
    };
    for (const invalid of [
      { ...extension, spec: 'attacker-controlled' },
      { ...extension, sequence: -1 },
      { ...extension, source: { adapterId: '../secret' } },
      { ...extension, scope: { workspaceId: 'workspace-1' } },
      { ...extension, extension: { fallback: 'drop', documentation: 'bad' } },
      { ...extension, extension: { fallback: 'preserve-in-journal' } },
    ]) {
      const result = validateEvent(invalid);
      expect(result).toMatchObject({
        status: 'rejected',
        diagnostics: [{ code: 'invalid-extension', severity: 'error', field: 'extension' }],
      });
      expect(JSON.stringify(result)).not.toContain('attacker-controlled');
    }
  });

  it('does not expose input values in extension diagnostics', () => {
    const result = validateEvent({
      ...fixture('session.started'),
      type: 'x.io.example.telemetry',
      extension: { fallback: 'drop', documentation: 'SECRET-DOCUMENTATION' },
      data: { secret: 'SECRET-DATA' },
    });
    expect(result).toEqual({
      status: 'rejected',
      diagnostics: [{ code: 'invalid-extension', severity: 'error', field: 'extension' }],
    });
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
});
