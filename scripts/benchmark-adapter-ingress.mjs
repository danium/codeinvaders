import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { performance } from 'node:perf_hooks';
import {
  sanitizeIngressRecord,
  createSanitizedIngressHandoff,
  deriveInstallationEndpoint,
  sendCanonicalIpc,
  spoolCanonical,
} from '../packages/adapter-sdk/dist/index.js';

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
const iterations = 100;
const root = await fs.mkdtemp(join(tmpdir(), 'codeinvaders-adapter-bench-'));
const endpoint = deriveInstallationEndpoint(root);
if (!endpoint) throw new Error('platform has no valid local endpoint');
const preparation = sanitizeIngressRecord(event);
if (preparation.status !== 'accepted') throw new Error('fixture was rejected');
const handoff = createSanitizedIngressHandoff(preparation);

function receiveFrame(socket) {
  let data = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    data = Buffer.concat([data, Buffer.from(chunk)]);
    const marker = data.indexOf(58);
    if (marker < 0) return;
    const length = Number(data.subarray(7, marker).toString('ascii'));
    if (Number.isSafeInteger(length) && data.length >= marker + 1 + length + 1) socket.end('ACK\n');
  });
}
const server = createServer(receiveFrame);
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(endpoint.address, resolve);
});

async function measure(mode, operation) {
  const start = performance.now();
  for (let i = 0; i < iterations; i += 1) await operation();
  const totalMs = performance.now() - start;
  return {
    mode,
    iterations,
    totalMs,
    meanMs: totalMs / iterations,
    budgetMs: 250,
    withinBudget: totalMs / iterations < 250,
  };
}
const results = [];
results.push(
  await measure('direct-node', () => {
    const result = sanitizeIngressRecord(event);
    if (result.status !== 'accepted') throw new Error('direct rejection');
  }),
);
results.push(
  await measure('ipc-success', async () => {
    const result = await sendCanonicalIpc(endpoint, handoff);
    if (result.status !== 'acknowledged') throw new Error(`IPC ${result.status}`);
  }),
);
const unavailable = deriveInstallationEndpoint(join(root, 'unavailable'));
results.push(
  await measure('broker-absence', async () => {
    const result = await sendCanonicalIpc(unavailable, handoff);
    if (result.status === 'acknowledged') throw new Error('unexpected ACK');
  }),
);
const spool = join(root, 'spool');
results.push(
  await measure('spool-fallback', async () => {
    const result = await sendCanonicalIpc(unavailable, handoff);
    if (result.status !== 'unavailable' && result.status !== 'timed-out')
      throw new Error('unexpected transport result');
    const stored = await spoolCanonical(spool, handoff);
    if (stored.status !== 'spooled') throw new Error(`spool ${stored.status}`);
  }),
);
server.close();
await fs.rm(root, { recursive: true, force: true });
process.stdout.write(
  JSON.stringify({
    schema: 'codeinvaders.adapter-benchmark.v2',
    results,
    bounded: results.every((result) => result.withinBudget),
  }) + '\n',
);
