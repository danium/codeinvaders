import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalBroker } from '../../apps/local/src/broker.js';
import { BrowserSessionStore, RUNTIME_LIMITS } from '../../apps/local/src/security.js';
import { APP_JS, renderAppShell } from '../../apps/local/src/ui.js';
import {
  EventJournal,
  initialSemanticState,
  makeSnapshot,
  readSnapshot,
  writeSnapshot,
} from '../../packages/core/src/index.js';

const event = (
  eventId: string,
  type: string,
  sequence: number,
  data: Record<string, unknown> = {},
  scope: Record<string, string> = {},
) => ({
  spec: 'io.github.danium.codeinvaders.aap',
  version: '1.0.0',
  eventId,
  type,
  occurredAt: new Date(1_700_000_000_000 + sequence).toISOString(),
  observedAt: new Date(1_700_000_000_000 + sequence).toISOString(),
  sequence: 0,
  source: {
    adapterId: 'security-test',
    adapterVersion: '0.1.0',
    streamId: 'security-stream',
    epochId: 'security-epoch',
  },
  scope: { workspaceId: 'security-workspace', sessionId: 'security-session', ...scope },
  fidelity: 'observed',
  finality: 'confirmed',
  data,
});

const sessionEvent = (suffix: string, sequence = 1) =>
  event(`session-${suffix}`, 'session.started', sequence, { resume: false });

async function withBroker(run: (broker: LocalBroker) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'codeinvaders-adversarial-'));
  const broker = new LocalBroker({ dataRoot: root, port: 0 });
  try {
    await broker.start();
    await run(broker);
  } finally {
    await broker.stop();
    await rm(root, { recursive: true, force: true });
  }
}

describe('local runtime adversarial ingress', () => {
  it('rejects oversized, malformed, and unsupported-major HTTP/API input', async () => {
    await withBroker(async (broker) => {
      const base = broker.origin;
      const oversized = await fetch(`${base}/api/session`, {
        method: 'POST',
        headers: { Origin: base, 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: 'x'.repeat(RUNTIME_LIMITS.maxBodyBytes) }),
      });
      expect(oversized.status).toBe(400);
      const malformed = await fetch(`${base}/api/session`, {
        method: 'POST',
        headers: { Origin: base, 'Content-Type': 'application/json' },
        body: '{"secret":',
      });
      expect(malformed.status).toBe(400);
      const unsupported = await broker.ingest({ ...sessionEvent('major'), version: '2.0.0' });
      expect(unsupported).toEqual({ ok: false, code: 'invalid-ingress' });
    });
  });

  it('rejects exact-origin attacks and stale launch/session secrets', async () => {
    await withBroker(async (broker) => {
      const base = broker.origin;
      expect(
        (await fetch(`${base}/api/status`, { headers: { Origin: `${base}.evil` } })).status,
      ).toBe(403);
      expect((await fetch(`${base}/api/status`, { headers: { Origin: 'null' } })).status).toBe(403);
      expect(
        (
          await fetch(`${base}/api/status`, {
            headers: { Host: `127.0.0.1:${broker.status().port}`, 'Sec-Fetch-Site': 'cross-site' },
          })
        ).status,
      ).toBe(403);
      const store = new BrowserSessionStore(10, 1_000, 'stale-secret-0123456789');
      const session = store.exchange(store.launchToken, 1_000)!;
      expect(store.authenticate(session.token, 1_009)).toBe(true);
      expect(store.authenticate(session.token, 1_010)).toBe(false);
      expect(store.exchange('stale-secret-0123456789', 1_061)).toBeUndefined();
    });
  });

  it('keeps markup labels inert and never places secrets into HTML or query strings', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const html = renderAppShell(hostile);
    expect(html).not.toContain(hostile);
    expect(APP_JS).not.toContain('innerHTML');
    expect(APP_JS).toContain('textContent');
    expect(APP_JS).toContain('createTextNode');
    expect(html).not.toContain('?secret=');
  });

  it('disconnects a slow client after its bounded queue fills', async () => {
    await withBroker(async (broker) => {
      const session = broker.sessions.exchange(broker.sessions.launchToken)!;
      let destroyed = false;
      let writes = 0;
      const listeners = new Map<string, (...args: unknown[]) => void>();
      const socket = {
        write: () => {
          writes++;
          return writes === 1;
        },
        destroy: () => {
          destroyed = true;
        },
        on: (name: string, listener: (...args: unknown[]) => void) => {
          listeners.set(name, listener);
        },
      } as never;
      expect(
        broker.handleUpgrade(
          {
            url: '/api/live',
            headers: {
              origin: broker.origin,
              host: `127.0.0.1:${broker.status().port}`,
              'sec-websocket-protocol': `codeinvaders-session.${session.token}`,
              'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
            },
            on: () => undefined,
          } as never,
          socket,
        ),
      ).toBe(true);
      // Exercise the queue bound directly. Going through journal ingestion here
      // made the test depend on filesystem timing and occasionally exceed the
      // Windows CI timeout, while the behavior under test is broadcast flow.
      const broadcast = (broker as unknown as { broadcast(message: unknown): void }).broadcast.bind(
        broker,
      );
      for (let index = 0; index < RUNTIME_LIMITS.maxClientQueue + 2; index++)
        broadcast({ type: 'event', event: { sequence: index } });
      expect(destroyed).toBe(true);
      expect(listeners.has('close')).toBe(true);
    });
  });

  it('recovers safely from corrupt journal, snapshot, and local files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeinvaders-corrupt-'));
    try {
      const journalRoot = join(root, 'journal', 's64-c2VjdXJpdHktc3RyZWFt');
      await mkdir(journalRoot, { recursive: true });
      await mkdir(join(root, 'snapshots'), { recursive: true });
      await writeFile(join(journalRoot, 'segment-00000000.jsonl'), '{corrupt}\n');
      await writeFile(join(journalRoot, 'manifest.json'), '{corrupt}');
      await writeFile(join(root, 'snapshots', 'local.snapshot.json'), '{corrupt}');
      await writeFile(join(root, 'config.json'), '{corrupt}');
      await writeFile(join(root, 'local.salt'), '{corrupt}');
      const broker = new LocalBroker({ dataRoot: root, port: 0 });
      await expect(broker.start()).resolves.toBeDefined();
      expect((await fetch(`${broker.origin}/api/health`)).status).toBe(200);
      await broker.stop();
      const snapshotPath = join(root, 'snapshots', 'check.snapshot.json');
      const valid = makeSnapshot(initialSemanticState(), 'security-stream');
      expect((await writeSnapshot(snapshotPath, valid)).ok).toBe(true);
      await writeFile(snapshotPath, '{not-json}');
      expect(await readSnapshot(snapshotPath, 'security-stream')).toEqual({
        ok: false,
        code: 'corrupt',
      });
      const journal = new EventJournal({
        root: join(root, 'journal', 'fresh'),
        streamId: 'fresh-stream',
      });
      expect((await journal.events()).ok).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
