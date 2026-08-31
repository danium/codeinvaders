import { chmod, mkdir, open, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalizeEvent, serializeCanonicalEvent } from '@codeinvaders/protocol';
import type { AnyCoreEvent } from '@codeinvaders/protocol';
import { canonicalizeIngress } from './ingress.js';
import { ownedPath, safeDeleteOwned, verifyOwnedPath } from './paths.js';

export interface JournalOptions {
  readonly root: string;
  readonly streamId: string;
  readonly segmentBytes?: number;
  readonly privateMode?: 'private' | 'standard';
}
export interface AppendAck {
  readonly eventId: string;
  readonly sequence: number;
  readonly duplicate: boolean;
}
export interface SegmentRange {
  readonly firstSequence: number;
  readonly lastSequence: number;
  readonly records: number;
}
export interface JournalManifest {
  readonly version: 1;
  readonly streamId: string;
  readonly nextSequence: number;
  readonly segments: readonly string[];
  readonly segmentRanges?: Readonly<Record<string, SegmentRange>>;
  readonly repaired?: boolean;
}
export type JournalErrorCode = 'invalid-ingress' | 'unsafe-path' | 'io-failure' | 'incompatible';
export type JournalResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: JournalErrorCode };
const MAX_SEGMENT = 16 * 1024 * 1024;
const safeError = (code: JournalErrorCode): JournalResult<never> => ({ ok: false, code });
const segmentName = (n: number): string => `segment-${String(n).padStart(8, '0')}.jsonl`;
const isManifest = (v: unknown, streamId: string): v is JournalManifest => {
  if (!v || typeof v !== 'object') return false;
  const x = v as Record<string, unknown>;
  return (
    x.version === 1 &&
    x.streamId === streamId &&
    Number.isSafeInteger(x.nextSequence) &&
    Array.isArray(x.segments) &&
    x.segments.every((s) => typeof s === 'string' && /^segment-\d{8}\.jsonl$/.test(s))
  );
};

