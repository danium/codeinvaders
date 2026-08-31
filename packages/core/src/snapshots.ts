import { open, readFile, rename, writeFile } from 'node:fs/promises';
import {
  canonicalizeState,
  serializeCanonicalState,
  type AnyCoreEvent,
} from '@codeinvaders/protocol';
import type { SemanticState } from './reducer.js';
import { reduceEvents, initialSemanticState } from './reducer.js';

export const SNAPSHOT_PROTOCOL = 'io.github.danium.codeinvaders.aap@1.0.0' as const;
export const SNAPSHOT_SCHEMA = '1' as const;
export interface Snapshot {
  readonly protocol: typeof SNAPSHOT_PROTOCOL;
  readonly reducer: string;
  readonly schema: typeof SNAPSHOT_SCHEMA;
  readonly streamId: string;
  readonly throughSequence: number;
  readonly state: SemanticState;
}
export type SnapshotResult =
  | { readonly ok: true; readonly value: Snapshot }
  | { readonly ok: false; readonly code: 'unavailable' | 'incompatible' | 'corrupt' };

const stateLooksValid = (state: unknown, sequence: number): state is SemanticState => {
  if (!state || typeof state !== 'object') return false;
  const x = state as Record<string, unknown>;
  return (
    x.lastSequence === sequence &&
    [x.sources, x.sessions, x.turns, x.agents, x.tasks, x.operations, x.permissions].every(
      (v) => !!v && typeof v === 'object' && !Array.isArray(v),
    ) &&
    !!x.rootAgents &&
    typeof x.rootAgents === 'object' &&
    !Array.isArray(x.rootAgents) &&
    !!x.fallbackObjectives &&
    typeof x.fallbackObjectives === 'object' &&
    !Array.isArray(x.fallbackObjectives) &&
    Array.isArray(x.gaps) &&
    Array.isArray(x.diagnostics)
  );
};

export function makeSnapshot(state: SemanticState, streamId: string, reducer = '1'): Snapshot {
  return {
    protocol: SNAPSHOT_PROTOCOL,
    reducer,
    schema: SNAPSHOT_SCHEMA,
    streamId,
    throughSequence: state.lastSequence,
    state: canonicalizeState(state) as unknown as SemanticState,
  };
}
export function serializeSnapshot(snapshot: Snapshot): string {
  return serializeCanonicalState(snapshot);
}

/** Atomically writes a complete, canonically serialized snapshot. */
export async function writeSnapshot(path: string, snapshot: Snapshot): Promise<SnapshotResult> {
  try {
    const temp = `${path}.tmp`;
    await writeFile(temp, serializeSnapshot(snapshot), 'utf8');
    const handle = await open(temp, 'r+');
    await handle.sync();
    await handle.close();
    await rename(temp, path);
    return { ok: true, value: snapshot };
  } catch {
    return { ok: false, code: 'unavailable' };
  }
}

export async function readSnapshot(
  path: string,
  streamId: string,
  reducer = '1',
): Promise<SnapshotResult> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return { ok: false, code: 'corrupt' };
    const x = parsed as Record<string, unknown>;
    if (
      x.protocol !== SNAPSHOT_PROTOCOL ||
      x.reducer !== reducer ||
      x.schema !== SNAPSHOT_SCHEMA ||
      x.streamId !== streamId
    )
      return { ok: false, code: 'incompatible' };
    if (
      typeof x.throughSequence !== 'number' ||
      !Number.isSafeInteger(x.throughSequence) ||
      !stateLooksValid(x.state, x.throughSequence)
    )
      return { ok: false, code: 'corrupt' };
    return { ok: true, value: x as unknown as Snapshot };
  } catch {
    return { ok: false, code: 'corrupt' };
  }
}

/** Rebuilds when a snapshot is absent, incompatible, or corrupt. */
export async function readSnapshotOrRebuild(
  path: string,
  streamId: string,
  events: readonly AnyCoreEvent[],
  reducer = '1',
): Promise<SnapshotResult> {
  const loaded = await readSnapshot(path, streamId, reducer);
  if (loaded.ok) return loaded;
  const canonical = events
    .filter((event) => event.source.streamId === streamId && event.sequence > 0)
    .sort((a, b) => a.sequence - b.sequence || a.eventId.localeCompare(b.eventId));
  const state = reduceEvents(canonical, initialSemanticState());
  return { ok: true, value: makeSnapshot(state, streamId, reducer) };
}
