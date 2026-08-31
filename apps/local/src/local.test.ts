import { describe, expect, it } from 'vitest';
import type { AnyCoreEvent } from '@codeinvaders/protocol';
import { initialSemanticState, reduce } from '@codeinvaders/core';
import {
  ArenaModel,
  coalesceEffects,
  mapTransition,
  reduceDensity,
  renderAppShell,
  APP_JS,
  ARENA_JS,
  runArenaLoadProfile,
} from './index.js';
import { BrowserSessionStore, isLoopbackHost, secureJsonParse } from './index.js';
import { IpcFrameDecoder, encodeIpcFrame } from './index.js';
import { appDataPaths, readOrCreateSalt } from './index.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const event = (
  type: string,
  sequence: number,
  scope: Record<string, string>,
  data: Record<string, unknown> = {},
): AnyCoreEvent =>
  ({
    spec: 'io.github.danium.codeinvaders.aap',
    version: '0.1.0',
    eventId: `event-${sequence}`,
    type,
    occurredAt: new Date(sequence).toISOString(),
    observedAt: new Date(sequence).toISOString(),
    sequence,
    source: { adapterId: 'test', adapterVersion: '0.1.0', streamId: 'stream', epochId: 'epoch' },
    scope: { workspaceId: 'workspace', sessionId: 'session', ...scope },
    fidelity: 'observed',
    finality: type === 'task.completion.requested' ? 'provisional' : 'confirmed',
    data,
    ...(type === 'task.completion.requested'
      ? { semantic: { kind: 'checkpoint', terminal: false } }
      : {}),
  }) as AnyCoreEvent;

