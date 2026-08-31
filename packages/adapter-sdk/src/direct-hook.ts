import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { createOpaqueIdDeriver, type OpaqueId, type OpaqueIdDeriver } from './identity.js';
import { deriveStableRetryEventId, sanitizeIngressRecord } from './ingress.js';
import {
  createSanitizedIngressHandoff,
  deriveInstallationEndpoint,
  sendCanonicalIpc,
  spoolCanonical,
  IPC_DEADLINE_MS,
  type IpcResult,
  type SpoolResult,
} from './transport.js';
import type { CoreEventType, Fidelity, SemanticMetadata } from '@codeinvaders/protocol';

/** The only environment contract used by an installed direct hook. */
export const DIRECT_HOOK_DATA_ENV = 'CODEINVADERS_DATA_DIR';
export const DIRECT_HOOK_SALT_FILE = 'local.salt';
export const DIRECT_HOOK_SPOOL_DIRECTORY = 'spool';
export const DIRECT_HOOK_EPOCH_FILE = 'hook-epoch';
export const DIRECT_HOOK_RUNTIME_FILE = 'runtime.json';
/** Compatibility while the local runtime migrates its metadata file name. */
export const DIRECT_HOOK_RUNTIME_COMPAT_FILE = 'config.json';
export const DIRECT_HOOK_DIAGNOSTICS_DIRECTORY = 'diagnostics';
export const DIRECT_HOOK_DIAGNOSTIC_LIMIT = 256;

type RuntimeProcess = {
  readonly env?: Record<string, string | undefined>;
  readonly platform?: string;
  readonly pid?: number;
};

function runtimeProcess(): RuntimeProcess {
  return (globalThis as { readonly process?: RuntimeProcess }).process ?? {};
}

function environmentRoot(): string {
  const process = runtimeProcess();
  const env = process.env ?? {};
  if (typeof env[DIRECT_HOOK_DATA_ENV] === 'string' && env[DIRECT_HOOK_DATA_ENV].length > 0)
    return resolve(env[DIRECT_HOOK_DATA_ENV]);
  if (process.platform === 'win32')
    return resolve(
      env.LOCALAPPDATA ??
        join(env.USERPROFILE ?? env.HOME ?? '.', 'AppData', 'Local', 'CodeInvaders'),
    );
  return resolve(
    join(env.XDG_DATA_HOME ?? join(env.HOME ?? '.', '.local', 'share'), 'codeinvaders'),
  );
}

function own(value: unknown, key: string): unknown {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

/** Reads one bounded native scalar without invoking accessors or retaining it. */
export function directNativeIdentity(
  input: unknown,
  ...keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = own(input, key);
    if (typeof value === 'string' && value.length > 0 && value.length <= 256) return value;
  }
  return undefined;
}

export function directNativeTimestamp(
  input: unknown,
  ...keys: readonly string[]
): string | undefined {
  const value = directNativeIdentity(input, ...keys);
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return Buffer.from(binary, 'binary').toString('base64url');
}

function keyBytes(value: string): Uint8Array | undefined {
  try {
    const bytes = Buffer.from(value, 'base64url');
    return bytes.byteLength === 32 ? bytes : undefined;
  } catch {
    return undefined;
  }
}

async function createTextOnce(path: string, text: string): Promise<string> {
  try {
    const temporary = `${path}.${runtimeProcess().pid ?? 0}.${Date.now()}.tmp`;
    const handle = await fs.open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(Buffer.from(text, 'utf8'));
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.link(temporary, path);
    } finally {
      try {
        await fs.unlink(temporary);
      } catch {
        /* winner already linked */
      }
    }
  } catch {
    /* Another hook may have created the installation file first. */
  }
  return fs.readFile(path, 'utf8');
}

