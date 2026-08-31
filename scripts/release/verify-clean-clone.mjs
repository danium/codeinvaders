import { Buffer } from 'node:buffer';
import { cp, mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers';

const root = resolve(import.meta.dirname, '..', '..');
const outputBase = resolve(
  root,
  process.argv.find((value) => value.startsWith('--output='))?.slice(9) ??
    'dist/release/clean-clone-verification',
);
const maxOutputBytes = 256 * 1024;
const requestedTimeout = Number(
  process.argv.find((value) => value.startsWith('--timeout-ms='))?.slice(13),
);
const defaultTimeoutMs =
  Number.isSafeInteger(requestedTimeout) && requestedTimeout >= 1_000
    ? requestedTimeout
    : 5 * 60 * 1000;

function run(command, args, options = {}) {
  const captureLimit = options.captureLimit ?? maxOutputBytes;
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  return new Promise((resolveResult) => {
    const started = Date.now();
    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd ?? root,
        env: options.env ?? process.env,
        // Windows exposes pnpm as a .cmd shim; shell is enabled only for this fixed executable.
        shell: process.platform === 'win32' && command.toLowerCase().endsWith('.cmd'),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolveResult({
        code: null,
        stdout: '',
        stderr:
          error instanceof Error && error.message === 'spawn EINVAL'
            ? 'spawn-einval'
            : 'spawn-failed',
        durationMs: Date.now() - started,
        truncated: false,
        timedOut: false,
      });
      return;
    }
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncated = false;
    let timedOut = false;
    const collect = (target, chunk, current, limit) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      if (current < limit) {
        const kept = bytes.subarray(0, limit - current);
        target.push(kept);
      }
      if (current + bytes.length > limit) truncated = true;
      return current + bytes.length;
    };
    child.stdout.on('data', (chunk) => {
      stdoutBytes = collect(stdout, chunk, stdoutBytes, captureLimit);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes = collect(stderr, chunk, stderrBytes, captureLimit);
    });
    child.on('error', (error) =>
      resolveResult({
        code: null,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: error.code === 'ENOENT' ? 'command-not-found' : 'command-failed',
        durationMs: Date.now() - started,
        truncated,
        timedOut,
      }),
    );
    child.on('close', (code, signal) =>
      resolveResult({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        durationMs: Date.now() - started,
        truncated,
        timedOut,
      }),
    );
    setTimeout(() => {
      if (child.exitCode === null && !child.killed) {
        timedOut = true;
        if (process.platform === 'win32' && child.pid) {
          // pnpm.cmd starts a child node process; terminate only this command tree.
          spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
            stdio: 'ignore',
            windowsHide: true,
          });
        } else child.kill('SIGTERM');
        resolveResult({
          code: null,
          signal: 'timeout',
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: 'timeout',
          durationMs: Date.now() - started,
          truncated,
          timedOut,
        });
      }
    }, timeoutMs).unref();
  });
}

function pnpmInvocation(args) {
  if (process.platform === 'win32') {
    const candidates = [
      process.env.APPDATA &&
        join(process.env.APPDATA, 'npm', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'),
      process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'pnpm', 'pnpm.cjs'),
    ].filter(Boolean);
    const script = candidates.find((candidate) => existsSync(candidate));
    if (script) return { command: process.execPath, args: [script, ...args] };
    return { command: 'pnpm.cmd', args };
  }
  return { command: 'pnpm', args };
}

