import { deepFreeze, validEventFixture, type ProtocolFixture } from './core-events.js';
import type { CoreEventType, EventScope, ProtocolDiagnostic } from '../index.js';

export interface InvalidScopeFixture {
  readonly name: string;
  readonly type: CoreEventType;
  readonly omittedScope: keyof EventScope;
  readonly event: ProtocolFixture;
}

function scopeOmissionFixture(
  type: CoreEventType,
  omittedScope: keyof EventScope,
): InvalidScopeFixture {
  const event = validEventFixture(type);
  const scope = { ...(event.scope as ProtocolFixture) };
  delete scope[omittedScope];
  return {
    name: `${type}-missing-${omittedScope}`,
    type,
    omittedScope,
    event: { ...event, scope },
  };
}

/** Common scope coverage uses a few representative event shapes rather than repeating every type. */
const commonScopeOmissionDefinitions = [
  ['session.started', 'workspaceId'],
  ['session.started', 'sessionId'],
  ['task.created', 'sessionId'],
] as const satisfies readonly (readonly [CoreEventType, keyof EventScope])[];

export const commonScopeOmissionFixtures = deepFreeze(
  commonScopeOmissionDefinitions.map(([type, omittedScope]) =>
    scopeOmissionFixture(type, omittedScope),
  ),
);

/** Every event-specific scope rule has one deterministic missing-field fixture. */
const eventSpecificScopeOmissionDefinitions = [
  ['turn.started', 'turnId'],
  ['turn.finished', 'turnId'],
  ['turn.quiescent', 'turnId'],
  ['agent.spawned', 'agentId'],
  ['agent.state.changed', 'agentId'],
  ['agent.finished', 'agentId'],
  ['task.created', 'taskId'],
  ['task.updated', 'taskId'],
  ['task.assigned', 'taskId'],
  ['task.completion.requested', 'taskId'],
  ['task.completed', 'taskId'],
  ['task.failed', 'taskId'],
  ['task.denied', 'taskId'],
  ['task.cancelled', 'taskId'],
  ['task.abandoned', 'taskId'],
  ['task.corrected', 'taskId'],
  ['task.plan.reconciled', 'turnId'],
  ['tool.requested', 'operationId'],
  ['tool.started', 'operationId'],
  ['tool.completed', 'operationId'],
  ['tool.failed', 'operationId'],
  ['permission.requested', 'permissionId'],
  ['permission.resolved', 'permissionId'],
] as const satisfies readonly (readonly [CoreEventType, keyof EventScope])[];

export const eventSpecificScopeOmissionFixtures = deepFreeze(
  eventSpecificScopeOmissionDefinitions.map(([type, omittedScope]) =>
    scopeOmissionFixture(type, omittedScope),
  ),
);

export const invalidScopeFixtures = deepFreeze([
  ...commonScopeOmissionFixtures,
  ...eventSpecificScopeOmissionFixtures,
]);

export interface UnknownOptionalFieldFixture {
  readonly name: string;
  readonly event: ProtocolFixture;
  readonly topLevelField: string;
  readonly dataField: string;
  readonly expectedKnownData: Readonly<Record<string, unknown>>;
}

export const unknownOptionalFieldFixtures: readonly UnknownOptionalFieldFixture[] = deepFreeze([
  {
    name: 'core-event-unknown-optional-fields',
    event: {
      ...validEventFixture('session.started'),
      version: '1.1.0',
      futureOptional: { revision: 2, marker: 'opaque' },
      data: {
        ...(validEventFixture('session.started').data as ProtocolFixture),
        futureOptional: { marker: 'opaque' },
      },
    },
    topLevelField: 'futureOptional',
    dataField: 'futureOptional',
    expectedKnownData: { resume: false },
  },
  {
    name: 'task-event-unknown-data-field',
    event: {
      ...validEventFixture('task.created'),
      version: '1.1.0',
      eventMetadata: { marker: 'opaque' },
      data: {
        ...(validEventFixture('task.created').data as ProtocolFixture),
        futureStatusMetadata: { marker: 'opaque' },
      },
    },
    topLevelField: 'eventMetadata',
    dataField: 'futureStatusMetadata',
    expectedKnownData: { status: 'pending', fallback: false },
  },
]);

export interface ExtensionFixture {
  readonly name: string;
  readonly event: ProtocolFixture;
  readonly expectedStatus: 'preserved-extension' | 'rejected';
  readonly expectedDiagnostic: Readonly<Pick<ProtocolDiagnostic, 'code' | 'severity' | 'field'>>;
}

const extensionBase = (): ProtocolFixture => ({
  ...validEventFixture('session.started'),
  type: 'x.io.example.telemetry',
  extension: {
    fallback: 'preserve-in-journal',
    documentation: 'Synthetic opaque extension fixture.',
    vendorField: 'opaque',
  },
  data: { marker: 'opaque', nested: { value: 1 } },
});

export const extensionFixtures: readonly ExtensionFixture[] = deepFreeze([
  {
    name: 'namespaced-extension-is-preserved',
    event: extensionBase(),
    expectedStatus: 'preserved-extension',
    expectedDiagnostic: { code: 'extension-preserved', severity: 'warning', field: 'type' },
  },
]);