/** The salt is JSON text to match the local runtime's storage contract. */
async function readOrCreateKey(root: string): Promise<Uint8Array> {
  const path = join(root, DIRECT_HOOK_SALT_FILE);
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(path, 'utf8'));
    if (typeof parsed === 'string') {
      const existing = keyBytes(parsed);
      if (existing !== undefined) return existing;
    }
  } catch {
    /* The first direct hook invocation creates the installation-local key. */
  }
  const key = new Uint8Array(32);
  const cryptoApi = (
    globalThis as { readonly crypto?: { getRandomValues: (target: Uint8Array) => Uint8Array } }
  ).crypto;
  if (!cryptoApi) throw new Error('crypto-unavailable');
  cryptoApi.getRandomValues(key);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const actual = await createTextOnce(path, JSON.stringify(base64Url(key)) + '\n');
  return keyBytes(JSON.parse(actual)) ?? key;
}

async function readOrCreateEpoch(root: string): Promise<string> {
  for (const name of [DIRECT_HOOK_RUNTIME_FILE, DIRECT_HOOK_RUNTIME_COMPAT_FILE]) {
    try {
      const runtime = JSON.parse(await fs.readFile(join(root, name), 'utf8')) as {
        startedAt?: unknown;
      };
      if (typeof runtime.startedAt === 'string' && runtime.startedAt.length <= 64)
        return `runtime:${runtime.startedAt}`;
    } catch {
      /* runtime may not be running */
    }
  }
  const path = join(root, DIRECT_HOOK_EPOCH_FILE);
  try {
    const value = await fs.readFile(path, 'utf8');
    if (/^[A-Za-z0-9_-]{32,128}$/.test(value.trim())) return value.trim();
  } catch {
    /* First invocation creates a stable adapter epoch. */
  }
  const bytes = new Uint8Array(24);
  const cryptoApi = (
    globalThis as { readonly crypto?: { getRandomValues: (target: Uint8Array) => Uint8Array } }
  ).crypto;
  if (!cryptoApi) throw new Error('crypto-unavailable');
  cryptoApi.getRandomValues(bytes);
  const epoch = base64Url(bytes);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  return (await createTextOnce(path, `${epoch}\n`)).trim();
}

/** Persist only a closed diagnostic code; native input never reaches this file. */
export async function recordDirectDiagnostic(
  adapterId: DirectEventDescriptor['adapterId'],
  code:
    | 'native-input-invalid'
    | 'native-schema-unsupported'
    | 'native-field-invalid'
    | 'runtime-timeout'
    | 'runtime-limit-exceeded',
  gap?: 'spool-overflow' | 'spool-error',
): Promise<void> {
  try {
    const directory = join(environmentRoot(), DIRECT_HOOK_DIAGNOSTICS_DIRECTORY);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const names = await fs.readdir(directory);
    let committed = 0;
    for (const name of names) {
      if (!name.endsWith('.diagnostic')) continue;
      try {
        if (!(await fs.lstat(join(directory, name))).isSymbolicLink()) committed += 1;
      } catch {
        /* A concurrently retired record is not counted. */
      }
    }
    if (committed >= DIRECT_HOOK_DIAGNOSTIC_LIMIT) return;
    // One deterministic record per adapter/code makes the cap invariant even
    // when many independent hook processes report the same failure together.
    const target = join(directory, `direct-hook-${adapterId}-${code}.diagnostic`);
    const body =
      JSON.stringify({ adapterId, code, count: 1, ...(gap === undefined ? {} : { gap }) }) + '\n';
    await createTextOnce(target, body);
  } catch {
    /* Diagnostics are best effort and never affect the native hook response. */
  }
}

function safeComponent(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : fallback;
}