function safeText(value) {
  const sanitized = String(value)
    .replace(/file:\/\/\/[A-Za-z]:\/[^\r\n ]*/gi, '<path>')
    .replace(/[A-Za-z]:[\\/][^\r\n ]*/g, '<path>')
    .replace(/(?:^|[\s(])\/(?:[^\s/]+\/)+[^\s)]*/g, '$1<path>')
    .replace(
      /\b(?:npm_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g,
      '<redacted-secret>',
    )
    .replace(
      /\b(?:prompt|message|command|output|transcript|credential|token|secret|username|remote)\b/gi,
      '<redacted>',
    );
  if (sanitized.length <= 720) return sanitized;
  return `${sanitized.slice(0, 240)}\n...\n${sanitized.slice(-440)}`;
}

function outcome(name, result, required = true) {
  const ok = result.code === 0;
  return {
    name,
    required,
    status: ok ? 'passed' : 'failed',
    exitCode: result.code,
    signal: result.signal ?? null,
    durationMs: result.durationMs,
    ...(ok ? {} : { reason: safeText(result.stderr || result.stdout || 'command-failed') }),
    ...(result.timedOut ? { reason: 'timeout' } : {}),
  };
}

async function commandVersion(command, args, cwd) {
  const invocation = command === 'pnpm' ? pnpmInvocation(args) : { command, args };
  const result = await run(invocation.command, invocation.args, { cwd });
  const value = result.stdout.trim().split(/\r?\n/)[0] ?? '';
  return /^[A-Za-z0-9_.+:/ -]{1,80}$/.test(value) ? value : '<unavailable>';
}

async function cli(cwd, env, args) {
  return run(process.execPath, ['packages/cli/dist/index.js', ...args], { cwd, env });
}

function parseCliJson(result) {
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    return undefined;
  }
}

