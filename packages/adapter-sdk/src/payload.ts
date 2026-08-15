import {
  MAX_JSON_DEPTH,
  type AgentState,
  type SanitizedToken,
  type TaskStatus,
  type ToolCategory,
} from '@codeinvaders/protocol';
import { isOpaqueId, type OpaqueId } from './identity.js';
import {
  canonicalToolNameForCategory,
  categorizeBuiltinTool,
  categorizeToolSnapshot,
} from './tool-category.js';
import {
  readFirstSnapshot,
  makeImmutableRecord,
  snapshotAllowedProperties,
  type SafePropertySnapshot,
} from './safe-input.js';
import { appendArrayValue, harden } from './immutable.js';

const freeze = harden;
const isSafeInteger = Number.isSafeInteger;

const PAYLOAD_PROPERTY_KEYS = freeze([
  'name',
  'toolName',
  'tool_name',
  'tool',
  'source',
  'kind',
  'toolType',
  'tool_type',
  'type',
  'provider',
  'origin',
  'toolKind',
  'tool_kind',
  'isMcp',
  'is_mcp',
  'mcp',
  'server',
  'serverName',
  'server_name',
  'mcpServer',
  'mcp_server',
  'mcpServerName',
  'mcp_server_name',
  'parallelGroupId',
  'parallel_group_id',
  'durationMs',
  'duration_ms',
  'resultClass',
  'result_class',
  'failureClass',
  'failure_class',
  'riskClass',
  'risk_class',
  'outcome',
  'status',
  'fallback',
  'ordinal',
  'assigneeAgentId',
  'assignee_agent_id',
  'checkpoint',
  'completion',
  'category',
  'failureCategory',
  'failure_category',
  'reason',
  'role',
  'depth',
  'to',
  'from',
  'vcs',
  'resume',
] as const);

export type ToolPayloadPhase = 'requested' | 'started' | 'completed' | 'failed';

export interface CanonicalToolRequestedPayload {
  readonly name: SanitizedToken;
  readonly category: ToolCategory;
  readonly parallelGroupId?: OpaqueId;
}

export type CanonicalToolStartedPayload = CanonicalToolRequestedPayload;

export interface CanonicalToolCompletedPayload {
  readonly name: SanitizedToken;
  readonly category: ToolCategory;
  readonly durationMs?: number;
  readonly resultClass?: 'success' | 'partial' | 'unknown';
}

export interface CanonicalToolFailedPayload {
  readonly name: SanitizedToken;
  readonly category: ToolCategory;
  readonly durationMs?: number;
  readonly failureClass:
    'exit_nonzero' | 'timeout' | 'denied' | 'cancelled' | 'exception' | 'unknown';
}

export type CanonicalToolPayload =
  | CanonicalToolRequestedPayload
  | CanonicalToolStartedPayload
  | CanonicalToolCompletedPayload
  | CanonicalToolFailedPayload;

export type PermissionPayloadPhase = 'requested' | 'resolved';

export interface CanonicalPermissionRequestedPayload {
  readonly category: ToolCategory;
  readonly riskClass?: 'read' | 'write' | 'network' | 'execute' | 'destructive' | 'unknown';
}

export interface CanonicalPermissionResolvedPayload {
  readonly outcome: 'allowed' | 'denied' | 'cancelled' | 'timed_out' | 'unknown';
}

export type CanonicalPermissionPayload =
  CanonicalPermissionRequestedPayload | CanonicalPermissionResolvedPayload;

export interface CanonicalTaskCreatedPayload {
  readonly status: TaskStatus;
  readonly ordinal?: number;
  readonly fallback: boolean;
}

export interface CanonicalTaskUpdatedPayload {
  readonly status?: TaskStatus;
  readonly ordinal?: number;
}

export interface CanonicalTaskAssignedPayload {
  readonly assigneeAgentId?: OpaqueId;
}

export interface CanonicalTaskCompletionRequestedPayload {
  readonly requestedStatus: 'completed';
  readonly checkpoint: 'native' | 'derived';
}

export interface CanonicalTaskCompletedPayload {
  readonly completion: 'observed' | 'derived';
}

export interface CanonicalTaskFailedPayload {
  readonly category: 'tool' | 'validation' | 'agent' | 'unknown';
}

export interface CanonicalTaskDeniedPayload {
  readonly reason: 'permission' | 'policy' | 'unknown';
}

export interface CanonicalTaskCancelledPayload {
  readonly reason: 'replanned' | 'user' | 'superseded' | 'unknown';
}

