import { protocolId, type CoreEventType } from '../index.js';

export type ProtocolFixture = Record<string, unknown>;

/** Freezes fixture catalogs recursively so one consumer cannot alter another consumer's inputs. */
export function deepFreeze<T>(value: T): T {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && 'value' in descriptor) deepFreeze(descriptor.value);
  }
  return value;
}

/** The stable fixture view of the complete core event registry. */
const coreEventFixtureTypesValue = [
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
] as const satisfies readonly CoreEventType[];
export const coreEventFixtureTypes = deepFreeze(coreEventFixtureTypesValue);

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

const data: Record<CoreEventType, ProtocolFixture> = {
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

/** Fields required in addition to the common workspace and session scope. */
const requiredScopeByEventValue: Partial<Record<CoreEventType, Readonly<Record<string, string>>>> =
  {
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
export const requiredScopeByEvent = deepFreeze(requiredScopeByEventValue);

function semanticFor(type: CoreEventType): ProtocolFixture | undefined {
  switch (type) {
    case 'source.capability.changed':
      return { kind: 'capability', terminal: false };
    case 'telemetry.gap':
      return { kind: 'gap', terminal: false };
    case 'turn.quiescent':
      return { kind: 'quiescence', terminal: false };
    case 'task.completion.requested':
      return { kind: 'checkpoint', terminal: false };
    case 'task.completed':
      return { kind: 'outcome', terminal: true, outcome: 'success' };
    case 'task.failed':
      return { kind: 'outcome', terminal: true, outcome: 'failure' };
    case 'task.denied':
      return { kind: 'outcome', terminal: true, outcome: 'denied' };
    case 'task.cancelled':
      return { kind: 'outcome', terminal: true, outcome: 'cancelled' };
    case 'task.abandoned':
      return { kind: 'outcome', terminal: true, outcome: 'abandoned' };
    case 'task.corrected':
      return {
        kind: 'correction',
        terminal: false,
        correctionOfEventId: 'event-0',
        correctionOfEntityId: 'task-1',
      };
    default:
      return undefined;
  }
}

/** Returns a detached copy so a test can mutate a scenario without changing later fixtures. */
export function validEventFixture(type: CoreEventType): ProtocolFixture {
  const event: ProtocolFixture = {
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
    scope: {
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      ...requiredScopeByEvent[type],
    },
    fidelity: 'observed',
    finality: type === 'task.completion.requested' ? 'provisional' : 'confirmed',
    data: data[type],
  };
  const semantic = semanticFor(type);
  if (semantic !== undefined) event.semantic = semantic;
  return structuredClone(event);
}

/** One valid, reusable event for every registry discriminant. */
export const validCoreEventFixtures = deepFreeze(
  Object.fromEntries(
    coreEventFixtureTypes.map((type) => [type, validEventFixture(type)]),
  ) as Record<CoreEventType, ProtocolFixture>,
);
