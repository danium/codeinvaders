import { describe, expect, it } from 'vitest';
import type { AnyCoreEvent } from '../../packages/protocol/src/index.js';
import { initialSemanticState, reduceEvents, replayTo } from '../../packages/core/src/index.js';
import { ArenaModel } from '../../apps/local/src/arena.js';
import { mapEvents, mapTransition } from '../../apps/local/src/mapper.js';

const event = (
  eventId: string,
  type: string,
  sequence: number,
  scope: Record<string, string> = {},
  data: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
): AnyCoreEvent =>
  ({
    spec: 'io.github.danium.codeinvaders.aap',
    version: '1.0.0',
    eventId,
    type,
    occurredAt: new Date(1_700_000_000_000 + sequence).toISOString(),
    observedAt: new Date(1_700_000_000_000 + sequence).toISOString(),
    sequence,
    source: {
      adapterId: 'visual-fixture',
      adapterVersion: '0.1.0',
      streamId: 'visual-stream',
      epochId: 'visual-epoch',
    },
    scope: { workspaceId: 'visual-workspace', sessionId: 'visual-session', ...scope },
    fidelity: 'observed',
    finality: 'confirmed',
    data,
    ...extra,
  }) as AnyCoreEvent;

describe('semantic visualization fixtures', () => {
  it('keeps parallel tools attached to one carrier without semantic drops', () => {
    const events = [
      event('carrier', 'session.started', 1),
      event(
        'tool-a',
        'tool.started',
        2,
        { operationId: 'operation-a' },
        { name: 'Read', category: 'read' },
      ),
      event(
        'tool-b',
        'tool.started',
        3,
        { operationId: 'operation-b' },
        { name: 'Edit', category: 'edit' },
      ),
      event(
        'tool-c',
        'tool.started',
        4,
        { operationId: 'operation-c' },
        { name: 'Test', category: 'test' },
      ),
    ];
    const state = reduceEvents(events);
    const intents = mapEvents(events, initialSemanticState(), (previous, current) =>
      reduceEvents([current], previous),
    );
    expect(Object.keys(state.rootAgents)).toHaveLength(1);
    expect(intents.filter((intent) => intent.kind === 'tool-charge')).toHaveLength(3);
    expect(
      new Set(
        intents.filter((intent) => intent.kind === 'tool-charge').map((intent) => intent.entityId),
      ),
    ).toHaveLength(3);
  });

  it('preserves nested subagent parentage and every task terminal outcome', () => {
    const spawned = [
      event('root', 'session.started', 1),
      event(
        'agent-1',
        'agent.spawned',
        2,
        { agentId: 'agent-1' },
        { role: 'orchestrator', depth: 1 },
        { links: { parentAgentId: 'root:visual-session' } },
      ),
      event(
        'agent-2',
        'agent.spawned',
        3,
        { agentId: 'agent-2' },
        { role: 'worker', depth: 2 },
        { links: { parentAgentId: 'agent-1' } },
      ),
      event(
        'agent-3',
        'agent.spawned',
        4,
        { agentId: 'agent-3' },
        { role: 'tester', depth: 3 },
        { links: { parentAgentId: 'agent-2' } },
      ),
    ];
    const nestedIntents = mapEvents(spawned, initialSemanticState(), (previous, current) =>
      reduceEvents([current], previous),
    );
    expect(
      nestedIntents
        .filter((intent) => intent.kind === 'child-ship')
        .map((intent) => intent.parentId),
    ).toEqual(['root:visual-session', 'agent-1', 'agent-2']);
    const terminals = [
      ['completed', { completion: 'observed' }, 'success-impact'],
      ['failed', {}, 'failure'],
      ['denied', { reason: 'policy' }, 'denial'],
      ['abandoned', { reason: 'timeout' }, 'abandonment'],
      ['cancelled', { reason: 'user' }, 'retreat'],
    ] as const;
    const terminalEvents = terminals.map(([status, data], index) =>
      event(`task-${status}`, `task.${status}`, index + 10, { taskId: `task-${status}` }, data),
    );
    const terminalIntents = mapEvents(terminalEvents, initialSemanticState(), (previous, current) =>
      reduceEvents([current], previous),
    );
    expect(new Set(terminalIntents.map((intent) => intent.kind))).toEqual(
      new Set(terminals.map(([, , kind]) => kind)),
    );
    expect(terminalIntents.every((intent) => intent.terminal && !intent.reversible)).toBe(true);
    const unknownAfterSessionEnd = reduceEvents([
      event(
        'task-open',
        'task.created',
        30,
        { taskId: 'task-open' },
        { status: 'in_progress', fallback: false },
      ),
      event('session-close', 'session.ended', 31, {}, { reason: 'normal' }),
    ]);
    expect(unknownAfterSessionEnd.tasks['task-open']?.status).toBe('unknown');
  });

  it('represents permission decisions and telemetry degradation as explicit intents', () => {
    const events = [
      event(
        'permission-request',
        'permission.requested',
        1,
        { permissionId: 'permission-1' },
        { category: 'execute', riskClass: 'execute' },
      ),
      event(
        'permission-denied',
        'permission.resolved',
        2,
        { permissionId: 'permission-1' },
        { outcome: 'denied' },
      ),
      event('gap', 'telemetry.gap', 3, {}, { fromSequence: 2, toSequence: 5, reason: 'dropped' }),
      event(
        'capability',
        'source.capability.changed',
        4,
        {},
        {
          capabilities: {
            signals: {
              sessions: { availability: 'available' },
              tools: { availability: 'partial' },
            },
          },
        },
      ),
    ];
    const state = reduceEvents(events);
    const intents = mapEvents(events, initialSemanticState(), (previous, current) =>
      reduceEvents([current], previous),
    );
    expect(state.gaps).toHaveLength(1);
    expect(state.diagnostics).toContain('telemetry-gap');
    expect(state.sources['visual-session']).toMatchObject({ availability: 'partial' });
    expect(intents.map((intent) => intent.kind)).toEqual([
      'permission-lock',
      'denial',
      'telemetry-gap',
      'capability',
    ]);
  });

  it('keeps replay seeks semantically equivalent and preserves reduced-motion state', () => {
    const events = [
      event('session', 'session.started', 1),
      event(
        'task',
        'task.created',
        2,
        { taskId: 'task-1' },
        { status: 'in_progress', fallback: false, label: 'task' },
      ),
      event('complete', 'task.completed', 3, { taskId: 'task-1' }, { completion: 'observed' }),
    ];
    const live = reduceEvents(events);
    expect(replayTo(events, 2).tasks['task-1']?.status).toBe('in_progress');
    expect(replayTo(events, 3).tasks['task-1']?.status).toBe(live.tasks['task-1']?.status);
    const model = new ArenaModel({ maxEffects: 300, reducedMotion: true });
    for (const intent of mapEvents(events, initialSemanticState(), (previous, current) =>
      reduceEvents([current], previous),
    ))
      model.apply(intent);
    expect(model.snapshot().reducedMotion).toBe(true);
    expect(model.snapshot().entities.find((entity) => entity.id === 'task-1')?.visible).toBe(false);
  });

  it('maps each task state transition to a stable semantic identity', () => {
    const before = initialSemanticState();
    const next = reduceEvents([
      event(
        'task',
        'task.created',
        1,
        { taskId: 'task-1' },
        { status: 'in_progress', fallback: false },
      ),
    ]);
    const intent = mapTransition({
      previous: before,
      next,
      event: event(
        'task',
        'task.created',
        1,
        { taskId: 'task-1' },
        { status: 'in_progress', fallback: false },
      ),
    })[0];
    expect(intent?.entityId).toBe('task-1');
    expect(intent?.priority).toBe('semantic');
  });

  it('preserves task assignment as a structural ship relationship', () => {
    const events = [
      event(
        'task-created',
        'task.created',
        1,
        { taskId: 'task-1' },
        { status: 'pending', fallback: false, ordinal: 0 },
      ),
      event(
        'task-assigned',
        'task.assigned',
        2,
        { taskId: 'task-1' },
        { assigneeAgentId: 'agent-1' },
      ),
    ];
    const state = reduceEvents(events);
    const intents = mapEvents(events, initialSemanticState(), (previous, current) =>
      reduceEvents([current], previous),
    );
    expect(state.tasks['task-1']?.assigneeAgentId).toBe('agent-1');
    expect(intents.at(-1)).toMatchObject({
      kind: 'task',
      entityId: 'task-1',
      parentId: 'agent-1',
    });
  });

  it('shows resumed work and abandons open operations when a session seals', () => {
    const events = [
      event('turn', 'turn.started', 1, { turnId: 'turn-1' }, {}),
      event('quiet', 'turn.quiescent', 2, { turnId: 'turn-1' }, { reason: 'native' }),
      event(
        'tool',
        'tool.started',
        3,
        { turnId: 'turn-1', operationId: 'operation-1' },
        { name: 'Read', category: 'read' },
      ),
      event('ended', 'session.ended', 4, {}, { reason: 'normal' }),
    ];
    const intents = mapEvents(events, initialSemanticState(), (previous, current) =>
      reduceEvents([current], previous),
    );
    expect(intents.some((intent) => intent.kind === 'resumed')).toBe(true);
    expect(intents).toContainEqual(
      expect.objectContaining({
        kind: 'abandonment',
        entityId: 'operation-1',
        status: 'session-ended',
      }),
    );
  });
});
