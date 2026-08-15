import * as Ajv2020Module from 'ajv/dist/2020.js';
import * as addFormatsModule from 'ajv-formats';
import type { ErrorObject, KeywordDefinition, ValidateFunction } from 'ajv';

/** The stable, vendor-neutral Agent Arcade Protocol namespace. */
export const protocolId = 'io.github.danium.codeinvaders.aap' as const;
export const protocolVersion = '1.0.0' as const;
export type ProtocolVersion = `${number}.${number}.${number}`;

export const MAX_EVENT_BYTES = 32_768;
export const MAX_JSON_DEPTH = 12;
export const MAX_EXTENSION_BYTES = 4_096;

export type Fidelity = 'observed' | 'derived' | 'synthetic';
export type Finality = 'provisional' | 'confirmed';
export type Support = 'none' | 'derived' | 'observed';
export type Id = string;
export type SignalAvailability = 'unsupported' | 'partial' | 'available';
export type SignalCoverage = 'none' | 'partial' | 'full';
export type SignalFinality = 'provisional' | 'confirmed' | 'mixed';
export const PLAN_ORDINAL_BASE = 0 as const;
export type OpaqueText = string & { readonly __codeinvadersOpaqueText: unique symbol };
export type SanitizedToken = string & { readonly __codeinvadersSanitizedToken: unique symbol };

/** Brands canonical text only after the same bounded checks used by the protocol schema. */
export function opaqueText(value: string, maxLength = 256): OpaqueText {
  const codePointLength = [...value].length;
  if (
    codePointLength < 1 ||
    codePointLength > Math.min(maxLength, 2048) ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || code === 0x7f;
    })
  )
    throw new Error('invalid opaque text');
  return value as OpaqueText;
}

export function sanitizedToken(value: string): SanitizedToken {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value))
    throw new Error('invalid sanitized token');
  return value as SanitizedToken;
}

export interface SignalExclusion {
  readonly code:
    | 'hosted-tools'
    | 'manual-denials'
    | 'deny-rules'
    | 'missing-correlation'
    | 'session-configuration'
    | 'unknown';
  readonly scope?: 'platform' | 'session' | 'signal';
}

export type SignalCapability =
  | {
      readonly availability: 'unsupported';
      readonly evidenceQuality: 'none';
      readonly coverage: 'none';
      readonly finality: 'provisional';
      readonly exclusions: readonly SignalExclusion[];
    }
  | {
      readonly availability: 'partial';
      readonly evidenceQuality: Exclude<Support, 'none'>;
      readonly coverage: 'partial';
      readonly finality: SignalFinality;
      readonly exclusions: readonly [SignalExclusion, ...SignalExclusion[]];
    }
  | {
      readonly availability: 'available';
      readonly evidenceQuality: Exclude<Support, 'none'>;
      readonly coverage: 'full';
      readonly finality: Exclude<SignalFinality, 'provisional'>;
      readonly exclusions: readonly SignalExclusion[];
    };

export interface SourceIdentity {
  readonly adapterId: Id;
  readonly adapterVersion: string;
  readonly streamId: Id;
  readonly epochId: Id;
  readonly nativeToken?: SanitizedToken;
}

export interface EventScope {
  readonly workspaceId: Id;
  readonly repoId?: Id;
  readonly sessionId: Id;
  readonly turnId?: Id;
  readonly agentId?: Id;
  readonly taskId?: Id;
  readonly operationId?: Id;
  readonly permissionId?: Id;
}

export interface EventLinks {
  readonly causationEventId?: Id;
  readonly parentAgentId?: Id;
  readonly parentTaskId?: Id;
  readonly correlationId?: Id;
}

export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'denied'
  | 'cancelled'
  | 'abandoned'
  | 'unknown';
export type NonTerminalTaskStatus = 'pending' | 'in_progress' | 'blocked';
export type TerminalTaskStatus = Exclude<TaskStatus, NonTerminalTaskStatus>;
export type TaskOutcome = 'success' | 'failure' | 'denied' | 'cancelled' | 'abandoned' | 'unknown';
type TerminalOutcomeForStatus<Status extends TerminalTaskStatus> = Status extends 'completed'
  ? 'success'
  : Status extends 'failed'
    ? 'failure'
    : Status extends 'denied'
      ? 'denied'
      : Status extends 'cancelled'
        ? 'cancelled'
        : Status extends 'abandoned'
          ? 'abandoned'
          : 'unknown';
export type ToolCategory =
  | 'read'
  | 'search'
  | 'shell'
  | 'edit'
  | 'test'
  | 'build'
  | 'browser'
  | 'web'
  | 'mcp'
  | 'agent'
  | 'planning'
  | 'media'
  | 'other';
export type AgentState =
  'starting' | 'working' | 'waiting' | 'blocked' | 'finishing' | 'finished' | 'failed';

export interface CapabilityProfile {
  readonly revision: number;
  readonly effectiveSequence: number;
  readonly platform: {
    readonly agentKind: SanitizedToken;
    readonly agentVersion?: string;
    readonly configId?: Id;
  };
  readonly session: {
    readonly mode: 'interactive' | 'non-interactive' | 'unknown';
    readonly configurationId?: Id;
  };
  readonly signals: {
    readonly sessions: SignalCapability;
    readonly turns: SignalCapability;
    readonly tasks: SignalCapability;
    readonly taskPlan: SignalCapability;
    readonly agents: SignalCapability;
    readonly tools: SignalCapability;
    readonly permissions: SignalCapability;
  };
  readonly exclusions: readonly SignalExclusion[];
}

export type SemanticMetadata =
  | { readonly kind: 'checkpoint'; readonly terminal: false; readonly basis?: 'native' | 'derived' }
  | {
      readonly kind: 'quiescence';
      readonly terminal: false;
      readonly basis?: 'native' | 'timeout' | 'quiescence';
    }
  | {
      readonly kind: 'outcome';
      readonly terminal: true;
      readonly outcome: 'success';
      /** A timeout may close work conservatively, but never establish success. */
      readonly basis?: 'native' | 'derived' | 'quiescence';
    }
  | {
      readonly kind: 'outcome';
      readonly terminal: true;
      readonly outcome: Exclude<TaskOutcome, 'success'>;
      readonly basis?: 'native' | 'derived' | 'timeout' | 'quiescence';
    }
  | {
      readonly kind: 'correction';
      readonly terminal: false;
      readonly correctionOfEventId: Id;
      readonly correctionOfEntityId: Id;
      readonly basis?: 'correction';
    }
  | { readonly kind: 'capability'; readonly terminal: false; readonly basis?: 'native' | 'derived' }
  | {
      readonly kind: 'gap';
      readonly terminal: false;
      readonly basis?: 'native' | 'derived' | 'timeout';
    };
type RequiredSemantic = SemanticMetadata;
type SemanticRequiredEventType =
  | 'source.capability.changed'
  | 'telemetry.gap'
  | 'turn.quiescent'
  | 'task.completion.requested'
  | 'task.completed'
  | 'task.failed'
  | 'task.denied'
  | 'task.cancelled'
  | 'task.abandoned'
  | 'task.corrected';
type TerminalEventOutcome = {
  'task.completed': 'success';
  'task.failed': 'failure';
  'task.denied': 'denied';
  'task.cancelled': 'cancelled';
  'task.abandoned': 'abandoned';
};
type OutcomeBasis = 'native' | 'derived' | 'timeout' | 'quiescence';
type OutcomeSemantic<Outcome extends TaskOutcome> = {
  readonly kind: 'outcome';
  readonly terminal: true;
  readonly outcome: Outcome;
  readonly basis?: Outcome extends 'success' ? Exclude<OutcomeBasis, 'timeout'> : OutcomeBasis;
};
type SemanticFor<T extends CoreEventType> = T extends 'task.completion.requested'
  ? Extract<RequiredSemantic, { kind: 'checkpoint' }>
  : T extends 'turn.quiescent'
    ? Extract<RequiredSemantic, { kind: 'quiescence' }>
    : T extends 'telemetry.gap'
      ? Extract<RequiredSemantic, { kind: 'gap' }>
      : T extends 'source.capability.changed'
        ? Extract<RequiredSemantic, { kind: 'capability' }>
        : T extends 'task.corrected'
          ? | Extract<RequiredSemantic, { kind: 'correction' }>
            | Extract<RequiredSemantic, { kind: 'outcome' }>
          : T extends keyof TerminalEventOutcome
            ? OutcomeSemantic<TerminalEventOutcome[T]>
            : SemanticMetadata | undefined;

