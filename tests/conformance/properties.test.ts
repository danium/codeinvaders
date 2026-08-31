import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  canonicalizeState,
  serializeCanonicalState,
  validateEvent,
  type AnyCoreEvent,
  type CoreEventType,
} from '../../packages/protocol/src/index.js';
import {
  validEventFixture,
  coreEventFixtureTypes,
} from '../../packages/protocol/src/fixtures/index.js';
import {
  EventJournal,
  initialSemanticState,
  reduceEvents,
  readSnapshot,
  makeSnapshot,
  serializeSnapshot,
} from '../../packages/core/src/index.js';
import {
  OWNERSHIP_MARKER,
  composeJsonConfig,
  composeTomlConfig,
  parseConfig,
  removeOwnedConfig,
} from '../../packages/cli/src/index.js';

const event = (type: CoreEventType, id: string, sequence = 1): AnyCoreEvent =>
  ({ ...validEventFixture(type), eventId: id, sequence }) as unknown as AnyCoreEvent;

/** Small deterministic PRNG keeps property coverage reproducible in CI. */
function* pseudoRandom(seed: number): Generator<number> {
  let state = seed >>> 0;
  while (true) {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    yield ((state ^ (state >>> 14)) >>> 0) / 0x1_0000_0000;
  }
}

describe('conformance property checks', () => {
  it('schema validation is total and deterministic over malformed mutations', () => {
    const base = validEventFixture('session.started');
    const random = pseudoRandom(0xc0de);
    const mutations: unknown[] = [
      null,
      undefined,
      0,
      'native-input',
      [],
      { ...base, type: 'unknown.event' },
      { ...base, version: '9.0.0' },
      { ...base, scope: null },
      { ...base, data: { resume: 'not-a-boolean' } },
    ];
    for (let index = 0; index < 64; index += 1) {
      const value = (
        index % 2 === 0 ? { ...base, eventId: `event-${index}` } : { ...base }
      ) as Record<string, unknown>;
      if ((random.next().value as number) > 0.5) value.data = { resume: index };
      mutations.push(value);
    }
    for (const candidate of mutations) {
      let first: unknown;
      let second: unknown;
      expect(() => {
        first = validateEvent(candidate);
        second = validateEvent(candidate);
      }).not.toThrow();
      expect(second).toEqual(first);
    }
    for (const type of coreEventFixtureTypes) {
      expect(validateEvent(validEventFixture(type)).status).toBe('accepted');
    }
  });

  it('reducer output is deterministic and duplicate-safe for generated event streams', () => {
    const random = pseudoRandom(0x51a7e);
    const events = Array.from({ length: 48 }, (_, index) => {
      const type: CoreEventType =
        index % 3 === 0 ? 'tool.started' : index % 3 === 1 ? 'tool.completed' : 'telemetry.gap';
      const value = event(type, `generated-${index}`, index + 1);
      const mutable = value as unknown as {
        scope: Record<string, unknown>;
        data: Record<string, unknown>;
      };
      if (type === 'tool.started' || type === 'tool.completed') {
        mutable.scope = { ...value.scope, turnId: 'turn-1', operationId: `operation-${index}` };
      }
      if (type === 'telemetry.gap' && (random.next().value as number) > 0.5)
        mutable.data = { fromSequence: index, toSequence: index + 1, reason: 'dropped' };
      return value;
    });
    const once = reduceEvents(events);
    const twice = reduceEvents(events);
    const withDuplicate = reduceEvents([...events, events[10]!]);
    expect(serializeCanonicalState(once)).toBe(serializeCanonicalState(twice));
    expect(serializeCanonicalState(withDuplicate)).toBe(serializeCanonicalState(once));
    expect(once.lastSequence).toBe(events.length);
    expect(initialSemanticState()).toEqual(initialSemanticState());
  });

  it('canonical serialization is independent of insertion order and sorts entity collections', () => {
    const left = {
      z: 1,
      a: true,
      entities: [
        { id: 'entity-b', status: 'b' },
        { id: 'entity-a', status: 'a' },
      ],
    };
    const right = {
      entities: [
        { status: 'a', id: 'entity-a' },
        { status: 'b', id: 'entity-b' },
      ],
      a: true,
      z: 1,
    };
    const options = { entityCollections: [{ path: ['entities'], idKey: 'id' }] } as const;
    expect(serializeCanonicalState(left, options)).toBe(serializeCanonicalState(right, options));
    expect(canonicalizeState(left, options)).toEqual(canonicalizeState(right, options));
    expect(serializeCanonicalState({ value: -0 })).toBe('{"value":0}');
  });

  it('journal recovery preserves complete prefixes and ignores partial/corrupt suffixes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeinvaders-conformance-'));
    try {
      const journal = new EventJournal({ root, streamId: 'stream-1', segmentBytes: 1024 });
      await journal.append(event('session.started', 'recovery-prefix'));
      const segment = join(root, 'segment-00000000.jsonl');
      const prefix = await readFile(segment, 'utf8');
      await writeFile(segment, `${prefix}{"partial":`, 'utf8');
      const restarted = new EventJournal({ root, streamId: 'stream-1' });
      expect(await restarted.events()).toMatchObject({
        ok: true,
        value: [expect.objectContaining({ eventId: 'recovery-prefix' })],
      });
      expect(await restarted.append(event('session.started', 'recovery-prefix'))).toMatchObject({
        ok: true,
        value: { duplicate: true, sequence: 1 },
      });
      await writeFile(segment, `${prefix}not-json\n`, 'utf8');
      const recoveredAgain = new EventJournal({ root, streamId: 'stream-1' });
      expect(await recoveredAgain.events()).toMatchObject({
        ok: true,
        value: [expect.objectContaining({ eventId: 'recovery-prefix' })],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('snapshot serialization and compatibility checks are deterministic', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeinvaders-snapshot-'));
    try {
      const snapshot = makeSnapshot(
        reduceEvents([event('session.started', 'snapshot')]),
        'stream-1',
      );
      expect(serializeSnapshot(snapshot)).toBe(serializeSnapshot(snapshot));
      const path = join(root, 'snapshot.json');
      await writeFile(path, serializeSnapshot(snapshot), 'utf8');
      expect((await readSnapshot(path, 'stream-1')).ok).toBe(true);
      expect((await readSnapshot(path, 'stream-other')).ok).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('composes owned JSON/TOML hooks without replacing unrelated configuration', () => {
    const beforeJson = JSON.stringify({
      hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'user-hook' }] }] },
      unrelated: { keep: true },
    });
    const json = composeJsonConfig(beforeJson, 'codex', 'C:/isolated-hooks');
    expect(json.changed).toBe(true);
    expect(json.added).toBeGreaterThan(0);
    expect(json.after).toContain('user-hook');
    expect(json.after).toContain(OWNERSHIP_MARKER);
    expect(composeJsonConfig(json.after, 'codex', 'C:/isolated-hooks').added).toBe(0);
    const parsed = parseConfig(json.after, 'json');
    expect(parsed.valid).toBe(true);
    expect(removeOwnedConfig(json.after, 'json', 'codex').after).toContain('user-hook');

    const beforeToml = '# unrelated\n[agent]\nmode = "safe"\n';
    const toml = composeTomlConfig(beforeToml, 'claude', 'C:/isolated-hooks');
    expect(toml.after).toContain('# unrelated');
    expect(toml.after).toContain(OWNERSHIP_MARKER);
    expect(composeTomlConfig(toml.after, 'claude', 'C:/isolated-hooks').removed).toBe(1);
    expect(removeOwnedConfig(toml.after, 'toml', 'claude').after).toContain('[agent]');
  });

  it('keeps malformed configuration composition fail-closed and deterministic', () => {
    for (const input of ['{not-json', '[]']) {
      const json = composeJsonConfig(input, 'codex', 'C:/isolated-hooks');
      expect(json.changed).toBe(false);
      expect(json.after).toBe(input);
      expect(parseConfig(input, 'json').valid).toBe(false);
    }
    for (const input of ['\0', 'unterminated "quote']) {
      const toml = composeTomlConfig(input, 'claude', 'C:/isolated-hooks');
      expect(toml.changed).toBe(false);
      expect(toml.after).toBe(input);
    }
  });
});
