import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { homedir, platform } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export interface AppDataPaths {
  readonly root: string;
  readonly journal: string;
  readonly spool: string;
  readonly snapshots: string;
  readonly diagnostics: string;
  readonly config: string;
  readonly salt: string;
}
export async function discoverJournalStreams(root: string): Promise<readonly string[]> {
  try {
    const names: string[] = [];
    for (const name of await readdir(root)) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(name)) continue;
      const info = await lstat(join(root, name));
      if (!info.isSymbolicLink?.() && info.isDirectory?.()) names.push(name);
    }
    return names.sort();
  } catch {
    return [];
  }
}
export function applicationDataRoot(env: Record<string, string | undefined> = process.env): string {
  if (env.CODEINVADERS_DATA_DIR) return resolve(env.CODEINVADERS_DATA_DIR);
  if (platform() === 'win32')
    return join(env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'CodeInvaders');
  return join(env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'codeinvaders');
}
export function appDataPaths(root = applicationDataRoot()): AppDataPaths {
  const owned = resolve(root);
  return {
    root: owned,
    journal: join(owned, 'journal'),
    spool: join(owned, 'spool'),
    snapshots: join(owned, 'snapshots'),
    diagnostics: join(owned, 'diagnostics'),
    config: join(owned, 'runtime.json'),
    salt: join(owned, 'local.salt'),
  };
}
export async function ensureAppData(paths = appDataPaths()): Promise<AppDataPaths> {
  await mkdir(paths.root, { recursive: true, mode: 0o700 });
  await Promise.all(
    [paths.journal, paths.spool, paths.snapshots, paths.diagnostics].map((dir) =>
      mkdir(dir, { recursive: true, mode: 0o700 }),
    ),
  );
  try {
    await chmod(paths.root, 0o700);
  } catch {
    /* Windows ACLs are inherited and platform-managed. */
  }
  return paths;
}
function owned(root: string, child: string): boolean {
  const base = resolve(root),
    target = resolve(child);
  const rel = relative(base, target);
  return (
    rel === '' ||
    (rel !== '..' && !rel.startsWith(`..${'\\'}`) && !rel.startsWith('../') && !isAbsolute(rel))
  );
}
export async function atomicWriteJson(
  path: string,
  value: unknown,
  root = dirname(path),
): Promise<void> {
  if (!owned(root, path)) throw new Error('unsafe-path');
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
  await rename(temp, path);
}
export async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}
const saltCreations = new Map<string, Promise<string>>();
async function createOrReadSalt(paths: AppDataPaths): Promise<string> {
  const existing = await readJson<string>(paths.salt);
  if (typeof existing === 'string' && /^[A-Za-z0-9_-]{32,}$/.test(existing)) return existing;
  const salt = randomBytes(32).toString('base64url');
  await mkdir(paths.root, { recursive: true, mode: 0o700 });
  const temporary = `${paths.salt}.${process.pid}.${Date.now()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(salt)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temporary, paths.salt);
    await unlink(temporary);
    return salt;
  } catch {
    try {
      await unlink(temporary);
    } catch {
      /* another creator may have won the link race */
    }
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const winner = await readJson<string>(paths.salt);
      if (typeof winner === 'string' && /^[A-Za-z0-9_-]{32,}$/.test(winner)) return winner;
      await new Promise<void>((resolveWait) => setTimeout(resolveWait, 5));
    }
    throw new Error('salt-creation-race');
  }
}
export async function readOrCreateSalt(paths = appDataPaths()): Promise<string> {
  const key = resolve(paths.salt);
  const pending = saltCreations.get(key);
  if (pending !== undefined) return pending;
  const work = createOrReadSalt(paths);
  saltCreations.set(key, work);
  try {
    return await work;
  } finally {
    if (saltCreations.get(key) === work) saltCreations.delete(key);
  }
}
export async function writeRuntimeConfig<T>(paths: AppDataPaths, config: T): Promise<void> {
  await atomicWriteJson(paths.config, config, paths.root);
}
export async function readRuntimeConfig<T>(paths: AppDataPaths): Promise<T | undefined> {
  return readJson<T>(paths.config);
}
export async function recoverSdkIngress(
  root: string,
  onRecord: (canonicalJson: string) => Promise<boolean>,
  maxRecords = 4096,
  maxRecordBytes = 1_048_576,
): Promise<{ readonly recovered: number; readonly quarantined: number }> {
  let recovered = 0;
  let quarantined = 0;
  try {
    for (const name of (await readdir(root))
      .filter((entry) => entry.endsWith('.ingress'))
      .sort()
      .slice(0, maxRecords)) {
      const path = join(root, name);
      try {
        const info = await lstat(path);
        if (info.isSymbolicLink?.()) {
          quarantined++;
          continue;
        }
        const content = await readFile(path, 'utf8');
        if (!content.endsWith('\n') || Buffer.byteLength(content) > maxRecordBytes) {
          quarantined++;
          continue;
        }
        const canonicalJson = content.slice(0, -1);
        JSON.parse(canonicalJson);
        if (await onRecord(canonicalJson)) {
          await rename(path, `${path}.retired`);
          recovered++;
        } else quarantined++;
      } catch {
        quarantined++;
      }
    }
  } catch {
    /* absent spool is an empty, healthy spool */
  }
  return { recovered, quarantined };
}
export async function safeDeleteAll(
  paths: AppDataPaths,
): Promise<{ readonly removed: number; readonly skipped: readonly string[] }> {
  const skipped: string[] = [];
  let removed = 0;
  for (const target of [paths.journal, paths.spool, paths.snapshots, paths.diagnostics]) {
    try {
      const info = await lstat(target);
      if (info.isSymbolicLink?.()) {
        skipped.push(target);
        continue;
      }
      const actual = await realpath(target);
      if (!owned(paths.root, actual)) {
        skipped.push(target);
        continue;
      }
      await rm(actual, { recursive: true, force: true });
      removed++;
      await mkdir(target, { recursive: true, mode: 0o700 });
    } catch {
      /* absent directories are already clean */
    }
  }
  return { removed, skipped };
}