type CanonicalLabel = OpaqueText;
type CanonicalDescription = OpaqueText;
type CanonicalToolName = SanitizedToken;
type InitialCapabilityProfile = Omit<CapabilityProfile, 'revision'> & { revision: 1 };
type DataMap = {
  'source.connected': {
    agentKind: SanitizedToken;
    agentVersion?: string;
    capabilities: InitialCapabilityProfile;
  };
  'source.capability.changed': {
    capabilities: CapabilityProfile;
    previousRevision: number;
    effectiveSequence: number;
  };
  'source.heartbeat': { uptimeMs: number };
  'source.disconnected': { reason: 'normal' | 'timeout' | 'error' | 'unknown' };
  'telemetry.gap': {
    fromSequence?: number;
    toSequence?: number;
    reason: 'dropped' | 'corrupt' | 'out-of-order-timeout' | 'adapter-restart' | 'unknown';
  };
  'workspace.discovered': { label?: CanonicalLabel; vcs?: 'git' | 'other' | 'none' };
  'session.started': { resume: boolean };
  'session.ended': { reason: 'normal' | 'archived' | 'deleted' | 'idle' | 'error' | 'unknown' };
  'turn.started': { objectiveLabel?: CanonicalLabel };
  'turn.finished': { outcome: 'completed' | 'partial' | 'failed' | 'interrupted' | 'unknown' };
  'turn.quiescent': { reason: 'native' | 'timeout' | 'permission' | 'no-active-work' | 'unknown' };
  'agent.spawned': {
    role: 'orchestrator' | 'worker' | 'reviewer' | 'researcher' | 'tester' | 'unknown';
    agentKind?: SanitizedToken;
    label?: CanonicalLabel;
    depth: number;
  };
  'agent.state.changed': {
    from?: AgentState;
    to: AgentState;
    reason?: 'tool' | 'permission' | 'delegation' | 'native' | 'timeout' | 'unknown';
  };
  'agent.finished': { outcome: 'completed' | 'failed' | 'cancelled' | 'unknown' };
  'task.created': {
    label?: CanonicalLabel;
    description?: CanonicalDescription;
    status: TaskStatus;
    ordinal?: number;
    fallback: boolean;
  };
  'task.updated': {
    label?: CanonicalLabel;
    description?: CanonicalDescription;
    status?: TaskStatus;
    ordinal?: number;
  };
  'task.assigned': { assigneeAgentId?: Id };
  'task.completion.requested': { requestedStatus: 'completed'; checkpoint: 'native' | 'derived' };
  'task.completed': { completion: 'observed' | 'derived' };
  'task.failed': { category?: 'tool' | 'validation' | 'agent' | 'unknown' };
  'task.denied': { reason: 'permission' | 'policy' | 'unknown' };
  'task.cancelled': { reason?: 'replanned' | 'user' | 'superseded' | 'unknown' };
  'task.abandoned': { reason: 'timeout' | 'session-ended' | 'telemetry-gap' | 'unknown' };
  'task.corrected': TaskCorrectionData;
  'task.plan.reconciled': PlanReconciledData;
  'tool.requested': { name: CanonicalToolName; category: ToolCategory; parallelGroupId?: Id };
  'tool.started': { name: CanonicalToolName; category: ToolCategory; parallelGroupId?: Id };
  'tool.completed': {
    name: CanonicalToolName;
    category: ToolCategory;
    durationMs?: number;
    resultClass?: 'success' | 'partial' | 'unknown';
  };
  'tool.failed': {
    name: CanonicalToolName;
    category: ToolCategory;
    durationMs?: number;
    failureClass: 'exit_nonzero' | 'timeout' | 'denied' | 'cancelled' | 'exception' | 'unknown';
  };
  'permission.requested': {
    category: ToolCategory;
    riskClass?: 'read' | 'write' | 'network' | 'execute' | 'destructive' | 'unknown';
  };
  'permission.resolved': { outcome: 'allowed' | 'denied' | 'cancelled' | 'timed_out' | 'unknown' };
};

export interface PlanTask {
  readonly taskId: Id;
  readonly status: TaskStatus;
  readonly ordinal: number;
  readonly label?: CanonicalLabel;
  readonly identityBasis:
    'stable-native-id' | 'exact-normalized-identity' | 'exact-ordinal-continuity' | 'new-unmatched';
}

export type TaskCorrectionData =
  | {
      readonly correction: 'reopen';
      readonly correctedEventId: Id;
      readonly correctedEntityId: Id;
      readonly status: NonTerminalTaskStatus;
    }
  | {
      [Status in TerminalTaskStatus]: {
        readonly correction: 'replace-outcome';
        readonly correctedEventId: Id;
        readonly correctedEntityId: Id;
        readonly status: Status;
        readonly resultingOutcome: TerminalOutcomeForStatus<Status>;
      };
    }[TerminalTaskStatus];

declare const planRevisionBrand: unique symbol;
export type PlanRevision = {
  readonly revision: number;
  readonly previousRevision: number;
  readonly [planRevisionBrand]: true;
};

/** Creates the branded exact-predecessor pair required by later plan revisions. */
export function planRevision(revision: number, previousRevision: number): PlanRevision {
  if (
    !Number.isSafeInteger(revision) ||
    revision < 2 ||
    !Number.isSafeInteger(previousRevision) ||
    previousRevision !== revision - 1
  )
    throw new Error('invalid plan revision');
  return Object.freeze({ revision, previousRevision }) as PlanRevision;
}

export type PlanReconciledData =
  | {
      readonly revision: 1;
      readonly previousRevision?: never;
      readonly complete: true;
      readonly items: readonly PlanTask[];
    }
  | (PlanRevision & { readonly complete: true; readonly items: readonly PlanTask[] });

/** Terminal state may transfer only when the identity evidence is exact and durable. */
export function canTransferTerminalState(identityBasis: PlanTask['identityBasis']): boolean {
  return identityBasis === 'stable-native-id' || identityBasis === 'exact-normalized-identity';
}

export type CoreEventType = keyof DataMap;
type RequiredScopeByEvent = {
  'source.connected': 'sessionId';
  'source.capability.changed': 'sessionId';
  'source.heartbeat': 'sessionId';
  'source.disconnected': 'sessionId';
  'telemetry.gap': 'sessionId';
  'workspace.discovered': 'sessionId';
  'session.started': 'sessionId';
  'session.ended': 'sessionId';
  'turn.started': 'sessionId' | 'turnId';
  'turn.finished': 'sessionId' | 'turnId';
  'turn.quiescent': 'sessionId' | 'turnId';
  'agent.spawned': 'sessionId' | 'agentId';
  'agent.state.changed': 'sessionId' | 'agentId';
  'agent.finished': 'sessionId' | 'agentId';
  'task.created': 'sessionId' | 'taskId';
  'task.updated': 'sessionId' | 'taskId';
  'task.assigned': 'sessionId' | 'taskId';
  'task.completion.requested': 'sessionId' | 'taskId';
  'task.completed': 'sessionId' | 'taskId';
  'task.failed': 'sessionId' | 'taskId';
  'task.denied': 'sessionId' | 'taskId';
  'task.cancelled': 'sessionId' | 'taskId';
  'task.abandoned': 'sessionId' | 'taskId';
  'task.corrected': 'sessionId' | 'taskId';
  'task.plan.reconciled': 'sessionId' | 'turnId';
  'tool.requested': 'sessionId' | 'operationId';
  'tool.started': 'sessionId' | 'operationId';
  'tool.completed': 'sessionId' | 'operationId';
  'tool.failed': 'sessionId' | 'operationId';
  'permission.requested': 'sessionId' | 'permissionId';
  'permission.resolved': 'sessionId' | 'permissionId';
};
type ScopeFor<T extends CoreEventType> = EventScope &
  Required<Pick<EventScope, RequiredScopeByEvent[T] | 'workspaceId' | 'sessionId'>>;
type CoreEventEnvelope<T extends CoreEventType> = {
  readonly spec: typeof protocolId;
  readonly version: ProtocolVersion;
  readonly eventId: Id;
  readonly type: T;
  readonly occurredAt: string;
  readonly observedAt: string;
  readonly sequence: number;
  readonly source: SourceIdentity;
  readonly scope: ScopeFor<T>;
  readonly links?: EventLinks;
  readonly fidelity: Fidelity;
  readonly finality: T extends 'task.completion.requested'
    ? 'provisional'
    : T extends
          | 'source.capability.changed'
          | 'task.completed'
          | 'task.failed'
          | 'task.denied'
          | 'task.cancelled'
          | 'task.abandoned'
          | 'task.corrected'
      ? 'confirmed'
      : Finality;
};
type SemanticProperty<T extends CoreEventType> = T extends SemanticRequiredEventType
  ? { readonly semantic: SemanticFor<T> }
  : { readonly semantic?: SemanticFor<T> };
