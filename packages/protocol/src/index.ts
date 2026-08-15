import * as Ajv2020Module from 'ajv/dist/2020.js';
import * as addFormatsModule from 'ajv-formats';
import type { ErrorObject, ValidateFunction } from 'ajv';

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

export interface SourceIdentity {
  readonly adapterId: Id;
  readonly adapterVersion: string;
  readonly streamId: Id;
  readonly epochId: Id;
  readonly nativeEvent?: string;
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
  'pending' | 'in_progress' | 'blocked' | 'completed' | 'failed' | 'cancelled' | 'unknown';
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
  readonly sessions: Support;
  readonly turns: Support;
  readonly tasks: {
    readonly lifecycle: Support;
    readonly snapshotReconciliation: boolean;
    readonly titles: Support;
    readonly descriptions: Support;
    readonly assignment: Support;
    readonly hierarchy: Support;
  };
  readonly agents: {
    readonly lifecycle: Support;
    readonly nesting: Support;
    readonly toolAttribution: Support;
  };
  readonly tools: {
    readonly start: Support;
    readonly success: Support;
    readonly failure: Support;
    readonly duration: Support;
    readonly names: Support;
  };
  readonly permissions: {
    readonly request: Support;
    readonly resolution: Support;
    readonly operationLink: Support;
  };
  readonly notes?: readonly string[];
}