/** Invalid extension envelopes exercise type, metadata, fallback, and bounded-payload failures. */
export const invalidExtensionFixtures: readonly ExtensionFixture[] = deepFreeze([
  {
    name: 'non-namespaced-extension-type-is-rejected',
    event: { ...extensionBase(), type: 'telemetry.event' },
    expectedStatus: 'rejected',
    expectedDiagnostic: { code: 'unknown-event', severity: 'error', field: 'type' },
  },
  {
    name: 'malformed-namespaced-extension-type-is-rejected',
    event: { ...extensionBase(), type: 'x.example' },
    expectedStatus: 'rejected',
    expectedDiagnostic: { code: 'invalid-extension', severity: 'error', field: 'type' },
  },
  {
    name: 'extension-missing-fallback-is-rejected',
    event: {
      ...extensionBase(),
      extension: { documentation: 'Missing fallback.' },
    },
    expectedStatus: 'rejected',
    expectedDiagnostic: { code: 'invalid-extension', severity: 'error', field: 'extension' },
  },
  {
    name: 'extension-missing-documentation-is-rejected',
    event: {
      ...extensionBase(),
      extension: { fallback: 'preserve-in-journal' },
    },
    expectedStatus: 'rejected',
    expectedDiagnostic: { code: 'invalid-extension', severity: 'error', field: 'extension' },
  },
  {
    name: 'unsupported-extension-fallback-is-rejected',
    event: { ...extensionBase(), extension: { fallback: 'drop', documentation: 'Not safe.' } },
    expectedStatus: 'rejected',
    expectedDiagnostic: { code: 'invalid-extension', severity: 'error', field: 'extension' },
  },
  {
    name: 'malformed-extension-documentation-is-rejected',
    event: {
      ...extensionBase(),
      extension: { fallback: 'preserve-in-journal', documentation: { unsafe: true } },
    },
    expectedStatus: 'rejected',
    expectedDiagnostic: { code: 'invalid-extension', severity: 'error', field: 'extension' },
  },
  {
    name: 'oversized-extension-documentation-is-rejected',
    event: {
      ...extensionBase(),
      extension: {
        fallback: 'preserve-in-journal',
        documentation: 'd'.repeat(513),
      },
    },
    expectedStatus: 'rejected',
    expectedDiagnostic: { code: 'invalid-extension', severity: 'error', field: 'extension' },
  },
  {
    name: 'oversized-extension-data-is-rejected',
    event: {
      ...extensionBase(),
      data: { marker: 'x'.repeat(4_090) },
    },
    expectedStatus: 'rejected',
    expectedDiagnostic: { code: 'event-too-large', severity: 'error', field: 'size' },
  },
]);

export interface IncompatibleVersionFixture {
  readonly name: string;
  readonly event: ProtocolFixture;
  readonly expectedStatus: 'quarantined';
  readonly expectedCode: 'unsupported-major';
}

export const incompatibleVersionFixtures: readonly IncompatibleVersionFixture[] = deepFreeze([
  {
    name: 'core-unsupported-major-is-quarantined',
    event: { ...validEventFixture('session.started'), version: '9.0.0' },
    expectedStatus: 'quarantined',
    expectedCode: 'unsupported-major',
  },
  {
    name: 'extension-unsupported-major-is-quarantined',
    event: { ...extensionBase(), version: '9.0.0' },
    expectedStatus: 'quarantined',
    expectedCode: 'unsupported-major',
  },
]);

export interface DuplicateFixture {
  readonly name: string;
  readonly original: ProtocolFixture;
  readonly retry: ProtocolFixture;
  readonly expected: {
    readonly dedupeKey: 'eventId';
    readonly semanticTransitionCount: 1;
    readonly operationId: string;
    readonly validatorDeduplicates: false;
  };
}

const duplicateEvent = validEventFixture('tool.completed');
duplicateEvent.eventId = 'event-duplicate-tool';
duplicateEvent.sequence = 7;

export const duplicateFixtures: readonly DuplicateFixture[] = deepFreeze([
  {
    name: 'same-event-id-retry-is-one-semantic-transition',
    original: structuredClone(duplicateEvent),
    retry: structuredClone(duplicateEvent),
    expected: {
      dedupeKey: 'eventId',
      semanticTransitionCount: 1,
      operationId: 'operation-1',
      validatorDeduplicates: false,
    },
  },
]);

export interface CorrelationAmbiguityFixture {
  readonly name: string;
  readonly candidateOperations: readonly [ProtocolFixture, ProtocolFixture];
  readonly permission: ProtocolFixture;
  readonly expected: {
    readonly operationLink: 'absent';
    readonly reason: 'missing-correlation';
    readonly parallelGroupId: string;
    readonly operationIds: readonly [string, string];
    readonly sequences: readonly [number, number, number];
    readonly permissionId: string;
    readonly causalLink: 'absent';
  };
}

function operationCandidate(
  eventId: string,
  operationId: string,
  sequence: number,
  parallelGroupId: string,
): ProtocolFixture {
  const base = validEventFixture('tool.requested');
  return {
    ...base,
    eventId,
    sequence,
    scope: {
      ...(base.scope as ProtocolFixture),
      operationId,
    },
    data: {
      ...(base.data as ProtocolFixture),
      parallelGroupId,
    },
  };
}

export const correlationAmbiguityFixtures: readonly CorrelationAmbiguityFixture[] = deepFreeze([
  {
    name: 'permission-with-two-plausible-operations-remains-unlinked',
    candidateOperations: [
      operationCandidate('event-operation-a', 'operation-a', 8, 'parallel-group-1'),
      operationCandidate('event-operation-b', 'operation-b', 9, 'parallel-group-1'),
    ],
    permission: {
      ...validEventFixture('permission.requested'),
      eventId: 'event-permission-ambiguous',
      sequence: 10,
    },
    expected: {
      operationLink: 'absent',
      reason: 'missing-correlation',
      parallelGroupId: 'parallel-group-1',
      operationIds: ['operation-a', 'operation-b'],
      sequences: [8, 9, 10],
      permissionId: 'permission-1',
      causalLink: 'absent',
    },
  },
]);