describe('local runtime security', () => {
  it('accepts only loopback hosts and rejects hostile JSON shapes', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('192.168.1.1')).toBe(false);
    expect(() => secureJsonParse('{"a":'.padEnd(300_000, 'x'))).toThrow();
  });
  it('exchanges a one-use launch secret and invalidates stale sessions', () => {
    const store = new BrowserSessionStore();
    const session = store.exchange(store.launchToken);
    expect(session).toBeDefined();
    expect(store.exchange(store.launchToken)).toBeUndefined();
    expect(store.authenticate(session!.token)).toBe(true);
    store.rotate();
    expect(store.authenticate(session!.token)).toBe(false);
  });
  it('decodes SDK CIIP byte-length frames across partial chunks and rejects malformed headers', () => {
    const decoder = new IpcFrameDecoder();
    const frame = encodeIpcFrame('{"event":"é"}');
    expect(decoder.push(frame.subarray(0, 5))).toEqual([]);
    expect(decoder.push(frame.subarray(5))).toEqual(['{"event":"é"}']);
    expect(() => new IpcFrameDecoder().push('JSON\n')).toThrow();
  });
  it('keeps the launch secret out of the HTML response body', () => {
    const html = renderAppShell('secret-value');
    expect(html).not.toContain('secret-value');
    expect(html).toContain('/assets/app.v0.1.0.js');
    expect(html).toContain('Text-only mode');
    expect(APP_JS).toContain("import('/assets/arena.v0.1.0.js')");
    expect(APP_JS).toContain('state.fallbackObjectives');
    expect(ARENA_JS).toContain('THREE.InstancedMesh');
  });
  it('ships parsable browser modules that consume semantic intents without dynamic evaluation', () => {
    expect(() => Function(APP_JS)).not.toThrow();
    const arenaBody = ARENA_JS.replace(/^import[^\n]+\n/, '').replace(
      'export function createArena',
      'function createArena',
    );
    expect(() => Function(arenaBody)).not.toThrow();
    expect(ARENA_JS).toContain('lastIntents');
    expect(ARENA_JS).toContain('parentId');
    expect(APP_JS).not.toContain('eval(');
  });
  it('creates one stable installation salt under concurrent first-hook access', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeinvaders-salt-'));
    try {
      const paths = appDataPaths(root);
      const salts = await Promise.all(Array.from({ length: 8 }, () => readOrCreateSalt(paths)));
      expect(new Set(salts).size).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('semantic mapper and arena', () => {
  it('keeps completion requested reversible and only confirms success on terminal evidence', () => {
    const initial = initialSemanticState();
    const requested = event(
      'task.completion.requested',
      1,
      { taskId: 'task:1' },
      { requestedStatus: 'completed', checkpoint: 'native' },
    );
    const requestedState = reduce(initial, requested);
    const provisional = mapTransition({
      previous: initial,
      next: requestedState,
      event: requested,
    });
    expect(provisional[0]?.kind).toBe('task');
    expect(provisional[0]?.reversible).toBe(true);
    const completed = event('task.completed', 2, { taskId: 'task:1' }, { completion: 'observed' });
    const completedState = reduce(requestedState, completed);
    const terminal = mapTransition({
      previous: requestedState,
      next: completedState,
      event: completed,
    });
    expect(terminal[0]?.kind).toBe('success-impact');
    expect(terminal[0]?.terminal).toBe(true);
  });
  it('preserves semantic intents while bounding/coalescing cosmetic effects', () => {
    const intents = Array.from({ length: 400 }, (_, i) => ({
      version: 1 as const,
      kind: (i === 0 ? 'task' : 'tool-charge') as 'task' | 'tool-charge',
      entityId: i === 0 ? 'task:0' : `op:${i % 4}`,
      semanticTime: i,
      seed: i,
      terminal: false,
      reversible: true,
      priority: i === 0 ? ('semantic' as const) : ('cosmetic' as const),
      text: 'event',
    }));
    const compact = reduceDensity(coalesceEffects(intents), 300);
    expect(compact.some((item) => item.priority === 'semantic')).toBe(true);
    expect(compact.length).toBeLessThanOrEqual(301);
    const model = new ArenaModel({ maxEffects: 300, reducedMotion: true });
    compact.forEach((item) => model.apply(item));
    expect(model.snapshot().effects).toBe(0);
  });
  it('runs the documented 100 entity / 300 effect profile without semantic drops', () => {
    const sample = runArenaLoadProfile(100, 300);
    expect(sample.semanticEntities).toBe(100);
    expect(sample.semanticDrops).toBe(0);
    expect(sample.requestedEffects).toBe(300);
    expect(sample.retainedEffects).toBeLessThanOrEqual(300);
    expect(sample.boundedEffects).toBe(true);
    expect(sample.durationMs).toBeGreaterThanOrEqual(0);
    expect(sample.eventToPresentationMs).toBeGreaterThanOrEqual(0);
  });
  it('sheds a sustained cosmetic storm while retaining every semantic entity', () => {
    const semantic = Array.from({ length: 100 }, (_, index) => ({
      version: 1 as const,
      kind: 'task' as const,
      entityId: `task:${index}`,
      semanticTime: index,
      seed: index,
      terminal: false,
      reversible: true,
      priority: 'semantic' as const,
      text: 'task',
    }));
    const storm = Array.from({ length: 10_000 }, (_, index) => ({
      version: 1 as const,
      kind: 'tool-charge' as const,
      entityId: `operation:${index % 100}`,
      semanticTime: index,
      seed: index,
      terminal: false,
      reversible: true,
      priority: 'cosmetic' as const,
      text: 'tool',
    }));
    const compact = reduceDensity(coalesceEffects([...semantic, ...storm]), 300);
    expect(compact.filter((intent) => intent.priority === 'semantic')).toHaveLength(100);
    expect(compact.length).toBeLessThanOrEqual(300);
    const model = new ArenaModel({ maxEffects: 300 });
    compact.forEach((intent) => model.apply(intent));
    const snapshot = model.snapshot();
    expect(snapshot.entities).toHaveLength(100);
    expect(snapshot.effects).toBeLessThanOrEqual(300);
    model.dispose();
  });
});