type DataMap = {
  'source.connected': { agentKind: string; agentVersion?: string; capabilities: CapabilityProfile };
  'source.heartbeat': { uptimeMs: number };
  'source.disconnected': { reason: 'normal' | 'timeout' | 'error' | 'unknown' };
  'telemetry.gap': {
    fromSequence?: number;
    toSequence?: number;
    reason: 'dropped' | 'corrupt' | 'out-of-order-timeout' | 'adapter-restart' | 'unknown';
  };
  'workspace.discovered': { label?: string; vcs?: 'git' | 'other' | 'none' };
  'session.started': { resume: boolean };
  'session.ended': { reason: 'normal' | 'archived' | 'deleted' | 'idle' | 'error' | 'unknown' };
  'turn.started': { objectiveLabel?: string };
  'turn.finished': { outcome: 'completed' | 'partial' | 'failed' | 'interrupted' | 'unknown' };
  'agent.spawned': {
    role: 'orchestrator' | 'worker' | 'reviewer' | 'researcher' | 'tester' | 'unknown';
    label?: string;
    depth: number;
  };
  'agent.state.changed': {
    from?: AgentState;
    to: AgentState;
    reason?: 'tool' | 'permission' | 'delegation' | 'native' | 'timeout' | 'unknown';
  };
  'agent.finished': { outcome: 'completed' | 'failed' | 'cancelled' | 'unknown' };
  'task.created': {
    label?: string;
    description?: string;
    status: TaskStatus;
    ordinal?: number;
    fallback: boolean;
  };
  'task.updated': { label?: string; description?: string; status?: TaskStatus; ordinal?: number };
  'task.assigned': { assigneeAgentId?: Id };
  'task.completed': { completion: 'observed' | 'derived' };
  'task.failed': { category?: 'tool' | 'validation' | 'agent' | 'unknown' };
  'task.cancelled': { reason?: 'replanned' | 'user' | 'superseded' | 'unknown' };
  'task.plan.reconciled': { revision: number; taskIds: readonly Id[] };
  'tool.requested': { name: string; category: ToolCategory; parallelGroupId?: Id };
  'tool.started': { name: string; category: ToolCategory; parallelGroupId?: Id };
  'tool.completed': {
    name: string;
    category: ToolCategory;
    durationMs?: number;
    resultClass?: 'success' | 'partial' | 'unknown';
  };
  'tool.failed': {
    name: string;
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

export type CoreEventType = keyof DataMap;
type RequiredScopeByEvent = {
  'source.connected': 'sessionId';
  'source.heartbeat': 'sessionId';
  'source.disconnected': 'sessionId';
  'telemetry.gap': 'sessionId';
  'workspace.discovered': 'sessionId';
  'session.started': 'sessionId';
  'session.ended': 'sessionId';
  'turn.started': 'sessionId' | 'turnId';
  'turn.finished': 'sessionId' | 'turnId';
  'agent.spawned': 'sessionId' | 'agentId';
  'agent.state.changed': 'sessionId' | 'agentId';
  'agent.finished': 'sessionId' | 'agentId';
  'task.created': 'sessionId' | 'taskId';
  'task.updated': 'sessionId' | 'taskId';
  'task.assigned': 'sessionId' | 'taskId';
  'task.completed': 'sessionId' | 'taskId';
  'task.failed': 'sessionId' | 'taskId';
  'task.cancelled': 'sessionId' | 'taskId';
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
export type CoreEvent<T extends CoreEventType = CoreEventType> = {
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
  readonly finality: Finality;
  readonly data: DataMap[T];
};
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
  'source.heartbeat',
  'source.disconnected',
  'telemetry.gap',
  'workspace.discovered',
  'session.started',
  'session.ended',
  'turn.started',
  'turn.finished',
  'agent.spawned',
  'agent.state.changed',
  'agent.finished',
  'task.created',
  'task.updated',
  'task.assigned',
  'task.completed',
  'task.failed',
  'task.cancelled',
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
  'source.heartbeat': ['sessionId'],
  'source.disconnected': ['sessionId'],
  'telemetry.gap': ['sessionId'],
  'workspace.discovered': ['sessionId'],
  'session.started': ['sessionId'],
  'session.ended': ['sessionId'],
  'turn.started': ['sessionId', 'turnId'],
  'turn.finished': ['sessionId', 'turnId'],
  'agent.spawned': ['sessionId', 'agentId'],
  'agent.state.changed': ['sessionId', 'agentId'],
  'agent.finished': ['sessionId', 'agentId'],
  'task.created': ['sessionId', 'taskId'],
  'task.updated': ['sessionId', 'taskId'],
  'task.assigned': ['sessionId', 'taskId'],
  'task.completed': ['sessionId', 'taskId'],
  'task.failed': ['sessionId', 'taskId'],
  'task.cancelled': ['sessionId', 'taskId'],
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
const textSchema = { type: 'string', minLength: 1, maxLength: 256 };
const semverPattern =
  '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$';
const integerSchema = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const enumSchema = (values: readonly string[]) => ({ type: 'string', enum: values });
const supportSchema = enumSchema(['none', 'derived', 'observed']);
const capabilitySchema = {
  type: 'object',
  additionalProperties: true,
  required: ['sessions', 'turns', 'tasks', 'agents', 'tools', 'permissions'],
  properties: {
    sessions: supportSchema,
    turns: supportSchema,
    tasks: {
      type: 'object',
      additionalProperties: true,
      required: [
        'lifecycle',
        'snapshotReconciliation',
        'titles',
        'descriptions',
        'assignment',
        'hierarchy',
      ],
      properties: {
        lifecycle: supportSchema,
        snapshotReconciliation: { type: 'boolean' },
        titles: supportSchema,
        descriptions: supportSchema,
        assignment: supportSchema,
        hierarchy: supportSchema,
      },
    },
    agents: {
      type: 'object',
      additionalProperties: true,
      required: ['lifecycle', 'nesting', 'toolAttribution'],
      properties: {
        lifecycle: supportSchema,
        nesting: supportSchema,
        toolAttribution: supportSchema,
      },
    },
    tools: {
      type: 'object',
      additionalProperties: true,
      required: ['start', 'success', 'failure', 'duration', 'names'],
      properties: {
        start: supportSchema,
        success: supportSchema,
        failure: supportSchema,
        duration: supportSchema,
        names: supportSchema,
      },
    },
    permissions: {
      type: 'object',
      additionalProperties: true,
      required: ['request', 'resolution', 'operationLink'],
      properties: {
        request: supportSchema,
        resolution: supportSchema,
        operationLink: supportSchema,
      },
    },
    notes: { type: 'array', maxItems: 32, items: textSchema },
  },
};
const dataProps: Record<CoreEventType, Record<string, unknown>> = {
  'source.connected': {
    agentKind: textSchema,
    agentVersion: { ...textSchema, pattern: semverPattern },
    capabilities: capabilitySchema,
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
  'agent.spawned': {
    role: enumSchema(['orchestrator', 'worker', 'reviewer', 'researcher', 'tester', 'unknown']),
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
    description: { type: 'string', minLength: 1, maxLength: 2048 },
    status: enumSchema([
      'pending',
      'in_progress',
      'blocked',
      'completed',
      'failed',
      'cancelled',
      'unknown',
    ]),
    ordinal: integerSchema,
    fallback: { type: 'boolean' },
  },
  'task.updated': {
    label: textSchema,
    description: { type: 'string', minLength: 1, maxLength: 2048 },
    status: enumSchema([
      'pending',
      'in_progress',
      'blocked',
      'completed',
      'failed',
      'cancelled',
      'unknown',
    ]),
    ordinal: integerSchema,
  },
  'task.assigned': { assigneeAgentId: idSchema },
  'task.completed': { completion: enumSchema(['observed', 'derived']) },
  'task.failed': { category: enumSchema(['tool', 'validation', 'agent', 'unknown']) },
  'task.cancelled': { reason: enumSchema(['replanned', 'user', 'superseded', 'unknown']) },
  'task.plan.reconciled': {
    revision: integerSchema,
    taskIds: { type: 'array', maxItems: 1024, items: idSchema },
  },
  'tool.requested': {
    name: textSchema,
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
    name: textSchema,
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
    name: textSchema,
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
    name: textSchema,
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
  'source.heartbeat': ['uptimeMs'],
  'source.disconnected': ['reason'],
  'telemetry.gap': ['reason'],
  'session.started': ['resume'],
  'session.ended': ['reason'],
  'turn.finished': ['outcome'],
  'agent.spawned': ['role', 'depth'],
  'agent.state.changed': ['to'],
  'agent.finished': ['outcome'],
  'task.created': ['status', 'fallback'],
  'task.completed': ['completion'],
  'task.plan.reconciled': ['revision', 'taskIds'],
  'tool.requested': ['name', 'category'],
  'tool.started': ['name', 'category'],
  'tool.completed': ['name', 'category'],
  'tool.failed': ['name', 'category', 'failureClass'],
  'permission.requested': ['category'],
  'permission.resolved': ['outcome'],
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
      required: ['adapterId', 'adapterVersion', 'streamId', 'epochId'],
      properties: {
        adapterId: idSchema,
        adapterVersion: { type: 'string', pattern: semverPattern },
        streamId: idSchema,
        epochId: idSchema,
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
    fidelity: enumSchema(['observed', 'derived', 'synthetic']),
    finality: enumSchema(['provisional', 'confirmed']),
    data: {
      type: 'object',
      additionalProperties: true,
      required: requiredData[type] ?? [],
      properties: dataProps[type],
    },
  },
  'x-codeinvaders-limits': {
    maxBytes: MAX_EVENT_BYTES,
    maxDepth: MAX_JSON_DEPTH,
    maxExtensionBytes: MAX_EXTENSION_BYTES,
  },
  'x-codeinvaders-compatibility': {
    unknownOptionalFields: 'ignore',
    unknownExtensionFallback: 'preserve-in-journal',
  },
  'x-codeinvaders-required-scope': scopeRules[type],
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
  'x-codeinvaders-limits': {
    maxBytes: MAX_EVENT_BYTES,
    maxDepth: MAX_JSON_DEPTH,
    maxExtensionBytes: MAX_EXTENSION_BYTES,
  },
  'x-codeinvaders-compatibility': {
    unknownOptionalFields: 'ignore',
    unknownExtensionFallback: 'preserve-in-journal',
  },
};
export { extensionEventSchema };

type AjvLike = { compile: (schema: object) => ValidateFunction };
const AjvConstructor = Ajv2020Module.default as unknown as new (options: object) => AjvLike;
const ajv = new AjvConstructor({ strict: false, allErrors: false, validateFormats: true });
const addFormats = addFormatsModule.default as unknown as (instance: AjvLike) => void;
addFormats(ajv);
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
      extension.documentation.length < 1 ||
      extension.documentation.length > 512
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
  return { status: 'accepted', event: input as AnyCoreEvent, diagnostics: [] };
}

export function isCoreEvent(value: unknown): value is AnyCoreEvent {
  return validateEvent(value).status === 'accepted';
}

/** Exposed for conformance tests and consumers that want to preflight compilation. */
export function compileCoreEventSchemas(): readonly ValidateFunction[] {
  return coreTypes.map((type) => ajv.compile(coreEventSchemas[type]));
}
