import type { CapabilityProfile, SignalCapability, TaskStatus } from '@codeinvaders/protocol';
import {
  buildAdapterDiagnostic,
  buildAgentSpawnedPayload,
  buildAgentStateChangedPayload,
  buildPermissionRequestedPayload,
  buildPermissionResolvedPayload,
  buildSessionEndedPayload,
  buildSessionStartedPayload,
  buildTaskUpdatedPayload,
  buildToolCompletedPayload,
  buildToolFailedPayload,
  buildToolRequestedPayload,
  buildToolStartedPayload,
  buildTurnFinishedPayload,
  buildTurnQuiescentPayload,
} from '@codeinvaders/adapter-sdk';
import type { AdapterDiagnostic } from '@codeinvaders/adapter-sdk';
import { isOpaqueId } from '@codeinvaders/adapter-sdk';
import {
  deliverDirectEvent,
  directNativeIdentity,
  directNativeTimestamp,
  recordDirectDiagnostic,
  readDirectHookInput,
  type DirectEventDescriptor,
} from '@codeinvaders/adapter-sdk';

export const adapterName = 'codex' as const;
export const adapterVersion = '0.1.0' as const;
export const MAX_HOOK_BYTES = 32_768;
export const MAX_HOOK_DEPTH = 8;
export const MAX_HOOK_PROPERTIES = 64;
export const CODEX_KINDS = Object.freeze([
  'session.started',
  'session.ended',
  'session.compacted',
  'turn.requested',
  'turn.quiescent',
  'turn.finished',
  'tool.requested',
  'tool.started',
  'tool.completed',
  'tool.failed',
  'permission.requested',
  'permission.resolved',
  'agent.spawned',
  'agent.state.changed',
  'agent.checkpoint',
  'task.updated',
  'task.plan.reconciled',
] as const);
export type CodexLifecycleKind = (typeof CODEX_KINDS)[number];
export interface CodexLifecycleInput {
  readonly kind: unknown;
  readonly payload?: unknown;
}
export interface CodexLifecycleResult {
  readonly status: 'accepted' | 'rejected';
  readonly kind?: CodexLifecycleKind;
  readonly payload?: unknown;
  readonly classification?: 'provisional' | 'confirmed' | 'quiescent' | 'failure';
  readonly correlation?: 'native' | 'missing' | 'ambiguous';
  readonly diagnostic?: AdapterDiagnostic;
  readonly operationId?: string;
  readonly agentId?: string;
  readonly parentAgentId?: string;
  readonly evidence?: 'requested' | 'active' | 'quiescent' | 'confirmed';
}

function own(o: unknown, key: string): unknown {
  try {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return undefined;
    const d = Object.getOwnPropertyDescriptor(o, key);
    return d && 'value' in d ? d.value : undefined;
  } catch {
    return undefined;
  }
}

function boundedNative(value: unknown, depth = 0, seen = new Set<object>()): boolean {
  if (value === null || typeof value !== 'object') return true;
  if (depth > MAX_HOOK_DEPTH || seen.has(value)) return false;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_HOOK_PROPERTIES) return false;
      for (let i = 0; i < value.length; i += 1)
        if (!boundedNative(own(value, String(i)), depth + 1, seen)) return false;
      return true;
    }
    const keys = Object.keys(value);
    if (keys.length > MAX_HOOK_PROPERTIES) return false;
    for (const key of keys) if (!boundedNative(own(value, key), depth + 1, seen)) return false;
    return true;
  } catch {
    return false;
  }
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
function allowedKind(value: unknown): value is CodexLifecycleKind {
  return typeof value === 'string' && (CODEX_KINDS as readonly string[]).includes(value);
}
function classification(
  kind: CodexLifecycleKind,
): 'provisional' | 'confirmed' | 'quiescent' | 'failure' {
  if (
    kind === 'tool.requested' ||
    kind === 'tool.started' ||
    kind === 'permission.requested' ||
    kind === 'agent.checkpoint' ||
    kind === 'turn.requested'
  )
    return 'provisional';
  if (kind === 'tool.failed') return 'failure';
  if (kind === 'turn.quiescent') return 'quiescent';
  return 'confirmed';
}
function correlation(payload: unknown): 'native' | 'missing' | 'ambiguous' {
  const id = own(payload, 'toolUseId') ?? own(payload, 'tool_use_id') ?? own(payload, 'call_id');
  return isOpaqueId(id) ? 'native' : 'missing';
}