export type CoreEventPayload<T extends CoreEventType> = T extends 'task.corrected'
  ? | {
        readonly data: Extract<TaskCorrectionData, { correction: 'reopen' }>;
        readonly semantic: Extract<RequiredSemantic, { kind: 'correction' }>;
      }
    | {
        [Status in TerminalTaskStatus]: {
          readonly data: Extract<
            TaskCorrectionData,
            { correction: 'replace-outcome'; status: Status }
          >;
          readonly semantic: OutcomeSemantic<TerminalOutcomeForStatus<Status>>;
        };
      }[TerminalTaskStatus]
  : { readonly data: DataMap[T] } & SemanticProperty<T>;
export type CoreEvent<T extends CoreEventType = CoreEventType> = CoreEventEnvelope<T> &
  CoreEventPayload<T>;
export type AnyCoreEvent = { [T in CoreEventType]: CoreEvent<T> }[CoreEventType];

export interface ProtocolDiagnostic {
  readonly code:
    | 'invalid-envelope'
    | 'invalid-scope'
    | 'invalid-data'
    | 'event-too-large'
    | 'event-too-deep'
    | 'unsupported-major'
    | 'invalid-version'
    | 'unknown-event'
    | 'invalid-extension'
    | 'extension-preserved';
  readonly severity: 'error' | 'warning';
  readonly field?:
    | 'spec'
    | 'version'
    | 'eventId'
    | 'type'
    | 'timestamps'
    | 'sequence'
    | 'source'
    | 'scope'
    | 'fidelity'
    | 'finality'
    | 'data'
    | 'size'
    | 'depth'
    | 'extension';
  readonly eventType?: CoreEventType;
  readonly protocolMajor?: number;
}

export type ValidationResult =
  | { readonly status: 'accepted'; readonly event: AnyCoreEvent; readonly diagnostics: readonly [] }
  | {
      readonly status: 'preserved-extension';
      readonly event: ExtensionEvent;
      readonly diagnostics: readonly [ExtensionPreservedDiagnostic];
    }
  | {
      readonly status: 'rejected' | 'quarantined';
      readonly diagnostics: readonly [ProtocolDiagnostic, ...ProtocolDiagnostic[]];
    };

export interface ExtensionPreservedDiagnostic extends ProtocolDiagnostic {
  readonly code: 'extension-preserved';
  readonly severity: 'warning';
  readonly field: 'type';
}

// Keep this list explicit: it is the public discriminant registry and its order is stable.
const coreTypes: readonly CoreEventType[] = [
  'source.connected',
  'source.capability.changed',
  'source.heartbeat',
  'source.disconnected',
  'telemetry.gap',
  'workspace.discovered',
  'session.started',
  'session.ended',
  'turn.started',
  'turn.finished',
  'turn.quiescent',
  'agent.spawned',
  'agent.state.changed',
  'agent.finished',
  'task.created',
  'task.updated',
  'task.assigned',
  'task.completion.requested',
  'task.completed',
  'task.failed',
  'task.denied',
  'task.cancelled',
  'task.abandoned',
  'task.corrected',
  'task.plan.reconciled',
  'tool.requested',
  'tool.started',
  'tool.completed',
  'tool.failed',
  'permission.requested',
  'permission.resolved',
];
const scopeRules: Record<CoreEventType, readonly (keyof EventScope)[]> = {
  'source.connected': ['sessionId'],
  'source.capability.changed': ['sessionId'],
  'source.heartbeat': ['sessionId'],
  'source.disconnected': ['sessionId'],
  'telemetry.gap': ['sessionId'],
  'workspace.discovered': ['sessionId'],
  'session.started': ['sessionId'],
  'session.ended': ['sessionId'],
  'turn.started': ['sessionId', 'turnId'],
  'turn.finished': ['sessionId', 'turnId'],
  'turn.quiescent': ['sessionId', 'turnId'],
  'agent.spawned': ['sessionId', 'agentId'],
  'agent.state.changed': ['sessionId', 'agentId'],
  'agent.finished': ['sessionId', 'agentId'],
  'task.created': ['sessionId', 'taskId'],
  'task.updated': ['sessionId', 'taskId'],
  'task.assigned': ['sessionId', 'taskId'],
  'task.completion.requested': ['sessionId', 'taskId'],
  'task.completed': ['sessionId', 'taskId'],
  'task.failed': ['sessionId', 'taskId'],
  'task.denied': ['sessionId', 'taskId'],
  'task.cancelled': ['sessionId', 'taskId'],
  'task.abandoned': ['sessionId', 'taskId'],
  'task.corrected': ['sessionId', 'taskId'],
  'task.plan.reconciled': ['sessionId', 'turnId'],
  'tool.requested': ['sessionId', 'operationId'],
  'tool.started': ['sessionId', 'operationId'],
  'tool.completed': ['sessionId', 'operationId'],
  'tool.failed': ['sessionId', 'operationId'],
  'permission.requested': ['sessionId', 'permissionId'],
  'permission.resolved': ['sessionId', 'permissionId'],
};

const idSchema = {
  type: 'string',
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$',
};
const opaqueTextSchema = {
  type: 'string',
  minLength: 1,
  maxLength: 256,
  pattern: '^[^\\u0000-\\u001f\\u007f]+$',
};
const descriptionSchema = { ...opaqueTextSchema, maxLength: 2048 };
const sanitizedTokenSchema = {
  type: 'string',
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$',
};
const textSchema = opaqueTextSchema;
const semverPattern =
  '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$';
