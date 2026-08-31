import { execFileSync, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';
import { afterAll, describe, expect, it } from 'vitest';
import { deriveLocalEndpoint } from './index.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const roots = [];
let built = false;

function ensureBuilt() {
  if (built) return;
  const args = [
    '--filter',
    '@codeinvaders/adapter-sdk',
    '--filter',
    '@codeinvaders/adapter-codex',
    '--filter',
    '@codeinvaders/adapter-claude',
    'build',
  ];
  if (process.platform === 'win32')
    execFileSync(
      process.env.ComSpec ?? 'cmd.exe',
      ['/d', '/s', '/c', `pnpm.cmd ${args.join(' ')}`],
      { cwd: packageRoot, stdio: 'ignore', windowsHide: true },
    );
  else execFileSync('pnpm', args, { cwd: packageRoot, stdio: 'ignore' });
  built = true;
}

async function runHook(agent, root, input) {
  ensureBuilt();
  const child = spawn(
    process.execPath,
    [
      join(
        packageRoot,
        'packages',
        agent === 'codex' ? 'adapter-codex' : 'adapter-claude',
        'dist',
        'hook.js',
      ),
    ],
    {
      cwd: packageRoot,
      env: { ...process.env, CODEINVADERS_DATA_DIR: root },
      windowsHide: true,
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
  const code = await new Promise((resolveCode, reject) => {
    child.once('error', reject);
    child.once('close', (value) => resolveCode(value));
  });
  return { code, stdout, stderr };
}

async function tempRoot(name) {
  const root = await fs.mkdtemp(join(tmpdir(), `ci-${name}-`));
  roots.push(root);
  return root;
}

afterAll(async () => {
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('prebuilt direct hook delivery', () => {
  for (const agent of ['codex', 'claude']) {
    it(`${agent} returns exact empty response and atomically spools sanitized AAP`, async () => {
      const root = await tempRoot(`spool-${agent}`);
      const input = {
        hook_event_name: 'PostToolUse',
        session_id: 'stable-session',
        turn_id: 'stable-turn',
        agent_id: 'stable-agent',
        parent_agent_id: 'stable-parent-agent',
        tool_use_id: 'stable-operation',
        tool_name: 'Read',
        prompt: 'DIRECT_HOOK_PROMPT_CANARY',
        command: 'DIRECT_HOOK_COMMAND_CANARY',
        output: 'DIRECT_HOOK_OUTPUT_CANARY',
        path: 'DIRECT_HOOK_PATH_CANARY',
        assistant: 'DIRECT_HOOK_ASSISTANT_CANARY',
        source: 'DIRECT_HOOK_SOURCE_CANARY',
        patch: 'DIRECT_HOOK_PATCH_CANARY',
        args: 'DIRECT_HOOK_ARGS_CANARY',
        url: 'DIRECT_HOOK_URL_CANARY',
        query: 'DIRECT_HOOK_QUERY_CANARY',
        credential: 'DIRECT_HOOK_CREDENTIAL_CANARY',
        env: 'DIRECT_HOOK_ENV_CANARY',
        transcript: 'DIRECT_HOOK_TRANSCRIPT_CANARY',
        remote: 'DIRECT_HOOK_REMOTE_CANARY',
        user: 'DIRECT_HOOK_USER_CANARY',
      };
      const initial = await runHook(agent, root, input);
      expect(initial.code).toBe(0);
      expect(initial.stdout).toBe('{}');
      const results = await Promise.all(
        Array.from({ length: 8 }, () => runHook(agent, root, input)),
      );
      for (const result of results) {
        expect(result.code).toBe(0);
        expect(result.stdout).toBe('{}');
      }
      const files = (await fs.readdir(join(root, 'spool'))).filter((name) =>
        name.endsWith('.ingress'),
      );
      expect(files).toHaveLength(1);
      const content = await fs.readFile(join(root, 'spool', files[0]), 'utf8');
      expect(content).not.toMatch(
        /DIRECT_HOOK_(PROMPT|COMMAND|OUTPUT|PATH|ASSISTANT|SOURCE|PATCH|ARGS|URL|QUERY|CREDENTIAL|ENV|TRANSCRIPT|REMOTE|USER)_CANARY/,
      );
      const event = JSON.parse(content);
      expect(event.spec).toBe('io.github.danium.codeinvaders.aap');
      expect(event.source.streamId).toMatch(/^oid1_/);
      expect(event.type).toBe('tool.completed');
      expect(event.scope.turnId).toMatch(/^oid1_/);
      expect(event.scope.agentId).toMatch(/^oid1_/);
      expect(event.links.parentAgentId).toMatch(/^oid1_/);
      const salt = JSON.parse(await fs.readFile(join(root, 'local.salt'), 'utf8'));
      expect(typeof salt).toBe('string');
    }, 30_000);

    it(`${agent} uses real CIIP ACK delivery when the local endpoint is available`, async () => {
      const root = await tempRoot(`ipc-${agent}`);
      const endpoint = deriveLocalEndpoint(root);
      let frame = '';
      const server = (await import('node:net')).createServer((socket) => {
        socket.setEncoding('utf8');
        socket.on('data', (chunk) => {
          frame += chunk;
          socket.end('ACK\n');
        });
      });
      await new Promise((resolveListen, reject) => {
        server.once('error', reject);
        server.listen(endpoint.address, resolveListen);
      });
      const result = await runHook(agent, root, {
        hook_event_name: 'SessionStart',
        session_id: 'ipc-session',
      });
      await new Promise((resolveClose) => server.close(resolveClose));
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('{}');
      expect(frame).toMatch(/^CIIP\/1 \d+:\{[\s\S]*\}\n$/);
      await expect(fs.readdir(join(root, 'spool'), { withFileTypes: true })).rejects.toMatchObject({
        code: 'ENOENT',
      });
    }, 30_000);

    it(`${agent} fails open for malformed native input without persistence`, async () => {
      const root = await tempRoot(`malformed-${agent}`);
      const result = await runHook(agent, root, '{"hook":');
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('{}');
      await expect(fs.readdir(join(root, 'spool'))).rejects.toMatchObject({ code: 'ENOENT' });
      const diagnostics = await fs.readdir(join(root, 'diagnostics'));
      expect(diagnostics.some((name) => name.endsWith('.diagnostic'))).toBe(true);
      const diagnosticText = await Promise.all(
        diagnostics.map((name) => fs.readFile(join(root, 'diagnostics', name), 'utf8')),
      );
      expect(diagnosticText.join('')).not.toContain('DIRECT_HOOK_');
    }, 30_000);

    it(`${agent} does not merge a hook with a missing session`, async () => {
      const root = await tempRoot(`missing-session-${agent}`);
      const result = await runHook(agent, root, {
        hook_event_name: 'SessionStart',
        tool_name: 'Read',
      });
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('{}');
      await expect(fs.readdir(join(root, 'spool'))).rejects.toMatchObject({ code: 'ENOENT' });
    }, 30_000);
  }

  it('preserves a real bounded Codex plan and separates restarted epochs', async () => {
    const root = await tempRoot('plan-restart');
    const plan = {
      hook_event_name: 'TaskPlanUpdated',
      session_id: 'plan-session',
      turn_id: 'plan-turn',
      payload: {
        revision: 2,
        complete: true,
        items: [{ id: 'native-task-a', status: 'completed', ordinal: 0 }],
      },
    };
    await runHook('codex', root, plan);
    await fs.writeFile(
      join(root, 'runtime.json'),
      JSON.stringify({ startedAt: '2026-08-31T01:00:00.000Z' }),
    );
    await runHook('codex', root, plan);
    const files = (await fs.readdir(join(root, 'spool'))).filter((name) =>
      name.endsWith('.ingress'),
    );
    expect(files).toHaveLength(2);
    const events = await Promise.all(
      files.map((name) => fs.readFile(join(root, 'spool', name), 'utf8').then(JSON.parse)),
    );
    expect(events.map((event) => event.data)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          revision: 2,
          previousRevision: 1,
          complete: true,
          items: [expect.objectContaining({ ordinal: 0, status: 'completed' })],
        }),
      ]),
    );
    expect(new Set(events.map((event) => event.eventId)).size).toBe(2);
    expect(new Set(events.map((event) => event.source.epochId)).size).toBe(2);
  }, 30_000);

  it('coordinates spool record quotas across child processes', async () => {
    ensureBuilt();
    const root = await tempRoot('spool-cap-race');
    const sdk = JSON.stringify(
      pathToFileURL(join(packageRoot, 'packages', 'adapter-sdk', 'dist', 'index.js')).href,
    );
    const children = Array.from({ length: 10 }, (_, index) => {
      const script = `import { join } from 'node:path'; import { sanitizeIngressRecord, createSanitizedIngressHandoff, spoolCanonical, createOpaqueIdDeriver } from ${sdk};
const d=await createOpaqueIdDeriver(new Uint8Array(32)); const id=await d.derive('stream',${JSON.stringify(`cap:${index}`)}); const event={spec:'io.github.danium.codeinvaders.aap',version:'1.0.0',eventId:id,type:'session.started',occurredAt:'2026-01-01T00:00:00.000Z',observedAt:'2026-01-01T00:00:00.000Z',sequence:0,source:{adapterId:'codeinvaders-codex',adapterVersion:'0.1.0',streamId:id,epochId:id},scope:{workspaceId:id,sessionId:id},fidelity:'observed',finality:'confirmed',data:{resume:false}};
const prepared=sanitizeIngressRecord(event); if(prepared.status!=='accepted') process.exit(2); console.log((await spoolCanonical(join(${JSON.stringify(root)},'spool'),createSanitizedIngressHandoff(prepared),{bytes:1024*1024,records:3})).status);`;
      return new Promise((resolveChild, rejectChild) => {
        const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
          cwd: packageRoot,
          windowsHide: true,
        });
        let errorText = '';
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk) => {
          errorText += chunk;
        });
        child.once('error', rejectChild);
        child.once('close', (code) =>
          code === 0 ? resolveChild() : rejectChild(new Error(`spool child ${code}: ${errorText}`)),
        );
      });
    });
    await Promise.all(children);
    const files = (await fs.readdir(join(root, 'spool'))).filter((name) =>
      name.endsWith('.ingress'),
    );
    expect(files.length).toBeLessThanOrEqual(3);
  }, 30_000);
});
