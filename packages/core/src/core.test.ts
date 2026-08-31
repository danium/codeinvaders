import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validEventFixture } from '@codeinvaders/protocol/fixtures';
import type { AnyCoreEvent, CoreEventType } from '@codeinvaders/protocol';
import {
  EventJournal,
  initialSemanticState,
  reduceEvents,
  replay,
  orderedEvents,
  canonicalizeIngress,
  recoverPendingSpool,
  makeSnapshot,
  readSnapshot,
  readSnapshotOrRebuild,
  serializeSnapshot,
  writeSnapshot,
  safeDeleteOwned,
  verifyOwnedPath,
  buildReplayIndex,
} from './index.js';

const event = (type: CoreEventType, id: string, sequence = 1): AnyCoreEvent =>
  ({ ...validEventFixture(type), eventId: id, sequence }) as unknown as AnyCoreEvent;

describe('canonical core', () => {
  it('rejects native input safely and deduplicates concurrent appends across restart', async () => {
    expect(canonicalizeIngress({ nativeError: 'secret' })).toEqual({
      ok: false,
      code: 'invalid-ingress',
    });
    const root = await mkdtemp(join(tmpdir(), 'codeinvaders-core-'));
    try {
      const journal = new EventJournal({ root, streamId: 'stream-1', segmentBytes: 1024 });
      const results = await Promise.all([
        journal.append(event('session.started', 'same')),
        journal.append(event('session.started', 'same')),
      ]);
      expect(results.filter((x) => x.ok && !x.value.duplicate)).toHaveLength(1);
      const restarted = new EventJournal({ root, streamId: 'stream-1' });
      const duplicate = await restarted.append(event('session.started', 'same'));
      expect(duplicate).toMatchObject({ ok: true, value: { duplicate: true, sequence: 1 } });
      const foreignStream = {
        ...event('session.started', 'foreign'),
        source: { ...event('session.started', 'foreign-source').source, streamId: 'stream-2' },
      } as AnyCoreEvent;
      expect(await restarted.append(foreignStream)).toEqual({
        ok: false,
        code: 'invalid-ingress',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('keeps valid prefix, makes replay ordering and reducer terminal state deterministic', () => {
    const first = event('task.created', 'a', 1);
    const done = event('task.completed', 'b', 2);
    const failed = event('task.failed', 'c', 3);
    const events = [first, done, failed] as const;
    expect(orderedEvents([done, first, done]).map((x) => x.eventId)).toEqual(['a', 'b']);
    const live = reduceEvents(events);
    const replayed = replay(events).at(-1)?.state;
    expect(replayed).toEqual(live);
    expect(live.tasks['task-1']?.status).toBe('completed');
    expect(reduceEvents([first, failed, done]).tasks['task-1']?.status).toBe('failed');
    expect(initialSemanticState().lastSequence).toBe(0);
  });

  it('rotates bounded JSONL, assigns stream order, and acknowledges duplicate retries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeinvaders-core-'));
    try {
      const journal = new EventJournal({ root, streamId: 'stream-1', segmentBytes: 1024 });
      const results = await Promise.all(
        Array.from({ length: 24 }, (_, i) => journal.append(event('session.started', `e-${i}`))),
      );
      expect(results.every((x) => x.ok)).toBe(true);
      const sequences = results
        .flatMap((x) => (x.ok ? [x.value.sequence] : []))
        .sort((a, b) => a - b);
      expect(sequences).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
      expect(
        (await readdir(root)).filter((name) => name.endsWith('.jsonl')).length,
      ).toBeGreaterThan(1);
      const journalEvents = await journal.events();
      expect(journalEvents.ok).toBe(true);
      if (journalEvents.ok) expect(journalEvents.value).toHaveLength(24);
      expect(await journal.append(event('session.started', 'e-3'))).toMatchObject({
        ok: true,
        value: { duplicate: true, sequence: 4 },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('repairs missing/corrupt manifests and partial or corrupt suffixes without losing a prefix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeinvaders-core-'));
    try {
      const first = new EventJournal({ root, streamId: 'stream-1' });
      await first.append(event('session.started', 'prefix'));
      const segment = join(root, 'segment-00000000.jsonl');
      const original = await readFile(segment, 'utf8');
      await writeFile(segment, `${original}{"partial":`, 'utf8');
      await writeFile(join(root, 'manifest.json'), '{not-json', 'utf8');
      const recovered = new EventJournal({ root, streamId: 'stream-1' });
      const repairedEvents = await recovered.events();
      expect(repairedEvents.ok).toBe(true);
      if (repairedEvents.ok) expect(repairedEvents.value.map((x) => x.eventId)).toEqual(['prefix']);
      const duplicate = await recovered.append(event('session.started', 'prefix'));
      expect(duplicate).toMatchObject({ ok: true, value: { duplicate: true, sequence: 1 } });
      await writeFile(segment, `${original}not-json\n`, 'utf8');
      const recoveredAgain = new EventJournal({ root, streamId: 'stream-1' });
      const repairedAgain = await recoveredAgain.events();
      expect(repairedAgain.ok).toBe(true);
      if (repairedAgain.ok) expect(repairedAgain.value.map((x) => x.eventId)).toEqual(['prefix']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('retires pending spool files only after durable append and leaves invalid records', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeinvaders-core-'));
    const spool = join(root, 'spool');
    await mkdir(spool);
    try {
      await writeFile(
        join(spool, '001.pending'),
        JSON.stringify(event('session.started', 'spooled')),
        'utf8',
      );
      await writeFile(
        join(spool, '002.pending'),
        JSON.stringify({ nativeTranscript: 'secret' }),
        'utf8',
      );
      const result = await recoverPendingSpool(
        spool,
        new EventJournal({ root: join(root, 'journal'), streamId: 'stream-1' }),
      );
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ ok: true, value: { sequence: 1 } });
      expect(result[1]).toEqual({ ok: false, code: 'invalid-ingress' });
      expect((await readdir(spool)).sort()).toEqual(['001.pending.retired', '002.pending']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('recovers SDK .ingress records with their committed newline framing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeinvaders-core-'));
    const spool = join(root, 'spool');
    await mkdir(spool);
    try {
      await writeFile(
        join(spool, 'event.ingress'),
        `${JSON.stringify(event('session.started', 'sdk-spooled'))}\n`,
        'utf8',
      );
      const result = await recoverPendingSpool(
        spool,
        new EventJournal({ root: join(root, 'journal'), streamId: 'stream-1' }),
      );
      expect(result).toEqual([
        { ok: true, value: { eventId: 'sdk-spooled', sequence: 1, duplicate: false } },
      ]);
      expect(await readdir(spool)).toEqual(['event.ingress.retired']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('models resumable turns, conservative terminals, roots, and one fallback objective immutably', () => {
    const started = event('turn.started', 'turn-start', 1);
    const quiet = event('turn.quiescent', 'turn-quiet', 2);
    const tool = {
      ...event('tool.started', 'tool', 3),
      scope: { ...event('turn.started', 'x').scope, turnId: 'turn-1', operationId: 'op-1' },
    } as unknown as AnyCoreEvent;
    const finished = event('turn.finished', 'turn-finished', 4);
    const state1 = reduceEvents([started, quiet, tool]);
    expect(state1.turns['turn-1']?.status).toBe('active');
    expect(Object.keys(state1.fallbackObjectives)).toEqual(['fallback:turn-1']);
    expect(Object.keys(state1.tasks)).toHaveLength(0);
    const before = JSON.stringify(state1);
    const state2 = reduceEvents([finished], state1);
    expect(state2.turns['turn-1']?.status).toBe('sealed');
    expect(JSON.stringify(state1)).toBe(before);
    const created = event('task.created', 'task-created', 5);
    const done = event('task.completed', 'task-done', 6);
    const failed = event('task.failed', 'task-failed', 7);
    const terminals = reduceEvents([
      event('session.started', 'session-root'),
      created,
      done,
      failed,
    ]);
    expect(terminals.tasks['task-1']?.status).toBe('completed');
    expect(terminals.rootAgents['root:session-1']?.structural).toBe(true);
    expect(terminals.agents['root:session-1']).toBeUndefined();
  });

  it('models requested turns and reconciles full plans without false completion', () => {
    const requested = {
      ...event('turn.started', 'requested', 1),
      finality: 'provisional',
    } as unknown as AnyCoreEvent;
    const requestedState = reduceEvents([requested]);
    expect(requestedState.turns['turn-1']?.status).toBe('requested');
    expect(Object.keys(requestedState.fallbackObjectives)).toEqual(['fallback:turn-1']);

    const plan = {
      ...event('task.plan.reconciled', 'plan-1', 2),
      data: {
        revision: 1,
        complete: true,
        items: [
          {
            taskId: 'task-plan-a',
            status: 'in_progress',
            ordinal: 0,
            identityBasis: 'stable-native-id',
          },
        ],
      },
    } as unknown as AnyCoreEvent;
    const first = reduceEvents([plan], requestedState);
    expect(first.tasks['task-plan-a']).toMatchObject({
      status: 'in_progress',
      turnId: 'turn-1',
      provisional: false,
    });
    expect(first.fallbackObjectives['fallback:turn-1']).toBeUndefined();

    const replacement = {
      ...event('task.plan.reconciled', 'plan-2', 3),
      data: {
        revision: 2,
        previousRevision: 1,
        complete: true,
        items: [
          {
            taskId: 'task-plan-b',
            status: 'pending',
            ordinal: 0,
            identityBasis: 'new-unmatched',
          },
        ],
      },
    } as unknown as AnyCoreEvent;
    const second = reduceEvents([replacement], first);
    expect(second.tasks['task-plan-a']?.status).toBe('cancelled');
    expect(second.tasks['task-plan-b']?.status).toBe('pending');

    const tool = {
      ...event('tool.started', 'tool-after-request', 4),
      scope: {
        ...event('tool.started', 'scope').scope,
        turnId: 'turn-1',
        operationId: 'op-after-request',
      },
    } as AnyCoreEvent;
    expect(reduceEvents([tool], requestedState).turns['turn-1']?.status).toBe('active');
  });

  it('writes sorted versioned snapshots and exposes safe incompatible/corrupt rebuild results', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeinvaders-core-'));
    const path = join(root, 'state.snapshot.json');
    try {
      const state = reduceEvents([event('session.started', 'snapshot-event')]);
      const snapshot = makeSnapshot(state, 'stream-1');
      expect(serializeSnapshot(snapshot).indexOf('"protocol"')).toBeGreaterThanOrEqual(0);
      expect((await writeSnapshot(path, snapshot)).ok).toBe(true);
      expect((await readSnapshot(path, 'stream-1')).ok).toBe(true);
      const incompatible = await readSnapshot(path, 'other');
      expect(incompatible.ok).toBe(false);
      if (!incompatible.ok) expect(incompatible.code).toBe('incompatible');
      await writeFile(path, '{bad', 'utf8');
      const corrupt = await readSnapshot(path, 'stream-1');
      expect(corrupt.ok).toBe(false);
      if (!corrupt.ok) expect(corrupt.code).toBe('corrupt');
      const rebuilt = await readSnapshotOrRebuild(path, 'stream-1', [
        event('session.started', 'snapshot-event'),
      ]);
      expect(rebuilt).toMatchObject({ ok: true, value: { throughSequence: 1 } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('replays deterministically with filtering, compressed idle time, index, and stream tie breaks', () => {
    const a = event('session.started', 'a', 1);
    const b = event('task.completed', 'b', 2);
    const later = {
      ...b,
      eventId: 'c',
      source: { ...b.source, streamId: 'stream-0' },
      observedAt: '2026-08-15T14:22:31.127Z',
    } as AnyCoreEvent;
    const frames = replay([b, later, a, a], { speed: 2, compressIdleMs: 10 });
    expect(frames.map((x) => x.event.eventId)).toEqual(['c', 'a', 'b']);
    expect(
      buildReplayIndex([a, b])
        .filter((x) => x.significant)
        .map((x) => x.eventId),
    ).toEqual(['b']);
    expect(replay([a, b], { taskId: 'task-1' })).toHaveLength(1);
    const sequenceFirst = {
      ...a,
      eventId: 'sequence-first',
      observedAt: '2026-08-15T14:22:59.000Z',
      sequence: 1,
    } as AnyCoreEvent;
    const timestampFirst = {
      ...a,
      eventId: 'timestamp-first',
      observedAt: '2026-08-15T14:22:00.000Z',
      sequence: 2,
    } as AnyCoreEvent;
    expect(orderedEvents([timestampFirst, sequenceFirst]).map((x) => x.eventId)).toEqual([
      'sequence-first',
      'timestamp-first',
    ]);
  });

  it('rejects path escapes and symlink deletion attempts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeinvaders-core-'));
    const outside = await mkdtemp(join(tmpdir(), 'codeinvaders-outside-'));
    try {
      expect((await verifyOwnedPath(root, join(root, '..', 'outside'))).ok).toBe(false);
      expect((await safeDeleteOwned(root, join(outside, 'absolute.jsonl'))).ok).toBe(false);
      await writeFile(join(outside, 'secret.jsonl'), 'secret', 'utf8');
      try {
        await symlink(join(outside, 'secret.jsonl'), join(root, 'link.jsonl'));
      } catch {
        return;
      }
      expect((await safeDeleteOwned(root, 'link.jsonl')).ok).toBe(false);
      expect(await readFile(join(outside, 'secret.jsonl'), 'utf8')).toBe('secret');
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('retains a complete current segment and invalidates disposable derived artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeinvaders-core-'));
    try {
      const journal = new EventJournal({ root, streamId: 'stream-1', segmentBytes: 1024 });
      await Promise.all(
        Array.from({ length: 12 }, (_, i) => journal.append(event('session.started', `ret-${i}`))),
      );
      await writeFile(join(root, 'state.snapshot.json'), '{}', 'utf8');
      await writeFile(join(root, 'events.index.json'), '{}', 'utf8');
      expect(await journal.retain(0)).toEqual({ ok: true, value: undefined });
      expect(
        (await readdir(root)).filter(
          (name) => name.endsWith('.snapshot.json') || name.endsWith('.index.json'),
        ),
      ).toEqual([]);
      expect((await journal.events()).ok).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