const integerSchema = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const enumSchema = (values: readonly string[]) => ({ type: 'string', enum: values });
const supportSchema = enumSchema(['none', 'derived', 'observed']);
const signalCapabilitySchema = {
  type: 'object',
  additionalProperties: true,
  required: ['availability', 'evidenceQuality', 'coverage', 'finality', 'exclusions'],
  properties: {
    availability: enumSchema(['unsupported', 'partial', 'available']),
    evidenceQuality: supportSchema,
    coverage: enumSchema(['none', 'partial', 'full']),
    finality: enumSchema(['provisional', 'confirmed', 'mixed']),
    exclusions: {
      type: 'array',
      maxItems: 32,
      items: {
        type: 'object',
        additionalProperties: true,
        required: ['code'],
        properties: {
          code: enumSchema([
            'hosted-tools',
            'manual-denials',
            'deny-rules',
            'missing-correlation',
            'session-configuration',
            'unknown',
          ]),
          scope: enumSchema(['platform', 'session', 'signal']),
        },
      },
    },
  },
};
const capabilityMatrixSchema = {
  oneOf: [
    {
      type: 'object',
      properties: {
        availability: { const: 'unsupported' },
        evidenceQuality: { const: 'none' },
        coverage: { const: 'none' },
        finality: { const: 'provisional' },
        exclusions: {},
      },
      required: ['availability', 'evidenceQuality', 'coverage', 'finality', 'exclusions'],
    },
    {
      type: 'object',
      properties: {
        availability: { const: 'partial' },
        evidenceQuality: { enum: ['observed', 'derived'] },
        coverage: { const: 'partial' },
        finality: { enum: ['provisional', 'confirmed', 'mixed'] },
        exclusions: {},
      },
      required: ['availability', 'coverage', 'exclusions'],
      allOf: [
        {
          type: 'object',
          properties: { exclusions: { type: 'array', minItems: 1 } },
        },
      ],
    },
    {
      type: 'object',
      properties: {
        availability: { const: 'available' },
        evidenceQuality: { enum: ['observed', 'derived'] },
        coverage: { const: 'full' },
        finality: { enum: ['confirmed', 'mixed'] },
        exclusions: {},
      },
      required: ['availability', 'evidenceQuality', 'coverage', 'finality', 'exclusions'],
    },
  ],
};
const signalCapabilityWithMatrixSchema = {
  ...signalCapabilitySchema,
  allOf: [capabilityMatrixSchema],
};
const capabilitySchema = {
  type: 'object',
  additionalProperties: true,
  required: ['revision', 'effectiveSequence', 'platform', 'session', 'signals', 'exclusions'],
  properties: {
    revision: integerSchema,
    effectiveSequence: integerSchema,
    platform: {
      type: 'object',
      additionalProperties: true,
      required: ['agentKind'],
      properties: {
        agentKind: sanitizedTokenSchema,
        agentVersion: { ...textSchema, pattern: semverPattern },
        configId: idSchema,
      },
    },
    session: {
      type: 'object',
      additionalProperties: true,
      required: ['mode'],
      properties: {
        mode: enumSchema(['interactive', 'non-interactive', 'unknown']),
        configurationId: idSchema,
      },
    },
    signals: {
      type: 'object',
      additionalProperties: true,
      required: ['sessions', 'turns', 'tasks', 'taskPlan', 'agents', 'tools', 'permissions'],
      properties: {
        sessions: signalCapabilityWithMatrixSchema,
        turns: signalCapabilityWithMatrixSchema,
        tasks: signalCapabilityWithMatrixSchema,
        taskPlan: signalCapabilityWithMatrixSchema,
        agents: signalCapabilityWithMatrixSchema,
        tools: signalCapabilityWithMatrixSchema,
        permissions: signalCapabilityWithMatrixSchema,
      },
    },
    exclusions: {
      type: 'array',
      maxItems: 32,
      items: {
        type: 'object',
        additionalProperties: true,
        required: ['code'],
        properties: {
          code: enumSchema([
            'hosted-tools',
            'manual-denials',
            'deny-rules',
            'missing-correlation',
            'session-configuration',
            'unknown',
          ]),
          scope: enumSchema(['platform', 'session', 'signal']),
        },
      },
    },
  },
};
const dataProps: Record<CoreEventType, Record<string, unknown>> = {
  'source.connected': {
    agentKind: sanitizedTokenSchema,
    agentVersion: { ...textSchema, pattern: semverPattern },
    capabilities: capabilitySchema,
  },
  'source.capability.changed': {
    capabilities: capabilitySchema,
    previousRevision: integerSchema,
    effectiveSequence: integerSchema,
  },
  'source.heartbeat': { uptimeMs: integerSchema },
  'source.disconnected': { reason: enumSchema(['normal', 'timeout', 'error', 'unknown']) },
  'telemetry.gap': {
    fromSequence: integerSchema,
    toSequence: integerSchema,
    reason: enumSchema([
      'dropped',
      'corrupt',
      'out-of-order-timeout',
      'adapter-restart',
      'unknown',
    ]),
  },
  'workspace.discovered': { label: textSchema, vcs: enumSchema(['git', 'other', 'none']) },
  'session.started': { resume: { type: 'boolean' } },
  'session.ended': {
    reason: enumSchema(['normal', 'archived', 'deleted', 'idle', 'error', 'unknown']),
  },
  'turn.started': { objectiveLabel: textSchema },
  'turn.finished': {
    outcome: enumSchema(['completed', 'partial', 'failed', 'interrupted', 'unknown']),
  },
  'turn.quiescent': {
    reason: enumSchema(['native', 'timeout', 'permission', 'no-active-work', 'unknown']),
  },
  'agent.spawned': {
    role: enumSchema(['orchestrator', 'worker', 'reviewer', 'researcher', 'tester', 'unknown']),
    agentKind: sanitizedTokenSchema,
    label: textSchema,
    depth: { ...integerSchema, maximum: MAX_JSON_DEPTH },
  },
  'agent.state.changed': {
    from: enumSchema([
      'starting',
      'working',
      'waiting',
      'blocked',
      'finishing',
      'finished',
      'failed',
    ]),
    to: enumSchema([
      'starting',
      'working',
      'waiting',
      'blocked',
      'finishing',
      'finished',
      'failed',
    ]),
    reason: enumSchema(['tool', 'permission', 'delegation', 'native', 'timeout', 'unknown']),
  },
  'agent.finished': { outcome: enumSchema(['completed', 'failed', 'cancelled', 'unknown']) },
  'task.created': {
    label: textSchema,
    description: descriptionSchema,
    status: enumSchema([
      'pending',
      'in_progress',
      'blocked',
      'completed',
      'failed',
      'denied',
      'cancelled',
      'abandoned',
      'unknown',
    ]),
    ordinal: integerSchema,
    fallback: { type: 'boolean' },
  },
  'task.updated': {
    label: textSchema,
    description: descriptionSchema,
    status: enumSchema([
      'pending',
      'in_progress',
      'blocked',
      'completed',
      'failed',
      'denied',
      'cancelled',
      'abandoned',
      'unknown',
    ]),
    ordinal: integerSchema,
  },
  'task.assigned': { assigneeAgentId: idSchema },
  'task.completion.requested': {
    requestedStatus: enumSchema(['completed']),
    checkpoint: enumSchema(['native', 'derived']),
  },
  'task.completed': { completion: enumSchema(['observed', 'derived']) },
  'task.failed': { category: enumSchema(['tool', 'validation', 'agent', 'unknown']) },
  'task.denied': { reason: enumSchema(['permission', 'policy', 'unknown']) },
  'task.cancelled': { reason: enumSchema(['replanned', 'user', 'superseded', 'unknown']) },
  'task.abandoned': {
    reason: enumSchema(['timeout', 'session-ended', 'telemetry-gap', 'unknown']),
  },
  'task.corrected': {
    correction: enumSchema(['reopen', 'replace-outcome']),
    correctedEventId: idSchema,
    correctedEntityId: idSchema,
    status: enumSchema([
      'pending',
      'in_progress',
      'blocked',
      'completed',
      'failed',
      'denied',
      'cancelled',
      'abandoned',
      'unknown',
    ]),
    resultingOutcome: enumSchema([
      'success',
      'failure',
      'denied',
      'cancelled',
      'abandoned',
      'unknown',
    ]),
  },
  'task.plan.reconciled': {
    revision: integerSchema,
    previousRevision: integerSchema,
    complete: { const: true },
    items: {
      type: 'array',
      maxItems: 1024,
      items: {
        type: 'object',
        additionalProperties: true,
        required: ['taskId', 'status', 'ordinal', 'identityBasis'],
        properties: {
          taskId: idSchema,
          status: enumSchema([
            'pending',
            'in_progress',
            'blocked',
            'completed',
            'failed',
            'denied',
            'cancelled',
            'abandoned',
            'unknown',
          ]),
          ordinal: integerSchema,
          label: textSchema,
          identityBasis: enumSchema([
            'stable-native-id',
            'exact-normalized-identity',
            'exact-ordinal-continuity',
            'new-unmatched',
          ]),
        },
      },
    },
  },
  'tool.requested': {
    name: sanitizedTokenSchema,
    category: enumSchema([
      'read',
      'search',
      'shell',
      'edit',
      'test',
      'build',
      'browser',
      'web',
      'mcp',
      'agent',
      'planning',
      'media',
      'other',
    ]),
    parallelGroupId: idSchema,
  },
  'tool.started': {
    name: sanitizedTokenSchema,
    category: enumSchema([
      'read',
      'search',
      'shell',
      'edit',
      'test',
      'build',
      'browser',
      'web',
      'mcp',
      'agent',
      'planning',
      'media',
      'other',
    ]),
    parallelGroupId: idSchema,
  },
  'tool.completed': {
    name: sanitizedTokenSchema,
    category: enumSchema([
      'read',
      'search',
      'shell',
      'edit',
      'test',
      'build',
      'browser',
      'web',
      'mcp',
      'agent',
      'planning',
      'media',
      'other',
    ]),
    durationMs: integerSchema,
    resultClass: enumSchema(['success', 'partial', 'unknown']),
  },
  'tool.failed': {
    name: sanitizedTokenSchema,
    category: enumSchema([
      'read',
      'search',
      'shell',
      'edit',
      'test',
      'build',
      'browser',
      'web',
      'mcp',
      'agent',
      'planning',
      'media',
      'other',
    ]),
    durationMs: integerSchema,
    failureClass: enumSchema([
      'exit_nonzero',
      'timeout',
      'denied',
      'cancelled',
      'exception',
      'unknown',
    ]),
  },
  'permission.requested': {
    category: enumSchema([
      'read',
      'search',
      'shell',
      'edit',
      'test',
      'build',
      'browser',
      'web',
      'mcp',
      'agent',
      'planning',
      'media',
      'other',
    ]),
    riskClass: enumSchema(['read', 'write', 'network', 'execute', 'destructive', 'unknown']),
  },
  'permission.resolved': {
    outcome: enumSchema(['allowed', 'denied', 'cancelled', 'timed_out', 'unknown']),
  },
};
const requiredData: Partial<Record<CoreEventType, readonly string[]>> = {
  'source.connected': ['agentKind', 'capabilities'],
  'source.capability.changed': ['capabilities', 'previousRevision', 'effectiveSequence'],
  'source.heartbeat': ['uptimeMs'],
  'source.disconnected': ['reason'],
  'telemetry.gap': ['reason'],
  'session.started': ['resume'],
  'session.ended': ['reason'],
  'turn.finished': ['outcome'],
  'turn.quiescent': ['reason'],
  'agent.spawned': ['role', 'depth'],
  'agent.state.changed': ['to'],
  'agent.finished': ['outcome'],
  'task.created': ['status', 'fallback'],
  'task.completion.requested': ['requestedStatus', 'checkpoint'],
  'task.completed': ['completion'],
  'task.denied': ['reason'],
  'task.abandoned': ['reason'],
  'task.corrected': ['correction', 'correctedEventId', 'correctedEntityId', 'status'],
  'task.plan.reconciled': ['revision', 'complete', 'items'],
  'tool.requested': ['name', 'category'],
  'tool.started': ['name', 'category'],
  'tool.completed': ['name', 'category'],
  'tool.failed': ['name', 'category', 'failureClass'],
  'permission.requested': ['category'],
  'permission.resolved': ['outcome'],
};

