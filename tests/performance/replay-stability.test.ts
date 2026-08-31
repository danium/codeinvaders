import { describe, expect, it } from 'vitest';
import type { AnyCoreEvent } from '../../packages/protocol/src/index.js';
import {
  canonicalizeEvent,
  serializeCanonicalEvent,
  serializeCanonicalState,
  validateEvent,
} from '../../packages/protocol/src/index.js';
import {
  buildReplayIndex,
  initialSemanticState,
  orderedEvents,
  reduceEvents,
  replay,
  replayTo,
} from '../../packages/core/src/index.js';

const makeEvent = (
  sequence: number,
  type: 'session.started' | 'turn.started' | 'tool.started' | 'tool.completed' | 'turn.finished',
): AnyCoreEvent => {
  const scope = {
    workspaceId: 'workspace:stability',
    repoId: 'repo:stability',
    sessionId: 'session:stability',
    ...(type !== 'session.started' && { turnId: 'turn:stability' }),
    ...((type === 'tool.started' || type === 'tool.completed') && {
      operationId: `operation:${sequence}`,
    }),
  };
  const data =
    type === 'session.started'
      ? { resume: false }
      : type === 'turn.finished'
        ? { outcome: 'completed' }
        : type === 'tool.completed'
          ? {
              name: `tool-${sequence}`,
              category: 'test',
              durationMs: sequence,
              resultClass: 'success',
            }
          : type === 'tool.started'
            ? { name: `tool-${sequence}`, category: 'test' }
            : { objectiveLabel: `objective-${sequence}` };
  return canonicalizeEvent({
    spec: 'io.github.danium.codeinvaders.aap',
    version: '1.0.0',
    eventId: `stability-event-${sequence}`,
    type,
    occurredAt: new Date(1_700_000_000_000 + sequence * 17).toISOString(),
    observedAt: new Date(1_700_000_000_000 + sequence * 17).toISOString(),
    sequence,
    source: {
      adapterId: 'stability-test',
      adapterVersion: '0.1.0',
      streamId: 'stability-stream',
      epochId: 'stability-epoch',
    },
    scope,
    fidelity: 'observed',
    finality: 'confirmed',
    data,
  }) as AnyCoreEvent;
};

const dataset = (): AnyCoreEvent[] => {
  const events: AnyCoreEvent[] = [makeEvent(1, 'session.started')];
  for (let index = 0; index < 96; index++) {
    const sequence = index * 3 + 2;
    events.push(makeEvent(sequence, 'turn.started'));
    events.push(makeEvent(sequence + 1, 'tool.started'));
    events.push(makeEvent(sequence + 2, 'tool.completed'));
  }
  events.push(makeEvent(400, 'turn.finished'));
  return events;
};

const shuffled = <T>(input: readonly T[], seed: number): T[] => {
  const output = [...input];
  let value = seed >>> 0;
  for (let index = output.length - 1; index > 0; index--) {
    value = (value * 1_664_525 + 1_013_904_223) >>> 0;
    const swap = value % (index + 1);
    [output[index], output[swap]] = [output[swap]!, output[index]!];
  }
  return output;
};

describe('deterministic replay and bounded event properties', () => {
  it('replays a large shuffled/duplicated journal to the same canonical state', () => {
    const source = dataset();
    const live = reduceEvents(orderedEvents(source));
    const expected = serializeCanonicalState(live);
    for (let seed = 1; seed <= 32; seed++) {
      const input = shuffled([...source, source[12]!, source[12]!, source[0]!], seed);
      const frames = replay(input);
      expect(frames).toHaveLength(source.length);
      expect(serializeCanonicalState(frames.at(-1)!.state)).toBe(expected);
      expect(orderedEvents(input).map((event) => event.eventId)).toEqual(
        source.map((event) => event.eventId),
      );
    }
  });

  it('keeps canonical event bytes stable under repeated normalization and permutation', () => {
    const source = dataset();
    const baseline = source.map(serializeCanonicalEvent);
    for (let seed = 1; seed <= 16; seed++) {
      const normalized = shuffled(source, seed).map((event) => serializeCanonicalEvent(event));
      expect(new Set(normalized)).toEqual(new Set(baseline));
    }
    expect(validateEvent({ malformed: true }).status).toBe('rejected');
    expect(validateEvent({ ...source[0], data: { resume: 'yes' } }).status).toBe('rejected');
  });

  it('makes every seek point agree with a prefix replay and marks stable index entries', () => {
    const source = dataset();
    const index = buildReplayIndex(source);
    expect(index).toHaveLength(source.length);
    expect(index.map((entry) => entry.sequence)).toEqual(source.map((event) => event.sequence));
    for (const sequence of [1, 2, 25, 100, 250, 400]) {
      const prefix = source.filter((event) => event.sequence <= sequence);
      expect(serializeCanonicalState(replayTo(source, sequence))).toBe(
        serializeCanonicalState(reduceEvents(prefix, initialSemanticState())),
      );
    }
  });
});
