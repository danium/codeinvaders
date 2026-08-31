import { lstat, realpath, mkdir, readdir, unlink } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';

export type SafeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: 'unsafe-path' | 'not-owned' | 'io-failure' };
const comparable = (value: string): string =>
  process.platform === 'win32' ? value.toLowerCase() : value;
const outside = (base: string, target: string): boolean => {
  const rel = relative(comparable(base), comparable(target));
  return rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || rel.includes('\0');
};
/** Lexical ownership check. It never reads or follows the candidate. */
export function ownedPath(root: string, child: string): SafeResult<string> {
  try {
    const base = resolve(root),
      target = resolve(child);
    return outside(base, target) ? { ok: false, code: 'unsafe-path' } : { ok: true, value: target };
  } catch {
    return { ok: false, code: 'unsafe-path' };
  }
}
/** Physical ownership check. Symlink/junction targets outside root are rejected. */
export async function verifyOwnedPath(root: string, child: string): Promise<SafeResult<string>> {
  const checked = ownedPath(root, child);
  if (!checked.ok) return checked;
  try {
    const info = await lstat(checked.value);
    if (info.isSymbolicLink?.()) return { ok: false, code: 'unsafe-path' };
    const [base, actual] = await Promise.all([realpath(resolve(root)), realpath(checked.value)]);
    return outside(base, actual) ? { ok: false, code: 'unsafe-path' } : { ok: true, value: actual };
  } catch {
    return { ok: false, code: 'not-owned' };
  }
}
export async function safeMkdir(root: string): Promise<SafeResult<string>> {
  try {
    const resolved = resolve(root);
    await mkdir(resolved, { recursive: true, mode: 0o700 });
    return { ok: true, value: resolved };
  } catch {
    return { ok: false, code: 'io-failure' };
  }
}
/** Delete only a regular file physically inside root; never follows a link. */
export async function safeDeleteOwned(root: string, name: string): Promise<SafeResult<void>> {
  // Do not let path.join reinterpret an absolute attacker-controlled name as a child.
  const candidate = /^[\\/]|^[A-Za-z]:[\\/]/.test(name) ? name : join(root, name);
  const p = ownedPath(root, candidate);
  if (!p.ok) return p;
  try {
    const info = await lstat(p.value);
    if (!info.isFile()) return { ok: false, code: 'not-owned' };
    const verified = await verifyOwnedPath(root, p.value);
    if (!verified.ok) return verified;
    // Unlink the physically verified path. The lexical spelling may be an
    // alias of the trusted root (for example /var -> /private/var on macOS).
    await unlink(verified.value);
    return { ok: true, value: undefined };
  } catch {
    return { ok: false, code: 'io-failure' };
  }
}
export async function ownedFiles(root: string): Promise<SafeResult<readonly string[]>> {
  try {
    const entries: string[] = [];
    for (const name of await readdir(root)) {
      if (!name.endsWith('.jsonl') && name !== 'manifest.json') continue;
      const checked = await verifyOwnedPath(root, join(root, name));
      if (checked.ok) entries.push(name);
    }
    return { ok: true, value: entries };
  } catch {
    return { ok: false, code: 'io-failure' };
  }
}
