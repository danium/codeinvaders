import type { AnyCoreEvent } from '@codeinvaders/protocol';
import { reduceEvents, initialSemanticState, type SemanticState } from './reducer.js';

export interface ReplayFilter {
  readonly sessionId?: string;
  readonly turnId?: string;
  readonly agentId?: string;
  readonly taskId?: string;
  readonly operationId?: string;
  readonly type?: string;
  readonly fromSequence?: number;
  readonly toSequence?: number;
}
export interface ReplayOptions extends ReplayFilter {
  readonly speed?: number;
  readonly compressIdleMs?: number;
  /** A live-edge request is intentionally a pure alias for the current canonical input. */
  readonly liveEdge?: boolean;
}
export interface ReplayFrame {
  readonly event: AnyCoreEvent;
  readonly semanticTime: number;
  readonly state: SemanticState;
}
export interface ReplayIndexEntry {
  readonly eventId: string;
  readonly sequence: number;
  readonly semanticTime: number;
  readonly significant: boolean;
}
const compare = (a: AnyCoreEvent, b: AnyCoreEvent): number => {
  if (a.source.streamId === b.source.streamId)
    return (
      a.sequence - b.sequence ||
      a.observedAt.localeCompare(b.observedAt) ||
      a.eventId.localeCompare(b.eventId)
    );
  return (
    a.observedAt.localeCompare(b.observedAt) ||
    a.source.streamId.localeCompare(b.source.streamId) ||
    a.sequence - b.sequence ||
    a.eventId.localeCompare(b.eventId)
  );
};
export function filterEvents(
  events: readonly AnyCoreEvent[],
  filter: ReplayFilter = {},
): AnyCoreEvent[] {
  return events.filter(
    (e) =>
      (!filter.sessionId || e.scope.sessionId === filter.sessionId) &&
      (!filter.turnId || e.scope.turnId === filter.turnId) &&
      (!filter.agentId || e.scope.agentId === filter.agentId) &&
      (!filter.taskId || e.scope.taskId === filter.taskId) &&
      (!filter.operationId || e.scope.operationId === filter.operationId) &&
      (!filter.type || e.type === filter.type) &&
      (filter.fromSequence === undefined || e.sequence >= filter.fromSequence) &&
      (filter.toSequence === undefined || e.sequence <= filter.toSequence),
  );
}
/** De-duplicates IDs before applying the documented deterministic display order. */
export function orderedEvents(events: readonly AnyCoreEvent[]): AnyCoreEvent[] {
  const seen = new Set<string>();
  return [...events]
    .sort(compare)
    .filter((e) => !seen.has(e.eventId) && (seen.add(e.eventId), true));
}
export function replay(
  events: readonly AnyCoreEvent[],
  options: ReplayOptions = {},
  initial = initialSemanticState(),
): readonly ReplayFrame[] {
  const selected = orderedEvents(filterEvents(events, options));
  if (options.speed !== undefined && (!Number.isFinite(options.speed) || options.speed <= 0))
    throw new RangeError('speed must be positive');
  if (
    options.compressIdleMs !== undefined &&
    (!Number.isFinite(options.compressIdleMs) || options.compressIdleMs < 0)
  )
    throw new RangeError('compressIdleMs must be non-negative');
  const speed = options.speed ?? 1;
  let previous = selected[0]?.observedAt ? Date.parse(selected[0].observedAt) : 0;
  let state = initial;
  const frames: ReplayFrame[] = [];
  for (const event of selected) {
    const current = Date.parse(event.observedAt);
    const gap = Math.max(0, current - previous);
    const elapsed =
      options.compressIdleMs === undefined ? gap : Math.min(gap, options.compressIdleMs);
    state = reduceEvents([event], state);
    frames.push({
      event,
      semanticTime: (frames.at(-1)?.semanticTime ?? 0) + elapsed / speed,
      state,
    });
    previous = current;
  }
  return frames;
}
export function replayTo(
  events: readonly AnyCoreEvent[],
  sequence = Number.MAX_SAFE_INTEGER,
  initial = initialSemanticState(),
): SemanticState {
  return reduceEvents(
    orderedEvents(events).filter((e) => e.sequence <= sequence),
    initial,
  );
}
export function significantEvents(events: readonly AnyCoreEvent[]): readonly AnyCoreEvent[] {
  return orderedEvents(events).filter(
    (e) =>
      e.type === 'telemetry.gap' ||
      e.type === 'session.ended' ||
      e.type === 'turn.quiescent' ||
      e.type === 'turn.finished' ||
      e.type === 'task.completion.requested' ||
      e.type.endsWith('.completed') ||
      e.type.endsWith('.failed') ||
      e.type.includes('corrected') ||
      e.type === 'task.denied' ||
      e.type === 'task.cancelled' ||
      e.type === 'task.abandoned',
  );
}
export function buildReplayIndex(
  events: readonly AnyCoreEvent[],
  options: ReplayOptions = {},
): readonly ReplayIndexEntry[] {
  const significant = new Set(significantEvents(events).map((event) => event.eventId));
  return replay(events, options).map((frame) => ({
    eventId: frame.event.eventId,
    sequence: frame.event.sequence,
    semanticTime: frame.semanticTime,
    significant: significant.has(frame.event.eventId),
  }));
}
export const replayIndex = buildReplayIndex;
/** Returns the current canonical live edge without consulting native agent state. */
export function liveEdge(
  events: readonly AnyCoreEvent[],
  options: ReplayOptions = {},
  initial = initialSemanticState(),
): ReplayFrame | undefined {
  return replay(events, { ...options, liveEdge: true }, initial).at(-1);
}
/** Return the state at a sequence, retaining canonical-only replay semantics. */
export const seekReplay = replayTo;
