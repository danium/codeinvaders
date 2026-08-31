import { promises as fs } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createConnection, type Socket } from 'node:net';
import {
  isAcceptedIngressPreparation,
  type AcceptedIngressPreparation,
  type CanonicalIngressJson,
} from './ingress.js';

export const IPC_DEADLINE_MS = 250;
export const MAX_SPOOL_BYTES = 4 * 1024 * 1024;
export const MAX_SPOOL_RECORDS = 4096;
export const MAX_SPOOL_RECORD_BYTES = 1_048_576;
const MAX_DEADLINE_MS = IPC_DEADLINE_MS;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const PIPE_PREFIX = '\\\\.\\pipe\\';
const runtimePlatform = (globalThis as { readonly process?: { readonly platform?: string } })
  .process?.platform;

export type LocalEndpoint = { readonly kind: 'unix' | 'windows-pipe'; readonly address: string };
const validEndpoints = new WeakSet<object>();
export type IpcResult = {
  readonly status: 'acknowledged' | 'unavailable' | 'timed-out' | 'malformed-ack';
};
export type SpoolResult = {
  readonly status: 'spooled' | 'full' | 'rejected';
  readonly gap?: 'spool-overflow' | 'spool-error';
};
export type SanitizedIngressHandoff = Readonly<{
  readonly canonicalJson: CanonicalIngressJson;
  readonly eventId: string;
}>;
const validHandoffs = new WeakSet<object>();

function ownedChild(candidate: string, root: string): boolean {
  const rel = relative(root, candidate);
  return (
    rel !== '' &&
    rel !== '..' &&
    !rel.startsWith(`..${sep}`) &&
    !isAbsolute(rel) &&
    !rel.includes('\0')
  );
}

/** Accepts only an installation-local, single-component Unix endpoint or a named pipe. */
export function validateInstallationEndpoint(
  value: unknown,
  installationRoot: string,
): LocalEndpoint | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 260 || value.includes('\0'))
    return undefined;
  if (value.startsWith(PIPE_PREFIX)) {
    if (runtimePlatform !== 'win32') return undefined;
    const name = value.slice(PIPE_PREFIX.length);
    return SAFE_NAME.test(name) && name.startsWith('CodeInvaders-') && !name.includes('..')
      ? markEndpoint({ kind: 'windows-pipe', address: value })
      : undefined;
  }
  if (runtimePlatform === 'win32') return undefined;
  if (!isAbsolute(installationRoot) || !isAbsolute(value)) return undefined;
  const root = resolve(installationRoot);
  const candidate = resolve(value);
  const component = relative(root, candidate);
  return ownedChild(candidate, root) && component === 'CodeInvaders.sock'
    ? markEndpoint({ kind: 'unix', address: candidate })
    : undefined;
}

function markEndpoint(endpoint: LocalEndpoint): LocalEndpoint {
  const result = Object.freeze(endpoint);
  validEndpoints.add(result);
  return result;
}

export function deriveInstallationEndpoint(installationRoot: string): LocalEndpoint | undefined {
  if (!isAbsolute(installationRoot) || installationRoot.includes('\0')) return undefined;
  if (runtimePlatform === 'win32') {
    let hash = 2166136261;
    for (let i = 0; i < installationRoot.length; i += 1)
      hash = Math.imul(hash ^ installationRoot.charCodeAt(i), 16777619);
    return validateInstallationEndpoint(
      `${PIPE_PREFIX}CodeInvaders-${(hash >>> 0).toString(16)}`,
      installationRoot,
    );
  }
  return validateInstallationEndpoint(
    join(resolve(installationRoot), 'CodeInvaders.sock'),
    resolve(installationRoot),
  );
}
export const deriveLocalEndpoint = deriveInstallationEndpoint;

function assertHandoff(value: unknown): SanitizedIngressHandoff | undefined {
  if (!value || typeof value !== 'object' || !validHandoffs.has(value)) return undefined;
  const candidate = value as Partial<SanitizedIngressHandoff>;
  return typeof candidate.canonicalJson === 'string' &&
    typeof candidate.eventId === 'string' &&
    candidate.canonicalJson.length > 0 &&
    candidate.canonicalJson.length <= MAX_SPOOL_RECORD_BYTES
    ? Object.freeze({ canonicalJson: candidate.canonicalJson, eventId: candidate.eventId })
    : undefined;
}

/** Converts an accepted SDK preparation into the only value transport APIs accept. */
export function createSanitizedIngressHandoff(
  preparation: AcceptedIngressPreparation,
): SanitizedIngressHandoff {
  if (!isAcceptedIngressPreparation(preparation)) throw new TypeError('invalid ingress handoff');
  const handoff = Object.freeze({
    canonicalJson: preparation.canonicalJson,
    eventId: preparation.eventId as string,
  });
  validHandoffs.add(handoff);
  return handoff;
}