export interface CanonicalTaskAbandonedPayload {
  readonly reason: 'timeout' | 'session-ended' | 'telemetry-gap' | 'unknown';
}

export interface CanonicalAgentSpawnedPayload {
  readonly role: 'orchestrator' | 'worker' | 'reviewer' | 'researcher' | 'tester' | 'unknown';
  readonly depth: number;
}

export interface CanonicalAgentStateChangedPayload {
  readonly to: AgentState;
  readonly from?: AgentState;
  readonly reason?: 'tool' | 'permission' | 'delegation' | 'native' | 'timeout' | 'unknown';
}

export interface CanonicalAgentFinishedPayload {
  readonly outcome: 'completed' | 'failed' | 'cancelled' | 'unknown';
}

export interface CanonicalSessionStartedPayload {
  readonly resume: boolean;
}

export interface CanonicalSessionEndedPayload {
  readonly reason: 'normal' | 'archived' | 'deleted' | 'idle' | 'error' | 'unknown';
}

export interface CanonicalTurnFinishedPayload {
  readonly outcome: 'completed' | 'partial' | 'failed' | 'interrupted' | 'unknown';
}

export interface CanonicalTurnQuiescentPayload {
  readonly reason: 'native' | 'timeout' | 'permission' | 'no-active-work' | 'unknown';
}

export interface CanonicalWorkspaceDiscoveredPayload {
  readonly vcs: 'git' | 'other' | 'none';
}

export type PayloadBuilderErrorCode = 'invalid-agent-state';

const PAYLOAD_BUILDER_ERROR_CODES = freeze(['invalid-agent-state'] as const);

function isPayloadBuilderErrorCode(value: unknown): value is PayloadBuilderErrorCode {
  if (typeof value !== 'string') return false;
  for (let index = 0; index < PAYLOAD_BUILDER_ERROR_CODES.length; index += 1) {
    if (PAYLOAD_BUILDER_ERROR_CODES[index] === value) return true;
  }
  return false;
}

/** Errors contain only a bounded public code and never native input text. */
export class PayloadBuilderError extends Error {
  readonly code: PayloadBuilderErrorCode;

  constructor(code: PayloadBuilderErrorCode) {
    const safeCode = isPayloadBuilderErrorCode(code) ? code : 'invalid-agent-state';
    super(`payload builder failed: ${safeCode}`);
    this.name = 'PayloadBuilderError';
    this.code = safeCode;
    freeze(this);
  }
}

const TASK_STATUSES = freeze([
  'pending',
  'in_progress',
  'blocked',
  'completed',
  'failed',
  'denied',
  'cancelled',
  'abandoned',
  'unknown',
] as const);
const AGENT_STATES = freeze([
  'starting',
  'working',
  'waiting',
  'blocked',
  'finishing',
  'finished',
  'failed',
] as const);

function safeEnum<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  if (typeof value !== 'string') return fallback;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === value) return value as T;
  }
  return fallback;
}

function optionalEnum<T extends string>(value: unknown, values: readonly T[]): T | undefined {
  if (typeof value !== 'string') return undefined;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === value) return value as T;
  }
  return undefined;
}

function safeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function safeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && isSafeInteger(value) && value >= 0 ? value : undefined;
}

function safeDepth(value: unknown): number {
  const depth = safeInteger(value);
  return depth !== undefined && depth <= MAX_JSON_DEPTH ? depth : 0;
}

function safeOpaqueId(value: unknown): OpaqueId | undefined {
  return isOpaqueId(value) ? value : undefined;
}

function snapshotPayload(input: unknown): readonly SafePropertySnapshot[] {
  return snapshotAllowedProperties(input, PAYLOAD_PROPERTY_KEYS);
}

function toolCategoryForInput(
  input: unknown,
  snapshot: readonly SafePropertySnapshot[],
): ToolCategory {
  if (typeof input === 'string') return categorizeBuiltinTool(input);
  return categorizeToolSnapshot(snapshot);
}

function toolNameForInput(
  input: unknown,
  snapshot: readonly SafePropertySnapshot[],
): SanitizedToken {
  return canonicalToolNameForCategory(toolCategoryForInput(input, snapshot));
}

function normalizeToolPhase(value: unknown): ToolPayloadPhase {
  return safeEnum(value, ['requested', 'started', 'completed', 'failed'] as const, 'started');
}