export class EventJournal {
  readonly root: string;
  readonly streamId: string;
  readonly segmentBytes: number;
  private manifest: JournalManifest;
  private readonly ids = new Map<string, number>();
  private readonly locations = new Map<string, string>();
  private tail = Promise.resolve();
  private ready: Promise<void>;
  private recoveryError = false;
  constructor(options: JournalOptions) {
    this.root = options.root;
    this.streamId = options.streamId;
    // A canonical event is bounded by the protocol; rotation remains bounded for normal records.
    const requestedBytes = options.segmentBytes;
    this.segmentBytes = Math.min(
      MAX_SEGMENT,
      Math.max(1, Number.isFinite(requestedBytes) ? requestedBytes! : 1024 * 1024),
    );
    this.manifest = { version: 1, streamId: this.streamId, nextSequence: 1, segments: [] };
    this.ready = this.recover().catch(() => {
      this.recoveryError = true;
    });
  }
  private async recover(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await chmod(this.root, 0o700);
    const names = await readdir(this.root);
    let old: JournalManifest | undefined;
    try {
      const parsed: unknown = JSON.parse(await readFile(join(this.root, 'manifest.json'), 'utf8'));
      if (isManifest(parsed, this.streamId)) old = parsed;
    } catch {
      /* rebuild from segments */
    }
    const discovered = names.filter((x) => /^segment-\d{8}\.jsonl$/.test(x)).sort();
    const ranges: Record<string, SegmentRange> = {};
    const segments: string[] = [];
    let repairedDuringScan = false;
    let highest = 0;
    for (const name of discovered) {
      const checked = await verifyOwnedPath(this.root, join(this.root, name));
      if (!checked.ok) continue;
      let text: string;
      try {
        text = await readFile(checked.value, 'utf8');
      } catch {
        continue;
      }
      const lines = text.split('\n');
      const complete = lines.at(-1) === '';
      if (complete) lines.pop();
      let valid = '';
      let first = Number.MAX_SAFE_INTEGER;
      let last = 0;
      let count = 0;
      for (const line of lines) {
        if (!line) break;
        try {
          const event = canonicalizeEvent(JSON.parse(line));
          if (
            event.source.streamId !== this.streamId ||
            !Number.isSafeInteger(event.sequence) ||
            event.sequence < 1
          )
            break;
          // The first durable copy wins; duplicate records are omitted on repair.
          if (this.ids.has(event.eventId)) continue;
          this.ids.set(event.eventId, event.sequence);
          this.locations.set(event.eventId, name);
          valid += serializeCanonicalEvent(event) + '\n';
          first = Math.min(first, event.sequence);
          last = Math.max(last, event.sequence);
          count++;
          highest = Math.max(highest, event.sequence);
        } catch {
          break;
        }
      }
      // Rewrite only when corruption, duplicate records, or a partial suffix was found.
      if (valid !== text) {
        repairedDuringScan = true;
        await writeFile(checked.value, valid, 'utf8');
        const h = await open(checked.value, 'r+');
        await h.sync();
        await h.close();
      }
      if (count) {
        segments.push(name);
        ranges[name] = { firstSequence: first, lastSequence: last, records: count };
      }
    }
    const repaired =
      repairedDuringScan ||
      old === undefined ||
      JSON.stringify(old.segments) !== JSON.stringify(segments);
    this.manifest = {
      version: 1,
      streamId: this.streamId,
      nextSequence: Math.max(1, highest + 1),
      segments,
      segmentRanges: ranges,
      repaired,
    };
    await this.persist();
    if (repaired) {
      const invalidated = await invalidateDerivedArtifacts(this.root);
      if (!invalidated.ok) throw new Error('derived-artifact-invalidation-failed');
    }
  }
  private async persist(): Promise<void> {
    const temp = join(this.root, 'manifest.json.tmp');
    await writeFile(temp, JSON.stringify(this.manifest), 'utf8');
    await chmod(temp, 0o600);
    const handle = await open(temp, 'r+');
    await handle.sync();
    await handle.close();
    const target = join(this.root, 'manifest.json');
    const checked = ownedPath(this.root, target);
    if (!checked.ok) throw new Error('unsafe-path');
    await rename(temp, target);
  }
  private async durableAppend(path: string, text: string): Promise<void> {
    const handle = await open(path, 'a', 0o600);
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  private enqueue<T>(work: () => Promise<JournalResult<T>>): Promise<JournalResult<T>> {
    let result!: JournalResult<T>;
    this.tail = this.tail
      .then(async () => {
        result = await work();
      })
      .catch(() => {
        result = safeError('io-failure');
      });
    return this.tail.then(() => result);
  }
  async append(input: unknown): Promise<JournalResult<AppendAck>> {
    const ingress = canonicalizeIngress(input);
    if (!ingress.ok) return safeError('invalid-ingress');
    if (ingress.event.source.streamId !== this.streamId) return safeError('invalid-ingress');
    await this.ready;
    if (this.recoveryError) return safeError('io-failure');
    return this.enqueue<AppendAck>(async () => {
      const event = ingress.event;
      const prior = this.ids.get(event.eventId);
      if (prior !== undefined)
        return { ok: true, value: { eventId: event.eventId, sequence: prior, duplicate: true } };
      const sequence = this.manifest.nextSequence;
      const canonical = canonicalizeEvent({ ...event, sequence });
      const line = serializeCanonicalEvent(canonical) + '\n';
      let name = this.manifest.segments.at(-1);
      if (!name || (await this.size(name)) + Buffer.byteLength(line) > this.segmentBytes) {
        name = segmentName(
          this.manifest.segments.reduce((max, x) => Math.max(max, Number(x.slice(8, 16))), -1) + 1,
        );
        this.manifest = { ...this.manifest, segments: [...this.manifest.segments, name] };
      }
      const checked = ownedPath(this.root, join(this.root, name));
      if (!checked.ok) return safeError('unsafe-path');
      await this.durableAppend(checked.value, line);
      await chmod(checked.value, 0o600);
      this.ids.set(event.eventId, sequence);
      this.locations.set(event.eventId, name);
      const previousRange = this.manifest.segmentRanges?.[name];
      const range = previousRange
        ? {
            firstSequence: previousRange.firstSequence,
            lastSequence: sequence,
            records: previousRange.records + 1,
          }
        : { firstSequence: sequence, lastSequence: sequence, records: 1 };
      this.manifest = {
        ...this.manifest,
        nextSequence: sequence + 1,
        segmentRanges: { ...(this.manifest.segmentRanges ?? {}), [name]: range },
      };
      await this.persist();
      return { ok: true, value: { eventId: event.eventId, sequence, duplicate: false } };
    });
  }
  private async size(name: string): Promise<number> {
    try {
      return (await stat(join(this.root, name))).size;
    } catch {
      return 0;
    }
  }
  async events(): Promise<JournalResult<readonly AnyCoreEvent[]>> {
    await this.ready;
    if (this.recoveryError) return safeError('io-failure');
    try {
      const out: AnyCoreEvent[] = [];
      for (const name of this.manifest.segments) {
        const checked = await verifyOwnedPath(this.root, join(this.root, name));
        if (!checked.ok) continue;
        const text = await readFile(checked.value, 'utf8');
        for (const line of text.split('\n'))
          if (line)
            try {
              const event = canonicalizeEvent(JSON.parse(line));
              if (event.source.streamId === this.streamId) out.push(event);
            } catch {
              /* quarantine malformed records */
            }
      }
      const seen = new Set<string>();
      return {
        ok: true,
        value: out
          .filter((e) => !seen.has(e.eventId) && (seen.add(e.eventId), true))
          .sort((a, b) => a.sequence - b.sequence),
      };
    } catch {
      return safeError('io-failure');
    }
  }
  async retain(maxBytes: number): Promise<JournalResult<void>> {
    await this.ready;
    if (this.recoveryError) return safeError('io-failure');
    return this.enqueue(async () => {
      try {
        while (
          this.manifest.segments.length > 1 &&
          (await Promise.all(this.manifest.segments.map((x) => this.size(x)))).reduce(
            (a, b) => a + b,
            0,
          ) > Math.max(0, maxBytes)
        ) {
          const name = this.manifest.segments[0]!;
          const deleted = await safeDeleteOwned(this.root, name);
          if (!deleted.ok)
            return safeError(deleted.code === 'unsafe-path' ? 'unsafe-path' : 'io-failure');
          for (const [eventId, location] of this.locations)
            if (location === name) {
              this.ids.delete(eventId);
              this.locations.delete(eventId);
            }
          const ranges = { ...(this.manifest.segmentRanges ?? {}) };
          delete ranges[name];
          this.manifest = {
            ...this.manifest,
            segments: this.manifest.segments.slice(1),
            segmentRanges: ranges,
            repaired: true,
          };
          await this.persist();
        }
        return await invalidateDerivedArtifacts(this.root);
      } catch {
        return safeError('io-failure');
      }
    });
  }
}

export async function invalidateDerivedArtifacts(root: string): Promise<JournalResult<void>> {
  try {
    for (const name of (await readdir(root)).filter(
      (x) => x.endsWith('.snapshot.json') || x.endsWith('.index.json'),
    )) {
      const removed = await safeDeleteOwned(root, name);
      if (!removed.ok)
        return safeError(removed.code === 'unsafe-path' ? 'unsafe-path' : 'io-failure');
    }
    return { ok: true, value: undefined };
  } catch {
    return safeError('io-failure');
  }
}

/** Ingest only sanitized pending records; retirement follows durable acknowledgement. */
export async function recoverPendingSpool(
  spoolRoot: string,
  journal: EventJournal,
): Promise<readonly JournalResult<AppendAck>[]> {
  const results: JournalResult<AppendAck>[] = [];
  try {
    for (const name of (await readdir(spoolRoot))
      .filter((x) => x.endsWith('.pending') || x.endsWith('.ingress'))
      .sort()) {
      const checked = await verifyOwnedPath(spoolRoot, join(spoolRoot, name));
      if (!checked.ok) {
        results.push(safeError('unsafe-path'));
        continue;
      }
      try {
        const text = await readFile(checked.value, 'utf8');
        const result = await journal.append(
          JSON.parse(text.endsWith('\n') ? text.slice(0, -1) : text),
        );
        results.push(result);
        if (result.ok) await rename(checked.value, `${checked.value}.retired`);
      } catch {
        results.push(safeError('io-failure'));
      }
    }
  } catch {
    results.push(safeError('io-failure'));
  }
  return results;
}