const builders: Readonly<Record<CodexLifecycleKind, (v: unknown) => unknown>> = Object.freeze({
  'session.started': buildSessionStartedPayload,
  'session.ended': buildSessionEndedPayload,
  // AAP has no turn.requested payload; preserve evidence with an empty canonical payload.
  'turn.requested': () => Object.freeze({}),
  'turn.quiescent': buildTurnQuiescentPayload,
  'turn.finished': buildTurnFinishedPayload,
  'tool.requested': buildToolRequestedPayload,
  'tool.started': buildToolStartedPayload,
  'tool.completed': buildToolCompletedPayload,
  'tool.failed': buildToolFailedPayload,
  'permission.requested': buildPermissionRequestedPayload,
  'permission.resolved': buildPermissionResolvedPayload,
  'agent.spawned': buildAgentSpawnedPayload,
  'agent.state.changed': buildAgentStateChangedPayload,
  'agent.checkpoint': buildAgentStateChangedPayload,
  'task.updated': buildTaskUpdatedPayload,
  'task.plan.reconciled': () => Object.freeze({}),
  'session.compacted': () => Object.freeze({}),
});

/** Explicit native schema allowlist. Unknown fields are never copied or echoed. */
export function normalizeCodexLifecycle(input: unknown): CodexLifecycleResult {
  if (!boundedNative(input))
    return {
      status: 'rejected',
      diagnostic: buildAdapterDiagnostic({
        code: 'native-field-invalid',
        severity: 'warning',
        field: 'native-size',
      }),
    };
  const kind = own(input, 'kind');
  if (!allowedKind(kind))
    return {
      status: 'rejected',
      diagnostic: buildAdapterDiagnostic({
        code: 'native-schema-unsupported',
        severity: 'warning',
        field: 'native-schema',
      }),
    };
  try {
    const nativePayload = own(input, 'payload');
    if (
      nativePayload !== undefined &&
      (!nativePayload || typeof nativePayload !== 'object' || Array.isArray(nativePayload))
    )
      throw new Error();
    const payload = builders[kind](nativePayload);
    return { status: 'accepted', kind, payload };
  } catch {
    return {
      status: 'rejected',
      diagnostic: buildAdapterDiagnostic({
        code: 'native-field-invalid',
        severity: 'warning',
        field: 'native-field',
      }),
    };
  }
}

export function normalizeCodexEvidence(input: unknown): CodexLifecycleResult {
  const base = normalizeCodexLifecycle(input);
  if (base.status !== 'accepted' || base.kind === undefined) return base;
  const rawPayload = own(input, 'payload');
  const rawOperationId =
    own(rawPayload, 'toolUseId') ?? own(rawPayload, 'tool_use_id') ?? own(rawPayload, 'call_id');
  const operationId = isOpaqueId(rawOperationId) ? rawOperationId : undefined;
  const rawAgentId = own(rawPayload, 'agentId') ?? own(rawPayload, 'agent_id');
  const rawParentAgentId = own(rawPayload, 'parentAgentId') ?? own(rawPayload, 'parent_agent_id');
  const agentId = isOpaqueId(rawAgentId) ? rawAgentId : undefined;
  const parentAgentId = isOpaqueId(rawParentAgentId) ? rawParentAgentId : undefined;
  const evidence: CodexLifecycleResult['evidence'] =
    base.kind === 'turn.requested' ||
    base.kind === 'tool.requested' ||
    base.kind === 'permission.requested'
      ? 'requested'
      : base.kind === 'tool.started' ||
          base.kind === 'agent.spawned' ||
          base.kind === 'agent.state.changed'
        ? 'active'
        : base.kind === 'turn.quiescent' || base.kind === 'agent.checkpoint'
          ? 'quiescent'
          : 'confirmed';
  const result: CodexLifecycleResult = {
    status: 'accepted',
    kind: base.kind,
    payload: base.payload,
    classification: classification(base.kind),
    correlation: own(rawPayload, 'ambiguous') === true ? 'ambiguous' : correlation(rawPayload),
    evidence,
    ...(operationId === undefined ? {} : { operationId }),
    ...(agentId === undefined ? {} : { agentId }),
    ...(parentAgentId === undefined ? {} : { parentAgentId }),
  };
  return result;
}

const nativeHookMap: Readonly<Record<string, CodexLifecycleKind>> = Object.freeze({
  SessionStart: 'session.started',
  SessionEnd: 'session.ended',
  UserPromptSubmit: 'turn.requested',
  PreToolUse: 'tool.requested',
  PostToolUse: 'tool.completed',
  PostToolUseFailure: 'tool.failed',
  PermissionRequest: 'permission.requested',
  PermissionResolved: 'permission.resolved',
  SubagentStart: 'agent.spawned',
  SubagentStop: 'agent.checkpoint',
  Stop: 'turn.quiescent',
  Compact: 'session.compacted',
  TaskPlanUpdated: 'task.plan.reconciled',
});

