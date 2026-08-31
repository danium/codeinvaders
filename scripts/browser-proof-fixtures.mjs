import { createConnection } from 'node:net';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validEventFixture } from '../packages/protocol/dist/fixtures/index.js';
import { reduceEvents } from '../packages/core/dist/index.js';

const dataRoot = process.env.CODEINVADERS_DATA_DIR;
if (!dataRoot) throw new Error('CODEINVADERS_DATA_DIR is required');
const runtime = JSON.parse(await readFile(join(resolve(dataRoot), 'runtime.json'), 'utf8'));
if (!runtime || typeof runtime.ipcPath !== 'string')
  throw new Error('runtime.json does not contain a valid IPC path');
const endpoint = runtime.ipcPath;
const sessionId = 'browser-session';
const workspaceId = 'browser-workspace';
const turnId = 'browser-turn';
let index = 0;
const capabilityFixture = structuredClone(validEventFixture('source.capability.changed').data);
capabilityFixture.capabilities.signals.tools = {
  availability: 'partial',
  evidenceQuality: 'observed',
  coverage: 'partial',
  finality: 'mixed',
  exclusions: [{ code: 'hosted-tools', scope: 'signal' }],
};

function event(type, scope = {}, data = {}, extra = {}) {
  index += 1;
  const base = validEventFixture(type);
  const observedAt = new Date(Date.UTC(2026, 7, 31, 0, 0, index)).toISOString();
  const mergedData = { ...base.data, ...data };
  if (type === 'source.capability.changed') {
    mergedData.effectiveSequence = index;
    mergedData.capabilities = {
      ...mergedData.capabilities,
      effectiveSequence: index,
    };
  }
  return {
    ...base,
    eventId: `browser-proof-${String(index).padStart(3, '0')}`,
    sequence: index,
    occurredAt: observedAt,
    observedAt,
    source: {
      ...base.source,
      streamId: 'browser-proof-stream',
      epochId: 'browser-proof-epoch',
    },
    scope: { ...base.scope, workspaceId, sessionId, ...scope },
    data: mergedData,
    ...extra,
  };
}

const events = [
  event('session.started'),
  event('turn.started', { turnId }),
  event(
    'agent.spawned',
    { turnId, agentId: 'browser-agent' },
    { role: 'worker', depth: 1 },
    { links: { parentAgentId: `root:${sessionId}` } },
  ),
  event(
    'task.created',
    { turnId, taskId: 'browser-task-success' },
    { status: 'in_progress', ordinal: 0, fallback: false },
  ),
  event(
    'task.assigned',
    { turnId, taskId: 'browser-task-success' },
    { assigneeAgentId: 'browser-agent' },
  ),
  event(
    'tool.started',
    { turnId, agentId: 'browser-agent', operationId: 'browser-operation-success' },
    { name: 'read', category: 'read' },
  ),
  event(
    'tool.completed',
    { turnId, agentId: 'browser-agent', operationId: 'browser-operation-success' },
    { name: 'read', category: 'read', resultClass: 'success' },
  ),
  event(
    'tool.started',
    { turnId, agentId: 'browser-agent', operationId: 'browser-operation-denied' },
    { name: 'shell', category: 'shell' },
  ),
  event(
    'tool.failed',
    { turnId, agentId: 'browser-agent', operationId: 'browser-operation-denied' },
    { name: 'shell', category: 'shell', failureClass: 'denied' },
  ),
  event(
    'tool.started',
    { turnId, agentId: 'browser-agent', operationId: 'browser-operation-cancelled' },
    { name: 'shell', category: 'shell' },
  ),
  event(
    'tool.failed',
    { turnId, agentId: 'browser-agent', operationId: 'browser-operation-cancelled' },
    { name: 'shell', category: 'shell', failureClass: 'cancelled' },
  ),
  event(
    'permission.requested',
    { turnId, agentId: 'browser-agent', permissionId: 'browser-permission' },
    { category: 'shell', riskClass: 'execute' },
  ),
  event(
    'permission.resolved',
    { turnId, agentId: 'browser-agent', permissionId: 'browser-permission' },
    { outcome: 'denied' },
  ),
  event('task.completion.requested', { turnId, taskId: 'browser-task-success' }),
  event('task.completed', { turnId, taskId: 'browser-task-success' }),
  event(
    'task.created',
    { turnId, taskId: 'browser-task-failed' },
    { status: 'in_progress', ordinal: 1, fallback: false },
  ),
  event('task.failed', { turnId, taskId: 'browser-task-failed' }),
  event(
    'task.created',
    { turnId, taskId: 'browser-task-cancelled' },
    { status: 'in_progress', ordinal: 2, fallback: false },
  ),
  event('task.cancelled', { turnId, taskId: 'browser-task-cancelled' }),
  event(
    'task.created',
    { turnId, taskId: 'browser-task-abandoned' },
    { status: 'in_progress', ordinal: 3, fallback: false },
  ),
  event('task.abandoned', { turnId, taskId: 'browser-task-abandoned' }),
  event('turn.quiescent', { turnId }, { reason: 'native' }),
  event(
    'tool.started',
    { turnId, agentId: 'browser-agent', operationId: 'browser-operation-resumed' },
    { name: 'read', category: 'read' },
  ),
  event('source.capability.changed', {}, capabilityFixture),
  event('telemetry.gap', {}, { fromSequence: 24, toSequence: 25, reason: 'dropped' }),
  event('turn.started', { turnId: 'browser-fallback-turn' }),
  event(
    'tool.started',
    { turnId: 'browser-fallback-turn', operationId: 'browser-fallback-operation' },
    { name: 'read', category: 'read' },
  ),
  event('session.ended', {}, { reason: 'normal' }),
];

async function send(payload) {
  const body = Buffer.from(JSON.stringify(payload));
  const frame = Buffer.concat([Buffer.from(`CIIP/1 ${body.length}:`), body, Buffer.from('\n')]);
  await new Promise((resolve, reject) => {
    const socket = createConnection(endpoint);
    let output = '';
    socket.setTimeout(2_000);
    socket.on('connect', () => socket.write(frame));
    socket.on('data', (chunk) => {
      output += chunk.toString('utf8');
      if (output.includes('\n')) {
        socket.end();
        if (output.trim() === 'ACK') resolve();
        else reject(new Error(`fixture rejected: ${String(payload.type)}`));
      }
    });
    socket.on('timeout', () => socket.destroy(new Error('fixture timeout')));
    socket.on('error', reject);
  });
}

for (const payload of events) await send(payload);
process.stdout.write(
  `${JSON.stringify({
    delivered: events.length,
    fallbackObjectives: Object.keys(reduceEvents(events).fallbackObjectives),
  })}\n`,
);