/** Builds a tool payload from a fixed allowlist and a fixed canonical name code. */
export function buildToolPayload(
  input: unknown,
  phase: ToolPayloadPhase = 'started',
): CanonicalToolPayload {
  const snapshot = snapshotPayload(input);
  const category = toolCategoryForInput(input, snapshot);
  const name = toolNameForInput(input, snapshot);
  const parallelGroupId = safeOpaqueId(
    readFirstSnapshot(snapshot, ['parallelGroupId', 'parallel_group_id']),
  );

  switch (normalizeToolPhase(phase)) {
    case 'requested': {
      const entries: [string, unknown][] = [
        ['name', name],
        ['category', category],
      ];
      if (parallelGroupId !== undefined)
        appendArrayValue(entries, ['parallelGroupId', parallelGroupId]);
      return makeImmutableRecord<CanonicalToolRequestedPayload>(entries);
    }
    case 'started': {
      const entries: [string, unknown][] = [
        ['name', name],
        ['category', category],
      ];
      if (parallelGroupId !== undefined)
        appendArrayValue(entries, ['parallelGroupId', parallelGroupId]);
      return makeImmutableRecord<CanonicalToolStartedPayload>(entries);
    }
    case 'completed': {
      const entries: [string, unknown][] = [
        ['name', name],
        ['category', category],
      ];
      const durationMs = safeInteger(readFirstSnapshot(snapshot, ['durationMs', 'duration_ms']));
      if (durationMs !== undefined) appendArrayValue(entries, ['durationMs', durationMs]);
      const resultClass = optionalEnum(
        readFirstSnapshot(snapshot, ['resultClass', 'result_class']),
        ['success', 'partial', 'unknown'] as const,
      );
      if (resultClass !== undefined) appendArrayValue(entries, ['resultClass', resultClass]);
      return makeImmutableRecord<CanonicalToolCompletedPayload>(entries);
    }
    case 'failed': {
      const entries: [string, unknown][] = [
        ['name', name],
        ['category', category],
        [
          'failureClass',
          safeEnum(
            readFirstSnapshot(snapshot, ['failureClass', 'failure_class']),
            ['exit_nonzero', 'timeout', 'denied', 'cancelled', 'exception', 'unknown'] as const,
            'unknown',
          ),
        ],
      ];
      const durationMs = safeInteger(readFirstSnapshot(snapshot, ['durationMs', 'duration_ms']));
      if (durationMs !== undefined) appendArrayValue(entries, ['durationMs', durationMs]);
      return makeImmutableRecord<CanonicalToolFailedPayload>(entries);
    }
  }
}

export function buildToolRequestedPayload(input: unknown): CanonicalToolRequestedPayload {
  return buildToolPayload(input, 'requested') as CanonicalToolRequestedPayload;
}

export function buildToolStartedPayload(input: unknown): CanonicalToolStartedPayload {
  return buildToolPayload(input, 'started') as CanonicalToolStartedPayload;
}

export function buildToolCompletedPayload(input: unknown): CanonicalToolCompletedPayload {
  return buildToolPayload(input, 'completed') as CanonicalToolCompletedPayload;
}

export function buildToolFailedPayload(input: unknown): CanonicalToolFailedPayload {
  return buildToolPayload(input, 'failed') as CanonicalToolFailedPayload;
}

function normalizePermissionPhase(value: unknown): PermissionPayloadPhase {
  return safeEnum(value, ['requested', 'resolved'] as const, 'requested');
}

/** Builds a permission payload without copying a native reason or tool name. */
export function buildPermissionPayload(
  input: unknown,
  phase: PermissionPayloadPhase = 'requested',
): CanonicalPermissionPayload {
  const snapshot = snapshotPayload(input);
  if (normalizePermissionPhase(phase) === 'resolved') {
    return makeImmutableRecord<CanonicalPermissionResolvedPayload>([
      [
        'outcome',
        safeEnum(
          readFirstSnapshot(snapshot, ['outcome']),
          ['allowed', 'denied', 'cancelled', 'timed_out', 'unknown'] as const,
          'unknown',
        ),
      ],
    ]);
  }

  const category = toolCategoryForInput(input, snapshot);
  const entries: [string, unknown][] = [['category', category]];
  const riskClass = optionalEnum(readFirstSnapshot(snapshot, ['riskClass', 'risk_class']), [
    'read',
    'write',
    'network',
    'execute',
    'destructive',
    'unknown',
  ] as const);
  if (riskClass !== undefined) appendArrayValue(entries, ['riskClass', riskClass]);
  return makeImmutableRecord<CanonicalPermissionRequestedPayload>(entries);
}

