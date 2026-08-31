import type { CapabilityProfile, SignalCapability, ToolCategory } from '@codeinvaders/protocol';
import {
  buildAdapterDiagnostic,
  canonicalToolNameForCategory,
  categorizeTool,
  deliverDirectEvent,
  directNativeIdentity,
  directNativeTimestamp,
  isOpaqueId,
  readDirectHookInput,
  recordDirectDiagnostic,
  type AdapterDiagnostic,
  type DirectEventDescriptor,
  type OpaqueId,
} from '@codeinvaders/adapter-sdk';

export const adapterName = 'claude' as const;
export const adapterVersion = '0.1.0' as const;
export const MAX_HOOK_BYTES = 32_768;
export const MAX_HOOK_DEPTH = 16;
export const MAX_HOOK_PROPERTIES = 256;
export const CLAUDE_HOOKS = Object.freeze([
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionDenied',
  'UserPromptSubmit',
  'Stop',
  'StopFailure',
  'TaskCreated',
  'TaskCompleted',
  'SubagentStart',
  'SubagentStop',
  'SessionStart',
  'SessionEnd',
] as const);
export type ClaudeHook = (typeof CLAUDE_HOOKS)[number];
type Phase =
  | 'prompt'
  | 'stop'
  | 'stop-failure'
  | 'tool'
  | 'permission'
  | 'task'
  | 'subagent'
  | 'session'
  | 'unknown';
const own = (v: unknown, k: string): unknown => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const d = Object.getOwnPropertyDescriptor(v, k);
  return d && 'value' in d ? d.value : undefined;
};
const hookBounds = (value: unknown): boolean => {
  try {
    let bytes = 0;
    let properties = 0;
    const seen = new Set<object>();
    const visit = (v: unknown, depth: number): boolean => {
      if (v === null || typeof v !== 'object') {
        if (typeof v === 'string') {
          bytes += new TextEncoder().encode(v).byteLength;
        }
        return bytes <= MAX_HOOK_BYTES;
      }
      if (depth > MAX_HOOK_DEPTH || seen.has(v as object)) return false;
      seen.add(v as object);
      const keys = Reflect.ownKeys(v as object);
      properties += keys.length;
      if (properties > MAX_HOOK_PROPERTIES) return false;
      for (const key of keys) {
        if (typeof key === 'string') {
          const descriptor = Object.getOwnPropertyDescriptor(v as object, key);
          if (!descriptor || !('value' in descriptor) || !visit(descriptor.value, depth + 1))
            return false;
        }
      }
      return true;
    };
    return visit(value, 0);
  } catch {
    return false;
  }
};
const boundedHookInput = (input: unknown): unknown | undefined => {
  try {
    const value =
      typeof input === 'string'
        ? new TextEncoder().encode(input).byteLength <= MAX_HOOK_BYTES
          ? JSON.parse(input)
          : undefined
        : input;
    return value !== undefined && hookBounds(value) ? value : undefined;
  } catch {
    return undefined;
  }
};
const boundedText = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 && v.length <= 256 ? v : undefined;
const safeDuration = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 86400000 ? v : undefined;
const isHook = (v: unknown): v is ClaudeHook =>
  typeof v === 'string' && (CLAUDE_HOOKS as readonly string[]).includes(v);
const hasNativeId = (v: unknown): boolean => {
  const id =
    own(v, 'tool_use_id') ?? own(v, 'toolUseId') ?? own(v, 'task_id') ?? own(v, 'agent_id');
  return typeof id === 'string' && id.length > 0 && id.length <= 128;
};
const phaseOf = (h: ClaudeHook): Phase =>
  h === 'UserPromptSubmit'
    ? 'prompt'
    : h === 'Stop'
      ? 'stop'
      : h === 'StopFailure'
        ? 'stop-failure'
        : h.includes('Tool')
          ? 'tool'
          : h.includes('Permission')
            ? 'permission'
            : h.includes('Task')
              ? 'task'
              : h.includes('Subagent')
                ? 'subagent'
                : 'session';