/** Parse the pinned native hook envelope; canonical events remain a separate API. */
export function normalizeCodexHook(input: unknown): CodexLifecycleResult {
  try {
    if (typeof input === 'string') {
      if (utf8Length(input) > MAX_HOOK_BYTES)
        return {
          status: 'rejected',
          diagnostic: buildAdapterDiagnostic({
            code: 'native-field-invalid',
            severity: 'warning',
            field: 'native-size',
          }),
        };
      input = JSON.parse(input);
    }
    if (!boundedNative(input))
      return {
        status: 'rejected',
        diagnostic: buildAdapterDiagnostic({
          code: 'native-field-invalid',
          severity: 'warning',
          field: 'native-size',
        }),
      };
    const hook = own(input, 'hook') ?? own(input, 'event') ?? own(input, 'hook_event_name');
    if (typeof hook !== 'string' || !(hook in nativeHookMap))
      return {
        status: 'rejected',
        diagnostic: buildAdapterDiagnostic({
          code: 'native-schema-unsupported',
          severity: 'warning',
          field: 'native-schema',
        }),
      };
    let payload = own(input, 'payload') ?? input;
    if (hook === 'SubagentStop' && own(payload, 'to') === undefined) payload = { to: 'waiting' };
    if (hook === 'PostToolUseFailure') {
      const exitCode = own(payload, 'exitCode') ?? own(payload, 'exit_code');
      payload = {
        failureClass: typeof exitCode === 'number' && exitCode !== 0 ? 'exit_nonzero' : 'unknown',
        durationMs: own(payload, 'durationMs') ?? own(payload, 'duration_ms'),
        toolUseId: own(payload, 'toolUseId') ?? own(payload, 'tool_use_id'),
      };
    }
    const result = normalizeCodexEvidence({ kind: nativeHookMap[hook], payload });
    return result;
  } catch {
    return {
      status: 'rejected',
      diagnostic: buildAdapterDiagnostic({
        code: 'native-field-invalid',
        severity: 'warning',
        field: 'native-input',
      }),
    };
  }
}

const directKindMap: Readonly<
  Record<CodexLifecycleKind, import('@codeinvaders/protocol').CoreEventType>
> = Object.freeze({
  'session.started': 'session.started',
  'session.ended': 'session.ended',
  'session.compacted': 'source.heartbeat',
  'turn.requested': 'turn.started',
  'turn.quiescent': 'turn.quiescent',
  'turn.finished': 'turn.finished',
  'tool.requested': 'tool.requested',
  'tool.started': 'tool.started',
  'tool.completed': 'tool.completed',
  'tool.failed': 'tool.failed',
  'permission.requested': 'permission.requested',
  'permission.resolved': 'permission.resolved',
  'agent.spawned': 'agent.spawned',
  'agent.state.changed': 'agent.state.changed',
  'agent.checkpoint': 'agent.state.changed',
  'task.updated': 'task.updated',
  'task.plan.reconciled': 'task.plan.reconciled',
});

