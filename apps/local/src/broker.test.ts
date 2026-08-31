import { describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import { startLocalBroker } from './broker.js';
import { encodeIpcFrame } from './ipc.js';

const testEvent = (eventId: string, streamId: string, sessionId: string) => ({
  spec: 'io.github.danium.codeinvaders.aap',
  version: '1.0.0',
  eventId,
  type: 'session.started',
  occurredAt: new Date().toISOString(),
  observedAt: new Date().toISOString(),
  sequence: 0,
  source: { adapterId: 'test', adapterVersion: '1.0.0', streamId, epochId: 'epoch' },
  scope: { workspaceId: 'workspace', sessionId },
  fidelity: 'observed',
  finality: 'confirmed',
  data: { resume: false },
});

describe('local broker integration', () => {
  it('serves authenticated state only on the exact loopback origin', async () => {
    const root = join(process.cwd(), `.local-runtime-test-${Date.now()}`);
    const broker = await startLocalBroker({ port: 0, dataRoot: root });
    try {
      const base = `http://127.0.0.1:${broker.status().port}`;
      expect((await fetch(`${base}/api/health`)).status).toBe(200);
      expect((await fetch(`${base}/api/state`, { headers: { Origin: base } })).status).toBe(401);
      const initialExchange = await fetch(`${base}/api/session`, {
        method: 'POST',
        headers: { Origin: base, 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: broker.sessions.launchToken }),
      });
      expect(initialExchange.status).toBe(200);
      const initialSession = (await initialExchange.json()) as { token: string };
      expect(
        (
          await fetch(`${base}/api/state`, {
            headers: { Authorization: `Bearer ${initialSession.token}` },
          })
        ).status,
      ).toBe(200);
      const exchange = await fetch(`${base}/api/session`, {
        method: 'POST',
        headers: { Origin: base, 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: broker.sessions.launchToken }),
      });
      expect(exchange.status).toBe(401);
      expect((await fetch(`${base}/assets/app.v0.1.0.js`)).status).toBe(200);
      expect(await (await fetch(`${base}/assets/arena.v0.1.0.js`)).text()).toContain(
        'InstancedMesh',
      );
      expect((await fetch(`${base}/assets/three.v0.180.0.module.js`)).status).toBe(200);
      expect((await fetch(`${base}/assets/three.core.js`)).status).toBe(200);
    } finally {
      await broker.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
  it('keeps the running broker coherent after delete-all and removes diagnostics', async () => {
    const root = join(process.cwd(), `.local-runtime-delete-${Date.now()}`);
    const broker = await startLocalBroker({ port: 0, dataRoot: root });
    try {
      expect(
        (await broker.ingest(testEvent('before-delete', 'delete-stream', 'delete-session'))).ok,
      ).toBe(true);
      const diagnosticPath = join(root, 'diagnostics', 'direct-hook-test.diagnostic');
      const { writeFile, access } = await import('node:fs/promises');
      await writeFile(diagnosticPath, '{"code":"runtime-timeout"}\n');
      const deleted = (await broker.deleteAll(true)) as { skipped: readonly string[] };
      expect(deleted.skipped).toHaveLength(0);
      await expect(access(diagnosticPath)).rejects.toThrow();
      expect(
        (await broker.ingest(testEvent('after-delete', 'fresh-stream', 'fresh-session'))).ok,
      ).toBe(true);
    } finally {
      await broker.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
  it('accepts the adapter SDK CIIP framed handoff and acknowledges after journal append', async () => {
    const root = join(process.cwd(), `.local-runtime-ipc-test-${Date.now()}`);
    const broker = await startLocalBroker({ port: 0, dataRoot: root });
    const event = JSON.stringify({
      spec: 'io.github.danium.codeinvaders.aap',
      version: '1.0.0',
      eventId: 'ipc-event',
      type: 'session.started',
      occurredAt: new Date().toISOString(),
      observedAt: new Date().toISOString(),
      sequence: 0,
      source: {
        adapterId: 'test',
        adapterVersion: '1.0.0',
        streamId: 'stream-ipc',
        epochId: 'epoch',
      },
      scope: { workspaceId: 'workspace', sessionId: 'session-ipc' },
      fidelity: 'observed',
      finality: 'confirmed',
      data: { resume: false },
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = createConnection(broker.ipcPath);
        let response = '';
        socket.once('error', reject);
        socket.on('data', (chunk) => {
          response += String(chunk);
          if (response === 'ACK\n') {
            expect(response).toBe('ACK\n');
            socket.destroy();
            resolve();
          } else if (response === 'ERR\n') reject(new Error('broker rejected CIIP frame'));
        });
        socket.once('connect', () => {
          socket.write(encodeIpcFrame(event));
          setTimeout(() => socket.end(), 100);
        });
      });
    } finally {
      await broker.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
  it('recovers every stream journal after restart', async () => {
    const root = join(process.cwd(), `.local-runtime-restart-${Date.now()}`);
    const first = await startLocalBroker({ port: 0, dataRoot: root });
    try {
      expect(
        (await first.ingest(testEvent('restart-event', 'restart-stream', 'restart-session'))).ok,
      ).toBe(true);
    } finally {
      await first.stop();
    }
    const second = await startLocalBroker({ port: 0, dataRoot: root });
    try {
      const base = second.origin;
      const exchange = await fetch(`${base}/api/session`, {
        method: 'POST',
        headers: { Origin: base, 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: second.sessions.launchToken }),
      });
      const session = (await exchange.json()) as { token: string };
      const state = await fetch(`${base}/api/state`, {
        headers: { Origin: base, Authorization: `Bearer ${session.token}` },
      });
      const payload = (await state.json()) as { state: { sessions: Record<string, unknown> } };
      expect(payload.state.sessions['restart-session']).toBeDefined();
    } finally {
      await second.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
  it('uses the supplied one-use launch secret and invalidates the prior session on restart', async () => {
    const root = join(process.cwd(), `.local-runtime-secret-${Date.now()}`);
    const launchSecret = 'test-launch-secret-0123456789';
    const first = await startLocalBroker({ port: 0, dataRoot: root, launchSecret });
    const firstBase = first.origin;
    const firstExchange = await fetch(`${firstBase}/api/session`, {
      method: 'POST',
      headers: { Origin: firstBase, 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: launchSecret }),
    });
    const firstSession = (await firstExchange.json()) as { token: string };
    await first.stop();
    const second = await startLocalBroker({ port: 0, dataRoot: root, launchSecret });
    try {
      expect(
        (
          await fetch(`${second.origin}/api/state`, {
            headers: { Authorization: `Bearer ${firstSession.token}` },
          })
        ).status,
      ).toBe(401);
      const secondExchange = await fetch(`${second.origin}/api/session`, {
        method: 'POST',
        headers: { Origin: second.origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: launchSecret }),
      });
      expect(secondExchange.status).toBe(200);
      const html = await (await fetch(`${second.origin}/`)).text();
      expect(html).not.toContain(launchSecret);
    } finally {
      await second.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
  it('completes an authenticated live WebSocket handshake and receives semantic events', async () => {
    const root = join(process.cwd(), `.local-runtime-ws-${Date.now()}`);
    const broker = await startLocalBroker({ port: 0, dataRoot: root });
    const base = broker.origin;
    try {
      const exchange = await fetch(`${base}/api/session`, {
        method: 'POST',
        headers: { Origin: base, 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: broker.sessions.launchToken }),
      });
      const session = (await exchange.json()) as { token: string };
      const socket = createConnection(broker.status().port, '127.0.0.1');
      const received = new Promise<string>((resolve, reject) => {
        let text = '';
        socket.once('error', reject);
        socket.on('data', (chunk) => {
          text += String(chunk);
          if (text.includes('session.live')) resolve(text);
        });
        socket.once('connect', () =>
          socket.write(
            `GET /api/live HTTP/1.1\r\nHost: 127.0.0.1:${broker.status().port}\r\nOrigin: ${base}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: codeinvaders-session.${session.token}\r\n\r\n`,
          ),
        );
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      await broker.ingest(testEvent('live-event', 'live-stream', 'session.live'));
      expect((await received).includes('session.live')).toBe(true);
      socket.destroy();
    } finally {
      await broker.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
});