/** Custom keywords emitted by the protocol schemas for constraints JSON Schema cannot express. */
export const protocolSchemaKeywordNames = {
  planRevision: 'x-codeinvaders-plan-revision',
  correctionReferences: 'x-codeinvaders-correction-references',
  capabilityCoherence: 'x-codeinvaders-capability-coherence',
  planItems: 'x-codeinvaders-plan-items',
  noTimeoutSuccess: 'x-codeinvaders-no-timeout-success',
  schemaKeywords: 'x-codeinvaders-schema-keywords',
  limits: 'x-codeinvaders-limits',
  compatibility: 'x-codeinvaders-compatibility',
  requiredScope: 'x-codeinvaders-required-scope',
} as const;
export const protocolSchemaKeywordDocumentation = {
  [protocolSchemaKeywordNames.planRevision]:
    'Revision one omits previousRevision; later revisions require previousRevision === revision - 1.',
  [protocolSchemaKeywordNames.correctionReferences]:
    'A reopen correction requires semantic correction references to equal its data references.',
  [protocolSchemaKeywordNames.capabilityCoherence]:
    'Connected capabilities start at revision one and use the event sequence; capability changes use the event sequence and exact revision predecessor.',
  [protocolSchemaKeywordNames.planItems]:
    'Plan items have unique task IDs, zero-based contiguous ordered ordinals, and never transfer terminal state through ordinal-only or new identities.',
  [protocolSchemaKeywordNames.noTimeoutSuccess]:
    'An outcome with success may not use timeout as its semantic basis.',
  [protocolSchemaKeywordNames.schemaKeywords]:
    'Registry of executable and annotation keywords used by the exported schemas.',
  [protocolSchemaKeywordNames.limits]:
    'Documented protocol size and depth limits enforced at the validation boundary.',
  [protocolSchemaKeywordNames.compatibility]:
    'Documented forward-compatibility behavior for optional fields and extension events.',
  [protocolSchemaKeywordNames.requiredScope]:
    'The event-specific scope fields required by the protocol schema.',
} as const;

/** The Ajv surface needed to register the protocol's executable schema keywords. */
export interface ProtocolSchemaCompiler {
  addKeyword(definition: KeywordDefinition): unknown;
  getKeyword(keyword: string): unknown;
}

function isKeywordRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, property: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, property);
}

const validPlanStatuses = new Set([
  'pending',
  'in_progress',
  'blocked',
  'completed',
  'failed',
  'denied',
  'cancelled',
  'abandoned',
  'unknown',
]);
const validPlanIdentityBases = new Set([
  'stable-native-id',
  'exact-normalized-identity',
  'exact-ordinal-continuity',
  'new-unmatched',
]);
const terminalPlanStatuses = new Set([
  'completed',
  'failed',
  'denied',
  'cancelled',
  'abandoned',
  'unknown',
]);
const protocolIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Returns true for malformed data so ordinary JSON Schema validation owns type errors. */
function validateCapabilityCoherenceKeyword(mode: unknown, value: unknown): boolean {
  if (
    (mode !== 'connected' && mode !== 'changed') ||
    !isKeywordRecord(value) ||
    !isSafeNonNegativeInteger(value.sequence) ||
    !isKeywordRecord(value.data) ||
    !isKeywordRecord(value.data.capabilities)
  )
    return true;

  const data = value.data;
  const capabilities = value.data.capabilities;
  if (
    !isKeywordRecord(capabilities) ||
    !isSafeNonNegativeInteger(capabilities.revision) ||
    !isSafeNonNegativeInteger(capabilities.effectiveSequence)
  )
    return true;

  if (mode === 'connected')
    return capabilities.revision === 1 && capabilities.effectiveSequence === value.sequence;

  if (
    !isSafeNonNegativeInteger(data.previousRevision) ||
    !isSafeNonNegativeInteger(data.effectiveSequence)
  )
    return true;
  return (
    data.previousRevision >= 1 &&
    capabilities.revision === data.previousRevision + 1 &&
    data.effectiveSequence === value.sequence &&
    capabilities.effectiveSequence === data.effectiveSequence
  );
}

/** Returns true for malformed data so ordinary JSON Schema validation owns type errors. */
function validatePlanItemsKeyword(schema: boolean, value: unknown): boolean {
  if (!schema || !isKeywordRecord(value) || !Array.isArray(value.items)) return true;

  const items = value.items;
  const parsedItems: Array<{
    taskId: string;
    status: string;
    ordinal: number;
    identityBasis: PlanTask['identityBasis'];
  }> = [];
  for (const item of items) {
    if (
      !isKeywordRecord(item) ||
      typeof item.taskId !== 'string' ||
      !protocolIdPattern.test(item.taskId) ||
      typeof item.status !== 'string' ||
      !validPlanStatuses.has(item.status) ||
      !isSafeNonNegativeInteger(item.ordinal) ||
      typeof item.identityBasis !== 'string' ||
      !validPlanIdentityBases.has(item.identityBasis)
    )
      return true;
    parsedItems.push({
      taskId: item.taskId,
      status: item.status,
      ordinal: item.ordinal,
      identityBasis: item.identityBasis as PlanTask['identityBasis'],
    });
  }

  const ids = new Set<string>();
  for (const [index, item] of parsedItems.entries()) {
    if (
      ids.has(item.taskId) ||
      item.ordinal !== PLAN_ORDINAL_BASE + index ||
      (terminalPlanStatuses.has(item.status) && !canTransferTerminalState(item.identityBasis))
    )
      return false;
    ids.add(item.taskId);
  }
  return true;
}

/** Returns true for malformed data so ordinary JSON Schema validation owns type errors. */
function validateNoTimeoutSuccessKeyword(schema: boolean, value: unknown): boolean {
  if (!schema || !isKeywordRecord(value) || !isKeywordRecord(value.semantic)) return true;
  const semantic = value.semantic;
  if (semantic.kind !== 'outcome' || semantic.outcome !== 'success' || semantic.basis !== 'timeout')
    return true;
  return false;
}

function validatePlanRevisionKeyword(schema: boolean, value: unknown): boolean {
  if (!schema || !isKeywordRecord(value)) return true;
  const revision = value.revision;
  if (revision === 1) {
    if (!hasOwn(value, 'previousRevision')) return true;
    const previousRevision = value.previousRevision;
    return typeof previousRevision !== 'number' || !Number.isSafeInteger(previousRevision);
  }
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 2) return true;
  if (!hasOwn(value, 'previousRevision')) return false;
  const previousRevision = value.previousRevision;
  if (
    typeof previousRevision !== 'number' ||
    !Number.isSafeInteger(previousRevision) ||
    previousRevision < 0
  )
    return true;
  return previousRevision === revision - 1;
}

function validateCorrectionReferencesKeyword(schema: boolean, value: unknown): boolean {
  if (!schema || !isKeywordRecord(value)) return true;
  const data = value.data;
  const semantic = value.semantic;
  if (!isKeywordRecord(data) || data.correction !== 'reopen' || !isKeywordRecord(semantic))
    return true;
  if (!hasOwn(semantic, 'correctionOfEventId') || !hasOwn(semantic, 'correctionOfEntityId'))
    return true;
  if (
    typeof data.correctedEventId !== 'string' ||
    !protocolIdPattern.test(data.correctedEventId) ||
    typeof data.correctedEntityId !== 'string' ||
    !protocolIdPattern.test(data.correctedEntityId) ||
    typeof semantic.correctionOfEventId !== 'string' ||
    !protocolIdPattern.test(semantic.correctionOfEventId) ||
    typeof semantic.correctionOfEntityId !== 'string' ||
    !protocolIdPattern.test(semantic.correctionOfEntityId)
  )
    return true;
  return (
    semantic.correctionOfEventId === data.correctedEventId &&
    semantic.correctionOfEntityId === data.correctedEntityId
  );
}

const planRevisionKeyword: KeywordDefinition = {
  keyword: protocolSchemaKeywordNames.planRevision,
  type: 'object',
  schemaType: 'boolean',
  errors: false,
  validate: validatePlanRevisionKeyword,
};
const correctionReferencesKeyword: KeywordDefinition = {
  keyword: protocolSchemaKeywordNames.correctionReferences,
  type: 'object',
  schemaType: 'boolean',
  errors: false,
  validate: validateCorrectionReferencesKeyword,
};

