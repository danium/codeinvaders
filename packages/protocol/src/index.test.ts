import { describe, expect, it } from 'vitest';
import * as Ajv2020Module from 'ajv/dist/2020.js';
import * as addFormatsModule from 'ajv-formats';
import {
  MAX_EVENT_BYTES,
  MAX_EXTENSION_BYTES,
  MAX_JSON_DEPTH,
  compileCoreEventSchemas,
  coreEventSchemas,
  extensionEventSchema,
  isCoreEvent,
  protocolId,
  protocolSchemaKeywordNames,
  registerProtocolSchemaKeywords,
  validateEvent,
  canTransferTerminalState,
  opaqueText,
  planRevision,
  sanitizedToken,
  type SanitizedToken,
  type OpaqueText,
  type PlanReconciledData,
  type SignalCapability,
  type AnyCoreEvent,
  type CoreEvent,
  type CoreEventPayload,
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
type RequiredSemanticIsRequired =
  Pick<CoreEvent<'task.completed'>, 'semantic'> extends Required<
    Pick<CoreEvent<'task.completed'>, 'semantic'>
  >
    ? true
    : false;
type UnrelatedSemanticIsOptional =
  Pick<CoreEvent<'session.started'>, 'semantic'> extends Required<
    Pick<CoreEvent<'session.started'>, 'semantic'>
  >
    ? false
    : true;
const requiredSemanticIsRequired: RequiredSemanticIsRequired = true;
const unrelatedSemanticIsOptional: UnrelatedSemanticIsOptional = true;
// @ts-expect-error semantic is required for semantic-required core events.
const missingRequiredSemantic: Pick<CoreEvent<'task.completed'>, 'semantic'> = {};
const omittedOptionalSemantic: Pick<CoreEvent<'session.started'>, 'semantic'> = {};
type CorrectedPayload = CoreEventPayload<'task.corrected'>;
const validReopenCorrection: CorrectedPayload = {
  data: {
    correction: 'reopen',
    correctedEventId: 'event-1',
    correctedEntityId: 'task-1',
    status: 'in_progress',
  },
  semantic: {
    kind: 'correction',
    terminal: false,
    correctionOfEventId: 'event-1',
    correctionOfEntityId: 'task-1',
  },
};
const validOutcomeCorrection: CorrectedPayload = {
  data: {
    correction: 'replace-outcome',
    correctedEventId: 'event-1',
    correctedEntityId: 'task-1',
    status: 'completed',
    resultingOutcome: 'success',
  },
  semantic: { kind: 'outcome', terminal: true, outcome: 'success' },
};
const mismatchedOutcomeCorrection: CorrectedPayload = {
  data: {
    correction: 'replace-outcome',
    correctedEventId: 'event-1',
    correctedEntityId: 'task-1',
    status: 'failed',
    // @ts-expect-error terminal correction status and resulting outcome must correspond.
    resultingOutcome: 'success',
  },
  semantic: { kind: 'outcome', terminal: true, outcome: 'success' },
};
// @ts-expect-error reopen data must use nonterminal correction metadata.
const invalidReopenCorrection: CorrectedPayload = {
  data: validReopenCorrection.data,
  semantic: { kind: 'outcome', terminal: true, outcome: 'success' },
};
// @ts-expect-error replace-outcome data must use terminal outcome metadata.
const invalidOutcomeCorrection: CorrectedPayload = {
  data: validOutcomeCorrection.data,
  semantic: {
    kind: 'correction',
    terminal: false,
    correctionOfEventId: 'event-1',
    correctionOfEntityId: 'task-1',
  },
};
// @ts-expect-error data.resultingOutcome and semantic.outcome must match.
const mismatchedSemanticOutcome: CorrectedPayload = {
  data: validOutcomeCorrection.data,
  semantic: { kind: 'outcome', terminal: true, outcome: 'failure' },
};
const wrongCompletedOutcome: CoreEvent<'task.completed'>['semantic'] = {
  kind: 'outcome',
  terminal: true,
  // @ts-expect-error task.completed can only carry the success outcome.
  outcome: 'failure',
};
const timeoutTaskSuccess: CoreEvent<'task.completed'>['semantic'] = {
  kind: 'outcome',
  terminal: true,
  outcome: 'success',
  // @ts-expect-error task.completed success cannot be based on a timeout.
  basis: 'timeout',
};
const timeoutCorrectedSuccess: CorrectedPayload = {
  data: {
    correction: 'replace-outcome',
    correctedEventId: 'event-1',
    correctedEntityId: 'task-1',
    status: 'completed',
    resultingOutcome: 'success',
  },
  // @ts-expect-error a successful replace-outcome correction cannot be based on a timeout.
  semantic: { kind: 'outcome', terminal: true, outcome: 'success', basis: 'timeout' },
};
// @ts-expect-error confirmed terminal outcomes cannot be provisional.
const provisionalCompletedFinality: CoreEvent<'task.completed'>['finality'] = 'provisional';
// @ts-expect-error completion checkpoints cannot be confirmed.
const confirmedCompletionCheckpointFinality: CoreEvent<'task.completion.requested'>['finality'] =
  'confirmed';
const wrongFailedOutcome: CoreEvent<'task.failed'>['semantic'] = {
  kind: 'outcome',
  terminal: true,
  // @ts-expect-error task.failed can only carry the failure outcome.
  outcome: 'success',
};
const wrongDeniedOutcome: CoreEvent<'task.denied'>['semantic'] = {
  kind: 'outcome',
  terminal: true,
  // @ts-expect-error task.denied can only carry the denied outcome.
  outcome: 'success',
};
const wrongCancelledOutcome: CoreEvent<'task.cancelled'>['semantic'] = {
  kind: 'outcome',
  terminal: true,
  // @ts-expect-error task.cancelled can only carry the cancelled outcome.
  outcome: 'success',
};
const wrongAbandonedOutcome: CoreEvent<'task.abandoned'>['semantic'] = {
  kind: 'outcome',
  terminal: true,
  // @ts-expect-error task.abandoned can only carry the abandoned outcome.
  outcome: 'success',
};

type ConnectedData = CoreEventPayload<'source.connected'>['data'];
const connectedData = {} as ConnectedData;
// @ts-expect-error source.connected agentKind must be a SanitizedToken.
const unbrandedConnectedAgentKind: ConnectedData = { ...connectedData, agentKind: 'codex' };
const invalidConnectedRevision: ConnectedData = {
  ...connectedData,
  capabilities: {
    ...connectedData.capabilities,
    // @ts-expect-error source.connected capabilities must start at revision one.
    revision: 2,
  },
};
type SpawnedData = CoreEventPayload<'agent.spawned'>['data'];
const spawnedData = {} as SpawnedData;
// @ts-expect-error agent.spawned agentKind must be a SanitizedToken when present.
const unbrandedSpawnedAgentKind: SpawnedData = { ...spawnedData, agentKind: 'codex' };
// @ts-expect-error agent.spawned label must be OpaqueText when present.
const unbrandedSpawnedLabel: SpawnedData = { ...spawnedData, label: 'worker' };
void missingTaskId;
void missingOperationId;
void missingPermissionId;
void missingTurnId;
void missingAgentId;
void assertDiscriminatedUnion;
void requiredSemanticIsRequired;
void unrelatedSemanticIsOptional;
void missingRequiredSemantic;
void omittedOptionalSemantic;
void validReopenCorrection;
void validOutcomeCorrection;
void invalidReopenCorrection;
void invalidOutcomeCorrection;
void mismatchedOutcomeCorrection;
void mismatchedSemanticOutcome;
void wrongCompletedOutcome;
void timeoutTaskSuccess;
void timeoutCorrectedSuccess;
void provisionalCompletedFinality;
void confirmedCompletionCheckpointFinality;
void wrongFailedOutcome;
void wrongDeniedOutcome;
void wrongCancelledOutcome;
void wrongAbandonedOutcome;
void unbrandedConnectedAgentKind;
void invalidConnectedRevision;
void unbrandedSpawnedAgentKind;
void unbrandedSpawnedLabel;

const brandedAgentKind: SanitizedToken = sanitizedToken('codex');
const brandedAgentLabel: OpaqueText = opaqueText('worker');
void brandedAgentKind;
void brandedAgentLabel;

const initialPlan: PlanReconciledData = { revision: 1, complete: true, items: [] };
// @ts-expect-error revision one must not carry a previous revision.
const initialPlanWithPrevious: PlanReconciledData = {
  revision: 1,
  previousRevision: 0,
  complete: true,
  items: [],
};
const subsequentPlan: PlanReconciledData = {
  ...planRevision(2, 1),
  complete: true,
  items: [],
};
// @ts-expect-error later plan revisions must use the branded exact-predecessor factory.
const rawSubsequentPlan: PlanReconciledData = {
  revision: 3,
  previousRevision: 1,
  complete: true,
  items: [],
};

const partialCapability: SignalCapability = {
  availability: 'partial',
  evidenceQuality: 'derived',
  coverage: 'partial',
  finality: 'provisional',
  exclusions: [{ code: 'hosted-tools' }],
};
const unsupportedCapability: SignalCapability = {
  availability: 'unsupported',
  evidenceQuality: 'none',
  coverage: 'none',
  finality: 'provisional',
  exclusions: [],
};
const availableCapability: SignalCapability = {
  availability: 'available',
  evidenceQuality: 'observed',
  coverage: 'full',
  finality: 'confirmed',
  exclusions: [],
};
// @ts-expect-error unsupported capability evidence must be none.
const invalidUnsupportedCapability: SignalCapability = {
  availability: 'unsupported',
  evidenceQuality: 'observed',
  coverage: 'none',
  finality: 'provisional',
  exclusions: [],
};
// @ts-expect-error available capability finality cannot be provisional.
const invalidAvailableCapability: SignalCapability = {
  availability: 'available',
  evidenceQuality: 'observed',
  coverage: 'full',
  finality: 'provisional',
  exclusions: [],
};
// @ts-expect-error partial capability must explain its exclusions with a non-empty tuple.
const emptyPartialCapability: SignalCapability = {
  availability: 'partial',
  evidenceQuality: 'derived',
  coverage: 'partial',
  finality: 'provisional',
  exclusions: [],
};
void initialPlan;
void initialPlanWithPrevious;
void subsequentPlan;
void rawSubsequentPlan;
void partialCapability;
void unsupportedCapability;
void availableCapability;
void invalidUnsupportedCapability;
void invalidAvailableCapability;
void emptyPartialCapability;

const capability = {
  revision: 1,
  effectiveSequence: 1,
  platform: { agentKind: 'codex', agentVersion: '1.0.0' },
  session: { mode: 'interactive' },
  signals: Object.fromEntries(
    ['sessions', 'turns', 'tasks', 'taskPlan', 'agents', 'tools', 'permissions'].map((key) => [
      key,
      {
        availability: 'available',
        evidenceQuality: 'observed',
        coverage: 'full',
        finality: 'mixed',
        exclusions: [],
      },
    ]),
  ),
  exclusions: [],
};
const data: Record<CoreEventType, Record<string, unknown>> = {
  'source.connected': { agentKind: 'codex', agentVersion: '1.0.0', capabilities: capability },
  'source.capability.changed': {
    capabilities: { ...capability, revision: 2, effectiveSequence: 1 },
    previousRevision: 1,
    effectiveSequence: 1,
  },
  'source.heartbeat': { uptimeMs: 1 },
  'source.disconnected': { reason: 'normal' },
  'telemetry.gap': { fromSequence: 1, toSequence: 2, reason: 'dropped' },
  'workspace.discovered': { label: 'opaque', vcs: 'git' },
  'session.started': { resume: false },
  'session.ended': { reason: 'normal' },
  'turn.started': { objectiveLabel: 'opaque' },
  'turn.finished': { outcome: 'completed' },
  'turn.quiescent': { reason: 'native' },
  'agent.spawned': { role: 'worker', agentKind: 'codex', label: 'opaque', depth: 0 },
  'agent.state.changed': { from: 'starting', to: 'working', reason: 'native' },
  'agent.finished': { outcome: 'completed' },
  'task.created': { label: 'opaque', status: 'pending', ordinal: 0, fallback: false },
  'task.updated': { label: 'opaque', status: 'in_progress', ordinal: 0 },
  'task.assigned': { assigneeAgentId: 'agent-1' },
  'task.completion.requested': { requestedStatus: 'completed', checkpoint: 'native' },
  'task.completed': { completion: 'observed' },
  'task.failed': { category: 'validation' },
  'task.denied': { reason: 'permission' },
  'task.cancelled': { reason: 'replanned' },
  'task.abandoned': { reason: 'timeout' },
  'task.corrected': {
    correction: 'reopen',
    correctedEventId: 'event-0',
    correctedEntityId: 'task-1',
    status: 'in_progress',
  },
  'task.plan.reconciled': {
    revision: 1,
    complete: true,
    items: [{ taskId: 'task-1', status: 'pending', ordinal: 0, identityBasis: 'stable-native-id' }],
  },
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
  'turn.quiescent': { turnId: 'turn-1' },
  'agent.spawned': { agentId: 'agent-1' },
  'agent.state.changed': { agentId: 'agent-1' },
  'agent.finished': { agentId: 'agent-1' },
  'task.created': { taskId: 'task-1' },
  'task.updated': { taskId: 'task-1' },
  'task.assigned': { taskId: 'task-1' },
  'task.completion.requested': { taskId: 'task-1' },
  'task.completed': { taskId: 'task-1' },
  'task.failed': { taskId: 'task-1' },
  'task.denied': { taskId: 'task-1' },
  'task.cancelled': { taskId: 'task-1' },
  'task.abandoned': { taskId: 'task-1' },
  'task.corrected': { taskId: 'task-1' },
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
    finality: type === 'task.completion.requested' ? 'provisional' : 'confirmed',
    data: data[type],
    ...(type === 'source.capability.changed'
      ? { semantic: { kind: 'capability', terminal: false } }
      : {}),
    ...(type === 'telemetry.gap' ? { semantic: { kind: 'gap', terminal: false } } : {}),
    ...(type === 'turn.quiescent' ? { semantic: { kind: 'quiescence', terminal: false } } : {}),
    ...(type === 'task.completion.requested'
      ? { semantic: { kind: 'checkpoint', terminal: false } }
      : {}),
    ...(type === 'task.completed'
      ? { semantic: { kind: 'outcome', terminal: true, outcome: 'success' } }
      : {}),
    ...(type === 'task.failed'
      ? { semantic: { kind: 'outcome', terminal: true, outcome: 'failure' } }
      : {}),
    ...(type === 'task.denied'
      ? { semantic: { kind: 'outcome', terminal: true, outcome: 'denied' } }
      : {}),
    ...(type === 'task.cancelled'
      ? { semantic: { kind: 'outcome', terminal: true, outcome: 'cancelled' } }
      : {}),
    ...(type === 'task.abandoned'
      ? { semantic: { kind: 'outcome', terminal: true, outcome: 'abandoned' } }
      : {}),
    ...(type === 'task.corrected'
      ? {
          semantic: {
            kind: 'correction',
            terminal: false,
            correctionOfEventId: 'event-0',
            correctionOfEntityId: 'task-1',
          },
        }
      : {}),
  };
}

