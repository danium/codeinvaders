import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { builtinModules as nodeBuiltins } from 'node:module';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

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
    for (const match of value.matchAll(/node\s+(\.\/[^\s"']+\.mjs)/g)) output.push(match[1]);
  } else if (Array.isArray(value)) {
    for (const item of value) hookCommands(item, output);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) hookCommands(item, output);
  }
  return output;
}

async function verifyEntry({ label, bundle, manifest, hooks, scriptName }) {
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
  const commands = hookCommands(hooksValue);
  if (commands.length === 0 || commands.some((command) => !command.endsWith(scriptName)))
    fail(`${label} hook definition does not reference ${scriptName}`);
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
    const input =
      label === 'codex'
        ? { hook: 'SessionStart', session_id: 'synthetic-session', cwd: 'fixture-workspace' }
        : { hook: 'SessionStart', session_id: 'synthetic-session', cwd: 'fixture-workspace' };
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
    const spool = join(dataRoot, 'spool');
    const records = await fs.readdir(spool).catch(() => []);
    if (records.length !== 1) fail(`${label} synthetic hook did not create one local spool record`);
    const body = await fs.readFile(join(spool, records[0]), 'utf8');
    if (!body.includes('io.github.danium.codeinvaders.aap'))
      fail(`${label} spool record is not canonical AAP text`);
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
    hooks: 'packaging/marketplace/plugins/codeinvaders/hooks.json',
    scriptName: 'codeinvaders-codex-hook.mjs',
  },
  {
    label: 'claude',
    bundle: 'packaging/manual/claude/scripts/codeinvaders-claude-hook.mjs',
    manifest: 'packaging/manual/claude/manifest.json',
    hooks: 'packaging/manual/claude/hooks.json',
    scriptName: 'codeinvaders-claude-hook.mjs',
  },
];
const results = [];
for (const entry of entries) {
  results.push(await verifyEntry(entry));
  results.push(await exercise(entry));
}
process.stdout.write(`${JSON.stringify({ version, results })}\n`);