const capabilityCoherenceKeyword: KeywordDefinition = {
  keyword: protocolSchemaKeywordNames.capabilityCoherence,
  type: 'object',
  schemaType: 'string',
  errors: false,
  validate: validateCapabilityCoherenceKeyword,
};
const planItemsKeyword: KeywordDefinition = {
  keyword: protocolSchemaKeywordNames.planItems,
  type: 'object',
  schemaType: 'boolean',
  errors: false,
  validate: validatePlanItemsKeyword,
};
const noTimeoutSuccessKeyword: KeywordDefinition = {
  keyword: protocolSchemaKeywordNames.noTimeoutSuccess,
  type: 'object',
  schemaType: 'boolean',
  errors: false,
  validate: validateNoTimeoutSuccessKeyword,
};
const annotationKeywords: readonly KeywordDefinition[] = [
  { keyword: protocolSchemaKeywordNames.schemaKeywords, valid: true },
  { keyword: protocolSchemaKeywordNames.limits, valid: true },
  { keyword: protocolSchemaKeywordNames.compatibility, valid: true },
  { keyword: protocolSchemaKeywordNames.requiredScope, valid: true },
];
const functionalKeywords: readonly KeywordDefinition[] = [
  planRevisionKeyword,
  correctionReferencesKeyword,
  capabilityCoherenceKeyword,
  planItemsKeyword,
  noTimeoutSuccessKeyword,
];
const allProtocolKeywords = [...functionalKeywords, ...annotationKeywords];
const functionalKeywordNames = new Set(
  functionalKeywords.flatMap((definition) =>
    typeof definition.keyword === 'string' ? [definition.keyword] : definition.keyword,
  ),
);

/** Register executable and annotation keywords required by every exported protocol schema. */
export function registerProtocolSchemaKeywords(instance: ProtocolSchemaCompiler): void {
  for (const definition of allProtocolKeywords) {
    const names =
      typeof definition.keyword === 'string' ? [definition.keyword] : definition.keyword;
    if (names.some((name) => !instance.getKeyword(name))) instance.addKeyword(definition);
  }
}

