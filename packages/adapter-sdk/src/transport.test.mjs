import { Buffer } from 'node:buffer';
import { setTimeout } from 'node:timers';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createSanitizedIngressHandoff,
  deriveInstallationEndpoint,
  recoverSpool,
  sanitizeIngressRecord,
  sendCanonicalIpc,
  spoolCanonical,
  validateInstallationEndpoint,
} from './index.js';

const id = 'oid1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const event = {
  spec: 'io.github.danium.codeinvaders.aap',
  version: '1.0.0',
  eventId: id,
  type: 'session.started',
  occurredAt: '2026-01-01T00:00:00.000Z',
  observedAt: '2026-01-01T00:00:00.000Z',
  sequence: 0,
  source: { adapterId: 'adapter-1', adapterVersion: '0.1.0', streamId: id, epochId: id },
  scope: { workspaceId: id, sessionId: id },
  fidelity: 'observed',
  finality: 'confirmed',
  data: { resume: false },
};
const roots = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'ci-sdk-'));
  roots.push(root);
  const preparation = sanitizeIngressRecord(event);
  if (preparation.status !== 'accepted') throw new Error('fixture rejected');
  return { root, handoff: createSanitizedIngressHandoff(preparation) };
}
async function serverAt(address, reply) {
  const server = createServer((socket) =>
    typeof reply === 'function' ? reply(socket) : socket.end(reply),
  );
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(address, resolve);
  });
  return server;
}

describe('bounded ingress transport', () => {
  it('rejects remote, traversal, platform-confused, and forged inputs', async () => {
    expect(
      validateInstallationEndpoint('\\\\server\\pipe\\CodeInvaders-x', 'C:\\CodeInvaders'),
    ).toBeUndefined();
    expect(
      validateInstallationEndpoint('/tmp/CodeInvaders.sock', 'C:\\CodeInvaders'),
    ).toBeUndefined();
    expect(
      validateInstallationEndpoint(
        'C:\\CodeInvaders\\..\\other\\CodeInvaders.sock',
        'C:\\CodeInvaders',
      ),
    ).toBeUndefined();
    await expect(
      sendCanonicalIpc({ kind: 'unix', address: '/tmp/pipe' }, 'raw', 10),
    ).resolves.toEqual({ status: 'unavailable' });
    expect(() =>
      createSanitizedIngressHandoff({ status: 'accepted', canonicalJson: '{}', eventId: id }),
    ).toThrow();
  });
  it('delivers exact framing and handles split ACK, junk, oversized, EOF, timeout, and late data', async () => {
    const { root, handoff } = await fixture();
    const endpoint = deriveInstallationEndpoint(root);
    let received = Buffer.from('');
    let replyStarted = false;
    const server = await serverAt(endpoint.address, (socket) =>
      socket.on('data', (chunk) => {
        received = Buffer.concat([received, Buffer.from(chunk)]);
        if (!replyStarted) {
          replyStarted = true;
          socket.write('A');
          setTimeout(() => {
            socket.end('CK\n');
          }, 1);
        }
      }),
    );
    await expect(sendCanonicalIpc(endpoint, handoff)).resolves.toEqual({ status: 'acknowledged' });
    server.unref();
    server.close();
    expect(received.toString()).toMatch(/^CIIP\/1 \d+:\{.*\}\n$/);
    for (const [reply, status] of [
      ['NOPE', 'malformed-ack'],
      ['A'.repeat(129), 'malformed-ack'],
      ['A', 'timed-out'],
      ['', 'timed-out'],
    ]) {
      const ep = deriveInstallationEndpoint(join(root, `case-${reply.length}-${status}`));
      const s = await serverAt(ep.address, (socket) => {
        if (status !== 'timed-out' || reply) socket.end(reply);
        else setTimeout(() => socket.destroy(), 100);
      });
      const result = await sendCanonicalIpc(ep, handoff, 30);
      expect(result.status).toBe(status);
      s.unref();
      s.close();
    }
  });
  it('spools atomically, privately, idempotently, recovers corruption, and enforces quotas', async () => {
    const { root, handoff } = await fixture();
    const spool = join(root, 'spool');
    await expect(spoolCanonical(spool, handoff)).resolves.toEqual({ status: 'spooled' });
    await expect(spoolCanonical(spool, handoff, { bytes: 1, records: 1 })).resolves.toEqual({
      status: 'spooled',
    });
    const files = await fs.readdir(spool);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.ingress$/);
    expect(await recoverSpool(spool)).toHaveLength(1);
    await fs.writeFile(join(spool, 'bad.ingress'), 'not-json\n');
    await fs.writeFile(join(spool, '.partial.tmp'), '{}');
    expect(await recoverSpool(spool)).toHaveLength(1);
    expect((await fs.readdir(spool)).some((x) => x.endsWith('.quarantine'))).toBe(true);
    expect(await spoolCanonical(join(root, 'full'), handoff, { bytes: 1, records: 1 })).toEqual({
      status: 'full',
      gap: 'spool-overflow',
    });
  });
});