export function buildCodexDirectDescriptor(input: unknown): DirectEventDescriptor | undefined {
  const normalized = normalizeCodexHook(input);
  if (
    normalized.status !== 'accepted' ||
    normalized.kind === undefined ||
    normalized.payload === undefined
  )
    return undefined;
  const payload = own(input, 'payload') ?? input;
  const type = directKindMap[normalized.kind];
  const native = (...keys: string[]) =>
    directNativeIdentity(input, ...keys) ?? directNativeIdentity(payload, ...keys);
  const operation = native('toolUseId', 'tool_use_id', 'call_id');
  if (normalized.kind.startsWith('tool.') && operation === undefined) return undefined;
  const session = directNativeIdentity(
    input,
    'sessionId',
    'session_id',
    'conversationId',
    'conversation_id',
  );
  if (session === undefined) return undefined;
  const turn = native('turnId', 'turn_id');
  if (normalized.kind === 'task.plan.reconciled' && turn === undefined) return undefined;
  const agent = native('agentId', 'agent_id', 'subagentId', 'subagent_id');
  const parentAgent = native('parentAgentId', 'parent_agent_id');
  const task = native('taskId', 'task_id');
  const permission = native('permissionId', 'permission_id');
  const workspace = native('workspace', 'workspacePath', 'workspace_path', 'cwd');
  const repository = native('repository', 'repositoryRoot', 'repository_root', 'repo');
  const timestamp = directNativeTimestamp(input, 'occurredAt', 'occurred_at', 'timestamp');
  const checkpoint = [
    adapterName,
    normalized.kind,
    session,
    directNativeIdentity(input, 'eventId', 'event_id', 'id') ??
      operation ??
      turn ??
      agent ??
      task ??
      permission ??
      'checkpoint',
  ];
  let plan: DirectEventDescriptor['plan'];
  let planRevision: number | undefined;
  if (normalized.kind === 'task.plan.reconciled') {
    const rawItems = own(payload, 'items') ?? own(payload, 'plan') ?? own(payload, 'tasks');
    if (!Array.isArray(rawItems)) return undefined;
    const complete = own(payload, 'complete');
    if (complete !== undefined && complete !== true) return undefined;
    plan = rawItems.slice(0, 256).map((item, index) => {
      const nativeId = directNativeIdentity(
        item,
        'nativeId',
        'native_id',
        'taskId',
        'task_id',
        'id',
      );
      return {
        identity: nativeId ?? `plan-item:${index}`,
        status: directNativeIdentity(item, 'status', 'state') ?? 'unknown',
        ordinal: (() => {
          const value = own(item, 'ordinal') ?? own(item, 'order') ?? index;
          return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : index;
        })(),
        identityBasis:
          nativeId === undefined ? ('new-unmatched' as const) : ('stable-native-id' as const),
      };
    });
    const candidate = own(payload, 'revision') ?? own(input, 'revision');
    if (Number.isSafeInteger(candidate) && (candidate as number) > 0)
      planRevision = candidate as number;
  }
  const data =
    normalized.kind === 'session.compacted'
      ? { uptimeMs: 0 }
      : normalized.kind === 'task.plan.reconciled'
        ? {}
        : normalized.payload;
  const semantic =
    type === 'turn.quiescent'
      ? { kind: 'quiescence', terminal: false, basis: 'native' as const }
      : undefined;
  return {
    adapterId: 'codeinvaders-codex',
    adapterVersion,
    type,
    checkpoint,
    ...(session === undefined ? {} : { session }),
    ...(workspace === undefined ? {} : { workspace }),
    ...(repository === undefined ? {} : { repository }),
    ...(turn === undefined ? {} : { turn }),
    ...(agent === undefined ? {} : { agent }),
    ...(parentAgent === undefined ? {} : { parentAgent }),
    ...(task === undefined ? {} : { task }),
    ...(operation === undefined ? {} : { operation }),
    ...(permission === undefined ? {} : { permission }),
    ...(timestamp === undefined ? {} : { timestamp }),
    ...(plan === undefined ? {} : { plan }),
    ...(planRevision === undefined ? {} : { planRevision }),
    data,
    finality:
      normalized.kind === 'tool.requested' ||
      normalized.kind === 'permission.requested' ||
      normalized.kind === 'turn.requested'
        ? 'provisional'
        : 'confirmed',
    ...(semantic === undefined
      ? {}
      : { semantic: semantic as import('@codeinvaders/protocol').SemanticMetadata }),
  };
}

/** Real direct hook path: normalize, construct AAP, and deliver or spool it. */
export async function runDirectCodexHook(input: unknown) {
  const descriptor = buildCodexDirectDescriptor(input);
  if (descriptor === undefined) {
    await recordDirectDiagnostic('codeinvaders-codex', 'native-input-invalid');
    return { status: 'dropped' as const };
  }
  return deliverDirectEvent(descriptor);
}

export async function runCodexHookProcess(): Promise<void> {
  const input = await readDirectHookInput(MAX_HOOK_BYTES);
  await runDirectCodexHook(input);
}
export interface CodexHookResult {
  readonly accepted?: never;
}
export function codexHook(input: unknown): CodexHookResult {
  normalizeCodexHook(input);
  return Object.freeze({});
}
export const directHook = codexHook;
export const plugin = Object.freeze({
  onLifecycle: codexHook,
});
export const manual = Object.freeze({
  observe: codexHook,
});

const partial = (
  code: 'hosted-tools' | 'manual-denials' | 'missing-correlation' | 'session-configuration',
): SignalCapability => ({
  availability: 'partial',
  evidenceQuality: 'observed',
  coverage: 'partial',
  finality: 'mixed',
  exclusions: [{ code }],
});
export const capabilities: CapabilityProfile['signals'] = Object.freeze({
  sessions: partial('session-configuration'),
  turns: partial('session-configuration'),
  tasks: partial('missing-correlation'),
  taskPlan: partial('missing-correlation'),
  agents: partial('missing-correlation'),
  tools: partial('hosted-tools'),
  permissions: partial('manual-denials'),
});

