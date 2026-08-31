import { mkdtemp, rm } from 'node:fs/promises';
/* global fetch */
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { LocalBroker } from '../apps/local/dist/broker.js';
import { validEventFixture } from '../packages/protocol/dist/fixtures/index.js';

const events = 200;
const root = await mkdtemp(resolve('.codeinvaders-broker-http-profile-'));
const broker = new LocalBroker({ dataRoot: root, port: 0 });
const eventFor = (index) => ({
  ...validEventFixture('source.heartbeat'),
  eventId: `oid1_${String(index).padStart(42, 'A')}`,
  sequence: index + 1,
  source: { ...validEventFixture('source.heartbeat').source, streamId: 'broker-profile-stream' },
  scope: { workspaceId: 'broker-profile-workspace', sessionId: 'broker-profile-session' },
  data: { uptimeMs: index },
});

try {
  await broker.start();
  const base = broker.origin;
  const exchange = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ secret: broker.sessions.launchToken }),
  });
  if (!exchange.ok) throw new Error(`session-exchange-${exchange.status}`);
  const session = await exchange.json();
  if (!session.token) throw new Error('session-token-missing');
  const auth = { Authorization: `Bearer ${session.token}`, Origin: base };

  const before = process.memoryUsage().heapUsed;
  const ingestStart = performance.now();
  for (let index = 0; index < events; index += 1) {
    const accepted = await broker.ingest(eventFor(index));
    if (!accepted.ok) throw new Error(`ingest-${accepted.code}`);
  }
  const ingestMs = performance.now() - ingestStart;
  const httpStart = performance.now();
  for (let index = 0; index < events; index += 1) {
    const response = await fetch(`${base}/api/state`, { headers: auth });
    if (!response.ok) throw new Error(`state-${response.status}`);
    await response.arrayBuffer();
  }
  const httpMs = performance.now() - httpStart;
  const replayResponse = await fetch(`${base}/api/replay`, { headers: auth });
  if (!replayResponse.ok) throw new Error(`replay-${replayResponse.status}`);
  const replay = await replayResponse.json();
  const replayEvents = Array.isArray(replay.events) ? replay.events.length : -1;
  if (replayEvents !== events) throw new Error(`replay-count-${replayEvents}`);
  const after = process.memoryUsage().heapUsed;
  process.stdout.write(
    JSON.stringify({
      schema: 'codeinvaders.broker-http-profile.v1',
      acceptedEvents: events,
      ingestMeanMs: ingestMs / events,
      replayEvents,
      authenticatedHttpRequests: events,
      httpStateMeanMs: httpMs / events,
      httpRequestsPerSecond: events / (httpMs / 1000),
      heapDeltaMb: Math.max(0, after - before) / (1024 * 1024),
      authStatus: exchange.status,
      noSemanticDrops: replayEvents === events,
    }) + '\n',
  );
} finally {
  await broker.stop();
  await rm(root, { recursive: true, force: true });
}
