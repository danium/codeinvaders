import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { builtinModules as nodeBuiltins } from 'node:module';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { validateEvent } from '../../packages/protocol/dist/index.js';

const root = resolve(import.meta.dirname, '../..');
const workspace = JSON.parse(await fs.readFile(join(root, 'package.json'), 'utf8'));
const version = workspace.version;
const builtins = new Set([...nodeBuiltins, ...nodeBuiltins.map((name) => `node:${name}`)]);

function fail(message) {
  throw new Error(`hook bundle verification failed: ${message}`);
}

function assertBundle(text, label) {
  if (text.includes('sourceMappingURL')) fail(`${label} contains a source map reference`);
  if (/[A-Za-z]:\\\\[A-Za-z]|\/home\/|\/Users\/|\/workspace\/|node_modules[\\/]/.test(text))
    fail(`${label} contains an absolute or dependency source path`);
  if (!text.includes(`direct hook bundle ${version}`)) fail(`${label} has stale version metadata`);
  if (text.includes("reply.includes('ACK\\n')") || !text.includes("reply === 'ACK\\n'"))
    fail(`${label} does not fail closed on malformed acknowledgements`);
  if (
    !text.includes(
      "const pluginData = ADAPTER === 'codex' ? env.PLUGIN_DATA : env.CLAUDE_PLUGIN_DATA;",
    ) ||
    !text.includes('resolve(env[DATA_ENV] || pluginData ||')
  )
    fail(`${label} does not prioritize the explicit and adapter plugin data roots`);
  if (/\b(?:import|export)\s+[^\n]*\s+from\s+['"](?!node:)/.test(text))
    fail(`${label} retains an external ESM import`);
  for (const match of text.matchAll(/(?:require|import)\s*\(\s*['"]([^'"]+)['"]/g)) {
    const specifier = match[1];
    if (
      !builtins.has(specifier) &&
      !specifier.startsWith('./') &&
      !specifier.startsWith('../') &&
      !specifier.startsWith('packages/') &&
      !specifier.startsWith('vendor/')
    )
      fail(`${label} retains external runtime import ${specifier}`);
  }
}

function hookCommands(value, output = []) {
  if (typeof value === 'string') {
    if (value.includes('codeinvaders-')) output.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) hookCommands(item, output);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) hookCommands(item, output);
  }
  return output;
}

async function verifyEntry({ label, bundle, manifest, hooks, scriptNames, windowsWrapper }) {
  const bundlePath = join(root, bundle);
  const manifestPath = join(root, manifest);
  const hooksPath = join(root, hooks);
  const [bundleText, manifestValue, hooksValue] = await Promise.all([
    fs.readFile(bundlePath, 'utf8').catch(() => fail(`${label} bundle is missing`)),
    fs
      .readFile(manifestPath, 'utf8')
      .then(JSON.parse)
      .catch(() => fail(`${label} manifest is missing`)),
    fs
      .readFile(hooksPath, 'utf8')
      .then(JSON.parse)
      .catch(() => fail(`${label} hook definition is missing`)),
  ]);
  assertBundle(bundleText, label);
  if (manifestValue.version !== version) fail(`${label} manifest version is stale`);
  const commands = [...new Set(hookCommands(hooksValue))];
  if (
    commands.length === 0 ||
    commands.some((command) => !scriptNames.some((scriptName) => command.includes(scriptName)))
  )
    fail(`${label} hook definition references an unexpected script`);
  if (label === 'codex') {
    const wrapperText = await fs
      .readFile(join(root, windowsWrapper), 'utf8')
      .catch(() => fail('codex Windows wrapper is missing'));
    if (
      wrapperText.replaceAll('\r\n', '\n') !==
      '@echo off\nnode "%~dp0codeinvaders-codex-hook.mjs"\nexit /b %ERRORLEVEL%\n'
    )
      fail('codex Windows wrapper contains unexpected commands');
    const names = Object.keys(hooksValue?.hooks ?? {});
    const supported = new Set([
      'SessionStart',
      'PermissionRequest',
      'PostToolUse',
      'PreCompact',
      'PostCompact',
      'SessionEnd',
      'UserPromptSubmit',
      'PreToolUse',
      'SubagentStart',
      'SubagentStop',
      'Stop',
    ]);
    if (names.length !== 11 || names.some((name) => !supported.has(name)))
      fail('codex hook definition contains unsupported or missing event names');
    for (const value of Object.values(hooksValue.hooks)) {
      for (const item of Array.isArray(value) ? value : []) {
        const command = item?.hooks?.[0];
        if (
          command?.commandWindows !==
          'cmd.exe /d /c %PLUGIN_ROOT%\\scripts\\codeinvaders-codex-hook.cmd'
        )
          fail('codex hook definition does not provide the Windows wrapper command');
        if (/["&|<>^()]/u.test(command.commandWindows))
          fail('codex Windows hook command is not quote-free');
        if (command?.command !== 'node "$PLUGIN_ROOT/scripts/codeinvaders-codex-hook.mjs"')
          fail('codex hook definition does not provide the portable POSIX command');
      }
    }
  }
  const syntax = spawnSync(process.execPath, ['--check', bundlePath], {
    cwd: root,
    encoding: 'utf8',
  });
  if (syntax.status !== 0) fail(`${label} bundle has invalid Node syntax`);
  return { label, bundle, bytes: Buffer.byteLength(bundleText), commands: commands.length };
}

async function exercise({ label, bundle }) {
  const directory = await fs.mkdtemp(join(tmpdir(), 'codeinvaders-hook-'));
  try {
    const dataRoot = join(directory, 'data');
    const common = { session_id: 'synthetic-session', cwd: 'fixture-workspace' };
    const inputs =
      label === 'codex'
        ? [
            { ...common, hook: 'SessionStart' },
            { ...common, hook: 'UserPromptSubmit' },
            { ...common, hook: 'Stop' },
            { ...common, hook: 'SessionEnd' },
            { ...common, session_id: 'synthetic-session-2', hook: 'SessionStart' },
            { ...common, session_id: 'synthetic-session-2', hook: 'SessionEnd' },
            { ...common, session_id: 'collision:a', hook: 'SessionStart' },
            { ...common, session_id: 'collision', event_id: 'a:checkpoint', hook: 'SessionStart' },
            { ...common, hook: 'PreCompact' },
            { ...common, hook: 'PostCompact' },
            { ...common, hook: 'PreToolUse' },
          ]
        : [
            { ...common, hook_event_name: 'SessionStart' },
            { ...common, hook_event_name: 'UserPromptSubmit' },
            {
              ...common,
              hook_event_name: 'TaskCompleted',
              task_id: 'task-1',
              tool_name: 'Task',
              success: true,
            },
            { ...common, hook_event_name: 'Stop' },
            { ...common, hook_event_name: 'SessionEnd' },
            {
              ...common,
              session_id: 'synthetic-session-2',
              hook_event_name: 'SessionStart',
            },
            { ...common, session_id: 'synthetic-session-2', hook_event_name: 'SessionEnd' },
            { ...common, session_id: 'collision:a', hook_event_name: 'SessionStart' },
            {
              ...common,
              session_id: 'collision',
              event_id: 'a:checkpoint',
              hook_event_name: 'SessionStart',
            },
            { ...common, hook_event_name: 'TaskCompleted', task_id: 'task-ignored' },
            { ...common, hook_event_name: 'PreToolUse' },
          ];
    for (const input of inputs) {
      const child = spawnSync(process.execPath, [join(root, bundle)], {
        cwd: directory,
        input: `${JSON.stringify(input)}\n`,
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          ...process.env,
          CODEINVADERS_DATA_DIR: dataRoot,
          HOME: join(directory, 'home'),
          USERPROFILE: join(directory, 'home'),
          CODEX_HOME: join(directory, 'codex'),
          CLAUDE_CONFIG_DIR: join(directory, 'claude'),
        },
      });
      if (child.error || child.status !== 0 || child.stdout.trim() !== '{}')
        fail(`${label} synthetic hook did not return the exact empty response`);
    }
    const spool = join(dataRoot, 'spool');
    const names = (await fs.readdir(spool).catch(() => [])).filter((name) =>
      name.endsWith('.ingress'),
    );
    const expected = label === 'codex' ? 10 : 9;
    if (names.length !== expected)
      fail(`${label} synthetic hooks created ${names.length} records instead of ${expected}`);
    const records = [];
    for (const name of names) {
      const body = await fs.readFile(join(spool, name), 'utf8');
      if (body.includes('synthetic-session') || body.includes('fixture-workspace'))
        fail(`${label} spool record retained native identity text`);
      let record;
      try {
        record = JSON.parse(body);
      } catch {
        fail(`${label} spool record is not JSON`);
      }
      const validation = validateEvent(record);
      if (validation.status !== 'accepted')
        fail(`${label} ${record?.type ?? 'unknown'} record failed protocol validation`);
      if (
        record.occurredAt === '1970-01-01T00:00:00.000Z' ||
        record.observedAt === '1970-01-01T00:00:00.000Z'
      )
        fail(
          `${label} hook without a native timestamp used the Unix epoch instead of observation time`,
        );
      records.push(record);
    }
    if (new Set(records.map((record) => record.eventId)).size !== records.length)
      fail(`${label} synthetic sessions reused a global event identity`);
    const started = records.find((record) => record.type === 'turn.started');
    const quiescent = records.find((record) => record.type === 'turn.quiescent');
    if (!started?.scope?.turnId || started.scope.turnId !== quiescent?.scope?.turnId)
      fail(`${label} turn lifecycle did not retain one opaque turn identity`);
    if (label === 'claude') {
      const task = records.find((record) => record.type === 'task.completed');
      if (task?.semantic?.outcome !== 'success')
        fail('claude task completion is missing terminal success semantics');
    }
    return { label, status: 'passed', spoolRecords: records.length };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

const entries = [
  {
    label: 'codex',
    bundle: 'packaging/marketplace/plugins/codeinvaders/scripts/codeinvaders-codex-hook.mjs',
    manifest: 'packaging/marketplace/plugins/codeinvaders/.codex-plugin/plugin.json',
    hooks: 'packaging/marketplace/plugins/codeinvaders/hooks/hooks.json',
    scriptNames: ['codeinvaders-codex-hook.mjs', 'codeinvaders-codex-hook.cmd'],
    windowsWrapper:
      'packaging/marketplace/plugins/codeinvaders/scripts/codeinvaders-codex-hook.cmd',
  },
  {
    label: 'claude',
    bundle: 'packaging/manual/claude/scripts/codeinvaders-claude-hook.mjs',
    manifest: 'packaging/manual/claude/manifest.json',
    hooks: 'packaging/manual/claude/hooks.json',
    scriptNames: ['codeinvaders-claude-hook.mjs'],
  },
];
const results = [];
for (const entry of entries) {
  results.push(await verifyEntry(entry));
  results.push(await exercise(entry));
}
process.stdout.write(`${JSON.stringify({ version, results })}\n`);
