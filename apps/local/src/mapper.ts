import type { AnyCoreEvent } from '@codeinvaders/protocol';
import type { SemanticState } from '@codeinvaders/core';

export const MAPPER_VERSION = 1 as const;
export type IntentKind =
  | 'carrier'
  | 'child-ship'
  | 'task'
  | 'fallback'
  | 'tool-charge'
  | 'permission-lock'
  | 'success-impact'
  | 'failure'
  | 'denial'
  | 'abandonment'
  | 'retreat'
  | 'correction'
  | 'quiescence'
  | 'resumed'
  | 'level-outcome'
  | 'session-ended'
  | 'capability'
  | 'telemetry-gap';
export interface AnimationIntent {
  readonly version: 1;
  readonly kind: IntentKind;
  readonly entityId: string;
  readonly semanticTime: number;
  readonly seed: number;
  readonly terminal: boolean;
  readonly reversible: boolean;
  readonly priority: 'semantic' | 'cosmetic';
  readonly status?: string;
  readonly parentId?: string;
  readonly text: string;
}
export interface MapperInput {
  readonly previous: SemanticState;
  readonly next: SemanticState;
  readonly event: AnyCoreEvent;
  readonly semanticTime?: number;
  readonly seed?: number;
}
function seed(event: AnyCoreEvent, supplied?: number): number {
  if (supplied !== undefined) return supplied >>> 0;
  let hash = 2166136261;
  for (const char of event.eventId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}
function textFor(event: AnyCoreEvent): string {
  return event.type.replaceAll('.', ' ');
}
export function mapTransition(input: MapperInput): AnimationIntent[] {
  const { event, previous, next } = input;
  const time = input.semanticTime ?? event.sequence;
  const common = {
    version: 1 as const,
    semanticTime: time,
    seed: seed(event, input.seed),
    text: textFor(event),
  };
  const semantic = (
    kind: IntentKind,
    entityId: string,
    options: Partial<AnimationIntent> = {},
  ): AnimationIntent => ({
    ...common,
    kind,
    entityId,
    terminal: false,
    reversible: true,
    priority: 'semantic',
    ...options,
  });
  if (event.type === 'session.started')
    return [semantic('carrier', `root:${event.scope.sessionId}`, { status: 'starting' })];
  if (event.type === 'agent.spawned' && event.scope.agentId)
    return [
      semantic('child-ship', event.scope.agentId, {
        parentId: event.links?.parentAgentId ?? `root:${event.scope.sessionId}`,
        status: 'starting',
      }),
    ];
  if (event.type.startsWith('tool.') && event.scope.operationId) {
    const effectParent =
      event.scope.agentId ?? event.links?.parentAgentId ?? `root:${event.scope.sessionId}`;
    const failureClass = event.type === 'tool.failed' ? String(event.data.failureClass) : '';
    const effect =
      event.type === 'tool.failed'
        ? semantic(
            failureClass === 'denied'
              ? 'denial'
              : failureClass === 'cancelled'
                ? 'abandonment'
                : 'failure',
            event.scope.operationId,
            {
              status: 'failed',
              terminal: true,
              reversible: false,
              parentId: effectParent,
            },
          )
        : event.type === 'tool.completed'
          ? semantic('success-impact', event.scope.operationId, {
              status: 'completed',
              terminal: true,
              reversible: false,
              priority: 'cosmetic',
              parentId: effectParent,
            })
          : semantic('tool-charge', event.scope.operationId, {
              status: event.type.slice(5),
              priority: 'cosmetic',
              parentId: effectParent,
            });
    const fallbackId = event.scope.turnId
      ? next.turns[event.scope.turnId]?.fallbackTaskId
      : undefined;
    const resumed =
      event.scope.turnId && previous.turns[event.scope.turnId]?.status === 'quiescent'
        ? semantic('resumed', event.scope.turnId, { status: 'active' })
        : undefined;
    return [
      effect,
      ...(fallbackId ? [semantic('fallback', fallbackId, { status: 'activity-only' })] : []),
      ...(resumed === undefined ? [] : [resumed]),
    ];
  }
  if (event.type === 'permission.requested' && event.scope.permissionId)
    return [
      semantic('permission-lock', event.scope.permissionId, {
        status: 'requested',
        ...(event.links?.correlationId ? { parentId: event.links.correlationId } : {}),
      }),
    ];
  if (event.type === 'permission.resolved' && event.scope.permissionId)
    return [
      semantic(
        event.data.outcome === 'denied' ? 'denial' : 'permission-lock',
        event.scope.permissionId,
        { status: String(event.data.outcome), terminal: true, reversible: false },
      ),
    ];
  if (event.type === 'telemetry.gap')
    return [semantic('telemetry-gap', `gap:${event.sequence}`, { status: 'signal-loss' })];
  if (event.type === 'turn.quiescent' && event.scope.turnId)
    return [semantic('quiescence', event.scope.turnId, { status: 'waiting' })];
  if (event.type === 'turn.started' && previous.turns[event.scope.turnId]?.status === 'quiescent')
    return [semantic('resumed', event.scope.turnId, { status: 'active' })];
  if (event.type === 'session.ended')
    return [
      ...Object.entries(next.operations)
        .filter(
          ([operationId, operation]) =>
            previous.operations[operationId]?.status === 'active' &&
            operation.status === 'abandoned',
        )
        .map(([operationId]) =>
          semantic('abandonment', operationId, {
            terminal: true,
            reversible: false,
            status: 'session-ended',
          }),
        ),
      semantic('session-ended', event.scope.sessionId, {
        terminal: true,
        reversible: false,
        status: 'sealed',
      }),
      semantic('level-outcome', event.scope.sessionId, {
        terminal: true,
        reversible: false,
        status: 'session-ended',
      }),
    ];
  if (event.type === 'source.capability.changed') {
    const source = next.sources[event.scope.sessionId] as { availability?: string } | undefined;
    return [
      semantic('capability', event.scope.sessionId, {
        status: source?.availability ?? 'unknown',
      }),
    ];
  }
  if (event.type === 'task.plan.reconciled') {
    const intents: AnimationIntent[] = [];
    for (const [taskId, task] of Object.entries(next.tasks).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const old = previous.tasks[taskId];
      if (
        old === undefined ||
        old.status !== task.status ||
        old.ordinal !== task.ordinal ||
        old.provisional !== task.provisional ||
        old.assigneeAgentId !== task.assigneeAgentId
      )
        intents.push(
          semantic('task', taskId, {
            status: task.status,
            reversible: task.provisional,
            terminal: false,
            ...(task.assigneeAgentId === undefined ? {} : { parentId: task.assigneeAgentId }),
          }),
        );
    }
    return intents;
  }
  if (event.scope.taskId) {
    const task = next.tasks[event.scope.taskId];
    const old = previous.tasks[event.scope.taskId];
    if (event.type === 'task.completed' && task?.status === 'completed')
      return [
        semantic('success-impact', event.scope.taskId, {
          terminal: true,
          reversible: false,
          priority: 'semantic',
          status: 'completed',
        }),
      ];
    if (event.type === 'task.failed')
      return [
        semantic('failure', event.scope.taskId, {
          terminal: true,
          reversible: false,
          priority: 'semantic',
          status: 'failed',
        }),
      ];
    if (event.type === 'task.denied')
      return [
        semantic('denial', event.scope.taskId, {
          terminal: true,
          reversible: false,
          priority: 'semantic',
          status: 'denied',
        }),
      ];
    if (event.type === 'task.abandoned')
      return [
        semantic('abandonment', event.scope.taskId, {
          terminal: true,
          reversible: false,
          priority: 'semantic',
          status: 'abandoned',
        }),
      ];
    if (event.type === 'task.cancelled')
      return [
        semantic('retreat', event.scope.taskId, {
          terminal: true,
          reversible: false,
          priority: 'semantic',
          status: 'cancelled',
        }),
      ];
    if (event.type === 'task.corrected')
      return [
        semantic('correction', event.scope.taskId, {
          ...(task?.status ? { status: task.status } : {}),
          priority: 'semantic',
        }),
      ];
    if (event.type === 'task.completion.requested')
      return [
        semantic('task', event.scope.taskId, {
          status: 'completion-requested',
          terminal: false,
          reversible: true,
        }),
      ];
    if (
      task &&
      (!old ||
        old.status !== task.status ||
        old.ordinal !== task.ordinal ||
        old.provisional !== task.provisional ||
        old.assigneeAgentId !== task.assigneeAgentId)
    )
      return [
        semantic('task', event.scope.taskId, {
          status: task.status,
          reversible: task.provisional,
          ...(task.assigneeAgentId === undefined ? {} : { parentId: task.assigneeAgentId }),
        }),
      ];
  }
  return [];
}
export const presentationMapper = mapTransition;
export function mapEvents(
  events: readonly AnyCoreEvent[],
  initial: SemanticState,
  reduceOne: (state: SemanticState, event: AnyCoreEvent) => SemanticState,
): AnimationIntent[] {
  let state = initial;
  const intents: AnimationIntent[] = [];
  for (const event of events) {
    const next = reduceOne(state, event);
    intents.push(...mapTransition({ previous: state, next, event }));
    state = next;
  }
  return intents;
}