export type DirectEventDescriptor = Readonly<{
  readonly adapterId: 'codeinvaders-codex' | 'codeinvaders-claude-code';
  readonly adapterVersion: string;
  readonly type: CoreEventType;
  readonly checkpoint: readonly string[];
  readonly session?: string;
  readonly workspace?: string;
  readonly repository?: string;
  readonly turn?: string;
  readonly agent?: string;
  readonly parentAgent?: string;
  readonly task?: string;
  readonly operation?: string;
  readonly permission?: string;
  readonly data: unknown;
  readonly finality: 'provisional' | 'confirmed';
  readonly fidelity?: Fidelity;
  readonly semantic?: SemanticMetadata;
  readonly timestamp?: string;
  readonly plan?: readonly Readonly<{
    identity: string;
    status: string;
    ordinal: number;
    identityBasis?:
      | 'stable-native-id'
      | 'exact-normalized-identity'
      | 'exact-ordinal-continuity'
      | 'new-unmatched';
  }>[];
  /** Native full-plan revision. Revision one intentionally omits previousRevision. */
  readonly planRevision?: number;
}>;

type DeliveryResult = Readonly<{
  readonly status: 'acknowledged' | 'spooled' | 'dropped';
  readonly ipc?: IpcResult['status'];
  readonly spool?: SpoolResult['status'];
}>;

async function id(
  deriver: OpaqueIdDeriver,
  type: Parameters<OpaqueIdDeriver['derive']>[0],
  value: string,
): Promise<OpaqueId> {
  return deriver.derive(type, value);
}

