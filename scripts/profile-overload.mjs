import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { dirname, resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EVENTS_DEFAULT = 1_500;
const SPOOL_ATTEMPTS_DEFAULT = 4_100;
const SPOOL_RECORD_LIMIT = 4_096;
const SPOOL_BYTE_LIMIT = 4 * 1024 * 1024;
const opaque = (index) => `oid1_${index.toString(36).padStart(42, 'A').slice(-42)}A`;
const STREAM_ID = opaque(90_003);

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
}

export function profileEvent(index) {
  const timestamp = new Date(1_700_000_000_000 + index).toISOString();
  return {
    spec: 'io.github.danium.codeinvaders.aap',
    version: '1.0.0',
    eventId: opaque(index),
    type: 'source.heartbeat',
    occurredAt: timestamp,
    observedAt: timestamp,
    sequence: 0,
    source: {
      adapterId: 'codeinvaders-codex',
      adapterVersion: '0.1.0',
      streamId: STREAM_ID,
      epochId: opaque(90_000),
    },
    scope: { workspaceId: opaque(90_001), sessionId: opaque(90_002) },
    fidelity: 'observed',
    finality: 'confirmed',
    data: { uptimeMs: index },
  };
}

async function treeStats(root) {
  let bytes = 0;
  let files = 0;
  let segments = 0;
  async function walk(path) {
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else {
        files++;
        bytes += (await stat(child)).size;
        if (/^segment-\d{8}\.jsonl$/.test(entry.name)) segments++;
      }
    }
  }
  await walk(root);
  return { bytes, files, segments };
}

async function removeTemporaryRoot(root) {
  const candidate = resolve(root);
  const workspace = resolve(ROOT);
  if (candidate === workspace || !candidate.startsWith(`${workspace}${sep}`))
    throw new Error('refusing-to-remove-outside-workspace');
  await rm(candidate, { recursive: true, force: true });
}