const semanticRequired = new Set<CoreEventType>([
  'source.capability.changed',
  'telemetry.gap',
  'turn.quiescent',
  'task.completion.requested',
  'task.completed',
  'task.failed',
  'task.denied',
  'task.cancelled',
  'task.abandoned',
  'task.corrected',
]);
const terminalOutcomeByStatus = {
  completed: 'success',
  failed: 'failure',
  denied: 'denied',
  cancelled: 'cancelled',
  abandoned: 'abandoned',
  unknown: 'unknown',
} as const satisfies Record<TerminalTaskStatus, TaskOutcome>;
const terminalOutcomeByEvent = {
  'task.completed': 'success',
  'task.failed': 'failure',
  'task.denied': 'denied',
  'task.cancelled': 'cancelled',
  'task.abandoned': 'abandoned',
} as const satisfies Partial<Record<CoreEventType, TaskOutcome>>;
const semanticRules: Partial<Record<CoreEventType, readonly object[]>> = {
  'task.completion.requested': [
    {
      type: 'object',
      properties: {
        finality: { const: 'provisional' },
        semantic: {
          type: 'object',
          required: ['kind', 'terminal'],
          properties: { kind: { const: 'checkpoint' }, terminal: { const: false } },
        },
      },
    },
  ],
  'turn.quiescent': [
    {
      type: 'object',
      properties: {
        semantic: {
          type: 'object',
          required: ['kind', 'terminal'],
          properties: { kind: { const: 'quiescence' }, terminal: { const: false } },
        },
      },
    },
  ],
  'telemetry.gap': [
    {
      type: 'object',
      properties: {
        semantic: {
          type: 'object',
          required: ['kind', 'terminal'],
          properties: { kind: { const: 'gap' }, terminal: { const: false } },
        },
      },
    },
  ],
  'task.completed': [
    {
      type: 'object',
      properties: {
        finality: { const: 'confirmed' },
        semantic: {
          type: 'object',
          properties: {
            kind: { const: 'outcome' },
            terminal: { const: true },
            outcome: { const: terminalOutcomeByEvent['task.completed'] },
          },
          required: ['kind', 'terminal', 'outcome'],
        },
      },
    },
  ],
  'task.failed': [
    {
      type: 'object',
      properties: {
        finality: { const: 'confirmed' },
        semantic: {
          type: 'object',
          properties: {
            kind: { const: 'outcome' },
            terminal: { const: true },
            outcome: { const: terminalOutcomeByEvent['task.failed'] },
          },
          required: ['kind', 'terminal', 'outcome'],
        },
      },
    },
  ],
  'task.denied': [
    {
      type: 'object',
      properties: {
        finality: { const: 'confirmed' },
        semantic: {
          type: 'object',
          properties: {
            kind: { const: 'outcome' },
            terminal: { const: true },
            outcome: { const: terminalOutcomeByEvent['task.denied'] },
          },
          required: ['kind', 'terminal', 'outcome'],
        },
      },
    },
  ],
  'task.cancelled': [
    {
      type: 'object',
      properties: {
        finality: { const: 'confirmed' },
        semantic: {
          type: 'object',
          properties: {
            kind: { const: 'outcome' },
            terminal: { const: true },
            outcome: { const: terminalOutcomeByEvent['task.cancelled'] },
          },
          required: ['kind', 'terminal', 'outcome'],
        },
      },
    },
  ],
  'task.abandoned': [
    {
      type: 'object',
      properties: {
        finality: { const: 'confirmed' },
        semantic: {
          type: 'object',
          properties: {
            kind: { const: 'outcome' },
            terminal: { const: true },
            outcome: { const: terminalOutcomeByEvent['task.abandoned'] },
          },
          required: ['kind', 'terminal', 'outcome'],
        },
      },
    },
  ],
  'source.capability.changed': [
    {
      type: 'object',
      properties: {
        finality: { const: 'confirmed' },
        semantic: {
          type: 'object',
          required: ['kind', 'terminal'],
          properties: { kind: { const: 'capability' }, terminal: { const: false } },
        },
      },
    },
  ],
};
const dataRules: Partial<Record<CoreEventType, readonly object[]>> = {
  'source.connected': [
    {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          properties: {
            capabilities: {
              type: 'object',
              required: ['revision'],
              properties: { revision: { const: 1 } },
            },
          },
        },
      },
    },
  ],
  'task.corrected': [
    {
      oneOf: [
        {
          type: 'object',
          properties: {
            finality: { const: 'confirmed' },
            data: {
              type: 'object',
              properties: {
                correction: { const: 'reopen' },
                status: enumSchema(['pending', 'in_progress', 'blocked']),
                correctedEventId: {},
                correctedEntityId: {},
              },
              required: ['correction', 'correctedEventId', 'correctedEntityId', 'status'],
              not: {
                type: 'object',
                properties: { resultingOutcome: {} },
                required: ['resultingOutcome'],
              },
            },
            semantic: {
              type: 'object',
              required: ['kind', 'terminal', 'correctionOfEventId', 'correctionOfEntityId'],
              properties: {
                kind: { const: 'correction' },
                terminal: { const: false },
                correctionOfEventId: {},
                correctionOfEntityId: {},
              },
            },
          },
          required: ['finality', 'data', 'semantic'],
        },
        ...(Object.entries(terminalOutcomeByStatus) as [TerminalTaskStatus, TaskOutcome][]).map(
          ([status, outcome]) => ({
            type: 'object',
            properties: {
              finality: { const: 'confirmed' },
              data: {
                type: 'object',
                properties: {
                  correction: { const: 'replace-outcome' },
                  status: { const: status },
                  resultingOutcome: { const: outcome },
                  correctedEventId: {},
                  correctedEntityId: {},
                },
                required: [
                  'correction',
                  'correctedEventId',
                  'correctedEntityId',
                  'status',
                  'resultingOutcome',
                ],
              },
              semantic: {
                type: 'object',
                required: ['kind', 'terminal', 'outcome'],
                properties: {
                  kind: { const: 'outcome' },
                  terminal: { const: true },
                  outcome: { const: outcome },
                },
              },
            },
            required: ['finality', 'data', 'semantic'],
          }),
        ),
      ],
    },
  ],
  'task.plan.reconciled': [
    {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          oneOf: [
            {
              type: 'object',
              properties: { revision: { const: 1 } },
              not: {
                type: 'object',
                properties: { previousRevision: {} },
                required: ['previousRevision'],
              },
            },
            {
              type: 'object',
              properties: {
                revision: { type: 'number', minimum: 2 },
                previousRevision: { type: 'integer', minimum: 1 },
              },
              required: ['revision', 'previousRevision'],
            },
          ],
        },
      },
    },
  ],
};
const baseSchema = (type: CoreEventType) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${protocolId}/events/${type}`,
  type: 'object',
  additionalProperties: true,
  required: [
    'spec',
    'version',
    'eventId',
    'type',
    'occurredAt',
    'observedAt',
    'sequence',
    'source',
    'scope',
    'fidelity',
    'finality',
    'data',
    ...(semanticRequired.has(type) ? ['semantic'] : []),
  ],
  properties: {
    spec: { const: protocolId },
    version: { type: 'string', pattern: semverPattern },
    eventId: idSchema,
    type: { const: type },
    occurredAt: { type: 'string', format: 'date-time' },
    observedAt: { type: 'string', format: 'date-time' },
    sequence: integerSchema,
    source: {
      type: 'object',
      additionalProperties: true,
      not: {
        type: 'object',
        properties: { nativeEvent: {} },
        required: ['nativeEvent'],
      },
      required: ['adapterId', 'adapterVersion', 'streamId', 'epochId'],
      properties: {
        adapterId: idSchema,
        adapterVersion: { type: 'string', pattern: semverPattern },
        streamId: idSchema,
        epochId: idSchema,
        nativeToken: sanitizedTokenSchema,
        nativeEvent: textSchema,
      },
    },
    scope: {
      type: 'object',
      additionalProperties: true,
      required: [...new Set(['workspaceId', 'sessionId', ...scopeRules[type]])],
      properties: {
        workspaceId: idSchema,
        repoId: idSchema,
        sessionId: idSchema,
        turnId: idSchema,
        agentId: idSchema,
        taskId: idSchema,
        operationId: idSchema,
        permissionId: idSchema,
      },
    },
    links: {
      type: 'object',
      additionalProperties: true,
      properties: {
        causationEventId: idSchema,
        parentAgentId: idSchema,
        parentTaskId: idSchema,
        correlationId: idSchema,
      },
    },
    semantic: {
      type: 'object',
      additionalProperties: true,
      required: ['kind', 'terminal'],
      properties: {
        kind: enumSchema([
          'checkpoint',
          'quiescence',
          'outcome',
          'correction',
          'capability',
          'gap',
        ]),
        terminal: { type: 'boolean' },
        outcome: enumSchema(['success', 'failure', 'denied', 'cancelled', 'abandoned', 'unknown']),
        basis: enumSchema([
          'native',
          'derived',
          'timeout',
          'quiescence',
          'reconciliation',
          'correction',
        ]),
        correctionOfEventId: idSchema,
        correctionOfEntityId: idSchema,
      },
    },
    fidelity: enumSchema(['observed', 'derived', 'synthetic']),
    finality: enumSchema(['provisional', 'confirmed']),
    data: {
      type: 'object',
      additionalProperties: true,
      required: requiredData[type] ?? [],
      properties: dataProps[type],
      ...(type === 'task.plan.reconciled'
        ? {
            [protocolSchemaKeywordNames.planRevision]: true,
            [protocolSchemaKeywordNames.planItems]: true,
          }
        : {}),
    },
  },
  ...(semanticRules[type] || dataRules[type]
    ? { allOf: [...(semanticRules[type] ?? []), ...(dataRules[type] ?? [])] }
    : {}),
  [protocolSchemaKeywordNames.noTimeoutSuccess]: true,
  ...(type === 'source.connected'
    ? { [protocolSchemaKeywordNames.capabilityCoherence]: 'connected' }
    : type === 'source.capability.changed'
      ? { [protocolSchemaKeywordNames.capabilityCoherence]: 'changed' }
      : {}),
  ...(type === 'task.corrected' ? { [protocolSchemaKeywordNames.correctionReferences]: true } : {}),
  [protocolSchemaKeywordNames.schemaKeywords]: protocolSchemaKeywordDocumentation,
  [protocolSchemaKeywordNames.limits]: {
    maxBytes: MAX_EVENT_BYTES,
    maxDepth: MAX_JSON_DEPTH,
    maxExtensionBytes: MAX_EXTENSION_BYTES,
  },
  [protocolSchemaKeywordNames.compatibility]: {
    unknownOptionalFields: 'ignore',
    unknownExtensionFallback: 'preserve-in-journal',
  },
  [protocolSchemaKeywordNames.requiredScope]: scopeRules[type],
});

export const coreEventSchemas = Object.fromEntries(
  coreTypes.map((type) => [type, baseSchema(type)]),
) as unknown as Readonly<Record<CoreEventType, Record<string, unknown>>>;
const extensionPattern =
  /^x\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

export interface ExtensionMetadata {
  readonly fallback: 'preserve-in-journal';
  readonly documentation: string;
  readonly [key: string]: unknown;
}

export interface ExtensionEvent {
  readonly spec: typeof protocolId;
  readonly version: ProtocolVersion;
  readonly eventId: Id;
  readonly type: `x.${string}`;
  readonly occurredAt: string;
  readonly observedAt: string;
  readonly sequence: number;
  readonly source: SourceIdentity;
  readonly scope: EventScope;
  readonly links?: EventLinks;
  readonly semantic?: SemanticMetadata;
  readonly fidelity: Fidelity;
  readonly finality: Finality;
  readonly extension: ExtensionMetadata;
  readonly data: Record<string, unknown>;
  readonly [key: string]: unknown;
}

const extensionEventSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${protocolId}/events/extension`,
  type: 'object',
  additionalProperties: true,
  required: [
    'spec',
    'version',
    'eventId',
    'type',
    'occurredAt',
    'observedAt',
    'sequence',
    'source',
    'scope',
    'fidelity',
    'finality',
    'extension',
    'data',
  ],
  properties: {
    spec: { const: protocolId },
    version: { type: 'string', pattern: semverPattern },
    eventId: idSchema,
    type: { type: 'string', pattern: extensionPattern.source },
    occurredAt: { type: 'string', format: 'date-time' },
    observedAt: { type: 'string', format: 'date-time' },
    sequence: integerSchema,
    source: baseSchema('source.connected').properties.source,
    scope: {
      type: 'object',
      additionalProperties: true,
      required: ['workspaceId', 'sessionId'],
      properties: {
        workspaceId: idSchema,
        repoId: idSchema,
        sessionId: idSchema,
        turnId: idSchema,
        agentId: idSchema,
        taskId: idSchema,
        operationId: idSchema,
        permissionId: idSchema,
      },
    },
    links: baseSchema('source.connected').properties.links,
    fidelity: enumSchema(['observed', 'derived', 'synthetic']),
    finality: enumSchema(['provisional', 'confirmed']),
    extension: {
      type: 'object',
      additionalProperties: true,
      required: ['fallback', 'documentation'],
      properties: {
        fallback: { const: 'preserve-in-journal' },
        documentation: { type: 'string', minLength: 1, maxLength: 512 },
      },
    },
    data: { type: 'object', additionalProperties: true },
  },
  [protocolSchemaKeywordNames.noTimeoutSuccess]: true,
  [protocolSchemaKeywordNames.schemaKeywords]: protocolSchemaKeywordDocumentation,
  [protocolSchemaKeywordNames.limits]: {
    maxBytes: MAX_EVENT_BYTES,
    maxDepth: MAX_JSON_DEPTH,
    maxExtensionBytes: MAX_EXTENSION_BYTES,
  },
  [protocolSchemaKeywordNames.compatibility]: {
    unknownOptionalFields: 'ignore',
    unknownExtensionFallback: 'preserve-in-journal',
  },
};
export { extensionEventSchema };

type AjvLike = ProtocolSchemaCompiler & { compile: (schema: object) => ValidateFunction };
const AjvConstructor = Ajv2020Module.default as unknown as new (options: object) => AjvLike;
const ajv = new AjvConstructor({ strict: false, allErrors: false, validateFormats: true });
const addFormats = addFormatsModule.default as unknown as (instance: AjvLike) => void;
addFormats(ajv);
registerProtocolSchemaKeywords(ajv);
const validators = new Map<CoreEventType, ValidateFunction>(
  coreTypes.map((type) => [type, ajv.compile(coreEventSchemas[type])]),
);
const extensionValidator = ajv.compile(extensionEventSchema);
const diagnostic = (
  code: ProtocolDiagnostic['code'],
  field?: ProtocolDiagnostic['field'],
  eventType?: CoreEventType,
  protocolMajor?: number,
): ProtocolDiagnostic => ({
  code,
  severity: 'error',
  ...(field ? { field } : {}),
  ...(eventType ? { eventType } : {}),
  ...(protocolMajor === undefined ? {} : { protocolMajor }),
});
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const semver = (value: unknown): value is string =>
  typeof value === 'string' && new RegExp(semverPattern).test(value);
const safeMajor = (version: string): number | undefined => {
  const major = Number(version.split('.')[0]);
  return Number.isSafeInteger(major) && major >= 0 && major <= 9999 ? major : undefined;
};