function frame(json: CanonicalIngressJson): Buffer {
  const body = Buffer.from(json, 'utf8');
  return Buffer.concat([
    Buffer.from(`CIIP/1 ${body.byteLength}:`, 'ascii'),
    body,
    Buffer.from('\n', 'ascii'),
  ]);
}

/** One monotonic deadline covers connect, write, response parsing, and teardown. */
export function sendCanonicalIpc(
  endpoint: LocalEndpoint,
  handoff: SanitizedIngressHandoff,
  deadlineMs = IPC_DEADLINE_MS,
): Promise<IpcResult> {
  return new Promise((done) => {
    const safe = assertHandoff(handoff);
    if (!safe) {
      done({ status: 'unavailable' });
      return;
    }
    const deadline = Math.max(1, Math.min(MAX_DEADLINE_MS, Math.floor(deadlineMs)));
    if (!validEndpoints.has(endpoint as object)) {
      done({ status: 'unavailable' });
      return;
    }
    const started = performance.now();
    let settled = false;
    let socket: Socket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (status: IpcResult['status']) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      socket?.destroy();
      done({ status });
    };
    const remaining = () => Math.max(1, deadline - (performance.now() - started));
    try {
      socket = createConnection(safeEndpoint(endpoint).address);
      let response = Buffer.from('', 'ascii');
      const arm = () => {
        timer = setTimeout(() => finish('timed-out'), remaining());
      };
      socket.once('error', () => finish('unavailable'));
      socket.once('close', () => {
        if (!settled) finish(response.byteLength === 0 ? 'unavailable' : 'malformed-ack');
      });
      socket.on('data', (chunk: Buffer | string) => {
        response = Buffer.concat([
          response,
          typeof chunk === 'string' ? Buffer.from(chunk) : chunk,
        ]);
        if (response.byteLength > 128) {
          finish('malformed-ack');
          return;
        }
        const text = response.toString('ascii');
        if (text === 'ACK\n') finish('acknowledged');
        else if (text.startsWith('ACK\n')) finish('malformed-ack');
        else if (text.length >= 4 && !'ACK\n'.startsWith(text)) finish('malformed-ack');
      });
      socket.once('connect', () => {
        if (!settled) {
          try {
            // Keep the write side open until the broker has returned its
            // durable ACK. Some hosts deliver a half-close before delayed
            // ACK bytes are observable, turning a valid handoff into a
            // spurious malformed/timeout result.
            socket?.write(frame(safe.canonicalJson));
          } catch {
            finish('unavailable');
          }
        }
      });
      arm();
    } catch {
      finish('unavailable');
    }
  });
}

function safeEndpoint(endpoint: LocalEndpoint): LocalEndpoint {
  if (!validEndpoints.has(endpoint as object)) throw new TypeError('invalid endpoint');
  if (
    !endpoint ||
    (endpoint.kind !== 'unix' && endpoint.kind !== 'windows-pipe') ||
    typeof endpoint.address !== 'string'
  )
    throw new TypeError('invalid endpoint');
  if (
    endpoint.kind === 'windows-pipe' &&
    (!endpoint.address.startsWith(PIPE_PREFIX) ||
      !SAFE_NAME.test(endpoint.address.slice(PIPE_PREFIX.length)) ||
      !endpoint.address.slice(PIPE_PREFIX.length).startsWith('CodeInvaders-'))
  )
    throw new TypeError('invalid pipe endpoint');
  if (
    endpoint.kind === 'unix' &&
    (!isAbsolute(endpoint.address) || endpoint.address.includes('\0'))
  )
    throw new TypeError('invalid unix endpoint');
  return endpoint;
}

const locks = new Map<string, Promise<void>>();
async function withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const prior = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((done) => {
    release = done;
  });
  locks.set(key, current);
  await prior;
  try {
    return await work();
  } finally {
    release();
    if (locks.get(key) === current) locks.delete(key);
  }
}

/* Coordinate quota accounting across separately spawned hook processes. A
 * stale lock is recoverable after a hard fail-open exit; the bounded retry
 * keeps lock contention inside the hook's total deadline. */
async function withProcessSpoolLock<T>(
  root: string,
  work: () => Promise<T>,
): Promise<T | undefined> {
  const lock = join(root, '.spool.lock');
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await fs.mkdir(lock, { recursive: false, mode: 0o700 });
      break;
    } catch {
      try {
        const info = await fs.stat(lock);
        if (Date.now() - info.mtimeMs > 1_000) await fs.rmdir(lock);
      } catch {
        /* The owner may have just released the lock. */
      }
      if (attempt === 39) return undefined;
      await new Promise<void>((resolveWait) => setTimeout(resolveWait, 5));
    }
  }
  try {
    return await work();
  } finally {
    try {
      await fs.rmdir(lock);
    } catch {
      /* A forced process exit leaves a lock for the stale-lock path above. */
    }
  }
}