describe('AAP Draft 2020-12 conformance', () => {
  it('keeps terminal evidence explicit and rejects timeout success or unlinked corrections', () => {
    expect(canTransferTerminalState('exact-ordinal-continuity')).toBe(false);
    expect(canTransferTerminalState('exact-normalized-identity')).toBe(true);
    expect(
      validateEvent({ ...fixture('task.completion.requested'), finality: 'confirmed' }),
    ).toMatchObject({ status: 'rejected' });
    expect(
      validateEvent({
        ...fixture('task.abandoned'),
        semantic: { kind: 'outcome', terminal: true, outcome: 'success' },
      }),
    ).toMatchObject({ status: 'rejected' });
    expect(
      validateEvent({
        ...fixture('task.corrected'),
        semantic: {
          kind: 'correction',
          terminal: true,
          correctionOfEventId: 'other',
          correctionOfEntityId: 'task-1',
        },
      }),
    ).toMatchObject({ status: 'rejected' });
  });

  it('requires complete ordered plan revisions and blocks unsafe terminal transfer', () => {
    const event = fixture('task.plan.reconciled');
    expect(
      validateEvent({
        ...event,
        data: {
          revision: 2,
          previousRevision: 1,
          complete: true,
          items: [
            {
              taskId: 'task-1',
              status: 'completed',
              ordinal: 0,
              identityBasis: 'exact-ordinal-continuity',
            },
          ],
        },
      }),
    ).toMatchObject({ status: 'rejected' });
    expect(
      validateEvent({
        ...event,
        data: {
          revision: 2,
          previousRevision: 1,
          complete: true,
          items: [
            {
              taskId: 'task-1',
              status: 'completed',
              ordinal: 0,
              identityBasis: 'exact-normalized-identity',
            },
          ],
        },
      }).status,
    ).toBe('accepted');
    expect(
      validateEvent({
        ...event,
        data: {
          revision: 2,
          previousRevision: 1,
          complete: true,
          items: [
            { taskId: 'task-1', status: 'pending', ordinal: 0, identityBasis: 'stable-native-id' },
            { taskId: 'task-2', status: 'pending', ordinal: 0, identityBasis: 'new-unmatched' },
          ],
        },
      }),
    ).toMatchObject({ status: 'rejected' });
  });

  it('models partial and unsupported signals and requires sequenced capability changes', () => {
    const connected = fixture('source.connected');
    const partial = structuredClone(connected) as Record<string, unknown>;
    const caps = partial.data as Record<string, unknown>;
    (caps.capabilities as Record<string, unknown>).signals = {
      ...((caps.capabilities as Record<string, unknown>).signals as object),
      tools: {
        availability: 'partial',
        evidenceQuality: 'derived',
        coverage: 'partial',
        finality: 'provisional',
        exclusions: [{ code: 'hosted-tools', scope: 'signal' }],
      },
    };
    expect(validateEvent(partial).status).toBe('accepted');
    const partialWithoutExclusions = structuredClone(partial) as Record<string, unknown>;
    (
      (
        (partialWithoutExclusions.data as Record<string, unknown>).capabilities as Record<
          string,
          unknown
        >
      ).signals as Record<string, unknown>
    ).tools = {
      availability: 'partial',
      evidenceQuality: 'derived',
      coverage: 'partial',
      finality: 'provisional',
      exclusions: [],
    };
    expect(validateEvent(partialWithoutExclusions).status).toBe('rejected');
    const unsupported = structuredClone(partial) as Record<string, unknown>;
    (
      ((unsupported.data as Record<string, unknown>).capabilities as Record<string, unknown>)
        .signals as Record<string, unknown>
    ).tools = {
      availability: 'unsupported',
      evidenceQuality: 'none',
      coverage: 'none',
      finality: 'provisional',
      exclusions: [],
    };
    expect(validateEvent(unsupported).status).toBe('accepted');
    const available = structuredClone(partial) as Record<string, unknown>;
    (
      ((available.data as Record<string, unknown>).capabilities as Record<string, unknown>)
        .signals as Record<string, unknown>
    ).tools = {
      availability: 'available',
      evidenceQuality: 'observed',
      coverage: 'full',
      finality: 'confirmed',
      exclusions: [],
    };
    expect(validateEvent(available).status).toBe('accepted');
    const badAvailable = structuredClone(available) as Record<string, unknown>;
    (
      ((badAvailable.data as Record<string, unknown>).capabilities as Record<string, unknown>)
        .signals as Record<string, unknown>
    ).tools = {
      availability: 'available',
      evidenceQuality: 'none',
      coverage: 'full',
      finality: 'provisional',
      exclusions: [],
    };
    expect(validateEvent(badAvailable).status).toBe('rejected');
    expect(
      validateEvent({
        ...fixture('source.capability.changed'),
        data: { ...(fixture('source.capability.changed').data as object), previousRevision: 4 },
      }),
    ).toMatchObject({ status: 'rejected' });
  });

  it('enforces revision one omission and exact predecessor revisions', () => {
    const base = fixture('task.plan.reconciled');
    const validator =
      compileCoreEventSchemas()[
        (Object.keys(coreEventSchemas) as CoreEventType[]).indexOf('task.plan.reconciled')
      ]!;
    const externallyCompiled = new (
      Ajv2020Module.default as unknown as new (options: object) => {
        addKeyword: (definition: object) => unknown;
        getKeyword: (keyword: string) => unknown;
        compile: (schema: object) => (value: unknown) => boolean;
      }
    )({ strict: false, allErrors: false, validateFormats: true });
    (addFormatsModule.default as unknown as (instance: object) => void)(externallyCompiled);
    registerProtocolSchemaKeywords(externallyCompiled);
    const publishedSchemaValidator = externallyCompiled.compile(
      coreEventSchemas['task.plan.reconciled'],
    );
    expect(
      (coreEventSchemas['task.plan.reconciled'].properties as Record<string, unknown>).data,
    ).toMatchObject({
      [protocolSchemaKeywordNames.planRevision]: true,
    });
    const revisionOne = { ...base, data: { revision: 1, complete: true, items: [] } };
    expect(validator(revisionOne)).toBe(true);
    expect(publishedSchemaValidator(revisionOne)).toBe(true);
    expect(validateEvent(revisionOne).status).toBe('accepted');
    const revisionOneWithPrevious = {
      ...base,
      data: { revision: 1, previousRevision: 0, complete: true, items: [] },
    };
    expect(validator(revisionOneWithPrevious)).toBe(false);
    expect(publishedSchemaValidator(revisionOneWithPrevious)).toBe(false);
    expect(validateEvent(revisionOneWithPrevious).status).toBe('rejected');
    expect(
      validator({
        ...base,
        data: { revision: 2, previousRevision: 1, complete: true, items: [] },
      }),
    ).toBe(true);
    expect(
      validator({
        ...base,
        data: { revision: 2, previousRevision: 0, complete: true, items: [] },
      }),
    ).toBe(false);
    const skippedRevision = {
      ...base,
      data: { revision: 3, previousRevision: 1, complete: true, items: [] },
    };
    expect(validator(skippedRevision)).toBe(false);
    expect(publishedSchemaValidator(skippedRevision)).toBe(false);
    expect(validateEvent(skippedRevision).status).toBe('rejected');
    expect(() => planRevision(3, 1)).toThrow('invalid plan revision');
    expect(planRevision(3, 2)).toEqual({ revision: 3, previousRevision: 2 });
    expect(
      validateEvent({
        ...base,
        data: { revision: 1, previousRevision: 0, complete: true, items: [] },
      }).status,
    ).toBe('rejected');
    expect(
      validateEvent({ ...base, data: { revision: 1, complete: true, items: [] } }).status,
    ).toBe('accepted');
    expect(
      validateEvent({
        ...base,
        data: { revision: 3, previousRevision: 1, complete: true, items: [] },
      }).status,
    ).toBe('rejected');
    expect(
      validateEvent({
        ...base,
        data: { revision: 3, previousRevision: 2, complete: true, items: [] },
      }).status,
    ).toBe('accepted');
  });

  it('uses Unicode code-point length for opaque text across factory, schema, and runtime', () => {
    const valid = '😀'.repeat(256);
    const invalid = '😀'.repeat(257);
    expect(opaqueText(valid)).toBe(valid);
    expect(() => opaqueText(invalid)).toThrow('invalid opaque text');
    const validator =
      compileCoreEventSchemas()[
        (Object.keys(coreEventSchemas) as CoreEventType[]).indexOf('workspace.discovered')
      ]!;
    const validEvent = {
      ...fixture('workspace.discovered'),
      data: { label: valid, vcs: 'git' },
    };
    expect(validator(validEvent)).toBe(true);
    expect(validateEvent(validEvent).status).toBe('accepted');
    const invalidEvent = {
      ...fixture('workspace.discovered'),
      data: { label: invalid, vcs: 'git' },
    };
    expect(validator(invalidEvent)).toBe(false);
    expect(validateEvent(invalidEvent).status).toBe('rejected');
  });

  it('requires plan ordinals to be zero-based, ordered, contiguous, and unique', () => {
    const base = fixture('task.plan.reconciled');
    const types = Object.keys(coreEventSchemas) as CoreEventType[];
    const validator = compileCoreEventSchemas()[types.indexOf('task.plan.reconciled')]!;
    const item = (taskId: string, ordinal: number) => ({
      taskId,
      status: 'pending',
      ordinal,
      identityBasis: 'new-unmatched',
    });
    for (const items of [
      [item('a', 1), item('b', 2)],
      [item('a', 0), item('b', 2)],
      [item('a', 1), item('b', 0)],
      [item('a', 0), item('a', 1)],
    ] as const) {
      const event = { ...base, data: { revision: 1, complete: true, items } };
      expect(validator(event)).toBe(false);
      expect(validateEvent(event).status).toBe('rejected');
    }
    const unsafeTerminal = {
      ...base,
      data: {
        revision: 1,
        complete: true,
        items: [{ taskId: 'a', status: 'completed', ordinal: 0, identityBasis: 'new-unmatched' }],
      },
    };
    expect(validator(unsafeTerminal)).toBe(false);
    expect(validateEvent(unsafeTerminal).status).toBe('rejected');
    const validTerminal = {
      ...base,
      data: {
        revision: 1,
        complete: true,
        items: [
          {
            taskId: 'a',
            status: 'completed',
            ordinal: 0,
            identityBasis: 'exact-normalized-identity',
          },
        ],
      },
    };
    expect(validator(validTerminal)).toBe(true);
    expect(validateEvent(validTerminal).status).toBe('accepted');
    expect(
      validateEvent({
        ...base,
        data: { revision: 1, complete: true, items: [item('a', 0), item('b', 1)] },
      }).status,
    ).toBe('accepted');
  });

  it('keeps denied, abandoned, and unknown terminal statuses explicit', () => {
    const base = fixture('task.plan.reconciled');
    for (const status of ['denied', 'abandoned', 'unknown'] as const) {
      expect(
        validateEvent({
          ...base,
          data: {
            revision: 1,
            complete: true,
            items: [{ taskId: 'a', status, ordinal: 0, identityBasis: 'exact-ordinal-continuity' }],
          },
        }).status,
      ).toBe('rejected');
      expect(
        validateEvent({
          ...base,
          data: {
            revision: 1,
            complete: true,
            items: [{ taskId: 'a', status, ordinal: 0, identityBasis: 'stable-native-id' }],
          },
        }).status,
      ).toBe('accepted');
    }
  });

  it('distinguishes reopen and replace-outcome corrections', () => {
    const base = fixture('task.corrected');
    const validator =
      compileCoreEventSchemas()[
        (Object.keys(coreEventSchemas) as CoreEventType[]).indexOf('task.corrected')
      ]!;
    expect(coreEventSchemas['task.corrected']).toMatchObject({
      [protocolSchemaKeywordNames.correctionReferences]: true,
    });
    expect(validator(base)).toBe(true);
    expect(validateEvent(base).status).toBe('accepted');
    for (const property of ['correctionOfEventId', 'correctionOfEntityId'] as const) {
      const mismatched = {
        ...base,
        semantic: { ...(base.semantic as object), [property]: 'other' },
      };
      expect(validator(mismatched)).toBe(false);
      expect(validateEvent(mismatched).status).toBe('rejected');
    }
    expect(
      validateEvent({
        ...base,
        data: {
          ...(base.data as object),
          status: 'completed',
          resultingOutcome: 'success',
          correction: 'replace-outcome',
        },
        semantic: { kind: 'outcome', terminal: true, outcome: 'success' },
      }).status,
    ).toBe('accepted');
    expect(
      validateEvent({
        ...base,
        data: { ...(base.data as object), correction: 'reopen', status: 'completed' },
        semantic: {
          kind: 'correction',
          terminal: false,
          correctionOfEventId: 'event-0',
          correctionOfEntityId: 'task-1',
        },
      }).status,
    ).toBe('rejected');
    expect(
      validateEvent({
        ...base,
        data: { ...(base.data as object), correction: 'replace-outcome', status: 'in_progress' },
        semantic: { kind: 'outcome', terminal: true, outcome: 'success' },
      }).status,
    ).toBe('rejected');
  });

  it('correlates terminal outcomes in types, direct schemas, and runtime', () => {
    const validators = compileCoreEventSchemas();
    const correctedValidator =
      validators[(Object.keys(coreEventSchemas) as CoreEventType[]).indexOf('task.corrected')]!;
    for (const [status, outcome] of [
      ['completed', 'success'],
      ['failed', 'failure'],
      ['denied', 'denied'],
      ['cancelled', 'cancelled'],
      ['abandoned', 'abandoned'],
      ['unknown', 'unknown'],
    ] as const) {
      const valid = {
        ...fixture('task.corrected'),
        data: {
          correction: 'replace-outcome',
          correctedEventId: 'event-0',
          correctedEntityId: 'task-1',
          status,
          resultingOutcome: outcome,
        },
        semantic: { kind: 'outcome', terminal: true, outcome },
      };
      expect(correctedValidator(valid)).toBe(true);
      expect(validateEvent(valid).status).toBe('accepted');
      const contradictorySemantic = {
        ...valid,
        semantic: {
          kind: 'outcome',
          terminal: true,
          outcome: outcome === 'success' ? 'failure' : 'success',
        },
      };
      expect(correctedValidator(contradictorySemantic)).toBe(false);
      expect(validateEvent(contradictorySemantic).status).toBe('rejected');
      const contradictoryData = {
        ...valid,
        data: { ...valid.data, resultingOutcome: outcome === 'success' ? 'failure' : 'success' },
      };
      expect(correctedValidator(contradictoryData)).toBe(false);
      expect(validateEvent(contradictoryData).status).toBe('rejected');
    }
    for (const [type, outcome] of [
      ['task.completed', 'success'],
      ['task.failed', 'failure'],
      ['task.denied', 'denied'],
      ['task.cancelled', 'cancelled'],
      ['task.abandoned', 'abandoned'],
    ] as const) {
      const event = fixture(type);
      expect(
        validateEvent({
          ...event,
          semantic: { kind: 'outcome', terminal: true, outcome: 'unknown' },
        }).status,
      ).toBe('rejected');
      expect(
        validateEvent({
          ...event,
          semantic: { kind: 'outcome', terminal: true, outcome },
        }).status,
      ).toBe('accepted');
    }
  });

  it('rejects timeout-based success in task outcomes and corrections', () => {
    const types = Object.keys(coreEventSchemas) as CoreEventType[];
    const validators = compileCoreEventSchemas();
    const completedValidator = validators[types.indexOf('task.completed')]!;
    const correctedValidator = validators[types.indexOf('task.corrected')]!;
    const timeoutCompleted = {
      ...fixture('task.completed'),
      semantic: { kind: 'outcome', terminal: true, outcome: 'success', basis: 'timeout' },
    };
    expect(completedValidator(timeoutCompleted)).toBe(false);
    expect(validateEvent(timeoutCompleted).status).toBe('rejected');

    const timeoutCorrection = {
      ...fixture('task.corrected'),
      data: {
        correction: 'replace-outcome',
        correctedEventId: 'event-0',
        correctedEntityId: 'task-1',
        status: 'completed',
        resultingOutcome: 'success',
      },
      semantic: { kind: 'outcome', terminal: true, outcome: 'success', basis: 'timeout' },
    };
    expect(correctedValidator(timeoutCorrection)).toBe(false);
    expect(validateEvent(timeoutCorrection).status).toBe('rejected');

    const validCompleted = {
      ...fixture('task.completed'),
      semantic: { kind: 'outcome', terminal: true, outcome: 'success', basis: 'native' },
    };
    expect(completedValidator(validCompleted)).toBe(true);
    expect(validateEvent(validCompleted).status).toBe('accepted');
    const validCorrection = {
      ...fixture('task.corrected'),
      data: {
        correction: 'replace-outcome',
        correctedEventId: 'event-0',
        correctedEntityId: 'task-1',
        status: 'completed',
        resultingOutcome: 'success',
      },
      semantic: { kind: 'outcome', terminal: true, outcome: 'success', basis: 'derived' },
    };
    expect(correctedValidator(validCorrection)).toBe(true);
    expect(validateEvent(validCorrection).status).toBe('accepted');
  });

  it('keeps fixed finality parity for terminal and checkpoint semantics', () => {
    const types = Object.keys(coreEventSchemas) as CoreEventType[];
    const validators = compileCoreEventSchemas();
    for (const type of [
      'task.completed',
      'task.failed',
      'task.denied',
      'task.cancelled',
      'task.abandoned',
      'task.corrected',
      'source.capability.changed',
    ] as const) {
      const event = { ...fixture(type), finality: 'provisional' };
      expect(validators[types.indexOf(type)]!(event)).toBe(false);
      expect(validateEvent(event).status).toBe('rejected');
    }
    const checkpoint = { ...fixture('task.completion.requested'), finality: 'confirmed' };
    expect(validators[types.indexOf('task.completion.requested')]!(checkpoint)).toBe(false);
    expect(validateEvent(checkpoint).status).toBe('rejected');
  });

  it('requires source.connected capability revision one in direct schema and runtime', () => {
    const validators = compileCoreEventSchemas();
    const connectedValidator = validators[0]!;
    for (const revision of [0, 2]) {
      const event = {
        ...fixture('source.connected'),
        data: {
          ...(fixture('source.connected').data as object),
          capabilities: {
            ...((fixture('source.connected').data as Record<string, unknown>)
              .capabilities as object),
            revision,
          },
        },
      };
      expect(connectedValidator(event)).toBe(false);
      expect(validateEvent(event).status).toBe('rejected');
    }
  });

  it('aligns sanitized agent kinds and opaque agent labels across schema and runtime', () => {
    const validators = compileCoreEventSchemas();
    const types = Object.keys(coreEventSchemas) as CoreEventType[];
    const connectedValidator = validators[types.indexOf('source.connected')]!;
    const spawnedValidator = validators[types.indexOf('agent.spawned')]!;
    const invalidConnectedKind = {
      ...fixture('source.connected'),
      data: { ...(fixture('source.connected').data as object), agentKind: 'codex worker' },
    };
    expect(connectedValidator(invalidConnectedKind)).toBe(false);
    expect(validateEvent(invalidConnectedKind).status).toBe('rejected');
    const invalidSpawnedKind = {
      ...fixture('agent.spawned'),
      data: { ...(fixture('agent.spawned').data as object), agentKind: 'codex worker' },
    };
    expect(spawnedValidator(invalidSpawnedKind)).toBe(false);
    expect(validateEvent(invalidSpawnedKind).status).toBe('rejected');
    const invalidSpawnedLabel = {
      ...fixture('agent.spawned'),
      data: { ...(fixture('agent.spawned').data as object), label: 'worker\n' },
    };
    expect(spawnedValidator(invalidSpawnedLabel)).toBe(false);
    expect(validateEvent(invalidSpawnedLabel).status).toBe('rejected');
  });

  it('enforces capability matrix and effective sequence coherence', () => {
    const connected = fixture('source.connected');
    const badUnsupported = structuredClone(connected) as Record<string, unknown>;
    const signals = (
      (badUnsupported.data as Record<string, unknown>).capabilities as Record<string, unknown>
    ).signals as Record<string, unknown>;
    signals.tools = {
      availability: 'unsupported',
      evidenceQuality: 'observed',
      coverage: 'none',
      finality: 'provisional',
      exclusions: [],
    };
    expect(validateEvent(badUnsupported).status).toBe('rejected');
    const badPartial = structuredClone(connected) as Record<string, unknown>;
    const partialSignals = (
      (badPartial.data as Record<string, unknown>).capabilities as Record<string, unknown>
    ).signals as Record<string, unknown>;
    partialSignals.tools = {
      availability: 'partial',
      evidenceQuality: 'derived',
      coverage: 'partial',
      finality: 'provisional',
      exclusions: [],
    };
    expect(validateEvent(badPartial).status).toBe('rejected');
    expect(validateEvent({ ...connected, sequence: 2 }).status).toBe('rejected');
    expect(
      validateEvent({
        ...fixture('source.capability.changed'),
        data: {
          ...(fixture('source.capability.changed').data as object),
          capabilities: {
            ...((fixture('source.capability.changed').data as Record<string, unknown>)
              .capabilities as object),
            effectiveSequence: 2,
          },
        },
      }).status,
    ).toBe('rejected');
  });

  it('keeps capability coherence identical in direct schemas and runtime', () => {
    const types = Object.keys(coreEventSchemas) as CoreEventType[];
    const validators = compileCoreEventSchemas();
    const validate = (type: CoreEventType, event: Record<string, unknown>, accepted: boolean) => {
      const schemaAccepted = validators[types.indexOf(type)]!(event);
      expect(schemaAccepted).toBe(accepted);
      expect(validateEvent(event).status === 'accepted').toBe(accepted);
    };

    const connected = fixture('source.connected');
    validate('source.connected', connected, true);
    validate('source.connected', { ...connected, sequence: 2 }, false);
    validate(
      'source.connected',
      {
        ...connected,
        data: {
          ...(connected.data as object),
          capabilities: {
            ...((connected.data as Record<string, unknown>).capabilities as object),
            effectiveSequence: 2,
          },
        },
      },
      false,
    );

    const changed = fixture('source.capability.changed');
    validate('source.capability.changed', changed, true);
    validate('source.capability.changed', { ...changed, sequence: 2 }, false);
    validate(
      'source.capability.changed',
      {
        ...changed,
        data: {
          ...(changed.data as object),
          effectiveSequence: 2,
        },
      },
      false,
    );
    validate(
      'source.capability.changed',
      {
        ...changed,
        data: {
          ...(changed.data as object),
          capabilities: {
            ...((changed.data as Record<string, unknown>).capabilities as object),
            effectiveSequence: 2,
          },
        },
      },
      false,
    );
    validate(
      'source.capability.changed',
      {
        ...changed,
        data: {
          ...(changed.data as object),
          previousRevision: 2,
        },
      },
      false,
    );
    validate(
      'source.capability.changed',
      {
        ...changed,
        data: {
          ...(changed.data as object),
          capabilities: {
            ...((changed.data as Record<string, unknown>).capabilities as object),
            revision: 3,
          },
        },
      },
      false,
    );
  });

  it('rejects raw native event text while accepting a sanitized native token', () => {
    expect(
      validateEvent({
        ...fixture('session.started'),
        source: {
          ...(fixture('session.started').source as object),
          nativeEvent: 'raw command text',
        },
      }).status,
    ).toBe('rejected');
    expect(
      validateEvent({
        ...fixture('session.started'),
        source: { ...(fixture('session.started').source as object), nativeToken: 'hook.pre_tool' },
      }).status,
    ).toBe('accepted');
    expect(
      validateEvent({
        ...fixture('tool.started'),
        data: { name: 'shell command --secret', category: 'shell' },
      }).status,
    ).toBe('rejected');
  });

  it('exports and executes every one of the 31 core discriminants', () => {
    const types = Object.keys(coreEventSchemas) as CoreEventType[];
    expect(types).toHaveLength(31);
    expect(compileCoreEventSchemas()).toHaveLength(31);
    for (const type of types) {
      expect(coreEventSchemas[type]).toMatchObject({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        'x-codeinvaders-limits': { maxBytes: MAX_EVENT_BYTES, maxDepth: MAX_JSON_DEPTH },
      });
      expect(validateEvent(fixture(type))).toMatchObject({ status: 'accepted' });
    }
  });

  it('registers every functional and annotation keyword idempotently for strict Ajv', () => {
    const AjvConstructor = Ajv2020Module.default as unknown as new (options: object) => {
      addKeyword: (definition: object) => unknown;
      getKeyword: (keyword: string) => unknown;
      compile: (schema: object) => unknown;
    };
    const strictAjv = new AjvConstructor({ strict: true, allErrors: false, validateFormats: true });
    (addFormatsModule.default as unknown as (instance: object) => void)(strictAjv);
    expect(() => {
      registerProtocolSchemaKeywords(strictAjv);
      registerProtocolSchemaKeywords(strictAjv);
      for (const schema of Object.values(coreEventSchemas)) strictAjv.compile(schema);
    }).not.toThrow();
  });

  it('executes each exported schema directly and rejects every nested required property', () => {
    type TestSchema = {
      required?: readonly string[];
      properties?: Record<string, TestSchema>;
    };
    const schemas = Object.values(coreEventSchemas) as TestSchema[];
    const validators = compileCoreEventSchemas();
    const removeRequired = (
      schema: TestSchema,
      value: unknown,
      path: string[] = [],
    ): string[][] => {
      const paths: string[][] = [];
      for (const property of schema.required ?? []) {
        paths.push([...path, property]);
      }
      for (const [property, child] of Object.entries(schema.properties ?? {})) {
        if (
          child &&
          typeof child === 'object' &&
          value &&
          typeof value === 'object' &&
          property in value
        )
          paths.push(
            ...removeRequired(child, (value as Record<string, unknown>)[property], [
              ...path,
              property,
            ]),
          );
      }
      return paths;
    };
    const remove = (value: Record<string, unknown>, path: string[]) => {
      const copy = structuredClone(value);
      let current: Record<string, unknown> = copy;
      for (const property of path.slice(0, -1)) {
        if (!current[property] || typeof current[property] !== 'object') return copy;
        current = current[property] as Record<string, unknown>;
      }
      delete current[path[path.length - 1]!];
      return copy;
    };
    for (const [index, type] of (Object.keys(coreEventSchemas) as CoreEventType[]).entries()) {
      const schema = schemas[index]!;
      const validator = validators[index]!;
      const event = fixture(type);
      expect(validator(event)).toBe(true);
      for (const path of removeRequired(schema, event)) {
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
    const compatibleCoreEvent = {
      ...fixture('session.started'),
      data: {
        ...(fixture('session.started').data as object),
        nested: { message: 'opaque', path: 'opaque', url: 'opaque', query: 'opaque', payload: {} },
      },
      future: { ignored: true },
    };
    expect(validateEvent(compatibleCoreEvent).status).toBe('accepted');
    expect(
      validateEvent({
        ...fixture('task.created'),
        data: {
          ...(fixture('task.created').data as object),
          nested: {
            message: 'opaque',
            path: 'opaque',
            url: 'opaque',
            query: 'opaque',
            payload: {},
          },
        },
      }).status,
    ).toBe('accepted');
    const extension = {
      ...fixture('session.started'),
      type: 'x.io.example.telemetry',
      extension: {
        fallback: 'preserve-in-journal',
        documentation: 'Preserve as an opaque journal record.',
      },
      data: {
        value: 'opaque',
        nested: { message: 'opaque', path: 'opaque', url: 'opaque', query: 'opaque', payload: {} },
      },
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
      validateEvent({
        ...fixture('task.created'),
        data: { label: 'bad\nlabel', status: 'pending', fallback: false },
      }),
    ).toMatchObject({ status: 'rejected' });
    expect(
      validateEvent({ ...fixture('tool.started'), data: { name: 'bad name', category: 'shell' } }),
    ).toMatchObject({ status: 'rejected' });
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

  it('uses Unicode code-point length for extension documentation at the schema boundary', () => {
    const AjvConstructor = Ajv2020Module.default as unknown as new (options: object) => {
      compile: (schema: object) => (value: unknown) => boolean;
    };
    const externalAjv = new AjvConstructor({
      strict: false,
      allErrors: false,
      validateFormats: true,
    });
    (addFormatsModule.default as unknown as (instance: object) => void)(externalAjv);
    const validator = externalAjv.compile(extensionEventSchema);
    const base = {
      ...fixture('session.started'),
      type: 'x.io.example.telemetry',
      extension: { fallback: 'preserve-in-journal', documentation: '' },
      data: { value: 'opaque' },
    };
    const valid = { ...base, extension: { ...base.extension, documentation: '😀'.repeat(512) } };
    const invalid = { ...base, extension: { ...base.extension, documentation: '😀'.repeat(513) } };
    expect(validator(valid)).toBe(true);
    expect(validateEvent(valid).status).toBe('preserved-extension');
    expect(validator(invalid)).toBe(false);
    expect(validateEvent(invalid).status).toBe('rejected');
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