const claudeCategory = (value: unknown): ToolCategory => {
  const base = categorizeTool(value);
  if (base !== 'other' || typeof value !== 'string') return base;
  switch (value) {
    case 'Read':
    case 'Glob':
    case 'LS':
      return value === 'Glob' ? 'search' : 'read';
    case 'Grep':
      return 'search';
    case 'Bash':
      return 'shell';
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return 'edit';
    case 'Task':
      return 'agent';
    default:
      return 'other';
  }
};
export interface ClaudeHookInput {
  readonly hook?: unknown;
  readonly event?: unknown;
  readonly tool_name?: unknown;
  readonly tool?: unknown;
  readonly status?: unknown;
  readonly success?: unknown;
  readonly duration_ms?: unknown;
  readonly background?: unknown;
  readonly [key: string]: unknown;
}
export interface ClaudeObservation {
  readonly phase: Phase;
  readonly hook?: ClaudeHook;
  readonly category?: ToolCategory;
  readonly toolName?: string;
  readonly status?: 'started' | 'completed' | 'failed' | 'allowed' | 'denied' | 'unknown';
  readonly durationMs?: number;
  readonly background?: boolean;
  readonly nesting?: 'nested' | 'root' | 'unknown';
  readonly correlation: 'observed' | 'missing' | 'ambiguous';
  readonly finality: 'provisional' | 'confirmed' | 'quiescent' | 'failure';
  readonly taskEvidence?: 'requested' | 'confirmed' | 'unconfirmed';
  readonly failureClass?: 'execution' | 'permission' | 'validation' | 'unknown';
  readonly operationId?: string;
  readonly agentId?: string;
  readonly parentAgentId?: string;
}
const successfulTask = (v: unknown): boolean => {
  const t = boundedText(own(v, 'tool_name') ?? own(v, 'tool'));
  return (
    (t === 'Task' || t === 'task') &&
    (own(v, 'success') === true || own(v, 'status') === 'completed')
  );
};
/** Exact hook allowlist; prompts, IDs, commands, args, output and paths never leave this boundary. */
export function normalizeClaudeHook(input: unknown): ClaudeObservation {
  try {
    input = boundedHookInput(input);
    if (input === undefined)
      return { phase: 'unknown', correlation: 'missing', finality: 'provisional' };
    const raw = boundedText(
      own(input, 'hook') ?? own(input, 'event') ?? own(input, 'hook_event_name'),
    );
    if (!isHook(raw)) return { phase: 'unknown', correlation: 'missing', finality: 'provisional' };
    const phase = phaseOf(raw);
    const category =
      phase === 'tool' || phase === 'permission'
        ? claudeCategory(own(input, 'tool_name') ?? own(input, 'tool'))
        : undefined;
    const rs = boundedText(own(input, 'status'));
    const reason = boundedText(own(input, 'reason')) ?? boundedText(own(input, 'error_type'));
    const excluded =
      raw === 'PostToolUseFailure' &&
      (reason === 'validation' || reason === 'permission' || reason === 'denied');
    const status =
      rs === 'started' ||
      rs === 'completed' ||
      rs === 'failed' ||
      rs === 'allowed' ||
      rs === 'denied'
        ? rs
        : raw === 'StopFailure' || raw === 'PostToolUseFailure'
          ? 'failed'
          : raw === 'PermissionDenied'
            ? 'denied'
            : undefined;
    const finality =
      raw === 'PreToolUse' ||
      raw === 'PermissionRequest' ||
      raw === 'TaskCreated' ||
      raw === 'SubagentStart'
        ? 'provisional'
        : raw === 'Stop' || raw === 'SubagentStop'
          ? 'quiescent'
          : (raw === 'PostToolUseFailure' && !excluded) || raw === 'StopFailure'
            ? 'failure'
            : 'confirmed';
    const taskEvidence =
      raw === 'TaskCreated'
        ? 'requested'
        : raw === 'TaskCompleted'
          ? successfulTask(input)
            ? 'confirmed'
            : 'unconfirmed'
          : undefined;
    const parent = own(input, 'parent_agent_id') ?? own(input, 'parentAgentId');
    const rawOperationId = own(input, 'tool_use_id') ?? own(input, 'toolUseId');
    const rawAgentId = own(input, 'agent_id') ?? own(input, 'agentId');
    const operationId = isOpaqueId(rawOperationId) ? rawOperationId : undefined;
    const agentId = isOpaqueId(rawAgentId) ? rawAgentId : undefined;
    const parentAgentId = isOpaqueId(parent) ? parent : undefined;
    const durationMs = safeDuration(own(input, 'duration_ms'));
    return {
      phase,
      hook: raw,
      ...(category ? { category, toolName: canonicalToolNameForCategory(category) as string } : {}),
      ...(status ? { status: excluded ? 'unknown' : status } : {}),
      ...(excluded
        ? {
            failureClass:
              reason === 'permission' || reason === 'denied' ? 'permission' : 'validation',
          }
        : raw === 'PostToolUseFailure' || raw === 'StopFailure'
          ? { failureClass: 'execution' }
          : {}),
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(typeof own(input, 'background') === 'boolean'
        ? { background: own(input, 'background') as boolean }
        : {}),
      ...(phase === 'subagent'
        ? { nesting: typeof parent === 'string' && parent.length > 0 ? 'nested' : 'root' }
        : {}),
      correlation: hasNativeId(input) ? 'observed' : 'missing',
      finality,
      ...(taskEvidence ? { taskEvidence } : {}),
      ...(operationId === undefined ? {} : { operationId }),
      ...(agentId === undefined ? {} : { agentId }),
      ...(parentAgentId === undefined ? {} : { parentAgentId }),
    };
  } catch {
    return { phase: 'unknown', correlation: 'missing', finality: 'provisional' };
  }
}
export interface ClaudeLifecycleResult {
  readonly status: 'accepted' | 'rejected';
  readonly hook?: ClaudeHook;
  readonly observation?: ClaudeObservation;
  /** Sanitized, protocol-facing evidence; never native payload data. */
  readonly payload?: ClaudeObservation;
  readonly classification?: 'provisional' | 'confirmed' | 'quiescent' | 'failure';
  readonly correlation?: 'native' | 'missing' | 'ambiguous';
  readonly diagnostic?: AdapterDiagnostic;
}
const reject = (
  code: 'native-schema-unsupported' | 'native-field-invalid',
): ClaudeLifecycleResult => ({
  status: 'rejected',
  diagnostic: buildAdapterDiagnostic({ code, severity: 'warning', field: 'native-schema' }),
});
/** Schema-valid lifecycle normalization with sanitized observation only. */
export function normalizeClaudeLifecycle(input: unknown): ClaudeLifecycleResult {
  input = boundedHookInput(input);
  if (input === undefined) return reject('native-field-invalid');
  const raw = boundedText(
    own(input, 'hook') ?? own(input, 'event') ?? own(input, 'hook_event_name'),
  );
  if (!isHook(raw)) return reject('native-schema-unsupported');
  try {
    const observation = normalizeClaudeHook(input);
    return {
      status: 'accepted',
      hook: raw,
      observation,
      payload: observation,
      classification: observation.finality === 'failure' ? 'failure' : observation.finality,
      correlation: observation.correlation === 'observed' ? 'native' : observation.correlation,
    };
  } catch {
    return reject('native-field-invalid');
  }
}
export const normalizeClaudeEvidence = normalizeClaudeLifecycle;