function referencedHookPaths(value) {
  const paths = [];
  const visit = (current) => {
    if (typeof current === 'string') {
      for (const match of current.matchAll(/(?:\.\/)?(scripts\/[^\s"']+\.mjs)/g))
        paths.push(match[1]);
    } else if (Array.isArray(current)) current.forEach(visit);
    else if (current && typeof current === 'object') Object.values(current).forEach(visit);
  };
  visit(value);
  return [...new Set(paths)];
}

async function validateAndInstallCodexPlugin(cloneRoot, codexHome, packageVersion) {
  const marketplacePath = join(
    cloneRoot,
    'packaging',
    'marketplace',
    '.agents',
    'plugins',
    'marketplace.json',
  );
  const pluginRoot = join(cloneRoot, 'packaging', 'marketplace', 'plugins', 'codeinvaders');
  const manifestPath = join(pluginRoot, '.codex-plugin', 'plugin.json');
  const hooksPath = join(pluginRoot, 'hooks.json');
  let marketplace;
  let manifest;
  let hooks;
  try {
    marketplace = JSON.parse(await readFile(marketplacePath, 'utf8'));
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    hooks = JSON.parse(await readFile(hooksPath, 'utf8'));
  } catch {
    return { status: 'failed', reason: 'codex-marketplace-or-plugin-manifest-missing' };
  }
  if (marketplace.name !== 'codeinvaders-local')
    return { status: 'failed', reason: 'codex-marketplace-ownership-name-mismatch' };
  const registered = marketplace.plugins?.find((entry) => entry?.name === 'codeinvaders');
  if (registered?.source?.path !== './plugins/codeinvaders')
    return { status: 'failed', reason: 'codex-marketplace-plugin-source-mismatch' };
  if (manifest.version !== packageVersion)
    return { status: 'failed', reason: 'codex-plugin-version-mismatch' };
  const refs = referencedHookPaths({ manifest, hooks });
  if (refs.length === 0) return { status: 'failed', reason: 'codex-plugin-hook-reference-missing' };
  for (const ref of refs) {
    try {
      await readFile(join(pluginRoot, ref), 'utf8');
    } catch {
      return { status: 'failed', reason: 'codex-plugin-referenced-hook-missing' };
    }
  }
  const destination = join(codexHome, 'plugins', 'codeinvaders');
  await mkdir(join(codexHome, 'plugins'), { recursive: true });
  await cp(pluginRoot, destination, { recursive: true });
  try {
    await readFile(join(destination, '.codex-plugin', 'plugin.json'), 'utf8');
    await readFile(join(destination, 'hooks.json'), 'utf8');
    for (const ref of refs) await readFile(join(destination, ref), 'utf8');
  } catch {
    return { status: 'failed', reason: 'codex-plugin-isolated-install-failed' };
  }
  return {
    status: 'passed',
    reason: 'validated-and-installed-in-isolated-codex-home',
    selector: 'codeinvaders@codeinvaders-local',
  };
}

async function validateAndInstallClaudeHooks(cloneRoot, claudeHome, packageVersion) {
  const manualRoot = join(cloneRoot, 'packaging', 'manual', 'claude');
  let manifest;
  let hooks;
  try {
    manifest = JSON.parse(await readFile(join(manualRoot, 'manifest.json'), 'utf8'));
    hooks = JSON.parse(await readFile(join(manualRoot, 'hooks.json'), 'utf8'));
  } catch {
    return { status: 'failed', reason: 'claude-manual-manifest-or-hooks-missing' };
  }
  if (manifest.version !== packageVersion)
    return { status: 'failed', reason: 'claude-manual-version-mismatch' };
  const refs = referencedHookPaths(hooks);
  if (refs.length === 0)
    return { status: 'failed', reason: 'claude-manual-hook-reference-missing' };
  for (const ref of refs) {
    try {
      await readFile(join(manualRoot, ref), 'utf8');
    } catch {
      return { status: 'failed', reason: 'claude-manual-referenced-hook-missing' };
    }
  }
  const destination = join(claudeHome, 'codeinvaders');
  await mkdir(claudeHome, { recursive: true });
  await cp(manualRoot, destination, { recursive: true });
  try {
    await readFile(join(destination, 'manifest.json'), 'utf8');
    await readFile(join(destination, 'hooks.json'), 'utf8');
    for (const ref of refs) await readFile(join(destination, ref), 'utf8');
  } catch {
    return { status: 'failed', reason: 'claude-manual-isolated-install-failed' };
  }
  return { status: 'passed', reason: 'validated-and-installed-in-isolated-claude-config' };
}

async function writeReports(report) {
  const jsonPath = `${outputBase}.json`;
  const markdownPath = `${outputBase}.md`;
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const rows = report.steps
    .map(
      (step) =>
        `| ${step.name} | ${step.status} | ${step.exitCode ?? 'n/a'} | ${step.durationMs} | ${step.reason ?? ''} |`,
    )
    .join('\n');
  const markdown = `# Clean-clone verification\n\nStatus: **${report.status}**\n\nCommit: \`${report.commit}\`\n\nThis report contains no checkout paths, native agent data, or command output.\n\n## Toolchain\n\n- Node.js: ${report.toolchain.node}\n- pnpm: ${report.toolchain.pnpm}\n- Git: ${report.toolchain.git}\n- Package version: ${report.packageVersion}\n\n## Steps\n\n| Step | Status | Exit | Duration (ms) | Reason |\n| --- | --- | ---: | ---: | --- |\n${rows}\n\n## Lifecycle checks\n\n- Isolated configuration: ${report.lifecycle.isolatedConfiguration}\n- Recordings preserved after uninstall: ${report.lifecycle.recordingsPreserved}\n- Absolute paths in report: none\n`;
  await writeFile(markdownPath, markdown, 'utf8');
  return {
    json: relative(root, jsonPath).replaceAll('\\', '/'),
    markdown: relative(root, markdownPath).replaceAll('\\', '/'),
  };
}

async function removeTemporaryRoot(path) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return true;
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
  }
  return false;
}

const tempRoot = await mkdtemp(join(tmpdir(), 'codeinvaders-clean-clone-'));
const cloneRoot = join(tempRoot, 'clone');
const archivePath = join(tempRoot, 'tracked-source.tar');
const isolatedHome = join(tempRoot, 'home');
const isolatedCodexHome = join(tempRoot, 'codex-home');
const isolatedConfig = join(tempRoot, 'agent-config');
const isolatedClaudeConfig = join(tempRoot, 'claude-config');
const isolatedData = join(tempRoot, 'data');
const steps = [];
let runtimePid;
let commit = '<unavailable>';
let packageVersion = '<unavailable>';
let toolchain;
let lifecycle = {
  isolatedConfiguration: 'not-run',
  recordingsPreserved: 'not-run',
};

try {
  const commitResult = await run('git', ['rev-parse', '--verify', 'HEAD']);
  commit = /^[0-9a-f]{40}$/.test(commitResult.stdout.trim())
    ? commitResult.stdout.trim()
    : '<invalid>';
  steps.push(outcome('tracked-source-commit', commitResult));
  const archiveResult = await run(
    'git',
    ['archive', '--format=tar', '--output', archivePath, 'HEAD'],
    { captureLimit: 8 * 1024 },
  );
  steps.push(outcome('copy-tracked-source', archiveResult));
  if (archiveResult.code !== 0) throw new Error('tracked-source-copy-failed');
  await mkdir(cloneRoot, { recursive: true });
  const extractResult = await run('tar', ['-xf', archivePath, '-C', cloneRoot], {
    captureLimit: 8 * 1024,
  });
  steps.push(outcome('extract-tracked-source', extractResult));
  if (extractResult.code !== 0) throw new Error('tracked-source-extract-failed');

  const packageJson = JSON.parse(await readFile(join(cloneRoot, 'package.json'), 'utf8'));
  packageVersion = typeof packageJson.version === 'string' ? packageJson.version : '<invalid>';
  const env = {
    ...process.env,
    HOME: isolatedHome,
    USERPROFILE: isolatedHome,
    CODEINVADERS_HOME: isolatedHome,
    CODEX_HOME: isolatedCodexHome,
    CODEINVADERS_CONFIG_DIR: isolatedConfig,
    CODEINVADERS_DATA_DIR: isolatedData,
    CODEINVADERS_CODEX_INSTALLED: '1',
    CODEINVADERS_CLAUDE_INSTALLED: '1',
    CODEINVADERS_BROWSER_COMMAND: '',
  };
  toolchain = {
    node: await commandVersion(process.execPath, ['--version'], cloneRoot),
    pnpm: await commandVersion('pnpm', ['--version'], cloneRoot),
    git: await commandVersion('git', ['--version'], cloneRoot),
  };
  const plugin = await validateAndInstallCodexPlugin(cloneRoot, isolatedCodexHome, packageVersion);
  steps.push({ name: 'codex-plugin-validation-and-install', required: true, ...plugin });
  const claude = await validateAndInstallClaudeHooks(
    cloneRoot,
    isolatedClaudeConfig,
    packageVersion,
  );
  steps.push({ name: 'claude-manual-hooks-validation-and-install', required: true, ...claude });
  const installInvocation = pnpmInvocation(['install', '--frozen-lockfile']);
  const install = await run(installInvocation.command, installInvocation.args, {
    cwd: cloneRoot,
    env,
    captureLimit: 512 * 1024,
  });
  steps.push(outcome('frozen-install', install));
  const checkInvocation = pnpmInvocation(['check']);
  const check = await run(checkInvocation.command, checkInvocation.args, {
    cwd: cloneRoot,
    env,
    captureLimit: 512 * 1024,
  });
  steps.push(outcome('repository-check', check));
  const buildInvocation = pnpmInvocation(['build']);
  const build = await run(buildInvocation.command, buildInvocation.args, {
    cwd: cloneRoot,
    env,
    captureLimit: 512 * 1024,
  });
  steps.push(outcome('production-build', build));
  const prepare = await run(
    process.execPath,
    ['scripts/release/prepare-release.mjs', `--version=${packageVersion}`],
    { cwd: cloneRoot, env, captureLimit: 512 * 1024 },
  );
  steps.push(outcome('release-preparation', prepare));
  const bundles = await run(process.execPath, ['scripts/release/verify-hook-bundles.mjs'], {
    cwd: cloneRoot,
    env,
    captureLimit: 512 * 1024,
  });
  steps.push(outcome('isolated-hook-bundle-execution', bundles));

  if (build.code === 0) {
    const installCli = await cli(cloneRoot, env, [
      'install',
      '--agent',
      'all',
      '--non-interactive',
      '--yes',
      '--json',
    ]);
    steps.push(outcome('cli-install', installCli));
    const installJson = parseCliJson(installCli);
    lifecycle.isolatedConfiguration = installCli.code === 0 && installJson ? 'passed' : 'failed';

    const start = await cli(cloneRoot, env, ['start', '--no-browser', '--json']);
    steps.push(outcome('cli-start', start));
    const statusAfterStart = await cli(cloneRoot, env, ['status', '--json']);
    steps.push(outcome('cli-status-after-start', statusAfterStart));
    const statusJson = parseCliJson(statusAfterStart);
    runtimePid = statusJson?.data?.runtime?.pid;
    if (!statusJson?.data?.runtime?.running) {
      steps[steps.length - 1] = {
        ...steps[steps.length - 1],
        status: 'failed',
        reason: 'runtime-not-running-after-start',
      };
    }

    const doctor = await cli(cloneRoot, env, ['doctor', '--non-interactive', '--json']);
    steps.push(outcome('cli-doctor', doctor));

    const fixturePath = join(cloneRoot, 'fixtures', 'replay', 'golden-events.json');
    let replayReady = false;
    try {
      const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
      if (
        Array.isArray(fixture) &&
        fixture.length > 0 &&
        fixture.every((event) => event && typeof event === 'object')
      ) {
        const replayPath = join(isolatedData, 'replay.jsonl');
        await mkdir(isolatedData, { recursive: true });
        await writeFile(
          replayPath,
          `${fixture.map((event) => JSON.stringify(event)).join('\n')}\n`,
          'utf8',
        );
        const replay = await cli(cloneRoot, env, ['replay', '--file', replayPath, '--json']);
        steps.push(outcome('cli-replay', replay));
        replayReady = replay.code === 0 && parseCliJson(replay)?.data?.canonicalOnly === true;
      }
    } catch {
      /* The missing or malformed fixture is reported as a deterministic blocker below. */
    }
    if (!replayReady)
      steps.push({
        name: 'cli-replay-fixture',
        required: true,
        status: 'failed',
        reason: 'sanitized-replay-fixture-unavailable',
      });

    const uninstall = await cli(cloneRoot, env, [
      'uninstall',
      '--agent',
      'all',
      '--non-interactive',
      '--yes',
      '--json',
    ]);
    steps.push(outcome('cli-uninstall', uninstall));
    lifecycle.recordingsPreserved = uninstall.code === 0 ? 'passed' : 'failed';
    if (runtimePid) {
      try {
        process.kill(runtimePid);
      } catch {
        /* The runtime may have already exited; status above remains the evidence. */
      }
    }
  } else {
    steps.push({
      name: 'cli-lifecycle',
      required: true,
      status: 'failed',
      reason: 'skipped-build-failed',
    });
  }

  const requiredFailures = steps.filter((step) => step.required && step.status !== 'passed');
  const report = {
    schema: 'codeinvaders.clean-clone-verification.v1',
    status: requiredFailures.length === 0 ? 'passed' : 'failed',
    commit,
    packageVersion,
    toolchain: toolchain ?? {
      node: '<unavailable>',
      pnpm: '<unavailable>',
      git: '<unavailable>',
    },
    source: 'git-archive-of-tracked-files-only',
    environment: {
      platform: process.platform,
      architecture: process.arch,
      network: 'dependency-install-only',
    },
    lifecycle,
    steps,
  };
  const reports = await writeReports(report);
  process.stdout.write(`${JSON.stringify({ ...report, reports })}\n`);
  if (requiredFailures.length > 0) process.exitCode = 1;
} catch (error) {
  const report = {
    schema: 'codeinvaders.clean-clone-verification.v1',
    status: 'failed',
    commit,
    packageVersion,
    toolchain: { node: '<unavailable>', pnpm: '<unavailable>', git: '<unavailable>' },
    source: 'git-archive-of-tracked-files-only',
    environment: {
      platform: process.platform,
      architecture: process.arch,
      network: 'dependency-install-only',
    },
    lifecycle,
    steps: [
      ...steps,
      { name: 'harness', required: true, status: 'failed', reason: safeText(error.message) },
    ],
  };
  const reports = await writeReports(report);
  process.stdout.write(`${JSON.stringify({ ...report, reports })}\n`);
  process.exitCode = 1;
} finally {
  if (runtimePid) {
    try {
      process.kill(runtimePid);
    } catch {
      /* Best-effort cleanup in the isolated clone only. */
    }
  }
  await removeTemporaryRoot(tempRoot);
}
