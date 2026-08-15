import { describe, expect, it } from 'vitest';
import * as Ajv2020Module from 'ajv/dist/2020.js';
import * as addFormatsModule from 'ajv-formats';
import {
  MAX_EVENT_BYTES,
  MAX_EXTENSION_BYTES,
  MAX_JSON_DEPTH,
  MAX_CANONICAL_ARRAY_LENGTH,
  MAX_CANONICAL_STATE_BYTES,
  MAX_CANONICAL_STATE_CONTAINERS,
  MAX_CANONICAL_STATE_DEPTH,
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
  CanonicalSerializationError,
  canonicalizeEvent,
  canonicalizeState,
  encodeCanonicalEvent,
  encodeCanonicalState,
  serializeCanonicalEvent,
  serializeCanonicalState,
} from './index.js';
import { requiredScopeByEvent, validEventFixture } from './fixtures/index.js';

declare const process: {
  readonly execPath: string;
  cwd(): string;
};

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

const fixture = validEventFixture;

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
        data: {
          ...(fixture('source.connected').data as object),
          capabilities: { sessions: 'bad' },
        },
      }),
    ).toMatchObject({ status: 'rejected' });
  });

  it('checks scope requirements for every event-specific scope', () => {
    for (const [type, scope] of Object.entries(requiredScopeByEvent) as [
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

  it('keeps every validateEvent envelope read total without invoking accessors', () => {
    const canary = 'VALIDATE-TRAP-SECRET';
    const accessorFields: Array<{
      field: 'version' | 'type' | 'data' | 'source' | 'scope' | 'semantic';
      eventType: CoreEventType;
      enumerable: boolean;
      diagnosticField: string;
    }> = [
      {
        field: 'version',
        eventType: 'session.started',
        enumerable: false,
        diagnosticField: 'version',
      },
      { field: 'type', eventType: 'session.started', enumerable: true, diagnosticField: 'type' },
      { field: 'data', eventType: 'session.started', enumerable: true, diagnosticField: 'data' },
      {
        field: 'source',
        eventType: 'session.started',
        enumerable: true,
        diagnosticField: 'source',
      },
      { field: 'scope', eventType: 'session.started', enumerable: true, diagnosticField: 'scope' },
      { field: 'semantic', eventType: 'task.completed', enumerable: true, diagnosticField: 'data' },
    ];
    for (const { field, eventType, enumerable, diagnosticField } of accessorFields) {
      const candidate = fixture(eventType);
      let getterCalls = 0;
      Object.defineProperty(candidate, field, {
        configurable: true,
        enumerable,
        get: () => {
          getterCalls += 1;
          throw new Error(canary);
        },
      });
      let result: ReturnType<typeof validateEvent> | undefined;
      expect(() => {
        result = validateEvent(candidate);
      }).not.toThrow();
      expect(result?.status).toBe('rejected');
      expect(result?.diagnostics[0]?.field).toBe(diagnosticField);
      expect(getterCalls).toBe(0);
      expect(JSON.stringify(result)).not.toContain(canary);
      expect(() => isCoreEvent(candidate)).not.toThrow();
      expect(isCoreEvent(candidate)).toBe(false);
    }
  });

  it('contains ownKeys, descriptor, prototype, revoked-proxy, and exported-error traps', () => {
    const canary = 'VALIDATE-PROXY-SECRET';
    const attackerError = new CanonicalSerializationError('serialization-failed', canary);
    const candidates: unknown[] = [
      new Proxy(fixture('session.started'), {
        ownKeys: () => {
          throw attackerError;
        },
      }),
      new Proxy(fixture('session.started'), {
        getOwnPropertyDescriptor: () => {
          throw new Error(canary);
        },
      }),
      new Proxy(fixture('session.started'), {
        getPrototypeOf: () => {
          throw new Error(canary);
        },
      }),
      Object.create({ leakedPrototype: canary }),
      [],
      new Date(),
    ];
    const revoked = Proxy.revocable(fixture('session.started'), {});
    revoked.revoke();
    candidates.push(revoked.proxy);
    for (const candidate of candidates) {
      let result: ReturnType<typeof validateEvent> | undefined;
      expect(() => {
        result = validateEvent(candidate);
      }).not.toThrow();
      expect(result?.status).toBe('rejected');
      expect(JSON.stringify(result)).not.toContain(canary);
      expect(() => isCoreEvent(candidate)).not.toThrow();
      expect(isCoreEvent(candidate)).toBe(false);
    }
  });

  it('does not accept missing required fields from hostile prototype pollution', () => {
    const originalVersion = Reflect.getOwnPropertyDescriptor(Object.prototype, 'version');
    const canary = 'PROTOTYPE-POLLUTION-CANARY';
    const restore = (property: string, descriptor: PropertyDescriptor | undefined): void => {
      if (descriptor === undefined) Reflect.deleteProperty(Object.prototype, property);
      else Object.defineProperty(Object.prototype, property, descriptor);
    };
    try {
      const target = fixture('session.started');
      delete target.version;
      const exactAttack = new Proxy(target, {
        getPrototypeOf(object) {
          Object.defineProperty(Object.prototype, 'version', {
            configurable: true,
            value: '1.0.0',
          });
          return Reflect.getPrototypeOf(object);
        },
      });
      const exactResult = validateEvent(exactAttack);
      expect(exactResult).toMatchObject({
        status: 'rejected',
        diagnostics: [{ code: 'invalid-version', field: 'version' }],
      });
      expect(exactResult.diagnostics.length).toBeLessThanOrEqual(2);
      expect(JSON.stringify(exactResult)).not.toContain(canary);
    } finally {
      restore('version', originalVersion);
    }

    const cases: Array<{
      property: string;
      remove: (event: Record<string, unknown>) => void;
      inherited: unknown;
    }> = [
      { property: 'spec', remove: (event) => delete event.spec, inherited: protocolId },
      { property: 'eventId', remove: (event) => delete event.eventId, inherited: 'event-1' },
      { property: 'type', remove: (event) => delete event.type, inherited: 'session.started' },
      {
        property: 'occurredAt',
        remove: (event) => delete event.occurredAt,
        inherited: '2026-08-15T14:22:31.120Z',
      },
      {
        property: 'observedAt',
        remove: (event) => delete event.observedAt,
        inherited: '2026-08-15T14:22:31.127Z',
      },
      { property: 'sequence', remove: (event) => delete event.sequence, inherited: 1 },
      {
        property: 'source',
        remove: (event) => delete event.source,
        inherited: fixture('session.started').source,
      },
      {
        property: 'scope',
        remove: (event) => delete event.scope,
        inherited: fixture('session.started').scope,
      },
      { property: 'fidelity', remove: (event) => delete event.fidelity, inherited: 'observed' },
      { property: 'finality', remove: (event) => delete event.finality, inherited: 'confirmed' },
      { property: 'data', remove: (event) => delete event.data, inherited: { resume: false } },
      {
        property: 'adapterId',
        remove: (event) => delete (event.source as Record<string, unknown>).adapterId,
        inherited: 'adapter-1',
      },
      {
        property: 'sessionId',
        remove: (event) => delete (event.scope as Record<string, unknown>).sessionId,
        inherited: 'session-1',
      },
      {
        property: 'resume',
        remove: (event) => delete (event.data as Record<string, unknown>).resume,
        inherited: false,
      },
    ];
    for (const { property, remove, inherited } of cases) {
      const original = Reflect.getOwnPropertyDescriptor(Object.prototype, property);
      try {
        const target = structuredClone(fixture('session.started')) as Record<string, unknown>;
        remove(target);
        const candidate = new Proxy(target, {
          getPrototypeOf(object) {
            Object.defineProperty(Object.prototype, property, {
              configurable: true,
              value: inherited,
            });
            return Reflect.getPrototypeOf(object);
          },
        });
        const result = validateEvent(candidate);
        expect(result.status, property).toBe('rejected');
        expect(result.diagnostics.length, property).toBeLessThanOrEqual(2);
        expect(JSON.stringify(result), property).not.toContain(canary);
      } finally {
        restore(property, original);
      }
    }
  });

  it('does not invoke inherited getters after the validation snapshot boundary', () => {
    const originalVersion = Reflect.getOwnPropertyDescriptor(Object.prototype, 'version');
    const canary = 'INHERITED-GETTER-CANARY';
    let getterCalls = 0;
    try {
      const target = fixture('session.started');
      delete target.version;
      const candidate = new Proxy(target, {
        getPrototypeOf(object) {
          Object.defineProperty(Object.prototype, 'version', {
            configurable: true,
            get: () => {
              getterCalls += 1;
              return canary;
            },
          });
          return Reflect.getPrototypeOf(object);
        },
      });
      const result = validateEvent(candidate);
      expect(result).toMatchObject({
        status: 'rejected',
        diagnostics: [{ code: 'invalid-version', field: 'version' }],
      });
      expect(getterCalls).toBe(0);
      expect(result.diagnostics.length).toBeLessThanOrEqual(2);
      expect(JSON.stringify(result)).not.toContain(canary);
    } finally {
      if (originalVersion === undefined) Reflect.deleteProperty(Object.prototype, 'version');
      else Object.defineProperty(Object.prototype, 'version', originalVersion);
    }
    expect(Reflect.getOwnPropertyDescriptor(Object.prototype, 'version')).toEqual(originalVersion);
  });

  it('rejects nested non-JSON values, arrays, symbols, cycles, and semantic traps before Ajv', () => {
    const canary = 'VALIDATE-NESTED-SECRET';
    const dataWith = (value: unknown): Record<string, unknown> => ({
      ...fixture('session.started'),
      data: { resume: false, nested: value },
    });
    const sparse = new Array(2);
    sparse[1] = 'present';
    const symbolKey: Record<string, unknown> = {};
    Object.defineProperty(symbolKey, Symbol('hidden'), { enumerable: true, value: canary });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    let nestedGetterCalls = 0;
    const nestedAccessor: Record<string, unknown> = {};
    Object.defineProperty(nestedAccessor, 'secret', {
      enumerable: true,
      get: () => {
        nestedGetterCalls += 1;
        throw new Error(canary);
      },
    });
    const nestedProxy = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error(canary);
        },
      },
    );
    let stringGetterCalls = 0;
    const toStringTrap: Record<string, unknown> = {};
    Object.defineProperty(toStringTrap, 'toString', {
      enumerable: true,
      get: () => {
        stringGetterCalls += 1;
        throw new Error(canary);
      },
    });
    const primitiveTrap: Record<string | symbol, unknown> = {};
    Object.defineProperty(primitiveTrap, Symbol.toPrimitive, {
      enumerable: true,
      get: () => {
        throw new Error(canary);
      },
    });
    const speciesTrap: unknown[] = [];
    Object.defineProperty(speciesTrap, 'constructor', {
      enumerable: true,
      get: () => {
        throw new Error(canary);
      },
    });
    const values: unknown[] = [
      undefined,
      NaN,
      Infinity,
      -Infinity,
      1n,
      Symbol(canary),
      sparse,
      symbolKey,
      cyclic,
      nestedAccessor,
      nestedProxy,
      toStringTrap,
      primitiveTrap,
      speciesTrap,
      new Map([[canary, canary]]),
    ];
    for (const value of values) {
      const result = validateEvent(dataWith(value));
      expect(result.status).toBe('rejected');
      expect(JSON.stringify(result)).not.toContain(canary);
    }
    expect(nestedGetterCalls).toBe(0);
    expect(stringGetterCalls).toBe(0);

    const semanticTrap = fixture('task.completed');
    let semanticGetterCalls = 0;
    Object.defineProperty(semanticTrap, 'semantic', {
      configurable: true,
      enumerable: true,
      get: () => {
        semanticGetterCalls += 1;
        throw new Error(canary);
      },
    });
    const semanticResult = validateEvent(semanticTrap);
    expect(semanticResult).toMatchObject({
      status: 'rejected',
      diagnostics: [{ code: 'invalid-data', field: 'data' }],
    });
    expect(semanticGetterCalls).toBe(0);
    expect(JSON.stringify(semanticResult)).not.toContain(canary);
  });

  it('returns detached, recursively frozen core and extension snapshots', () => {
    const original = structuredClone(fixture('session.started')) as Record<string, unknown> & {
      future: { nested: string[] };
    };
    original.future = { nested: ['preserved'] };
    const result = validateEvent(original);
    expect(result.status).toBe('accepted');
    if (result.status !== 'accepted') return;
    const safeEvent = result.event as unknown as Record<string, unknown>;
    const safeFuture = safeEvent.future as { nested: string[] };
    expect(result.event).not.toBe(original);
    expect(safeFuture).toEqual(original.future);
    expect(safeFuture).not.toBe(original.future);
    expect(Object.isFrozen(result.event)).toBe(true);
    expect(Object.isFrozen(result.event.data)).toBe(true);
    expect(Object.isFrozen(safeFuture)).toBe(true);
    expect(Object.isFrozen(safeFuture.nested)).toBe(true);
    original.version = '9.0.0';
    (original.data as Record<string, unknown>).resume = true;
    original.future.nested[0] = 'MUTATED';
    expect(result.event.version).toBe('1.0.0');
    expect((result.event.data as Record<string, unknown>).resume).toBe(false);
    expect(safeFuture.nested[0]).toBe('preserved');
    expect(
      Reflect.set(result.event as unknown as Record<string, unknown>, 'version', '9.0.0'),
    ).toBe(false);

    const extension = {
      ...fixture('session.started'),
      type: 'x.io.example.telemetry',
      extension: { fallback: 'preserve-in-journal', documentation: 'opaque' },
      data: { nested: { value: 'opaque' } },
    };
    const extensionResult = validateEvent(extension);
    expect(extensionResult.status).toBe('preserved-extension');
    if (extensionResult.status !== 'preserved-extension') return;
    expect(extensionResult.event).not.toBe(extension);
    expect(Object.isFrozen(extensionResult.event)).toBe(true);
    expect(Object.isFrozen(extensionResult.event.data)).toBe(true);
    extension.data.nested.value = 'MUTATED';
    expect((extensionResult.event.data.nested as { value: string }).value).toBe('opaque');
    expect(JSON.stringify(extensionResult)).not.toContain('MUTATED');
  });

  it('returns frozen standard arrays from state and event snapshots', () => {
    const state = canonicalizeState([1, 2, 3]) as readonly number[];
    expect(Array.isArray(state)).toBe(true);
    expect(Object.getPrototypeOf(state)).toBe(Array.prototype);
    expect(Object.isFrozen(state)).toBe(true);
    expect([...state]).toEqual([1, 2, 3]);
    expect(state.map((value) => value * 2)).toEqual([2, 4, 6]);
    expect([...state.entries()]).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    const visited: number[] = [];
    state.forEach((value) => {
      visited[visited.length] = value;
    });
    expect(visited).toEqual([1, 2, 3]);

    const eventResult = validateEvent(fixture('task.plan.reconciled'));
    expect(eventResult.status).toBe('accepted');
    if (eventResult.status !== 'accepted') return;
    const eventItems = (eventResult.event.data as { readonly items: readonly unknown[] }).items;
    expect(Array.isArray(eventItems)).toBe(true);
    expect(Object.getPrototypeOf(eventItems)).toBe(Array.prototype);
    expect(Object.isFrozen(eventItems)).toBe(true);
    expect([...eventItems]).toHaveLength(eventItems.length);
    expect(eventItems.map((item) => item)).toHaveLength(eventItems.length);
    expect([...eventItems.entries()]).toHaveLength(eventItems.length);
    let forEachCount = 0;
    eventItems.forEach(() => {
      forEachCount += 1;
    });
    expect(forEachCount).toBe(eventItems.length);

    const canonicalEvent = canonicalizeEvent(fixture('task.plan.reconciled'));
    const canonicalItems = (canonicalEvent.data as { readonly items: readonly unknown[] }).items;
    expect(Array.isArray(canonicalItems)).toBe(true);
    expect(Object.getPrototypeOf(canonicalItems)).toBe(Array.prototype);
    expect(Object.isFrozen(canonicalItems)).toBe(true);
    expect([...canonicalItems]).toHaveLength(canonicalItems.length);
  });

  it('accepts ordinary and documented null-prototype arrays but rejects custom prototypes safely', () => {
    class FancyArray<T> extends Array<T> {}
    const fancy = new FancyArray<number>();
    fancy.push(1, 2);
    expect(() => serializeCanonicalState(fancy)).toThrowError(
      expect.objectContaining({
        name: 'CanonicalSerializationError',
        code: 'unsupported-prototype',
      }),
    );

    const custom = [1, 2];
    Object.setPrototypeOf(custom, { custom: true });
    expect(() => serializeCanonicalState(custom)).toThrowError(
      expect.objectContaining({
        name: 'CanonicalSerializationError',
        code: 'unsupported-prototype',
      }),
    );

    const nullPrototype = [1, 2];
    Object.setPrototypeOf(nullPrototype, null);
    const normalized = canonicalizeState(nullPrototype) as readonly number[];
    expect(serializeCanonicalState(nullPrototype)).toBe('[1,2]');
    expect(Object.getPrototypeOf(normalized)).toBe(Array.prototype);
    expect(normalized).toEqual([1, 2]);

    const prototypeSecret = 'ARRAY-PROTOTYPE-TRAP-SECRET';
    const hostile = new Proxy([1, 2], {
      getPrototypeOf: () => {
        throw new Error(prototypeSecret);
      },
    });
    try {
      serializeCanonicalState(hostile);
      throw new Error('expected hostile array proxy to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(CanonicalSerializationError);
      expect((error as CanonicalSerializationError).code).toBe('invalid-json-value');
      expect((error as Error).message).not.toContain(prototypeSecret);
    }

    const revoked = Proxy.revocable([1, 2], {});
    revoked.revoke();
    expect(() => serializeCanonicalState(revoked.proxy)).toThrowError(
      expect.objectContaining({
        name: 'CanonicalSerializationError',
        code: 'invalid-json-value',
      }),
    );
  });

  it('does not consult poisoned Array.prototype while snapshotting or writing', () => {
    const canary = 'ARRAY-PROTOTYPE-CANARY';
    const pollutedKeys: (string | symbol)[] = [
      '0',
      'toJSON',
      Symbol.iterator,
      'map',
      'entries',
      'forEach',
      'push',
      'pop',
      'sort',
      'join',
      'fill',
      'includes',
    ];
    const originalDescriptors: (PropertyDescriptor | undefined)[] = new Array(pollutedKeys.length);
    for (let index = 0; index < pollutedKeys.length; index += 1) {
      originalDescriptors[index] = Reflect.getOwnPropertyDescriptor(
        Array.prototype,
        pollutedKeys[index] as string | symbol,
      );
    }

    let getterCalls = 0;
    let numericGetterCalls = 0;
    let numericSetterCalls = 0;
    let functionCalls = 0;
    const throwingFunction = (): never => {
      functionCalls += 1;
      throw new Error(canary);
    };
    const installPoison = (): void => {
      Object.defineProperty(Array.prototype, '0', {
        configurable: true,
        enumerable: false,
        get: () => {
          numericGetterCalls += 1;
          return canary;
        },
        set: function (this: object, value: unknown) {
          numericSetterCalls += 1;
          void value;
          Object.defineProperty(this, '0', {
            configurable: true,
            enumerable: true,
            writable: true,
            value: 'INJECTED-SECRET',
          });
        },
      });
      Object.defineProperty(Array.prototype, 'toJSON', {
        configurable: true,
        enumerable: false,
        get: () => {
          getterCalls += 1;
          return throwingFunction;
        },
      });
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        configurable: true,
        enumerable: false,
        get: () => {
          getterCalls += 1;
          return throwingFunction;
        },
      });
      const methodNames = [
        'map',
        'entries',
        'forEach',
        'push',
        'pop',
        'sort',
        'join',
        'fill',
        'includes',
      ];
      for (let index = 0; index < methodNames.length; index += 1) {
        Object.defineProperty(Array.prototype, methodNames[index] as string, {
          configurable: true,
          enumerable: false,
          get: () => {
            getterCalls += 1;
            return throwingFunction;
          },
        });
      }
    };
    const restorePoison = (): void => {
      for (let index = 0; index < pollutedKeys.length; index += 1) {
        const key = pollutedKeys[index] as string | symbol;
        const descriptor = originalDescriptors[index];
        if (descriptor === undefined) Reflect.deleteProperty(Array.prototype, key);
        else Object.defineProperty(Array.prototype, key, descriptor);
      }
    };

    const baselineEventText = serializeCanonicalEvent(fixture('task.plan.reconciled'));
    const event = new Proxy(fixture('task.plan.reconciled'), {
      getPrototypeOf(target) {
        installPoison();
        return Reflect.getPrototypeOf(target);
      },
    });
    const state = new Proxy([1, 2, 3], {
      getPrototypeOf(target) {
        installPoison();
        return Reflect.getPrototypeOf(target);
      },
    });

    let normalized: readonly number[] | undefined;
    let resultStatus: ReturnType<typeof validateEvent>['status'] | undefined;
    let serializedText: string | undefined;
    let operationError: unknown;
    try {
      normalized = canonicalizeState(state) as readonly number[];
      resultStatus = validateEvent(event).status;
      serializedText = serializeCanonicalEvent(event);
    } catch (error) {
      operationError = error;
    } finally {
      restorePoison();
    }

    expect(operationError).toBeUndefined();
    expect(normalized).toBeDefined();
    expect(Array.isArray(normalized)).toBe(true);
    expect(Object.getPrototypeOf(normalized as object)).toBe(Array.prototype);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(normalized?.[0]).toBe(1);
    expect(normalized?.[1]).toBe(2);
    expect(normalized?.[2]).toBe(3);
    expect(resultStatus).toBe('accepted');
    expect(serializedText).toBe(baselineEventText);
    expect(getterCalls).toBe(0);
    expect(numericGetterCalls).toBe(0);
    expect(numericSetterCalls).toBe(0);
    expect(functionCalls).toBe(0);

    for (let index = 0; index < pollutedKeys.length; index += 1) {
      expect(
        Reflect.getOwnPropertyDescriptor(Array.prototype, pollutedKeys[index] as string | symbol),
      ).toEqual(originalDescriptors[index]);
    }
  });

  it('protects direct canonicalizeState array slots from inherited numeric accessors', () => {
    const original = Reflect.getOwnPropertyDescriptor(Array.prototype, '0');
    let getterCalls = 0;
    let setterCalls = 0;
    const input = [1, 2];
    try {
      Object.defineProperty(Array.prototype, '0', {
        configurable: true,
        enumerable: false,
        get: () => {
          getterCalls += 1;
          return 'INJECTED-SECRET';
        },
        set: function (this: object) {
          setterCalls += 1;
          Object.defineProperty(this, '0', {
            configurable: true,
            enumerable: true,
            writable: true,
            value: 'INJECTED-SECRET',
          });
        },
      });
      const normalized = canonicalizeState(input) as readonly number[];
      expect(serializeCanonicalState(input)).toBe('[1,2]');
      expect(normalized[0]).toBe(1);
      expect(normalized[1]).toBe(2);
      expect(getterCalls).toBe(0);
      expect(setterCalls).toBe(0);
    } finally {
      if (original === undefined) Reflect.deleteProperty(Array.prototype, '0');
      else Object.defineProperty(Array.prototype, '0', original);
    }
    expect(Reflect.getOwnPropertyDescriptor(Array.prototype, '0')).toEqual(original);
  });

  it('clones shared acyclic values independently while rejecting actual cycles', () => {
    const shared = {
      nested: { value: 'opaque' },
      list: ['opaque'],
    };
    const core = fixture('session.started');
    core.futureLeft = shared;
    core.futureRight = shared;
    const coreResult = validateEvent(core);
    expect(coreResult.status).toBe('accepted');
    if (coreResult.status !== 'accepted') return;
    const safeCore = coreResult.event as unknown as Record<string, unknown>;
    const left = safeCore.futureLeft as Record<string, unknown>;
    const right = safeCore.futureRight as Record<string, unknown>;
    expect(left).not.toBe(right);
    expect(left).not.toBe(shared);
    expect(right).not.toBe(shared);
    expect(left.nested).not.toBe(right.nested);
    expect(left.list).not.toBe(right.list);
    expect(Object.getPrototypeOf(left)).toBeNull();
    expect(Object.getPrototypeOf(left.nested as object)).toBeNull();
    expect(Object.getPrototypeOf(left.list as object)).toBe(Array.prototype);
    expect(Object.isFrozen(left)).toBe(true);
    expect(Object.isFrozen(left.nested)).toBe(true);
    expect(Object.isFrozen(left.list)).toBe(true);

    shared.nested.value = 'mutated';
    shared.list[0] = 'mutated';
    expect((left.nested as Record<string, unknown>).value).toBe('opaque');
    expect((left.list as string[])[0]).toBe('opaque');
    expect(Reflect.set(left.nested as Record<string, unknown>, 'value', 'attacker-mutation')).toBe(
      false,
    );

    const extensionShared = { nested: { value: 'preserved' } };
    const extension = {
      ...fixture('session.started'),
      type: 'x.io.example.telemetry',
      extension: { fallback: 'preserve-in-journal', documentation: 'opaque' },
      data: { left: extensionShared, right: extensionShared },
    };
    const extensionResult = validateEvent(extension);
    expect(extensionResult.status).toBe('preserved-extension');
    if (extensionResult.status !== 'preserved-extension') return;
    const safeExtension = extensionResult.event.data as Record<string, unknown>;
    const extensionLeft = safeExtension.left as Record<string, unknown>;
    const extensionRight = safeExtension.right as Record<string, unknown>;
    expect(extensionLeft).not.toBe(extensionRight);
    expect(extensionLeft).not.toBe(extensionShared);
    expect(Object.getPrototypeOf(extensionLeft)).toBeNull();
    expect(Object.getPrototypeOf(extensionLeft.nested as object)).toBeNull();
    expect(Object.isFrozen(extensionResult.event)).toBe(true);
    expect(Object.isFrozen(extensionResult.event.data)).toBe(true);
    expect(Object.isFrozen(extensionLeft)).toBe(true);
    expect(Object.isFrozen(extensionLeft.nested)).toBe(true);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const cyclicEvent = fixture('session.started');
    cyclicEvent.future = cyclic;
    const cyclicResult = validateEvent(cyclicEvent);
    expect(cyclicResult).toMatchObject({ status: 'rejected' });
    expect(cyclicResult.diagnostics.length).toBeLessThanOrEqual(2);
  });

  it('preserves own __proto__ data keys without changing detached prototypes', () => {
    const event = fixture('session.started');
    const ownProtoValue = { marker: 'opaque' };
    Object.defineProperty(event, '__proto__', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: ownProtoValue,
    });
    const result = validateEvent(event);
    expect(result.status).toBe('accepted');
    if (result.status !== 'accepted') return;
    const safeEvent = result.event as unknown as Record<string, unknown>;
    expect(Object.getPrototypeOf(safeEvent)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(safeEvent, '__proto__')).toBe(true);
    expect(safeEvent['__proto__']).not.toBe(Object.prototype);
    expect(Object.getPrototypeOf(safeEvent['__proto__'] as object)).toBeNull();
    expect((safeEvent['__proto__'] as Record<string, unknown>).marker).toBe('opaque');
  });

  it('canonicalizes nested keys, escaping, non-ASCII text, and negative zero', () => {
    const value = {
      z: { beta: -0, alpha: 'café' },
      a: ['second', 'first'],
      controls: '\u0000\n\t"\\',
      numericKeys: { '2': 'two', '10': 'ten' },
    };
    const serialized = serializeCanonicalState(value);
    expect(serialized).toBe(
      String.raw`{"a":["second","first"],"controls":"\u0000\n\t\"\\","numericKeys":{"10":"ten","2":"two"},"z":{"alpha":"café","beta":0}}`,
    );
    const normalized = canonicalizeState(value) as Record<string, unknown>;
    expect(Object.is((normalized.z as Record<string, unknown>).beta, -0)).toBe(false);
    expect((normalized.z as Record<string, unknown>).beta).toBe(0);
    expect(new TextDecoder().decode(encodeCanonicalState(value))).toBe(serialized);
  });

  it('returns frozen null-prototype canonical state with detached shared values', () => {
    const shared = { nested: { value: 'opaque' } };
    const value = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(value, '__proto__', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: { marker: 'own-data' },
    });
    value.left = shared;
    value.right = shared;

    const normalized = canonicalizeState(value) as Record<string, unknown>;
    const left = normalized.left as Record<string, unknown>;
    const right = normalized.right as Record<string, unknown>;
    expect(Object.getPrototypeOf(normalized)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(normalized, '__proto__')).toBe(true);
    expect((normalized['__proto__'] as Record<string, unknown>).marker).toBe('own-data');
    expect(Object.getPrototypeOf(normalized['__proto__'] as object)).toBeNull();
    expect(left).not.toBe(right);
    expect(left).not.toBe(shared);
    expect(Object.getPrototypeOf(left)).toBeNull();
    expect(Object.getPrototypeOf(left.nested as object)).toBeNull();
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(left)).toBe(true);
    expect(Object.isFrozen(left.nested)).toBe(true);
    expect(Reflect.set(left.nested as Record<string, unknown>, 'value', 'attacker-mutation')).toBe(
      false,
    );
    expect(serializeCanonicalState(value)).toBe(
      '{"__proto__":{"marker":"own-data"},"left":{"nested":{"value":"opaque"}},"right":{"nested":{"value":"opaque"}}}',
    );
  });

  it('produces identical event text and UTF-8 bytes regardless of object insertion order', () => {
    const reverseKeys = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reverseKeys);
      if (value !== null && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .reverse()
            .map(([key, child]) => [key, reverseKeys(child)]),
        );
      }
      return value;
    };
    const original = fixture('session.started');
    const reordered = reverseKeys(original);
    const originalText = serializeCanonicalEvent(original);
    const reorderedText = serializeCanonicalEvent(reordered);
    expect(reorderedText).toBe(originalText);
    expect(Array.from(encodeCanonicalEvent(reordered))).toEqual(
      Array.from(encodeCanonicalEvent(original)),
    );
  });

  it('sorts only explicitly identified entity collections and uses code-unit ID order', () => {
    const value = {
      tasks: [
        { id: 'z', label: 'last' },
        { id: 'ä', label: 'non-ascii' },
        { id: 'a', label: 'first' },
      ],
      ordinary: [{ id: 'b' }, { id: 'a' }],
    };
    const options = { entityCollections: [{ path: ['tasks'], idKey: 'id' }] } as const;
    expect(serializeCanonicalState(value, options)).toBe(
      '{"ordinary":[{"id":"b"},{"id":"a"}],"tasks":[{"id":"a","label":"first"},{"id":"z","label":"last"},{"id":"ä","label":"non-ascii"}]}',
    );
    expect(serializeCanonicalState(value)).toBe(
      '{"ordinary":[{"id":"b"},{"id":"a"}],"tasks":[{"id":"z","label":"last"},{"id":"ä","label":"non-ascii"},{"id":"a","label":"first"}]}',
    );
    expect(
      serializeCanonicalState([{ id: 'b' }, { id: 'a' }], {
        entityCollections: [{ path: [], idKey: 'id' }],
      }),
    ).toBe('[{"id":"a"},{"id":"b"}]');
  });

  it('rejects duplicate, missing, invalid, and incorrectly located entity IDs', () => {
    const codeFor = (work: () => unknown): CanonicalSerializationError['code'] => {
      try {
        work();
      } catch (error) {
        expect(error).toBeInstanceOf(CanonicalSerializationError);
        return (error as CanonicalSerializationError).code;
      }
      throw new Error('expected canonical serialization to fail');
    };
    const options = { entityCollections: [{ path: ['tasks'], idKey: 'id' }] } as const;
    expect(
      codeFor(() => serializeCanonicalState({ tasks: [{ id: 'a' }, { id: 'a' }] }, options)),
    ).toBe('duplicate-entity-id');
    expect(codeFor(() => serializeCanonicalState({ tasks: [{ label: 'missing' }] }, options))).toBe(
      'missing-entity-id',
    );
    expect(codeFor(() => serializeCanonicalState({ tasks: [{ id: 1 }] }, options))).toBe(
      'invalid-entity-id',
    );
    expect(codeFor(() => serializeCanonicalState({ tasks: [{ id: '' }] }, options))).toBe(
      'invalid-entity-id',
    );
    expect(codeFor(() => serializeCanonicalState({ tasks: { a: { id: 'a' } } }, options))).toBe(
      'entity-collection-not-array',
    );
    expect(codeFor(() => serializeCanonicalState({}, options))).toBe('entity-collection-path');
    expect(
      codeFor(() =>
        serializeCanonicalState({ tasks: [{ id: 'SECRET-ID' }, { id: 'SECRET-ID' }] }, options),
      ),
    ).toBe('duplicate-entity-id');
    try {
      serializeCanonicalState({ tasks: [{ id: 'SECRET-ID' }, { id: 'SECRET-ID' }] }, options);
    } catch (error) {
      expect((error as Error).message).not.toContain('SECRET-ID');
    }
  });

  it('rejects all non-JSON values, unsupported instances, accessors, symbols, cycles, and holes', () => {
    const codeFor = (value: unknown): CanonicalSerializationError['code'] => {
      try {
        serializeCanonicalState(value);
      } catch (error) {
        expect(error).toBeInstanceOf(CanonicalSerializationError);
        return (error as CanonicalSerializationError).code;
      }
      throw new Error('expected canonical serialization to fail');
    };
    for (const value of [undefined, () => 'secret', Symbol('secret'), 1n, NaN, Infinity, -Infinity])
      expect(codeFor(value)).toBe('invalid-json-value');
    expect(codeFor({ nested: { invalid: NaN } })).toBe('invalid-json-value');
    expect(codeFor(new Date())).toBe('unsupported-prototype');
    expect(codeFor(new Map())).toBe('unsupported-prototype');
    expect(codeFor(new Set())).toBe('unsupported-prototype');
    expect(codeFor(/pattern/)).toBe('unsupported-prototype');
    expect(codeFor(new Number(1))).toBe('unsupported-prototype');
    expect(codeFor(Object.create({ inherited: true }))).toBe('unsupported-prototype');

    const sparse = new Array(2);
    sparse[1] = 'present';
    expect(codeFor(sparse)).toBe('sparse-array');

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(codeFor(cyclic)).toBe('cycle');

    const symbolKey: Record<string, unknown> = {};
    Object.defineProperty(symbolKey, Symbol('hidden'), { enumerable: true, value: 'secret' });
    expect(codeFor(symbolKey)).toBe('invalid-json-value');

    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, 'value', {
      enumerable: true,
      get: () => 'secret',
    });
    expect(codeFor(accessor)).toBe('accessor-property');

    const hidden: Record<string, unknown> = {};
    Object.defineProperty(hidden, 'value', { enumerable: false, value: undefined });
    expect(codeFor(hidden)).toBe('unsupported-property');
  });

  it('rejects quarantined, extension-preserved, invalid, and non-JSON core events', () => {
    const codeFor = (event: unknown): CanonicalSerializationError['code'] => {
      try {
        serializeCanonicalEvent(event);
      } catch (error) {
        expect(error).toBeInstanceOf(CanonicalSerializationError);
        return (error as CanonicalSerializationError).code;
      }
      throw new Error('expected event serialization to fail');
    };
    expect(codeFor({ ...fixture('session.started'), version: '9.0.0' })).toBe('event-quarantined');
    expect(
      codeFor({
        ...fixture('session.started'),
        type: 'x.io.example.telemetry',
        extension: { fallback: 'preserve-in-journal', documentation: 'opaque' },
        data: { value: 'opaque' },
      }),
    ).toBe('event-extension-not-supported');
    expect(
      codeFor({
        ...fixture('task.created'),
        scope: { workspaceId: 'workspace-1', sessionId: 'session-1' },
      }),
    ).toBe('event-not-accepted');
    const rejectedWithUnknownFunction = { ...fixture('session.started'), future: () => 'secret' };
    expect(validateEvent(rejectedWithUnknownFunction).status).toBe('rejected');
    expect(codeFor(rejectedWithUnknownFunction)).toBe('event-not-accepted');
  });

  it('validates and serializes the exact descriptor snapshot after a re-entrant version mutation', () => {
    const target = fixture('session.started');
    let descriptorReads = 0;
    const event = new Proxy(target, {
      getOwnPropertyDescriptor(object, property) {
        if (property === 'version') {
          descriptorReads += 1;
          const descriptor = Reflect.getOwnPropertyDescriptor(object, property);
          object.version = '9.0.0';
          return descriptor;
        }
        return Reflect.getOwnPropertyDescriptor(object, property);
      },
    });
    const result = validateEvent(event);
    expect(descriptorReads).toBe(1);
    expect(result).toMatchObject({ status: 'accepted' });
    if (result.status !== 'accepted') return;
    expect(result.event.version).toBe('1.0.0');
    expect(target.version).toBe('9.0.0');
    expect(serializeCanonicalEvent(result.event)).toContain('"version":"1.0.0"');
    expect(JSON.stringify(result)).not.toContain('9.0.0');
  });

  it('turns revoked proxies, throwing traps, and getters into canonical errors without leakage', () => {
    const revoked = Proxy.revocable({ secret: 'REVOKED-SECRET' }, {});
    revoked.revoke();
    for (const operation of [
      () => canonicalizeState(revoked.proxy),
      () => serializeCanonicalState(revoked.proxy),
      () => encodeCanonicalState(revoked.proxy),
    ]) {
      expect(() => operation()).toThrow(CanonicalSerializationError);
    }
    const revokedEvent = Proxy.revocable(fixture('session.started'), {});
    revokedEvent.revoke();
    for (const operation of [
      () => canonicalizeEvent(revokedEvent.proxy),
      () => serializeCanonicalEvent(revokedEvent.proxy),
      () => encodeCanonicalEvent(revokedEvent.proxy),
    ]) {
      expect(() => operation()).toThrow(CanonicalSerializationError);
    }

    const trapSecret = 'TRAP-SECRET-ERROR';
    const throwingProxy = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error(trapSecret);
        },
      },
    );
    try {
      serializeCanonicalState(throwingProxy);
    } catch (error) {
      expect(error).toBeInstanceOf(CanonicalSerializationError);
      expect((error as Error).message).not.toContain(trapSecret);
    }

    const accessorSecret = 'ACCESSOR-SECRET-ERROR';
    const accessor = {};
    Object.defineProperty(accessor, 'secret', {
      enumerable: true,
      get: () => {
        throw new Error(accessorSecret);
      },
    });
    try {
      serializeCanonicalState(accessor);
    } catch (error) {
      expect(error).toBeInstanceOf(CanonicalSerializationError);
      expect((error as Error).message).not.toContain(accessorSecret);
    }

    const optionSecret = 'OPTION-TRAP-SECRET';
    const pathProxy = new Proxy(['tasks'], {
      getOwnPropertyDescriptor: () => {
        throw new Error(optionSecret);
      },
    });
    try {
      serializeCanonicalState({ tasks: [{ id: 'a' }] }, {
        entityCollections: [{ path: pathProxy, idKey: 'id' }],
      } as never);
    } catch (error) {
      expect(error).toBeInstanceOf(CanonicalSerializationError);
      expect((error as Error).message).not.toContain(optionSecret);
    }
  });

  it('does not trust exported, subclassed, or copied errors at state and event boundaries', () => {
    const secret = 'TRAP-CANONICAL-INSTANCE-SECRET';
    const attackerCode = 'attacker-code' as unknown as CanonicalSerializationError['code'];
    const makeBaseError = (): CanonicalSerializationError => {
      const error = new CanonicalSerializationError(attackerCode, secret);
      Object.defineProperty(error, 'cause', { configurable: true, value: 'CAUSE-SECRET' });
      Object.defineProperty(error, 'stack', { configurable: true, value: 'STACK-SECRET' });
      return error;
    };
    class ExportedErrorSubclass extends CanonicalSerializationError {}
    const makeSubclassError = (): CanonicalSerializationError =>
      new ExportedErrorSubclass(attackerCode, secret);
    const makeCopiedShapeError = (): CanonicalSerializationError => {
      const error = Object.create(
        CanonicalSerializationError.prototype,
      ) as CanonicalSerializationError;
      Object.defineProperties(error, {
        code: { configurable: true, value: attackerCode },
        path: { configurable: true, value: secret },
        message: { configurable: true, value: 'MESSAGE-SECRET' },
        cause: { configurable: true, value: 'CAUSE-SECRET' },
        stack: { configurable: true, value: 'STACK-SECRET' },
      });
      return error;
    };
    const capture = (work: () => unknown): unknown => {
      try {
        work();
      } catch (error) {
        return error;
      }
      throw new Error('expected canonical serialization to fail');
    };
    const assertSanitized = (
      work: () => unknown,
      expectedCode: CanonicalSerializationError['code'],
      attackerError?: unknown,
    ): void => {
      const caught = capture(work);
      expect(caught).toBeInstanceOf(CanonicalSerializationError);
      if (attackerError !== undefined) expect(caught).not.toBe(attackerError);
      const error = caught as CanonicalSerializationError;
      expect(error.code).toBe(expectedCode);
      expect(error.path?.length ?? 0).toBeLessThanOrEqual(128);
      expect(error.message).not.toContain(secret);
      expect(error.message).not.toContain('MESSAGE-SECRET');
      expect(error.message).not.toContain('CAUSE-SECRET');
      expect(error.message).not.toContain('STACK-SECRET');
      expect(error.path).not.toContain(secret);
      expect(error.stack).not.toContain('STACK-SECRET');
      expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
    };
    const stateOperations = [
      (value: unknown, options?: unknown) => canonicalizeState(value, options as never),
      (value: unknown, options?: unknown) => serializeCanonicalState(value, options as never),
      (value: unknown, options?: unknown) => encodeCanonicalState(value, options as never),
    ];
    const eventOperations = [
      (value: unknown) => canonicalizeEvent(value),
      (value: unknown) => serializeCanonicalEvent(value),
      (value: unknown) => encodeCanonicalEvent(value),
    ];
    const stateWithOwnKeysTrap = (error: unknown): unknown =>
      new Proxy(
        {},
        {
          ownKeys: () => {
            throw error;
          },
        },
      );
    const eventWithOwnKeysTrap = (error: unknown): unknown =>
      new Proxy(fixture('session.started'), {
        ownKeys: () => {
          throw error;
        },
      });
    for (const makeError of [makeBaseError, makeSubclassError, makeCopiedShapeError]) {
      const attackerError = makeError();
      for (const operation of stateOperations)
        assertSanitized(
          () => operation(stateWithOwnKeysTrap(attackerError)),
          'invalid-json-value',
          attackerError,
        );
      for (const operation of eventOperations)
        assertSanitized(
          () => operation(eventWithOwnKeysTrap(attackerError)),
          'event-not-accepted',
          attackerError,
        );

      const pathTraps = [
        (error: unknown) =>
          new Proxy(['tasks'], {
            ownKeys: () => {
              throw error;
            },
          }),
        (error: unknown) =>
          new Proxy(['tasks'], {
            getOwnPropertyDescriptor: () => {
              throw error;
            },
          }),
      ];
      for (const makePath of pathTraps) {
        const options = { entityCollections: [{ path: makePath(attackerError), idKey: 'id' }] };
        for (const operation of stateOperations)
          assertSanitized(
            () => operation({ tasks: [] }, options),
            'invalid-options',
            attackerError,
          );
      }
    }

    const revokedState = Proxy.revocable({}, {});
    revokedState.revoke();
    for (const operation of stateOperations)
      assertSanitized(() => operation(revokedState.proxy), 'invalid-json-value');
    const revokedEvent = Proxy.revocable(fixture('session.started'), {});
    revokedEvent.revoke();
    for (const operation of eventOperations)
      assertSanitized(() => operation(revokedEvent.proxy), 'event-not-accepted');
  });

  it('retains only genuine internal errors with stable, frozen public fields', () => {
    const stateOperations = [
      () => canonicalizeState({ invalid: NaN }),
      () => serializeCanonicalState({ invalid: NaN }),
      () => encodeCanonicalState({ invalid: NaN }),
    ];
    for (const operation of stateOperations) {
      const caught = (() => {
        try {
          operation();
        } catch (error) {
          return error;
        }
        throw new Error('expected canonical serialization to fail');
      })();
      expect(caught).toBeInstanceOf(CanonicalSerializationError);
      expect((caught as CanonicalSerializationError).code).toBe('invalid-json-value');
      expect((caught as CanonicalSerializationError).path).toBe('$.object');
      expect(Object.isFrozen(caught)).toBe(true);
      expect((caught as Error & { cause?: unknown }).cause).toBeUndefined();
    }

    const quarantined = { ...fixture('session.started'), version: '9.0.0' };
    const eventOperations = [
      () => canonicalizeEvent(quarantined),
      () => serializeCanonicalEvent(quarantined),
      () => encodeCanonicalEvent(quarantined),
    ];
    for (const operation of eventOperations) {
      const caught = (() => {
        try {
          operation();
        } catch (error) {
          return error;
        }
        throw new Error('expected canonical event serialization to fail');
      })();
      expect(caught).toBeInstanceOf(CanonicalSerializationError);
      expect((caught as CanonicalSerializationError).code).toBe('event-quarantined');
      expect((caught as CanonicalSerializationError).path).toBe('$');
      expect(Object.isFrozen(caught)).toBe(true);
    }
  });

  it('sanitizes malicious errors from JSON and UTF-8 writer boundaries', () => {
    const secret = 'WRITER-CANONICAL-INSTANCE-SECRET';
    const attackerError = new CanonicalSerializationError(
      'writer-attacker-code' as unknown as CanonicalSerializationError['code'],
      secret,
    );
    const originalStringify = JSON.stringify;
    JSON.stringify = (() => {
      throw attackerError;
    }) as typeof JSON.stringify;
    let stateError: unknown;
    try {
      try {
        serializeCanonicalState('safe');
      } catch (error) {
        stateError = error;
      }
    } finally {
      JSON.stringify = originalStringify;
    }
    expect(stateError).toBeInstanceOf(CanonicalSerializationError);
    expect((stateError as CanonicalSerializationError).code).toBe('serialization-failed');
    expect(stateError).not.toBe(attackerError);
    expect((stateError as Error).message).not.toContain(secret);

    const originalTextEncoder = globalThis.TextEncoder;
    Object.defineProperty(globalThis, 'TextEncoder', {
      configurable: true,
      writable: true,
      value: class {
        encode(): never {
          throw attackerError;
        }
      },
    });
    const encodedErrors: unknown[] = [];
    try {
      for (const operation of [
        () => encodeCanonicalState({ safe: 'value' }),
        () => encodeCanonicalEvent(fixture('session.started')),
      ]) {
        try {
          operation();
        } catch (error) {
          encodedErrors.push(error);
        }
      }
    } finally {
      Object.defineProperty(globalThis, 'TextEncoder', {
        configurable: true,
        writable: true,
        value: originalTextEncoder,
      });
    }
    expect(encodedErrors).toHaveLength(2);
    expect(encodedErrors[0]).toBeInstanceOf(CanonicalSerializationError);
    expect((encodedErrors[0] as CanonicalSerializationError).code).toBe('serialization-failed');
    expect(encodedErrors[1]).toBeInstanceOf(CanonicalSerializationError);
    expect((encodedErrors[1] as CanonicalSerializationError).code).toBe('event-not-accepted');
    for (const error of encodedErrors) {
      expect(error).not.toBe(attackerError);
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it('does not echo attacker-controlled keys, IDs, paths, or idKey values', () => {
    const secretKey = 'ATTACKER-PROPERTY-SECRET';
    const secretId = 'ATTACKER-ID-SECRET';
    const secretPath = 'ATTACKER-PATH-SECRET';
    const secretIdKey = 'ATTACKER-IDKEY-SECRET';
    const failures = [
      () => serializeCanonicalState({ [secretKey]: NaN }),
      () =>
        serializeCanonicalState(
          { [secretPath]: [] },
          { entityCollections: [{ path: [secretPath], idKey: secretIdKey }] },
        ),
      () =>
        serializeCanonicalState(
          { tasks: [{ [secretIdKey]: secretId }, { [secretIdKey]: secretId }] },
          { entityCollections: [{ path: ['tasks'], idKey: secretIdKey }] },
        ),
    ];
    for (const failure of failures) {
      try {
        failure();
      } catch (error) {
        expect(error).toBeInstanceOf(CanonicalSerializationError);
        const message = (error as Error).message;
        expect(message).not.toContain(secretKey);
        expect(message).not.toContain(secretId);
        expect(message).not.toContain(secretPath);
        expect(message).not.toContain(secretIdKey);
      }
    }
  });

  it('bounds deep and oversized state without exposing RangeError or allocating unbounded output', () => {
    let deeplyNested: unknown = false;
    for (let index = 0; index < 20_000; index += 1) deeplyNested = { nested: deeplyNested };
    try {
      serializeCanonicalState(deeplyNested);
    } catch (error) {
      expect(error).toBeInstanceOf(CanonicalSerializationError);
      expect((error as CanonicalSerializationError).code).toBe('state-too-deep');
      expect(error).not.toBeInstanceOf(RangeError);
    }
    const oversized = new Array(MAX_CANONICAL_ARRAY_LENGTH + 1).fill(null);
    try {
      serializeCanonicalState(oversized);
    } catch (error) {
      expect(error).toBeInstanceOf(CanonicalSerializationError);
      expect(error).not.toBeInstanceOf(RangeError);
    }
    expect(MAX_CANONICAL_STATE_DEPTH).toBeGreaterThan(12);
  });

  it('reports container-limit failures without leaking internal exceptions', () => {
    const values: Record<string, unknown>[] = new Array(MAX_CANONICAL_STATE_CONTAINERS);
    for (let index = 0; index < values.length; index += 1) values[index] = {};
    try {
      canonicalizeState(values);
    } catch (error) {
      expect(error).toBeInstanceOf(CanonicalSerializationError);
      expect((error as CanonicalSerializationError).code).toBe('state-too-many-containers');
      expect(error).not.toBeInstanceOf(RangeError);
      return;
    }
    throw new Error('expected the canonical container limit to fail');
  });

  it('accounts for object-key material before canonical output allocation and enforces UTF-8 bounds', () => {
    const keyHeavy: Record<string, string> = {};
    for (let index = 0; index < 200; index += 1)
      keyHeavy[`${String(index).padStart(3, '0')}-${'k'.repeat(7_990)}`] = 'v';
    expect(() => serializeCanonicalState(keyHeavy)).toThrowError(
      expect.objectContaining({
        name: 'CanonicalSerializationError',
        code: 'state-too-large',
      }),
    );

    const nonAscii = 'é'.repeat(16_384);
    const belowByteLimit = new Array<string>(31);
    for (let index = 0; index < belowByteLimit.length; index += 1) belowByteLimit[index] = nonAscii;
    expect(serializeCanonicalState(belowByteLimit).length).toBeGreaterThan(0);

    const aboveByteLimit = new Array<string>(32);
    for (let index = 0; index < aboveByteLimit.length; index += 1) aboveByteLimit[index] = nonAscii;
    expect(() => serializeCanonicalState(aboveByteLimit)).toThrowError(
      expect.objectContaining({
        name: 'CanonicalSerializationError',
        code: 'state-too-large',
      }),
    );
    expect(MAX_CANONICAL_STATE_BYTES).toBe(1_048_576);
  });

  it('rejects accessor and structurally invalid options instead of treating them as absent', () => {
    const accessorOptions: Record<string, unknown> = {};
    Object.defineProperty(accessorOptions, 'entityCollections', {
      enumerable: true,
      get: () => [],
    });
    expect(() => serializeCanonicalState({}, accessorOptions as never)).toThrow(
      CanonicalSerializationError,
    );

    const extra = { entityCollections: [], extra: true };
    expect(() => serializeCanonicalState({}, extra as never)).toThrow(CanonicalSerializationError);
    const nonEnumerable: Record<string, unknown> = { entityCollections: [] };
    Object.defineProperty(nonEnumerable, 'hidden', { value: true, enumerable: false });
    expect(() => serializeCanonicalState({}, nonEnumerable as never)).toThrow(
      CanonicalSerializationError,
    );
    expect(() =>
      serializeCanonicalState({}, { entityCollections: [new Array(1)] } as never),
    ).toThrow(CanonicalSerializationError);
  });

  it('supports nested entity collections through arrays while preserving ordinary array order', () => {
    const value = {
      groups: [
        {
          id: 'group-b',
          tasks: [{ id: 'task-z' }, { id: 'task-a' }],
        },
        {
          id: 'group-a',
          tasks: [{ id: 'task-y' }, { id: 'task-b' }],
        },
      ],
      ordinary: [{ id: 'ordinary-b' }, { id: 'ordinary-a' }],
    };
    const wildcardOptions = {
      entityCollections: [
        { path: ['groups'], idKey: 'id' },
        { path: ['groups', { each: true }, 'tasks'], idKey: 'id' },
      ],
    } as const;
    expect(serializeCanonicalState(value, wildcardOptions)).toBe(
      '{"groups":[{"id":"group-a","tasks":[{"id":"task-b"},{"id":"task-y"}]},{"id":"group-b","tasks":[{"id":"task-a"},{"id":"task-z"}]}],"ordinary":[{"id":"ordinary-b"},{"id":"ordinary-a"}]}',
    );

    const indexedOptions = {
      entityCollections: [{ path: ['groups', 0, 'tasks'], idKey: 'id' }],
    } as const;
    expect(serializeCanonicalState(value, indexedOptions)).toBe(
      '{"groups":[{"id":"group-b","tasks":[{"id":"task-a"},{"id":"task-z"}]},{"id":"group-a","tasks":[{"id":"task-y"},{"id":"task-b"}]}],"ordinary":[{"id":"ordinary-b"},{"id":"ordinary-a"}]}',
    );
  });

  it('distinguishes path collisions, rejects duplicates and unmatched paths, and keeps arrays explicit', () => {
    const value = {
      '0': [{ id: 'property-b' }, { id: 'property-a' }],
      arrays: [
        [{ id: 'index-b' }, { id: 'index-a' }],
        [{ id: 'ordinary-b' }, { id: 'ordinary-a' }],
      ],
    };
    expect(
      serializeCanonicalState(value, { entityCollections: [{ path: ['0'], idKey: 'id' }] }),
    ).toContain('"0":[{"id":"property-a"},{"id":"property-b"}]');
    expect(
      serializeCanonicalState(value, {
        entityCollections: [{ path: ['arrays', 0], idKey: 'id' }],
      }),
    ).toContain(
      '"arrays":[[{"id":"index-a"},{"id":"index-b"}],[{"id":"ordinary-b"},{"id":"ordinary-a"}]]',
    );
    expect(() =>
      serializeCanonicalState(value, { entityCollections: [{ path: [0], idKey: 'id' }] }),
    ).toThrow(CanonicalSerializationError);
    expect(() =>
      serializeCanonicalState(value, {
        entityCollections: [
          { path: ['arrays', 0], idKey: 'id' },
          { path: ['arrays', 0], idKey: 'other' },
        ],
      }),
    ).toThrow(CanonicalSerializationError);
    expect(() =>
      serializeCanonicalState(value, {
        entityCollections: [{ path: ['missing'], idKey: 'id' }],
      }),
    ).toThrow(CanonicalSerializationError);
  });

  it('uses deterministic UTF-16 key order and well-formed escaping for astral and lone surrogates', () => {
    const value = { '\uD800': 'lone', z: '😀', a: '\uDC00', '10': 'ten', '2': 'two' };
    const text = serializeCanonicalState(value);
    expect(text).toBe('{"10":"ten","2":"two","a":"\\udc00","z":"😀","\\ud800":"lone"}');
    expect(Array.from(encodeCanonicalState(value))).toEqual(
      Array.from(new TextEncoder().encode(text)),
    );
    const normalized = canonicalizeState({ '2': 'two', '10': 'ten' }) as Record<string, unknown>;
    expect(Object.keys(normalized)).toEqual(['2', '10']);
    expect(serializeCanonicalState(normalized)).toBe('{"10":"ten","2":"two"}');
  });

  it('imports without Array.prototype map or iterator hooks and validates extensions after pollution', async () => {
    // @ts-expect-error The root project intentionally does not depend on Node type declarations.
    const { execFileSync } = await import('node:child_process');
    const workingDirectory = process.cwd().replace(/\\/g, '/');
    const repoRoot = workingDirectory.endsWith('/packages/protocol')
      ? workingDirectory.slice(0, -'/packages/protocol'.length)
      : workingDirectory;
    const sourcePath = `${repoRoot}/packages/protocol/src/index.ts`;
    const childScript = `
      import { readFileSync } from 'node:fs';
      import { resolve } from 'node:path';
      import { pathToFileURL } from 'node:url';
      const sourcePath = ${JSON.stringify(sourcePath)};
      const typescript = await import('typescript');
      const ajvUrl = pathToFileURL(resolve('packages/protocol/node_modules/ajv/dist/2020.js')).href;
      const formatsUrl = pathToFileURL(resolve('packages/protocol/node_modules/ajv-formats/dist/index.js')).href;
      await import(ajvUrl);
      await import(formatsUrl);
      const source = readFileSync(sourcePath, 'utf8');
      const javascript = typescript.transpileModule(source, {
        compilerOptions: {
          module: typescript.ModuleKind.ESNext,
          target: typescript.ScriptTarget.ES2023,
        },
      }).outputText
        .replaceAll('ajv/dist/2020.js', ajvUrl)
        .replaceAll('ajv-formats', formatsUrl);
      Object.defineProperty(Array.prototype, 'map', {
        configurable: true,
        get() { throw new Error('PREIMPORT-MAP-SECRET'); }
      });
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        configurable: true,
        get() { throw new Error('PREIMPORT-ITERATOR-SECRET'); }
      });
      await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(javascript));
      process.stdout.write('imported');
    `;
    const output = execFileSync(
      process.execPath,
      ['--experimental-strip-types', '--input-type=module', '-e', childScript],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    expect(output).toBe('imported');

    const extension = {
      ...fixture('session.started'),
      type: 'x.io.example.polluted',
      extension: { fallback: 'preserve-in-journal', documentation: 'opaque' },
      data: { value: 'opaque' },
    };
    const pollutedKeys: (string | symbol)[] = ['map', 'some', Symbol.iterator];
    const originals: (PropertyDescriptor | undefined)[] = new Array(pollutedKeys.length);
    for (let index = 0; index < pollutedKeys.length; index += 1)
      originals[index] = Reflect.getOwnPropertyDescriptor(
        Array.prototype,
        pollutedKeys[index] as string | symbol,
      );
    try {
      for (let index = 0; index < pollutedKeys.length; index += 1) {
        const key = pollutedKeys[index] as string | symbol;
        Object.defineProperty(Array.prototype, key, {
          configurable: true,
          get: () => {
            throw new Error('POSTIMPORT-ARRAY-SECRET');
          },
        });
      }
      expect(validateEvent(extension).status).toBe('preserved-extension');
      expect(opaqueText('safe')).toBe('safe');
    } finally {
      for (let index = 0; index < pollutedKeys.length; index += 1) {
        const key = pollutedKeys[index] as string | symbol;
        const descriptor = originals[index];
        if (descriptor === undefined) Reflect.deleteProperty(Array.prototype, key);
        else Object.defineProperty(Array.prototype, key, descriptor);
      }
    }
  });
});