export function buildPermissionRequestedPayload(
  input: unknown,
): CanonicalPermissionRequestedPayload {
  return buildPermissionPayload(input, 'requested') as CanonicalPermissionRequestedPayload;
}

export function buildPermissionResolvedPayload(input: unknown): CanonicalPermissionResolvedPayload {
  return buildPermissionPayload(input, 'resolved') as CanonicalPermissionResolvedPayload;
}

export function buildTaskCreatedPayload(input: unknown): CanonicalTaskCreatedPayload {
  const snapshot = snapshotPayload(input);
  const entries: [string, unknown][] = [
    ['status', safeEnum(readFirstSnapshot(snapshot, ['status']), TASK_STATUSES, 'unknown')],
    ['fallback', safeBoolean(readFirstSnapshot(snapshot, ['fallback']), false)],
  ];
  const ordinal = safeInteger(readFirstSnapshot(snapshot, ['ordinal']));
  if (ordinal !== undefined) appendArrayValue(entries, ['ordinal', ordinal]);
  return makeImmutableRecord<CanonicalTaskCreatedPayload>(entries);
}

export function buildTaskUpdatedPayload(input: unknown): CanonicalTaskUpdatedPayload {
  const snapshot = snapshotPayload(input);
  const entries: [string, unknown][] = [];
  const status = optionalEnum(readFirstSnapshot(snapshot, ['status']), TASK_STATUSES);
  if (status !== undefined) appendArrayValue(entries, ['status', status]);
  const ordinal = safeInteger(readFirstSnapshot(snapshot, ['ordinal']));
  if (ordinal !== undefined) appendArrayValue(entries, ['ordinal', ordinal]);
  return makeImmutableRecord<CanonicalTaskUpdatedPayload>(entries);
}

export function buildTaskAssignedPayload(input: unknown): CanonicalTaskAssignedPayload {
  const snapshot = snapshotPayload(input);
  const assigneeAgentId = safeOpaqueId(
    readFirstSnapshot(snapshot, ['assigneeAgentId', 'assignee_agent_id']),
  );
  if (assigneeAgentId === undefined) return makeImmutableRecord<CanonicalTaskAssignedPayload>([]);
  return makeImmutableRecord<CanonicalTaskAssignedPayload>([['assigneeAgentId', assigneeAgentId]]);
}

export function buildTaskCompletionRequestedPayload(
  input: unknown,
): CanonicalTaskCompletionRequestedPayload {
  const snapshot = snapshotPayload(input);
  return makeImmutableRecord<CanonicalTaskCompletionRequestedPayload>([
    ['requestedStatus', 'completed'],
    [
      'checkpoint',
      safeEnum(
        readFirstSnapshot(snapshot, ['checkpoint']),
        ['native', 'derived'] as const,
        'native',
      ),
    ],
  ]);
}

export function buildTaskCompletedPayload(input: unknown): CanonicalTaskCompletedPayload {
  const snapshot = snapshotPayload(input);
  return makeImmutableRecord<CanonicalTaskCompletedPayload>([
    [
      'completion',
      safeEnum(
        readFirstSnapshot(snapshot, ['completion']),
        ['observed', 'derived'] as const,
        'observed',
      ),
    ],
  ]);
}

export function buildTaskFailedPayload(input: unknown): CanonicalTaskFailedPayload {
  const snapshot = snapshotPayload(input);
  return makeImmutableRecord<CanonicalTaskFailedPayload>([
    [
      'category',
      safeEnum(
        readFirstSnapshot(snapshot, ['failureCategory', 'failure_category', 'category']),
        ['tool', 'validation', 'agent', 'unknown'] as const,
        'unknown',
      ),
    ],
  ]);
}

export function buildTaskDeniedPayload(input: unknown): CanonicalTaskDeniedPayload {
  const snapshot = snapshotPayload(input);
  return makeImmutableRecord<CanonicalTaskDeniedPayload>([
    [
      'reason',
      safeEnum(
        readFirstSnapshot(snapshot, ['reason']),
        ['permission', 'policy', 'unknown'] as const,
        'unknown',
      ),
    ],
  ]);
}

export function buildTaskCancelledPayload(input: unknown): CanonicalTaskCancelledPayload {
  const snapshot = snapshotPayload(input);
  return makeImmutableRecord<CanonicalTaskCancelledPayload>([
    [
      'reason',
      safeEnum(
        readFirstSnapshot(snapshot, ['reason']),
        ['replanned', 'user', 'superseded', 'unknown'] as const,
        'unknown',
      ),
    ],
  ]);
}