/** Builds one valid AAP event from an already-normalized, adapter-owned descriptor. */
export async function buildDirectEvent(
  descriptor: DirectEventDescriptor,
  deriver: OpaqueIdDeriver,
  epoch: string,
): Promise<Record<string, unknown>> {
  const sessionKey = safeComponent(descriptor.session, 'session:unknown');
  const workspaceKey = safeComponent(descriptor.workspace, `workspace:${sessionKey}`);
  const repositoryKey = safeComponent(descriptor.repository, `repository:${workspaceKey}`);
  const turnKey = safeComponent(descriptor.turn, `turn:${sessionKey}`);
  const agentKey = safeComponent(descriptor.agent, `agent:${sessionKey}`);
  const taskKey = safeComponent(descriptor.task, `task:${sessionKey}`);
  const operationKey = safeComponent(
    descriptor.operation,
    `operation:${descriptor.checkpoint.join(':')}`,
  );
  const permissionKey = safeComponent(
    descriptor.permission,
    `permission:${descriptor.checkpoint.join(':')}`,
  );
  const [sessionId, workspaceId, repoId, streamId, epochId] = await Promise.all([
    id(deriver, 'stream', `session:${sessionKey}`),
    id(deriver, 'workspace', workspaceKey),
    id(deriver, 'repository', repositoryKey),
    id(deriver, 'stream', `${descriptor.adapterId}:${sessionKey}`),
    id(deriver, 'stream', `epoch:${epoch}`),
  ]);
  const scope: Record<string, OpaqueId> = { workspaceId, repoId, sessionId };
  const needsTurn =
    descriptor.turn !== undefined ||
    descriptor.type === 'turn.started' ||
    descriptor.type === 'turn.finished' ||
    descriptor.type === 'turn.quiescent' ||
    descriptor.type === 'task.plan.reconciled';
  const needsAgent =
    descriptor.agent !== undefined ||
    descriptor.type === 'agent.spawned' ||
    descriptor.type === 'agent.state.changed' ||
    descriptor.type === 'agent.finished';
  const needsTask =
    descriptor.type.startsWith('task.') && descriptor.type !== 'task.plan.reconciled';
  const needsOperation = descriptor.type.startsWith('tool.');
  const needsPermission = descriptor.type.startsWith('permission.');
  const [turnId, agentId, taskId, operationId, permissionId] = await Promise.all([
    needsTurn ? id(deriver, 'turn', turnKey) : Promise.resolve(undefined),
    needsAgent ? id(deriver, 'agent', agentKey) : Promise.resolve(undefined),
    needsTask ? id(deriver, 'task', taskKey) : Promise.resolve(undefined),
    needsOperation ? id(deriver, 'operation', operationKey) : Promise.resolve(undefined),
    needsPermission ? id(deriver, 'permission', permissionKey) : Promise.resolve(undefined),
  ]);
  if (turnId !== undefined) scope.turnId = turnId;
  if (agentId !== undefined) scope.agentId = agentId;
  if (taskId !== undefined) scope.taskId = taskId;
  if (operationId !== undefined) scope.operationId = operationId;
  if (permissionId !== undefined) scope.permissionId = permissionId;
  // The runtime epoch is part of the retry namespace: a new runtime can reuse
  // a native checkpoint without creating a same-event-id/different-content
  // collision, while retries in one runtime remain byte-identical.
  const eventId = await deriveStableRetryEventId(deriver, [
    ...descriptor.checkpoint,
    `epoch:${epoch}`,
  ]);
  const planItems =
    descriptor.plan === undefined
      ? undefined
      : await Promise.all(
          descriptor.plan.slice(0, 256).map(async (item) => ({
            taskId: await id(deriver, 'task', item.identity),
            status: [
              'pending',
              'in_progress',
              'blocked',
              'completed',
              'failed',
              'denied',
              'cancelled',
              'abandoned',
              'unknown',
            ].includes(item.status)
              ? item.status
              : 'unknown',
            ordinal: item.ordinal,
            identityBasis: item.identityBasis ?? 'stable-native-id',
          })),
        );
  const planRevision =
    descriptor.planRevision !== undefined &&
    Number.isSafeInteger(descriptor.planRevision) &&
    descriptor.planRevision > 0
      ? descriptor.planRevision
      : 1;
  const finalData =
    planItems === undefined
      ? descriptor.data
      : {
          revision: planRevision,
          ...(planRevision > 1 ? { previousRevision: planRevision - 1 } : {}),
          complete: true,
          items: planItems,
        };
  const now = descriptor.timestamp ?? '1970-01-01T00:00:00.000Z';
  const links: Record<string, OpaqueId> = {};
  if (descriptor.parentAgent !== undefined)
    links.parentAgentId = await id(deriver, 'agent', descriptor.parentAgent);
  if (permissionId !== undefined && descriptor.operation !== undefined)
    links.correlationId = await id(deriver, 'operation', descriptor.operation);
  return {
    spec: 'io.github.danium.codeinvaders.aap',
    version: '1.0.0',
    eventId,
    type: descriptor.type,
    occurredAt: now,
    observedAt: now,
    sequence: 0,
    source: {
      adapterId: descriptor.adapterId,
      adapterVersion: descriptor.adapterVersion,
      streamId,
      epochId,
    },
    scope,
    ...(Object.keys(links).length === 0 ? {} : { links }),
    fidelity: descriptor.fidelity ?? 'observed',
    finality: descriptor.finality,
    ...(descriptor.semantic === undefined ? {} : { semantic: descriptor.semantic }),
    data: finalData,
  };
}

function remaining(started: number): number {
  return Math.max(1, Math.min(IPC_DEADLINE_MS, IPC_DEADLINE_MS - (performance.now() - started)));
}

