import type { AnyCoreEvent, AgentState, TaskStatus } from '@codeinvaders/protocol';

export type TurnStatus = 'requested' | 'active' | 'quiescent' | 'sealed';
export interface TaskState {
  readonly taskId: string;
  readonly sessionId?: string;
  readonly turnId?: string;
  readonly status: TaskStatus;
  readonly provisional: boolean;
  readonly outcome?: string;
  readonly ordinal?: number;
  readonly assigneeAgentId?: string;
  readonly fallback: boolean;
  readonly lastSequence: number;
}
export interface StructuralAgent {
  readonly agentId: string;
  readonly sessionId: string;
  readonly state: 'starting' | 'working' | 'waiting' | 'finished';
  readonly structural: true;
}
export interface FallbackObjective {
  readonly objectiveId: string;
  readonly turnId: string;
  readonly sessionId: string;
  readonly status: 'active' | 'quiescent' | 'sealed';
  readonly structural: true;
}
export interface OperationState {
  readonly status: string;
  readonly sessionId?: string;
}
export interface SemanticState {
  readonly sources: Readonly<Record<string, unknown>>;
  readonly sessions: Readonly<Record<string, { status: string }>>;
  readonly turns: Readonly<Record<string, { status: TurnStatus; fallbackTaskId?: string }>>;
  /** Observed agents only. Structural roots live in rootAgents. */
  readonly agents: Readonly<Record<string, { state: AgentState }>>;
  readonly rootAgents: Readonly<Record<string, StructuralAgent>>;
  readonly fallbackObjectives: Readonly<Record<string, FallbackObjective>>;
  readonly tasks: Readonly<Record<string, TaskState>>;
  readonly operations: Readonly<Record<string, OperationState>>;
  readonly permissions: Readonly<Record<string, { status: string }>>;
  readonly gaps: readonly { from?: number; to?: number; sequence: number }[];
  readonly diagnostics: readonly string[];
  readonly lastSequence: number;
}
export const initialSemanticState = (): SemanticState => ({
  sources: {},
  sessions: {},
  turns: {},
  agents: {},
  rootAgents: {},
  fallbackObjectives: {},
  tasks: {},
  operations: {},
  permissions: {},
  gaps: [],
  diagnostics: [],
  lastSequence: 0,
});

const terminal = new Set<TaskStatus>([
  'completed',
  'failed',
  'denied',
  'cancelled',
  'abandoned',
  'unknown',
]);
const operationTerminal = new Set([
  'completed',
  'failed',
  'denied',
  'cancelled',
  'abandoned',
  'unknown',
]);
const isTool = (type: string): boolean =>
  type === 'tool.requested' ||
  type === 'tool.started' ||
  type === 'tool.completed' ||
  type === 'tool.failed';
const outcome = (status: TaskStatus): string => (status === 'completed' ? 'success' : status);
function capabilityAvailability(
  data: Record<string, unknown>,
): 'available' | 'partial' | 'unsupported' | undefined {
  const profile = data.capabilities;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return undefined;
  const signals = (profile as Record<string, unknown>).signals;
  if (!signals || typeof signals !== 'object' || Array.isArray(signals)) return undefined;
  const values = Object.values(signals as Record<string, unknown>);
  if (values.length === 0) return undefined;
  const availabilities = values.map((value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>).availability
      : undefined,
  );
  if (availabilities.includes('unsupported')) return 'unsupported';
  if (availabilities.includes('partial')) return 'partial';
  return availabilities.every((value) => value === 'available') ? 'available' : undefined;
}

