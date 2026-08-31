import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const root = resolve(import.meta.dirname, '..', '..');
const cliPath = join(root, 'packages', 'cli', 'dist', 'index.js');
const fixturePath = join(root, 'fixtures', 'replay', 'golden-events.json');
const timeoutMs = 45_000;
const ownershipMarker = 'codeinvaders-owned:v1';

async function availablePort() {
  const server = createServer();
  await new Promise((resolveReady, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, resolveReady);
  });
  const address = server.address();
  await new Promise((resolveClosed, reject) =>
    server.close((error) => (error ? reject(error) : resolveClosed())),
  );
  if (!address || typeof address === 'string') throw new Error('port-probe-failed');
  return address.port;
}

function invoke(args, env) {
  return new Promise((done) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      done(result);
    };
    const child = spawn(process.execPath, [cliPath, ...args, '--json', '--non-interactive'], {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    const timer = setTimeout(() => {
      child.kill();
      finish({ code: null, json: undefined, error: 'timeout' });
    }, timeoutMs);
    timer.unref();
    child.on('error', (error) => {
      clearTimeout(timer);
      finish({
        code: null,
        json: undefined,
        error: error.code === 'ENOENT' ? 'command-not-found' : 'spawn-failed',
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      let json;
      try {
        json = JSON.parse(Buffer.concat(stdout).toString('utf8').trim());
      } catch {
        json = undefined;
      }
      finish({ code, json, error: Buffer.concat(stderr).toString('utf8').slice(0, 240) });
    });
  });
}

async function filesUnder(path) {
  let count = 0;
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true }).catch(() => [])) {
      const child = join(current, entry.name);
      if (entry.isDirectory()) await visit(child);
      else count += 1;
    }
  }
  await visit(path);
  return count;
}

async function runScenario(name, preconfigured) {
  const scenarioRoot = await mkdtemp(join(tmpdir(), `ci-${name[0]}-`));
  const home = join(scenarioRoot, 'home');
  const config = join(home, '.claude', 'settings.json');
  const data = join(scenarioRoot, 'data');
  const replay = join(data, 'fixture.jsonl');
  let runtimePid;
  const unrelated = {
    hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'keep-me' }] }] },
  };
  try {
    if (preconfigured) {
      await mkdir(dirname(config), { recursive: true });
      await writeFile(config, `${JSON.stringify(unrelated)}\n`, 'utf8');
    }
    const env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CODEINVADERS_HOME: home,
      CODEINVADERS_CONFIG_DIR: home,
      CODEINVADERS_DATA_DIR: data,
      CODEINVADERS_CLAUDE_INSTALLED: '1',
      CODEINVADERS_CODEX_INSTALLED: '0',
      CODEINVADERS_BROWSER_COMMAND: '',
    };
    const port = await availablePort();
    const run = async (command, extra = []) => {
      const result = await invoke([command, '--agent', 'claude', '--yes', ...extra], env);
      if (result.code !== 0)
        throw new Error(
          `${name}:${command}:${
            result.json?.data?.checks
              ?.filter((check) => !check.ok)
              .map((check) => check.name)
              .join(',') ||
            result.json?.message ||
            result.error ||
            'failed'
          }`,
        );
      return result.json;
    };
    await run('install');
    const started = await run('start', ['--no-browser', '--port', String(port)]);
    runtimePid = started?.data?.pid;
    const status = await run('status');
    if (!status?.data?.runtime?.running) throw new Error(`${name}:runtime-not-running`);
    if (runtimePid !== status.data.runtime.pid) throw new Error(`${name}:runtime-pid-mismatch`);
    await run('doctor');
    const fixture = await readFile(fixturePath, 'utf8');
    await mkdir(data, { recursive: true });
    await writeFile(replay, fixture.replace(/\r?\n$/, '\n'), 'utf8');
    const replayResult = await run('replay', ['--file', replay]);
    if (replayResult?.data?.canonicalOnly !== true) throw new Error(`${name}:replay-not-canonical`);
    await run('upgrade');
    const upgraded = JSON.parse(await readFile(config, 'utf8'));
    if (!JSON.stringify(upgraded).includes(ownershipMarker))
      throw new Error(`${name}:upgrade-lost-hooks`);
    const removed = await run('uninstall');
    const finalConfig = JSON.parse(await readFile(config, 'utf8'));
    if (JSON.stringify(finalConfig).includes(ownershipMarker))
      throw new Error(`${name}:owned-hooks-remain`);
    if (preconfigured && !JSON.stringify(finalConfig).includes('keep-me'))
      throw new Error(`${name}:unrelated-config-changed`);
    if (removed?.data?.recordingsPreserved !== true || (await filesUnder(data)) === 0)
      throw new Error(`${name}:recordings-not-preserved`);
    return { name, status: 'passed', preconfigured };
  } finally {
    if (runtimePid) {
      try {
        process.kill(runtimePid);
      } catch {
        /* Runtime may have exited during an earlier lifecycle step. */
      }
    }
    await rm(scenarioRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

const results = [];
try {
  results.push(await runScenario('clean', false));
  results.push(await runScenario('preconfigured', true));
  process.stdout.write(
    `${JSON.stringify({ status: 'passed', platform: process.platform, scenarios: results })}\n`,
  );
} catch (error) {
  const reason = error instanceof Error ? error.message : 'lifecycle-verification-failed';
  process.stdout.write(
    `${JSON.stringify({ status: 'failed', platform: process.platform, scenarios: results, reason: reason.slice(0, 240) })}\n`,
  );
  process.exitCode = 1;
}