export const CODEX_HOOKS = Object.freeze([
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionResolved',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'Compact',
  'TaskPlanUpdated',
] as const);

/** Detect only capabilities evidenced by the active session's observed hooks. */
export function detectCodexCapabilities(
  observed: readonly unknown[] = [],
): CapabilityProfile['signals'] {
  const seen = new Set(observed.filter((v): v is string => typeof v === 'string'));
  const has = (...names: readonly string[]) => names.some((name) => seen.has(name));
  const unavailable = (
    code: 'hosted-tools' | 'manual-denials' | 'missing-correlation' | 'session-configuration',
  ): SignalCapability => ({
    availability: 'unsupported',
    evidenceQuality: 'none',
    coverage: 'none',
    finality: 'provisional',
    exclusions: [{ code }],
  });
  return Object.freeze({
    sessions: has('SessionStart', 'session.started')
      ? partial('session-configuration')
      : unavailable('session-configuration'),
    turns: has('UserPromptSubmit', 'turn.requested')
      ? partial('session-configuration')
      : unavailable('session-configuration'),
    tasks: has('task.updated', 'task.plan.reconciled')
      ? partial('missing-correlation')
      : unavailable('missing-correlation'),
    taskPlan: has('task.plan.reconciled')
      ? partial('missing-correlation')
      : unavailable('missing-correlation'),
    agents: has('SubagentStart', 'agent.spawned')
      ? partial('missing-correlation')
      : unavailable('missing-correlation'),
    tools: has('PostToolUse', 'tool.completed')
      ? partial('hosted-tools')
      : unavailable('hosted-tools'),
    permissions: has('PermissionRequest', 'permission.requested')
      ? partial('manual-denials')
      : unavailable('manual-denials'),
  });
}

export function validateCodexNative(
  input: unknown,
): Readonly<{ valid: boolean; kind?: CodexLifecycleKind; diagnostic?: AdapterDiagnostic }> {
  const normalized = normalizeCodexLifecycle(input);
  if (normalized.status === 'accepted' && normalized.kind !== undefined)
    return Object.freeze({ valid: true, kind: normalized.kind });
  if (normalized.diagnostic !== undefined)
    return Object.freeze({ valid: false, diagnostic: normalized.diagnostic });
  return Object.freeze({ valid: false });
}

export type CodexPlanItem = Readonly<{
  nativeId?: string;
  identity?: string;
  ordinal: number;
  status: TaskStatus;
}>;
/** Full-revision reconciliation: stable ID, then exact ordinal only; never fuzzy-transfers terminal state. */
export function reconcileCodexPlan(
  previous: readonly CodexPlanItem[],
  next: readonly CodexPlanItem[],
  revision = 1,
): Readonly<{
  revision: number;
  items: readonly Readonly<{
    ordinal: number;
    status: TaskStatus;
    identityBasis: 'stable-native-id' | 'exact-ordinal-continuity' | 'new-unmatched';
    cancellationRequired: boolean;
  }>[];
}> {
  const items = next.slice(0, 256).map((item) => {
    const byId = item.nativeId && previous.filter((p) => p.nativeId === item.nativeId);
    const byOrdinal = previous.filter(
      (p) => p.ordinal === item.ordinal && (!item.identity || p.identity === item.identity),
    );
    const duplicateId =
      item.nativeId !== undefined && next.filter((p) => p.nativeId === item.nativeId).length !== 1;
    const duplicateOrdinal = next.filter((p) => p.ordinal === item.ordinal).length !== 1;
    const basis =
      !duplicateId && byId?.length === 1
        ? 'stable-native-id'
        : !duplicateOrdinal && byOrdinal.length === 1
          ? 'exact-ordinal-continuity'
          : 'new-unmatched';
    return Object.freeze({
      ordinal: item.ordinal,
      status: item.status,
      identityBasis: basis,
      cancellationRequired: false as boolean,
    });
  });
  const nextIds = new Set(
    next.map((item) => item.nativeId).filter((id): id is string => typeof id === 'string'),
  );
  const nextOrdinals = new Set(next.map((item) => item.ordinal));
  for (const prior of previous.slice(0, 256)) {
    if (
      (prior.nativeId && !nextIds.has(prior.nativeId)) ||
      (prior.nativeId === undefined && !nextOrdinals.has(prior.ordinal))
    )
      items.push(
        Object.freeze({
          ordinal: prior.ordinal,
          status: 'cancelled',
          identityBasis: 'stable-native-id',
          cancellationRequired: true,
        }),
      );
  }
  return Object.freeze({
    revision: Number.isSafeInteger(revision) && revision > 0 ? revision : 1,
    items: Object.freeze(items),
  });
}