/** A side-effect-free, immutable semantic projection of one canonical event. */
export function reduce(state: SemanticState, event: AnyCoreEvent): SemanticState {
  const sources = { ...state.sources },
    sessions = { ...state.sessions },
    turns = { ...state.turns };
  const agents = { ...state.agents },
    rootAgents = { ...state.rootAgents },
    fallbackObjectives = { ...state.fallbackObjectives };
  const tasks = { ...state.tasks },
    operations = { ...state.operations },
    permissions = { ...state.permissions };
  const gaps = [...state.gaps],
    diagnostics = [...state.diagnostics];
  const data = (event.data ?? {}) as Record<string, unknown>;
  const scope = event.scope;
  if (event.type.startsWith('source.'))
    sources[scope.sessionId] = {
      type: event.type,
      sequence: event.sequence,
      ...(capabilityAvailability(data) === undefined
        ? {}
        : { availability: capabilityAvailability(data) }),
    };
  if (event.type === 'session.started') {
    sessions[scope.sessionId] = { status: 'active' };
    const id = `root:${scope.sessionId}`;
    rootAgents[id] = {
      agentId: id,
      sessionId: scope.sessionId,
      state: 'starting',
      structural: true,
    };
  }
  if (event.type === 'session.ended') {
    sessions[scope.sessionId] = { status: 'sealed' };
    for (const [id, operation] of Object.entries(operations))
      if (
        operation?.status === 'active' &&
        (!('sessionId' in operation) || operation.sessionId === scope.sessionId)
      )
        operations[id] = { ...operation, status: 'abandoned' };
    for (const [id, task] of Object.entries(tasks))
      if (
        task &&
        !terminal.has(task.status) &&
        (!('sessionId' in task) || task.sessionId === scope.sessionId)
      )
        tasks[id] = {
          ...task,
          status: 'unknown',
          outcome: 'unknown',
          provisional: false,
          lastSequence: event.sequence,
        };
    for (const [id, root] of Object.entries(rootAgents))
      if (root.sessionId === scope.sessionId) {
        rootAgents[id] = { ...root, state: 'finished' };
      }
  }
  if (scope.turnId) {
    const previous = turns[scope.turnId];
    if (event.type === 'turn.started')
      turns[scope.turnId] = {
        status: event.finality === 'confirmed' ? 'active' : 'requested',
      };
    if (event.type === 'turn.quiescent' && previous?.status !== 'sealed')
      turns[scope.turnId] = { ...previous, status: 'quiescent' };
    if (event.type === 'turn.finished') turns[scope.turnId] = { ...previous, status: 'sealed' };
    if (
      isTool(event.type) &&
      (previous?.status === 'quiescent' || previous?.status === 'requested')
    )
      turns[scope.turnId] = { ...previous, status: 'active' };
  }
  if (scope.agentId) {
    if (event.type === 'agent.spawned') agents[scope.agentId] = { state: 'starting' };
    if (event.type === 'agent.state.changed')
      agents[scope.agentId] = { state: data.to as AgentState };
    if (event.type === 'agent.finished')
      agents[scope.agentId] = { state: data.outcome === 'failed' ? 'failed' : 'finished' };
    if (isTool(event.type) && agents[scope.agentId]?.state !== 'finished')
      agents[scope.agentId] = { state: 'working' };
    if (event.type === 'turn.quiescent' && agents[scope.agentId])
      agents[scope.agentId] = { state: 'waiting' };
  }
  const rootId = `root:${scope.sessionId}`;
  if (isTool(event.type) && !scope.agentId && !rootAgents[rootId]) {
    rootAgents[rootId] = {
      agentId: rootId,
      sessionId: scope.sessionId,
      state: 'starting',
      structural: true,
    };
  }
  if (isTool(event.type) && !scope.agentId && rootAgents[rootId]?.state !== 'finished') {
    rootAgents[rootId] = { ...rootAgents[rootId]!, state: 'working' };
  }
  if (event.type === 'turn.quiescent' && rootAgents[rootId]) {
    rootAgents[rootId] = { ...rootAgents[rootId]!, state: 'waiting' };
  }
  if (scope.operationId && event.type.startsWith('tool.')) {
    const old = operations[scope.operationId];
    const next =
      event.type === 'tool.completed'
        ? 'completed'
        : event.type === 'tool.failed'
          ? data.failureClass === 'denied'
            ? 'denied'
            : data.failureClass === 'cancelled'
              ? 'cancelled'
              : 'failed'
          : 'active';
    if (!old || !operationTerminal.has(old.status))
      operations[scope.operationId] = { status: next, sessionId: scope.sessionId };
  }
  if (scope.permissionId && event.type.startsWith('permission.'))
    permissions[scope.permissionId] = {
      status: event.type === 'permission.resolved' ? String(data.outcome) : 'requested',
    };
  if (event.type === 'telemetry.gap') {
    const gap: { from?: number; to?: number; sequence: number } = { sequence: event.sequence };
    if (typeof data.fromSequence === 'number') gap.from = data.fromSequence;
    if (typeof data.toSequence === 'number') gap.to = data.toSequence;
    gaps.push(gap);
    diagnostics.push('telemetry-gap');
    if (diagnostics.length > 256) diagnostics.splice(0, diagnostics.length - 256);
  }
  if (event.type === 'task.plan.reconciled' && Array.isArray(data.items)) {
    const seen = new Set<string>();
    for (const value of data.items.slice(0, 256)) {
      if (!value || typeof value !== 'object') continue;
      const item = value as Record<string, unknown>;
      if (typeof item.taskId !== 'string' || typeof item.status !== 'string') continue;
      const taskId = item.taskId;
      const nextStatus = item.status as TaskStatus;
      seen.add(taskId);
      const old = tasks[taskId];
      if (old && terminal.has(old.status) && !old.provisional) continue;
      tasks[taskId] = {
        taskId,
        sessionId: scope.sessionId,
        ...(scope.turnId === undefined ? {} : { turnId: scope.turnId }),
        status: nextStatus,
        provisional: event.finality !== 'confirmed',
        fallback: false,
        lastSequence: event.sequence,
        ...(typeof item.ordinal === 'number' ? { ordinal: item.ordinal } : {}),
        ...(old?.assigneeAgentId === undefined ? {} : { assigneeAgentId: old.assigneeAgentId }),
        ...(terminal.has(nextStatus) ? { outcome: outcome(nextStatus) } : {}),
      };
    }
    if (data.complete === true) {
      for (const [taskId, task] of Object.entries(tasks)) {
        if (
          task.sessionId === scope.sessionId &&
          task.turnId === scope.turnId &&
          !task.fallback &&
          !seen.has(taskId) &&
          !terminal.has(task.status)
        ) {
          tasks[taskId] = {
            ...task,
            status: 'cancelled',
            outcome: 'cancelled',
            provisional: false,
            lastSequence: event.sequence,
          };
        }
      }
    }
    if (seen.size > 0 && scope.turnId && event.finality === 'confirmed')
      delete fallbackObjectives[`fallback:${scope.turnId}`];
  }
  if (scope.taskId) {
    if (event.type === 'task.created' && data.fallback === true) {
      if (scope.turnId) {
        const id = `fallback:${scope.turnId}`,
          turn = turns[scope.turnId] ?? { status: 'active' as TurnStatus };
        fallbackObjectives[id] = {
          objectiveId: id,
          turnId: scope.turnId,
          sessionId: scope.sessionId,
          status:
            turn.status === 'sealed'
              ? 'sealed'
              : turn.status === 'quiescent'
                ? 'quiescent'
                : 'active',
          structural: true,
        };
        turns[scope.turnId] = { ...turn, fallbackTaskId: id };
      }
    } else {
      const old = tasks[scope.taskId] ?? {
        taskId: scope.taskId,
        status: 'unknown' as TaskStatus,
        provisional: true,
        fallback: false,
        lastSequence: 0,
      };
      let status = old.status,
        provisional = old.provisional,
        taskOutcome = old.outcome;
      if (event.type === 'task.corrected') {
        status = data.status as TaskStatus;
        taskOutcome = data.resultingOutcome as string | undefined;
        provisional = false;
      } else if (!terminal.has(old.status) || old.provisional) {
        if (event.type === 'task.created' || event.type === 'task.updated') {
          if (typeof data.status === 'string') status = data.status as TaskStatus;
          provisional = event.finality !== 'confirmed';
        }
        if (event.type === 'task.completion.requested') {
          status = 'in_progress';
          provisional = true;
        }
        if (event.type.startsWith('task.') && terminal.has(event.type.slice(5) as TaskStatus)) {
          status = event.type.slice(5) as TaskStatus;
          taskOutcome = outcome(status);
          provisional = false;
        }
      }
      const nextTask: TaskState = {
        taskId: old.taskId,
        sessionId: scope.sessionId,
        ...(scope.turnId === undefined
          ? old.turnId === undefined
            ? {}
            : { turnId: old.turnId }
          : { turnId: scope.turnId }),
        status,
        provisional,
        fallback: data.fallback === true || old.fallback,
        lastSequence: event.sequence,
        ...(taskOutcome === undefined ? {} : { outcome: taskOutcome }),
        ...(typeof data.ordinal === 'number'
          ? { ordinal: data.ordinal }
          : old.ordinal === undefined
            ? {}
            : { ordinal: old.ordinal }),
        ...(event.type === 'task.assigned'
          ? typeof data.assigneeAgentId === 'string'
            ? { assigneeAgentId: data.assigneeAgentId }
            : {}
          : old.assigneeAgentId === undefined
            ? {}
            : { assigneeAgentId: old.assigneeAgentId }),
      };
      tasks[scope.taskId] = nextTask;
      if (
        scope.turnId &&
        event.type === 'task.created' &&
        event.finality === 'confirmed' &&
        !nextTask.fallback
      )
        delete fallbackObjectives[`fallback:${scope.turnId}`];
    }
  }
  // A turn without confirmed task lifecycle gets one structural fallback,
  // never a fabricated record in the real task collection.
  if (
    scope.turnId &&
    (isTool(event.type) || event.type === 'turn.started') &&
    Object.values(tasks).every(
      (task) =>
        task.fallback ||
        task.status === 'unknown' ||
        task.sessionId !== scope.sessionId ||
        (task.turnId !== undefined && task.turnId !== scope.turnId),
    )
  ) {
    const id = `fallback:${scope.turnId}`,
      turn = turns[scope.turnId] ?? { status: 'active' as TurnStatus };
    fallbackObjectives[id] = {
      objectiveId: id,
      turnId: scope.turnId,
      sessionId: scope.sessionId,
      status:
        turn.status === 'sealed' ? 'sealed' : turn.status === 'quiescent' ? 'quiescent' : 'active',
      structural: true,
    };
    turns[scope.turnId] = { ...turn, fallbackTaskId: id };
  }
  if (scope.turnId && turns[scope.turnId]?.fallbackTaskId) {
    const fallback = fallbackObjectives[`fallback:${scope.turnId}`];
    if (fallback)
      fallbackObjectives[fallback.objectiveId] = {
        ...fallback,
        status:
          turns[scope.turnId]!.status === 'sealed'
            ? 'sealed'
            : turns[scope.turnId]!.status === 'quiescent'
              ? 'quiescent'
              : 'active',
      };
  }
  return {
    sources,
    sessions,
    turns,
    agents,
    rootAgents,
    fallbackObjectives,
    tasks,
    operations,
    permissions,
    gaps,
    diagnostics,
    lastSequence: Math.max(state.lastSequence, event.sequence),
  };
}
export const reduceEvents = (
  events: readonly AnyCoreEvent[],
  initial = initialSemanticState(),
): SemanticState => events.reduce(reduce, initial);