function serializedBounds(value: unknown): { bytes?: number; depth?: number } | ProtocolDiagnostic {
  const seen = new WeakSet<object>();
  let maxDepth = 0;
  const walk = (item: unknown, level: number): boolean => {
    maxDepth = Math.max(maxDepth, level);
    if (level > MAX_JSON_DEPTH) return false;
    if (!item || typeof item !== 'object') return true;
    if (seen.has(item)) return false;
    seen.add(item);
    const values = Array.isArray(item) ? item : Object.values(item);
    return values.every((child) => walk(child, level + 1));
  };
  if (!walk(value, 0))
    return diagnostic(
      maxDepth > MAX_JSON_DEPTH ? 'event-too-deep' : 'invalid-envelope',
      maxDepth > MAX_JSON_DEPTH ? 'depth' : undefined,
    );
  try {
    const encoded = new TextEncoder().encode(JSON.stringify(value));
    return { bytes: encoded.byteLength, depth: maxDepth };
  } catch {
    return diagnostic('invalid-envelope');
  }
}

function mapAjvError(
  error: ErrorObject | undefined,
  eventType?: CoreEventType,
): ProtocolDiagnostic {
  const keyword = error?.keyword;
  if (typeof keyword === 'string' && functionalKeywordNames.has(keyword))
    return diagnostic('invalid-data', 'data', eventType);
  if (keyword === 'format' && error?.params?.format === 'date-time')
    return diagnostic('invalid-envelope', 'timestamps', eventType);
  if (
    keyword === 'required' ||
    keyword === 'additionalProperties' ||
    keyword === 'type' ||
    keyword === 'enum' ||
    keyword === 'const' ||
    keyword === 'pattern' ||
    keyword === 'minimum' ||
    keyword === 'maximum' ||
    keyword === 'items' ||
    keyword === 'maxItems'
  ) {
    const field = error?.instancePath.startsWith('/scope')
      ? 'scope'
      : error?.instancePath.startsWith('/data')
        ? 'data'
        : error?.instancePath.includes('sequence')
          ? 'sequence'
          : error?.instancePath.includes('version')
            ? 'version'
            : 'invalid-envelope';
    return diagnostic(
      field === 'scope' ? 'invalid-scope' : field === 'data' ? 'invalid-data' : 'invalid-envelope',
      field === 'invalid-envelope' ? undefined : field,
      eventType,
    );
  }
  return diagnostic('invalid-envelope', undefined, eventType);
}

function semanticError(eventType: CoreEventType): ProtocolDiagnostic {
  return diagnostic('invalid-data', 'data', eventType);
}

function validateSemantics(
  input: Record<string, unknown>,
  eventType: CoreEventType,
): ProtocolDiagnostic | undefined {
  const semantic = input.semantic as Record<string, unknown> | undefined;
  const data = input.data as Record<string, unknown>;
  const finality = input.finality;
  const expectedOutcome = terminalOutcomeByEvent[eventType as keyof typeof terminalOutcomeByEvent];
  if (!validateNoTimeoutSuccessKeyword(true, input)) return semanticError(eventType);
  if (semanticRequired.has(eventType) && !semantic) return semanticError(eventType);
  if (
    eventType === 'task.completion.requested' &&
    (finality !== 'provisional' || semantic?.kind !== 'checkpoint' || semantic.terminal !== false)
  )
    return semanticError(eventType);
  if (
    eventType === 'turn.quiescent' &&
    (semantic?.kind !== 'quiescence' || semantic.terminal !== false)
  )
    return semanticError(eventType);
  if (eventType === 'telemetry.gap' && (semantic?.kind !== 'gap' || semantic.terminal !== false))
    return semanticError(eventType);
  if (
    expectedOutcome !== undefined &&
    (finality !== 'confirmed' || semantic?.kind !== 'outcome' || semantic.terminal !== true)
  )
    return semanticError(eventType);
  if (expectedOutcome !== undefined && semantic?.outcome !== expectedOutcome)
    return semanticError(eventType);
  if (
    eventType === 'task.corrected' &&
    (finality !== 'confirmed' ||
      semantic?.kind === undefined ||
      (data.correction === 'reopen' &&
        (semantic.kind !== 'correction' ||
          semantic.terminal !== false ||
          semantic.correctionOfEventId !== data.correctedEventId ||
          semantic.correctionOfEntityId !== data.correctedEntityId)) ||
      (data.correction === 'replace-outcome' &&
        (semantic.kind !== 'outcome' ||
          semantic.terminal !== true ||
          semantic.outcome !== data.resultingOutcome ||
          terminalOutcomeByStatus[data.status as TerminalTaskStatus] !== data.resultingOutcome)))
  )
    return semanticError(eventType);
  if (eventType === 'source.capability.changed') {
    if (
      finality !== 'confirmed' ||
      semantic?.kind !== 'capability' ||
      semantic.terminal !== false ||
      !validateCapabilityCoherenceKeyword('changed', input)
    )
      return semanticError(eventType);
  }
  if (eventType === 'source.connected') {
    if (!validateCapabilityCoherenceKeyword('connected', input)) return semanticError(eventType);
  }
  if (eventType === 'task.plan.reconciled') {
    const revision = data.revision as number;
    const previous = data.previousRevision as number | undefined;
    if (
      data.complete !== true ||
      !Number.isSafeInteger(revision) ||
      revision < 1 ||
      (revision === 1 ? hasOwn(data, 'previousRevision') : previous !== revision - 1) ||
      !validatePlanItemsKeyword(true, data)
    )
      return semanticError(eventType);
  }
  return undefined;
}

export function validateEvent(input: unknown): ValidationResult {
  if (!isRecord(input))
    return { status: 'rejected', diagnostics: [diagnostic('invalid-envelope')] };
  const bounds = serializedBounds(input);
  if ('code' in bounds) return { status: 'rejected', diagnostics: [bounds] };
  if ((bounds.bytes ?? 0) > MAX_EVENT_BYTES)
    return { status: 'rejected', diagnostics: [diagnostic('event-too-large', 'size')] };
  if ((bounds.depth ?? 0) > MAX_JSON_DEPTH)
    return { status: 'rejected', diagnostics: [diagnostic('event-too-deep', 'depth')] };
  if (!semver(input.version))
    return { status: 'rejected', diagnostics: [diagnostic('invalid-version', 'version')] };
  const major = safeMajor(input.version);
  if (major !== 1)
    return {
      status: 'quarantined',
      diagnostics: [diagnostic('unsupported-major', 'version', undefined, major)],
    };
  const type = input.type;
  if (typeof type !== 'string')
    return { status: 'rejected', diagnostics: [diagnostic('unknown-event', 'type')] };
  if (!coreTypes.includes(type as CoreEventType)) {
    if (!type.startsWith('x.'))
      return { status: 'rejected', diagnostics: [diagnostic('unknown-event', 'type')] };
    if (!extensionPattern.test(type))
      return { status: 'rejected', diagnostics: [diagnostic('invalid-extension', 'type')] };
    const extension = input.extension;
    if (
      !isRecord(extension) ||
      extension.fallback !== 'preserve-in-journal' ||
      typeof extension.documentation !== 'string' ||
      [...extension.documentation].length < 1 ||
      [...extension.documentation].length > 512
    )
      return { status: 'rejected', diagnostics: [diagnostic('invalid-extension', 'extension')] };
    const extensionBytes = serializedBounds(input.data);
    if ('code' in extensionBytes || (extensionBytes.bytes ?? 0) > MAX_EXTENSION_BYTES)
      return { status: 'rejected', diagnostics: [diagnostic('event-too-large', 'size')] };
    const extensionValid = extensionValidator(input);
    if (!extensionValid)
      return {
        status: 'rejected',
        diagnostics: [diagnostic('invalid-extension', 'extension')],
      };
    return {
      status: 'preserved-extension',
      event: input as ExtensionEvent,
      diagnostics: [{ code: 'extension-preserved', severity: 'warning', field: 'type' }],
    };
  }
  const eventType = type as CoreEventType;
  const valid = validators.get(eventType)?.(input);
  if (!valid)
    return {
      status: 'rejected',
      diagnostics: [mapAjvError(validators.get(eventType)?.errors?.[0], eventType)],
    };
  const semanticDiagnostic = validateSemantics(input, eventType);
  if (semanticDiagnostic) return { status: 'rejected', diagnostics: [semanticDiagnostic] };
  return { status: 'accepted', event: input as AnyCoreEvent, diagnostics: [] };
}

export function isCoreEvent(value: unknown): value is AnyCoreEvent {
  return validateEvent(value).status === 'accepted';
}

/** Exposed for conformance tests and consumers that want to preflight compilation. */
export function compileCoreEventSchemas(): readonly ValidateFunction[] {
  registerProtocolSchemaKeywords(ajv);
  return coreTypes.map((type) => ajv.compile(coreEventSchemas[type]));
}
