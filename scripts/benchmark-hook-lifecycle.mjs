import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { spawn } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = Object.freeze({
  codex: resolve(
    ROOT,
    'packaging/marketplace/plugins/codeinvaders/scripts/codeinvaders-codex-hook.mjs',
  ),
  claude: resolve(ROOT, 'packaging/manual/claude/scripts/codeinvaders-claude-hook.mjs'),
});
const MAX_SPOOL_BYTES = 4 * 1024 * 1024;
const MAX_SPOOL_RECORDS = 4096;
const nativeInput = (index) =>
  JSON.stringify({
    hook: 'SessionStart',
    sessionId: 'benchmark-session',
    session_id: 'benchmark-session',
    eventId: `benchmark-event-${index}`,
    workspace: 'benchmark-workspace',
    cwd: 'benchmark-workspace',
    payload: { resume: false, source: 'startup' },
  });

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
}

function childHook(path, dataRoot, index) {
  return new Promise((resolveResult, reject) => {
    const started = performance.now();
    const child = spawn(process.execPath, [path], {
      cwd: ROOT,
      env: { ...process.env, CODEINVADERS_DATA_DIR: dataRoot },
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    });
    let stdout = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveResult({ ...result, elapsedMs: performance.now() - started });
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish({ ok: false, reason: 'child-timeout' });
    }, 2_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.on('error', (error) => {
      if (!settled) reject(error);
    });
    child.on('close', (code) =>
      finish({
        ok: code === 0 && stdout === '{}',
        reason: stdout === '{}' ? undefined : 'hook-response',
      }),
    );
    child.stdin.end(nativeInput(index));
  });
}

async function spoolStats(root) {
  const spool = join(root, 'spool');
  let records = 0;
  let bytes = 0;
  try {
    for (const name of await readdir(spool)) {
      if (!name.endsWith('.ingress')) continue;
      records++;
      bytes += (await stat(join(spool, name))).size;
    }
  } catch {
    /* A missing spool is represented by zero, and is reported as a failed run. */
  }
  return { records, bytes };
}

async function journalStats(root) {
  let records = 0;
  let bytes = 0;
  async function walk(path) {
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.name.endsWith('.jsonl')) {
        records += (await readFile(child, 'utf8')).split('\n').filter(Boolean).length;
        bytes += (await stat(child)).size;
      }
    }
  }
  await walk(root);
  return { records, bytes };
}

async function runCase(hookPath, iterations, mode) {
  const dataRoot = await mkdtemp(join(ROOT, '.codeinvaders-hook-benchmark-'));
  let broker;
  try {
    if (mode === 'ipc') {
      const { LocalBroker } = await import(
        pathToFileURL(resolve(ROOT, 'apps/local/dist/broker.js')).href
      );
      broker = new LocalBroker({ dataRoot, port: 0 });
      await broker.start();
    }
    const samples = [];
    let successful = 0;
    for (let index = 0; index < iterations; index++) {
      const sample = await childHook(hookPath, dataRoot, index);
      samples.push(sample.elapsedMs);
      if (sample.ok) successful++;
    }
    const spool = await spoolStats(dataRoot);
    const journal = await journalStats(join(dataRoot, 'journal'));
    return {
      mode,
      successful,
      samples: samples.length,
      p50Ms: percentile(samples, 0.5),
      p95Ms: percentile(samples, 0.95),
      maxMs: Math.max(...samples),
      spoolRecords: spool.records,
      spoolBytes: spool.bytes,
      journalRecords: journal.records,
      journalBytes: journal.bytes,
      deliveryPass:
        mode === 'ipc'
          ? journal.records === iterations && spool.records === 0
          : spool.records === iterations,
      spoolBoundPass: spool.bytes <= MAX_SPOOL_BYTES && spool.records <= MAX_SPOOL_RECORDS,
    };
  } finally {
    if (broker) await broker.stop();
    await rm(dataRoot, { recursive: true, force: true });
  }
}

export async function benchmarkHookLifecycle({ iterations = 20, budgetMs = 250 } = {}) {
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 200)
    throw new RangeError('iterations must be between 1 and 200');
  const result = { budgetMs, iterations, agents: {} };
  for (const [agent, hookPath] of Object.entries(HOOKS)) {
    const fallback = await runCase(hookPath, iterations, 'spool');
    const ipc = await runCase(hookPath, iterations, 'ipc');
    result.agents[agent] = {
      fallback,
      ipc,
      budgetPass:
        fallback.successful === iterations &&
        ipc.successful === iterations &&
        percentile([fallback.p95Ms, ipc.p95Ms], 0.95) <= budgetMs,
      deliveryPass:
        fallback.deliveryPass && ipc.deliveryPass && fallback.spoolBoundPass && ipc.spoolBoundPass,
    };
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const iterationsArg = process.argv.find((arg) => arg.startsWith('--iterations='));
  const budgetArg = process.argv.find((arg) => arg.startsWith('--budget-ms='));
  const iterations = iterationsArg ? Number(iterationsArg.slice(13)) : 20;
  const budgetMs = budgetArg ? Number(budgetArg.slice(12)) : 250;
  try {
    const report = await benchmarkHookLifecycle({ iterations, budgetMs });
    process.stdout.write(JSON.stringify(report) + '\n');
    process.exitCode = Object.values(report.agents).every(
      (agent) => agent.budgetPass && agent.deliveryPass,
    )
      ? 0
      : 1;
  } catch (error) {
    process.stderr.write(`hook-benchmark: ${error instanceof Error ? error.message : 'failed'}\n`);
    process.exitCode = 2;
  }
}