const directKindMap: Readonly<
  Record<ClaudeHook, import('@codeinvaders/protocol').CoreEventType | undefined>
> = Object.freeze({
  SessionStart: 'session.started',
  SessionEnd: 'session.ended',
  UserPromptSubmit: 'turn.started',
  PreToolUse: 'tool.requested',
  PostToolUse: 'tool.completed',
  PostToolUseFailure: 'tool.failed',
  PermissionRequest: 'permission.requested',
  PermissionDenied: 'permission.resolved',
  Stop: 'turn.quiescent',
  StopFailure: 'turn.finished',
  TaskCreated: 'task.created',
  TaskCompleted: 'task.completed',
  SubagentStart: 'agent.spawned',
  SubagentStop: 'agent.state.changed',
});

export function buildClaudeDirectDescriptor(input: unknown): DirectEventDescriptor | undefined {
  const normalized = normalizeClaudeLifecycle(input);
  if (
    normalized.status !== 'accepted' ||
    normalized.hook === undefined ||
    normalized.observation === undefined
  )
    return undefined;
  const observation = normalized.observation;
  /* Validation and permission failures are evidence of a denied checkpoint, not execution failure. */
  if (
    normalized.hook === 'PostToolUseFailure' &&
    (observation.failureClass === 'validation' || observation.failureClass === 'permission')
  )
    return undefined;
  const type = directKindMap[normalized.hook];
  if (type === undefined) return undefined;
  const nativePayload = own(input, 'payload');
  const native = (...keys: string[]) =>
    directNativeIdentity(input, ...keys) ?? directNativeIdentity(nativePayload, ...keys);
  const session = native('session_id', 'sessionId', 'conversation_id', 'conversationId');
  if (session === undefined) return undefined;
  const turn = native('turn_id', 'turnId');
  const workspace = native('cwd', 'workspace', 'workspace_path', 'workspacePath');
  const repository = native('repository', 'repository_root', 'repositoryRoot', 'repo');
  const operation = native('tool_use_id', 'toolUseId', 'call_id');
  if (type.startsWith('tool.') && operation === undefined) return undefined;
  const agent = native('agent_id', 'agentId');
  const parentAgent = native('parent_agent_id', 'parentAgentId');
  const task = native('task_id', 'taskId');
  const permission = native('permission_id', 'permissionId');
  const timestamp = directNativeTimestamp(input, 'occurred_at', 'occurredAt', 'timestamp');
  const checkpoint = [
    adapterName,
    normalized.hook,
    session,
    directNativeIdentity(input, 'event_id', 'eventId', 'id') ??
      operation ??
      task ??
      agent ??
      permission ??
      'checkpoint',
  ];
  let data: unknown = {};
  if (type === 'session.started') data = { resume: false };
  else if (type === 'session.ended') data = { reason: 'unknown' };
  else if (type === 'turn.started') data = {};
  else if (type === 'turn.quiescent') data = { reason: 'native' };
  else if (type === 'turn.finished') data = { outcome: 'failed' };
  else if (type === 'task.created') data = { status: 'pending', fallback: false };
  else if (type === 'task.completed') data = { completion: 'observed' };
  else if (type === 'permission.requested') data = { category: observation.category ?? 'other' };
  else if (type === 'permission.resolved') data = { outcome: 'denied' };
  else if (type === 'agent.state.changed') data = { to: 'waiting', reason: 'native' };
  else if (type === 'agent.spawned') data = { role: 'unknown', depth: 0 };
  else if (type === 'tool.requested' || type === 'tool.started' || type === 'tool.completed')
    data = {
      name: canonicalToolNameForCategory(observation.category ?? 'other'),
      category: observation.category ?? 'other',
      ...(type === 'tool.completed' ? { resultClass: 'success' } : {}),
      ...(observation.durationMs === undefined ? {} : { durationMs: observation.durationMs }),
    };
  else if (type === 'tool.failed')
    data = {
      name: canonicalToolNameForCategory(observation.category ?? 'other'),
      category: observation.category ?? 'other',
      failureClass: 'unknown',
      ...(observation.durationMs === undefined ? {} : { durationMs: observation.durationMs }),
    };
  return {
    adapterId: 'codeinvaders-claude-code',
    adapterVersion,
    type,
    checkpoint,
    ...(session === undefined ? {} : { session }),
    ...(workspace === undefined ? {} : { workspace }),
    ...(repository === undefined ? {} : { repository }),
    ...(turn === undefined ? {} : { turn }),
    ...(operation === undefined ? {} : { operation }),
    ...(agent === undefined ? {} : { agent }),
    ...(parentAgent === undefined ? {} : { parentAgent }),
    ...(task === undefined ? {} : { task }),
    ...(permission === undefined ? {} : { permission }),
    ...(timestamp === undefined ? {} : { timestamp }),
    data,
    finality:
      type === 'tool.requested' || type === 'permission.requested' || type === 'task.created'
        ? 'provisional'
        : 'confirmed',
    ...(type === 'turn.quiescent'
      ? { semantic: { kind: 'quiescence' as const, terminal: false, basis: 'native' as const } }
      : type === 'task.completed'
        ? {
            semantic: {
              kind: 'outcome' as const,
              terminal: true,
              outcome: 'success' as const,
              basis: 'native' as const,
            },
          }
        : {}),
  };
}