/** Delivers only sanitized canonical text and never exposes transport errors to the hook. */
export async function deliverDirectEvent(
  descriptor: DirectEventDescriptor,
): Promise<DeliveryResult> {
  const started = performance.now();
  try {
    const root = environmentRoot();
    const [key, epoch] = await Promise.all([readOrCreateKey(root), readOrCreateEpoch(root)]);
    const deriver = await createOpaqueIdDeriver(key);
    if (remaining(started) <= 1) return { status: 'dropped' };
    const event = await buildDirectEvent(descriptor, deriver, epoch);
    if (remaining(started) <= 1) return { status: 'dropped' };
    const prepared = sanitizeIngressRecord(event);
    if (prepared.status !== 'accepted') return { status: 'dropped' };
    const handoff = createSanitizedIngressHandoff(prepared);
    const endpoint = deriveInstallationEndpoint(root);
    if (endpoint !== undefined) {
      const ipc = await sendCanonicalIpc(endpoint, handoff, remaining(started));
      if (ipc.status === 'acknowledged') return { status: 'acknowledged', ipc: ipc.status };
      if (remaining(started) <= 1) return { status: 'dropped', ipc: ipc.status };
      const spool = await spoolCanonicalWithDeadline(
        join(root, DIRECT_HOOK_SPOOL_DIRECTORY),
        handoff,
        remaining(started),
      );
      if (spool.status === 'full')
        await diagnosticWithDeadline(
          descriptor.adapterId,
          'runtime-limit-exceeded',
          spool.gap,
          remaining(started),
        );
      return spool.status === 'spooled'
        ? { status: 'spooled', ipc: ipc.status, spool: spool.status }
        : { status: 'dropped', ipc: ipc.status, spool: spool.status };
    }
    const spool = await spoolCanonicalWithDeadline(
      join(root, DIRECT_HOOK_SPOOL_DIRECTORY),
      handoff,
      remaining(started),
    );
    if (spool.status === 'full')
      await diagnosticWithDeadline(
        descriptor.adapterId,
        'runtime-limit-exceeded',
        spool.gap,
        remaining(started),
      );
    return spool.status === 'spooled'
      ? { status: 'spooled', spool: spool.status }
      : { status: 'dropped', spool: spool.status };
  } catch {
    return { status: 'dropped' };
  }
}

async function spoolCanonicalWithDeadline(
  root: string,
  handoff: ReturnType<typeof createSanitizedIngressHandoff>,
  deadline: number,
): Promise<SpoolResult> {
  return new Promise<SpoolResult>((resolveResult) => {
    let done = false;
    const timer = setTimeout(
      () => {
        if (!done) {
          done = true;
          resolveResult({ status: 'rejected', gap: 'spool-error' });
        }
      },
      Math.max(1, Math.floor(deadline)),
    );
    void spoolCanonical(root, handoff)
      .then((result) => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolveResult(result);
        }
      })
      .catch(() => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolveResult({ status: 'rejected', gap: 'spool-error' });
        }
      });
  });
}

async function diagnosticWithDeadline(
  adapterId: DirectEventDescriptor['adapterId'],
  code: Parameters<typeof recordDirectDiagnostic>[1],
  gap: Parameters<typeof recordDirectDiagnostic>[2],
  deadline: number,
): Promise<void> {
  await new Promise<void>((done) => {
    let settled = false;
    const timer = setTimeout(
      () => {
        if (!settled) {
          settled = true;
          done();
        }
      },
      Math.max(1, Math.floor(deadline)),
    );
    void recordDirectDiagnostic(adapterId, code, gap).finally(() => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        done();
      }
    });
  });
}

export async function readDirectHookInput(maxBytes = 32_768): Promise<unknown | undefined> {
  const process = runtimeProcess() as RuntimeProcess & {
    readonly stdin?: {
      setEncoding?: (v: string) => void;
      on?: (e: string, cb: (v: string) => void) => void;
    };
  };
  if (!process.stdin?.on) return undefined;
  process.stdin.setEncoding?.('utf8');
  let text = '';
  let oversized = false;
  return new Promise((resolveInput) => {
    process.stdin!.on!('data', (chunk) => {
      if (oversized) return;
      const value = typeof chunk === 'string' ? chunk : String(chunk);
      if (Buffer.byteLength(text + value, 'utf8') > maxBytes) {
        oversized = true;
        text = '';
        return;
      }
      text += value;
    });
    process.stdin!.on!('end', () => {
      if (oversized) {
        resolveInput(undefined);
        return;
      }
      try {
        resolveInput(JSON.parse(text));
      } catch {
        resolveInput(undefined);
      }
    });
  });
}