export function buildTaskAbandonedPayload(input: unknown): CanonicalTaskAbandonedPayload {
  const snapshot = snapshotPayload(input);
  return makeImmutableRecord<CanonicalTaskAbandonedPayload>([
    [
      'reason',
      safeEnum(
        readFirstSnapshot(snapshot, ['reason']),
        ['timeout', 'session-ended', 'telemetry-gap', 'unknown'] as const,
        'unknown',
      ),
    ],
  ]);
}

export function buildAgentSpawnedPayload(input: unknown): CanonicalAgentSpawnedPayload {
  const snapshot = snapshotPayload(input);
  return makeImmutableRecord<CanonicalAgentSpawnedPayload>([
    [
      'role',
      safeEnum(
        readFirstSnapshot(snapshot, ['role']),
        ['orchestrator', 'worker', 'reviewer', 'researcher', 'tester', 'unknown'] as const,
        'unknown',
      ),
    ],
    ['depth', safeDepth(readFirstSnapshot(snapshot, ['depth']))],
  ]);
}

export function buildAgentStateChangedPayload(input: unknown): CanonicalAgentStateChangedPayload {
  const snapshot = snapshotPayload(input);
  const to = optionalEnum(readFirstSnapshot(snapshot, ['to']), AGENT_STATES);
  if (to === undefined) throw new PayloadBuilderError('invalid-agent-state');
  const entries: [string, unknown][] = [['to', to]];
  const from = optionalEnum(readFirstSnapshot(snapshot, ['from']), AGENT_STATES);
  if (from !== undefined) appendArrayValue(entries, ['from', from]);
  const reason = optionalEnum(readFirstSnapshot(snapshot, ['reason']), [
    'tool',
    'permission',
    'delegation',
    'native',
    'timeout',
    'unknown',
  ] as const);
  if (reason !== undefined) appendArrayValue(entries, ['reason', reason]);
  return makeImmutableRecord<CanonicalAgentStateChangedPayload>(entries);
}

export function buildAgentFinishedPayload(input: unknown): CanonicalAgentFinishedPayload {
  const snapshot = snapshotPayload(input);
  return makeImmutableRecord<CanonicalAgentFinishedPayload>([
    [
      'outcome',
      safeEnum(
        readFirstSnapshot(snapshot, ['outcome']),
        ['completed', 'failed', 'cancelled', 'unknown'] as const,
        'unknown',
      ),
    ],
  ]);
}

export function buildSessionStartedPayload(input: unknown): CanonicalSessionStartedPayload {
  const snapshot = snapshotPayload(input);
  return makeImmutableRecord<CanonicalSessionStartedPayload>([
    ['resume', safeBoolean(readFirstSnapshot(snapshot, ['resume']), false)],
  ]);
}

export function buildSessionEndedPayload(input: unknown): CanonicalSessionEndedPayload {
  const snapshot = snapshotPayload(input);
  return makeImmutableRecord<CanonicalSessionEndedPayload>([
    [
      'reason',
      safeEnum(
        readFirstSnapshot(snapshot, ['reason']),
        ['normal', 'archived', 'deleted', 'idle', 'error', 'unknown'] as const,
        'unknown',
      ),
    ],
  ]);
}

export function buildTurnFinishedPayload(input: unknown): CanonicalTurnFinishedPayload {
  const snapshot = snapshotPayload(input);
  return makeImmutableRecord<CanonicalTurnFinishedPayload>([
    [
      'outcome',
      safeEnum(
        readFirstSnapshot(snapshot, ['outcome']),
        ['completed', 'partial', 'failed', 'interrupted', 'unknown'] as const,
        'unknown',
      ),
    ],
  ]);
}

export function buildTurnQuiescentPayload(input: unknown): CanonicalTurnQuiescentPayload {
  const snapshot = snapshotPayload(input);
  return makeImmutableRecord<CanonicalTurnQuiescentPayload>([
    [
      'reason',
      safeEnum(
        readFirstSnapshot(snapshot, ['reason']),
        ['native', 'timeout', 'permission', 'no-active-work', 'unknown'] as const,
        'unknown',
      ),
    ],
  ]);
}

export function buildWorkspaceDiscoveredPayload(
  input: unknown,
): CanonicalWorkspaceDiscoveredPayload {
  const snapshot = snapshotPayload(input);
  return makeImmutableRecord<CanonicalWorkspaceDiscoveredPayload>([
    [
      'vcs',
      safeEnum(readFirstSnapshot(snapshot, ['vcs']), ['git', 'other', 'none'] as const, 'other'),
    ],
  ]);
}