/** Writes one immutable handoff under a caller-supplied absolute owned spool root. */
export async function spoolCanonical(
  endpointDirectory: string,
  handoff: SanitizedIngressHandoff,
  limits = { bytes: MAX_SPOOL_BYTES, records: MAX_SPOOL_RECORDS },
): Promise<SpoolResult> {
  const safe = assertHandoff(handoff);
  if (
    !safe ||
    !isAbsolute(endpointDirectory) ||
    endpointDirectory.includes('\0') ||
    limits.bytes <= 0 ||
    limits.records <= 0
  )
    return { status: 'rejected', gap: 'spool-error' };
  const root = resolve(endpointDirectory);
  const content = Buffer.from(`${safe.canonicalJson}\n`, 'utf8');
  if (content.byteLength > MAX_SPOOL_RECORD_BYTES) return { status: 'full', gap: 'spool-overflow' };
  return withLock(root, async () => {
    try {
      await fs.mkdir(root, { recursive: true, mode: 0o700 });
      const result = await withProcessSpoolLock(root, async () => {
        const rootInfo = await fs.lstat(root);
        if (rootInfo.isSymbolicLink()) return { status: 'rejected', gap: 'spool-error' } as const;
        const entries = await fs.readdir(root);
        const committed = entries.filter((e) => e.endsWith('.ingress'));
        let bytes = 0;
        for (const entry of committed) bytes += (await fs.stat(join(root, entry))).size;
        // Opaque IDs are fixed-format, URL-safe values validated before this
        // boundary; using the complete value is deterministic and collision-free
        // without loading crypto (which can observe poisoned host intrinsics).
        const digest = safe.eventId;
        const temporary = join(root, `.${digest}.${Date.now()}.tmp`);
        const target = join(root, `${digest}.ingress`);
        // Delivery is idempotent. Check the committed record before enforcing
        // quotas; a retry must not turn a full spool into a false gap.
        try {
          const targetInfo = await fs.lstat(target);
          if (targetInfo.isSymbolicLink())
            return { status: 'rejected', gap: 'spool-error' } as const;
          const existing = await fs.readFile(target, 'utf8');
          if (existing === content.toString()) return { status: 'spooled' } as const;
          return { status: 'rejected', gap: 'spool-error' } as const;
        } catch {
          /* not committed yet */
        }
        if (committed.length >= limits.records || bytes + content.byteLength > limits.bytes)
          return { status: 'full', gap: 'spool-overflow' } as const;
        try {
          const handle = await fs.open(temporary, 'wx', 0o600);
          try {
            await handle.writeFile(content);
            await handle.sync();
          } finally {
            await handle.close();
          }
          await fs.rename(temporary, target);
          try {
            const dir = await fs.open(root, 'r');
            try {
              await dir.sync();
            } finally {
              await dir.close();
            }
          } catch {
            /* directory sync is unavailable on some platforms */
          }
        } catch {
          try {
            await fs.unlink(temporary);
          } catch {
            /* incomplete files are harmless */
          }
          // Another process may have committed the same event concurrently.
          // Treat an identical committed record as the successful retry case.
          try {
            const existing = await fs.readFile(target, 'utf8');
            if (existing === content.toString('utf8')) return { status: 'spooled' } as const;
          } catch {
            /* preserve the closed spool-error result */
          }
          return { status: 'rejected', gap: 'spool-error' } as const;
        }
        return { status: 'spooled' } as const;
      });
      return result ?? { status: 'rejected', gap: 'spool-error' };
    } catch {
      return { status: 'rejected', gap: 'spool-error' } as const;
    }
  });
}

/** Returns valid canonical text only; temps and malformed records are quarantined. */
export async function recoverSpool(endpointDirectory: string): Promise<readonly string[]> {
  if (!isAbsolute(endpointDirectory) || endpointDirectory.includes('\0')) return [];
  try {
    const root = resolve(endpointDirectory);
    const entries = await fs.readdir(root);
    const out: string[] = [];
    for (const name of entries
      .filter((e) => e.endsWith('.ingress'))
      .sort()
      .slice(0, MAX_SPOOL_RECORDS)) {
      const path = join(root, name);
      try {
        const value = await fs.readFile(path, 'utf8');
        const info = await fs.lstat(path);
        if (info.isSymbolicLink()) {
          await fs.rename(path, `${path}.quarantine`);
          continue;
        }
        if (
          value.endsWith('\n') &&
          value.length <= MAX_SPOOL_RECORD_BYTES &&
          !value.slice(0, -1).includes('\0') &&
          isCanonicalJsonRecord(value.slice(0, -1))
        )
          out.push(value.slice(0, -1));
        else await fs.rename(path, `${path}.quarantine`);
      } catch {
        /* never expose filesystem errors */
      }
    }
    return Object.freeze(out);
  } catch {
    return [];
  }
}

function isCanonicalJsonRecord(value: string): boolean {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch {
    return false;
  }
}