export async function profileOverload({
  events = EVENTS_DEFAULT,
  maxHeapDeltaMb = 128,
  spoolAttempts = SPOOL_ATTEMPTS_DEFAULT,
  spoolRecordLimit = SPOOL_RECORD_LIMIT,
  spoolByteLimit = SPOOL_BYTE_LIMIT,
} = {}) {
  if (!Number.isSafeInteger(events) || events < 100 || events > 20_000)
    throw new RangeError('events must be between 100 and 20000');
  if (!Number.isSafeInteger(spoolAttempts) || spoolAttempts < 1 || spoolAttempts > 5_000)
    throw new RangeError('spoolAttempts must be between 1 and 5000');
  const [{ EventJournal, reduceEvents, replay, replayTo }, { canonicalizeEvent }, sdk] =
    await Promise.all([
      import(pathToFileURL(resolve(ROOT, 'packages/core/dist/index.js')).href),
      import(pathToFileURL(resolve(ROOT, 'packages/protocol/dist/index.js')).href),
      import(pathToFileURL(resolve(ROOT, 'packages/adapter-sdk/dist/index.js')).href),
    ]);
  const root = await mkdtemp(join(ROOT, '.codeinvaders-overload-profile-'));
  try {
    if (typeof globalThis.gc === 'function') globalThis.gc();
    const startHeap = process.memoryUsage().heapUsed;
    const journal = new EventJournal({
      root,
      streamId: STREAM_ID,
      segmentBytes: 32 * 1024,
    });
    const latencies = [];
    let accepted = 0;
    for (let index = 0; index < events; index++) {
      const event = canonicalizeEvent(profileEvent(index));
      const started = performance.now();
      const result = await journal.append(event);
      latencies.push(performance.now() - started);
      if (result.ok) accepted++;
      else throw new Error(`journal-${result.code}`);
    }
    const loaded = await journal.events();
    if (!loaded.ok) throw new Error(`journal-${loaded.code}`);
    const stateStarted = performance.now();
    const state = reduceEvents(loaded.value);
    const frames = replay(loaded.value);
    const projectionMs = performance.now() - stateStarted;
    const seekStarted = performance.now();
    const seekState = replayTo(loaded.value, Math.floor(events / 2));
    const replaySeekMs = performance.now() - seekStarted;
    const spoolRoot = join(root, 'spool-overload');
    let spoolAccepted = 0;
    let spoolFull = 0;
    for (let index = 0; index < spoolAttempts; index++) {
      const prepared = sdk.sanitizeIngressRecord(canonicalizeEvent(profileEvent(10_000 + index)));
      if (prepared.status !== 'accepted')
        throw new Error(
          `spool-record-rejected-before-quota:${prepared.diagnostics?.map((item) => item.code).join(',') ?? 'unknown'}`,
        );
      const spoolResult = await sdk.spoolCanonical(
        spoolRoot,
        sdk.createSanitizedIngressHandoff(prepared),
        { bytes: spoolByteLimit, records: spoolRecordLimit },
      );
      if (spoolResult.status === 'spooled') spoolAccepted++;
      else if (spoolResult.status === 'full') spoolFull++;
      else throw new Error('spool-write-rejected');
    }
    const spoolEntries = await readdir(spoolRoot);
    const spoolRecords = spoolEntries.filter((name) => name.endsWith('.ingress')).length;
    const spoolDisk = await treeStats(spoolRoot);
    const endHeap = process.memoryUsage().heapUsed;
    const disk = await treeStats(root);
    const heapDeltaMb = Math.max(0, endHeap - startHeap) / (1024 * 1024);
    return {
      events,
      accepted,
      rejected: events - accepted,
      journalSegments: disk.segments,
      journalFiles: disk.files,
      journalBytes: disk.bytes,
      reducerLastSequence: state.lastSequence,
      replayFrames: frames.length,
      projectionMs,
      replaySeekMs,
      replaySeekLastSequence: seekState.lastSequence,
      spoolAttempts,
      spoolAccepted,
      spoolFull,
      spoolRecords,
      spoolBytes: spoolDisk.bytes,
      spoolOverflowObserved:
        spoolFull > 0 && spoolRecords <= spoolRecordLimit && spoolDisk.bytes <= spoolByteLimit,
      appendP50Ms: percentile(latencies, 0.5),
      appendP95Ms: percentile(latencies, 0.95),
      appendMaxMs: Math.max(...latencies),
      heapDeltaMb,
      gcAvailable: typeof globalThis.gc === 'function',
      boundedMemoryPass: heapDeltaMb <= maxHeapDeltaMb,
      noSemanticDrops: accepted === events && frames.length === events,
    };
  } finally {
    await removeTemporaryRoot(root);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const eventsArg = process.argv.find((arg) => arg.startsWith('--events='));
  const heapArg = process.argv.find((arg) => arg.startsWith('--max-heap-delta-mb='));
  const spoolArg = process.argv.find((arg) => arg.startsWith('--spool-attempts='));
  const spoolLimitArg = process.argv.find((arg) => arg.startsWith('--spool-record-limit='));
  const spoolBytesArg = process.argv.find((arg) => arg.startsWith('--spool-byte-limit='));
  try {
    const report = await profileOverload({
      events: eventsArg ? Number(eventsArg.slice(9)) : EVENTS_DEFAULT,
      maxHeapDeltaMb: heapArg ? Number(heapArg.slice(21)) : 128,
      spoolAttempts: spoolArg ? Number(spoolArg.slice(17)) : SPOOL_ATTEMPTS_DEFAULT,
      spoolRecordLimit: spoolLimitArg ? Number(spoolLimitArg.slice(21)) : SPOOL_RECORD_LIMIT,
      spoolByteLimit: spoolBytesArg ? Number(spoolBytesArg.slice(19)) : SPOOL_BYTE_LIMIT,
    });
    process.stdout.write(JSON.stringify(report) + '\n');
    process.exitCode =
      report.boundedMemoryPass && report.noSemanticDrops && report.spoolOverflowObserved ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      `overload-profile: ${error instanceof Error ? error.message : 'failed'}\n`,
    );
    process.exitCode = 2;
  }
}