export async function runDirectClaudeHook(input: unknown) {
  const descriptor = buildClaudeDirectDescriptor(input);
  if (descriptor === undefined) {
    await recordDirectDiagnostic('codeinvaders-claude-code', 'native-input-invalid');
    return { status: 'dropped' as const };
  }
  return deliverDirectEvent(descriptor);
}

export async function runClaudeHookProcess(): Promise<void> {
  const input = await readDirectHookInput(MAX_HOOK_BYTES);
  await runDirectClaudeHook(input);
}

const unsupported = (
  code:
    'unknown' | 'manual-denials' | 'missing-correlation' | 'hosted-tools' | 'session-configuration',
): SignalCapability => ({
  availability: 'unsupported',
  evidenceQuality: 'none',
  coverage: 'none',
  finality: 'provisional',
  exclusions: [{ code }],
});
const partial = (
  code:
    'unknown' | 'manual-denials' | 'missing-correlation' | 'hosted-tools' | 'session-configuration',
): SignalCapability => ({
  availability: 'partial',
  evidenceQuality: 'observed',
  coverage: 'partial',
  finality: 'mixed',
  exclusions: [{ code }],
});
export function claudeCapabilities(
  hasTaskTools = false,
  hasPermissionHooks = true,
): CapabilityProfile['signals'] {
  return {
    sessions: partial('session-configuration'),
    turns: partial('session-configuration'),
    tasks: hasTaskTools ? partial('missing-correlation') : unsupported('unknown'),
    taskPlan: unsupported('unknown'),
    agents: partial('missing-correlation'),
    tools: partial('hosted-tools'),
    permissions: hasPermissionHooks ? partial('manual-denials') : unsupported('manual-denials'),
  };
}
export function detectClaudeCapabilities(events: readonly unknown[]): CapabilityProfile['signals'] {
  let task = false,
    permission = false;
  for (const e of events.slice(0, 1024)) {
    const h = boundedText(own(e, 'hook') ?? own(e, 'event') ?? own(e, 'hook_event_name'));
    const t = boundedText(own(e, 'tool_name') ?? own(e, 'tool'));
    if (h === 'TaskCreated' || h === 'TaskCompleted' || t === 'Task' || t === 'task') task = true;
    if (h === 'PermissionRequest' || h === 'PermissionDenied') permission = true;
  }
  return claudeCapabilities(task, permission);
}
export function capabilityProfile(
  sessionId: OpaqueId,
  hasTaskTools = false,
  hasPermissionHooks = true,
): CapabilityProfile {
  const configurationId = isOpaqueId(sessionId) ? sessionId : undefined;
  return {
    revision: 1,
    effectiveSequence: 0,
    platform: { agentKind: 'claude-code' as never, agentVersion: adapterVersion },
    session: { mode: 'unknown', ...(configurationId ? { configurationId } : {}) },
    signals: claudeCapabilities(hasTaskTools, hasPermissionHooks),
    exclusions: [{ code: 'unknown', scope: 'session' }],
  };
}
export type ClaudeHookResult = Readonly<Record<string, never>>;
/** Direct/manual entrypoint is observational and fail-open. */
export function claudeHook(input: unknown): ClaudeHookResult {
  normalizeClaudeLifecycle(input);
  return {};
}
export const directHook = claudeHook;
export const prebuiltHook = Object.freeze({ name: adapterName, observe: claudeHook });
export const pluginDefinition = Object.freeze({ name: adapterName, onEvent: claudeHook });
export const manualHookDefinition = Object.freeze({
  name: adapterName,
  command: 'codeinvaders-claude-hook',
  observe: claudeHook,
});
export const plugin = pluginDefinition;
export const manual = manualHookDefinition;
export function diagnosticForInvalidHook() {
  return buildAdapterDiagnostic({
    code: 'native-input-invalid',
    severity: 'warning',
    boundary: 'adapter',
    field: 'native-input',
  });
}
