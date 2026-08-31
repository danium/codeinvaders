import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validEventFixture } from '../../packages/protocol/src/fixtures/index.js';
import { orderedEvents, reduceEvents } from '../../packages/core/src/index.js';
import type { AnyCoreEvent, CoreEventType } from '../../packages/protocol/src/index.js';

const catalog = JSON.parse(
  readFileSync(resolve(process.cwd(), 'fixtures/conformance/core-scenarios.json'), 'utf8'),
) as {
  readonly version: number;
  readonly scenarios: readonly {
    name: string;
    events: readonly CoreEventType[];
    expected: string;
  }[];
};

const makeEvent = (type: CoreEventType, id: string, sequence: number): AnyCoreEvent =>
  ({ ...validEventFixture(type), eventId: id, sequence }) as unknown as AnyCoreEvent;

function scopedEvent(
  type: CoreEventType,
  id: string,
  sequence: number,
  extra: Record<string, string>,
  data?: Record<string, unknown>,
): AnyCoreEvent {
  const result = makeEvent(type, id, sequence);
  return {
    ...result,
    scope: { ...result.scope, ...extra },
    ...(data === undefined ? {} : { data }),
  } as AnyCoreEvent;
}

describe('AAP semantic golden scenarios', () => {
  it('loads the shared core scenario catalog', () => {
    expect(catalog.version).toBe(1);
    expect(catalog.scenarios).toHaveLength(8);
  });

  it('creates exactly one fallback objective for tools-only work', () => {
    const state = reduceEvents([
      scopedEvent('turn.started', 'fallback-turn', 1, { turnId: 'turn-fallback' }),
      scopedEvent('tool.started', 'fallback-tool', 2, {
        turnId: 'turn-fallback',
        operationId: 'operation-fallback',
      }),
    ]);
    expect(Object.keys(state.tasks)).toHaveLength(0);
    expect(Object.keys(state.fallbackObjectives)).toEqual(['fallback:turn-fallback']);
  });

  it('keeps terminal cancellation monotonic and does not turn a later duplicate into success', () => {
    const state = reduceEvents([
      scopedEvent('task.created', 'task-create', 1, { taskId: 'task-cancel' }),
      scopedEvent('task.cancelled', 'task-cancel-event', 2, { taskId: 'task-cancel' }),
      scopedEvent('task.completed', 'task-late-complete', 3, { taskId: 'task-cancel' }),
    ]);
    expect(state.tasks['task-cancel']?.status).toBe('cancelled');
  });

  it('keeps parallel operations independently attributable', () => {
    const state = reduceEvents([
      scopedEvent('tool.requested', 'parallel-a', 1, { operationId: 'operation-a' }),
      scopedEvent('tool.requested', 'parallel-b', 2, { operationId: 'operation-b' }),
    ]);
    expect(state.operations).toMatchObject({
      'operation-a': { status: 'active' },
      'operation-b': { status: 'active' },
    });
  });

  it('preserves nested agent state and structural roots', () => {
    const state = reduceEvents([
      makeEvent('session.started', 'root-start', 1),
      scopedEvent('agent.spawned', 'agent-spawn', 2, { agentId: 'agent-nested' }),
      scopedEvent('agent.state.changed', 'agent-work', 3, { agentId: 'agent-nested' }),
    ]);
    expect(state.rootAgents['root:session-1']?.structural).toBe(true);
    expect(state.agents['agent-nested']?.state).toBe('working');
  });

  it('records permission denial, tool failure, and telemetry gaps distinctly', () => {
    const state = reduceEvents([
      scopedEvent('permission.requested', 'permission-request', 1, {
        permissionId: 'permission-1',
      }),
      scopedEvent(
        'permission.resolved',
        'permission-denied',
        2,
        { permissionId: 'permission-1' },
        { outcome: 'denied' },
      ),
      scopedEvent('tool.failed', 'failure', 3, { operationId: 'operation-failure' }),
      makeEvent('telemetry.gap', 'gap', 4),
    ]);
    expect(state.permissions['permission-1']?.status).toBe('denied');
    expect(state.operations['operation-failure']?.status).toBe('failed');
    expect(state.gaps).toHaveLength(1);
  });

  it('uses deterministic ordering and removes duplicate event IDs before reduction', () => {
    const first = makeEvent('session.started', 'duplicate', 1);
    const duplicate = { ...first, sequence: 9 } as AnyCoreEvent;
    const unique = makeEvent('session.ended', 'unique', 2);
    const ordered = orderedEvents([unique, duplicate, first]);
    expect(ordered.map((event) => event.eventId)).toEqual(['duplicate', 'unique']);
    expect(reduceEvents(ordered).sessions['session-1']?.status).toBe('sealed');
  });
});
