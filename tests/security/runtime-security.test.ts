import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BrowserSessionStore,
  RUNTIME_LIMITS,
  isLoopbackHost,
  secureJsonParse,
} from '../../apps/local/src/security.js';
import { hasValidOrigin } from '../../apps/local/src/security.js';
import { LocalBroker } from '../../apps/local/src/broker.js';
import { APP_CSS, CONTENT_SECURITY_POLICY, renderAppShell } from '../../apps/local/src/ui.js';
import {
  EventJournal,
  ownedPath,
  safeDeleteOwned,
  verifyOwnedPath,
} from '../../packages/core/src/index.js';

describe('release security boundary', () => {
  it('accepts only loopback binding and exact browser origins', () => {
    for (const host of ['127.0.0.1', '127.42.9.8', 'localhost', '::1'])
      expect(isLoopbackHost(host)).toBe(true);
    for (const host of ['0.0.0.0', '192.168.1.2', 'attacker.example', '127.0.0.1.example'])
      expect(isLoopbackHost(host)).toBe(false);
    expect(hasValidOrigin('http://127.0.0.1:43123', 'http://127.0.0.1:43123')).toBe(true);
    expect(hasValidOrigin('http://127.0.0.1:43123.evil', 'http://127.0.0.1:43123')).toBe(false);
    expect(hasValidOrigin(undefined, 'http://127.0.0.1:43123')).toBe(false);
  });

  it('bounds hostile JSON before it can enter runtime state', () => {
    expect(() =>
      secureJsonParse(JSON.stringify({ value: 'x'.repeat(RUNTIME_LIMITS.maxBodyBytes) })),
    ).toThrow('payload-too-large');
    expect(() =>
      secureJsonParse(JSON.stringify(Array.from({ length: RUNTIME_LIMITS.maxArrayItems + 1 }))),
    ).toThrow('array-too-large');
    let deep: unknown = 'leaf';
    for (let index = 0; index <= RUNTIME_LIMITS.maxJsonDepth; index++) deep = { next: deep };
    expect(() => secureJsonParse(JSON.stringify(deep))).toThrow('json-too-deep');
  });

  it('keeps launch secrets in the fragment and makes session exchange single-use', () => {
    const store = new BrowserSessionStore();
    const launch = store.launchToken;
    expect(renderAppShell(launch)).not.toContain(launch);
    const session = store.exchange(launch);
    expect(session).toBeDefined();
    expect(store.exchange(launch)).toBeUndefined();
    expect(store.authenticate(session!.token)).toBe(true);
    store.invalidate();
    expect(store.authenticate(session!.token)).toBe(false);
  });

  it('enforces origin and bearer authentication on a real broker process', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeinvaders-security-'));
    const broker = new LocalBroker({ dataRoot: root, port: 0 });
    try {
      const started = await broker.start();
      const base = broker.origin;
      expect(new URL(started.url).hash.length).toBeGreaterThan(1);
      expect(started.url).not.toContain('?');
      expect((await fetch(`${base}/api/health`)).status).toBe(200);
      expect((await fetch(`${base}/api/status`, { headers: { Origin: base } })).status).toBe(401);
      expect(
        (await fetch(`${base}/api/status`, { headers: { Origin: 'http://evil.example' } })).status,
      ).toBe(403);
      const exchanged = await fetch(`${base}/api/session`, {
        method: 'POST',
        headers: { Origin: base, 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: broker.sessions.launchToken }),
      });
      expect(exchanged.status).toBe(200);
      const token = ((await exchanged.json()) as { token: string }).token;
      expect(
        (
          await fetch(`${base}/api/status`, {
            headers: { Origin: base, Authorization: `Bearer ${token}` },
          })
        ).status,
      ).toBe(200);
      const html = await (await fetch(`${base}/`)).text();
      expect(html).not.toContain(broker.sessions.launchToken);
    } finally {
      await broker.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects traversal and symlink escapes, while deleting only owned regular files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeinvaders-paths-'));
    const outside = await mkdtemp(join(tmpdir(), 'codeinvaders-outside-'));
    try {
      expect(ownedPath(root, join(root, '..', 'outside.txt')).ok).toBe(false);
      expect((await verifyOwnedPath(root, join(root, 'missing'))).ok).toBe(false);
      const owned = join(root, 'owned.json');
      await writeFile(owned, '{}');
      expect((await safeDeleteOwned(root, 'owned.json')).ok).toBe(true);
      expect((await safeDeleteOwned(root, 'owned.json')).ok).toBe(false);
      const link = join(root, 'escape');
      let symlinkCreated = false;
      try {
        await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
        symlinkCreated = true;
      } catch {
        // Symlink creation can be disabled by a Windows policy.
      }
      if (symlinkCreated) {
        expect((await verifyOwnedPath(root, link)).ok).toBe(false);
        expect((await safeDeleteOwned(root, 'escape')).ok).toBe(false);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('quarantines malformed journal suffixes without replaying attacker-controlled records', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeinvaders-journal-'));
    try {
      const event = {
        spec: 'io.github.danium.codeinvaders.aap',
        version: '1.0.0',
        eventId: 'journal-safe-event',
        type: 'source.heartbeat',
        occurredAt: '2026-01-01T00:00:00.000Z',
        observedAt: '2026-01-01T00:00:00.000Z',
        sequence: 1,
        source: {
          adapterId: 'security-test',
          adapterVersion: '0.1.0',
          streamId: 'security-stream',
          epochId: 'security-epoch',
        },
        scope: { workspaceId: 'security-workspace', sessionId: 'security-session' },
        fidelity: 'observed',
        finality: 'confirmed',
        data: { uptimeMs: 1 },
      };
      await writeFile(
        join(root, 'segment-00000000.jsonl'),
        `${JSON.stringify(event)}\n{not-json}\n`,
      );
      const journal = new EventJournal({ root, streamId: 'security-stream' });
      const result = await journal.events();
      expect(result.ok).toBe(true);
      expect(result.ok && result.value).toHaveLength(1);
      expect(result.ok && result.value[0]?.eventId).toBe('journal-safe-event');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('ships a local-only CSP with an accessible WebGL fallback', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'self'");
    expect(CONTENT_SECURITY_POLICY).not.toContain('https:');
    const html = renderAppShell('redacted');
    expect(html).toContain('Skip to activity');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Visual arena disabled or unavailable');
    expect(APP_CSS).toContain('@media(prefers-reduced-motion:reduce)');
    expect(APP_CSS).toContain('.high-contrast');
    expect(APP_CSS).toContain('focus-visible');
  });
});
