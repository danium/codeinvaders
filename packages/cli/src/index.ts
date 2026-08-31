#!/usr/bin/env node

/** CodeInvaders lifecycle CLI. Configuration edits are ownership-aware and transactional. */
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { homedir, platform as hostPlatform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { EventJournal } from '@codeinvaders/core';
import { validEventFixture } from '@codeinvaders/protocol/fixtures';
import { validateEvent } from '@codeinvaders/protocol';

export const cliName = 'codeinvaders' as const;
export const cliVersion = '0.1.0' as const;
export const OWNERSHIP_MARKER = 'codeinvaders-owned:v1';
export const CODEX_PLUGIN_SELECTOR = 'codeinvaders@codeinvaders-local';
export const CODEX_MARKETPLACE_NAME = 'codeinvaders-local';
const RECOVERY_SUFFIX = '.codeinvaders-recovery.bak';
export const EXIT_CODES = Object.freeze({
  ok: 0,
  usage: 2,
  notConfigured: 3,
  failed: 4,
  conflict: 5,
  unsupported: 6,
  cancelled: 7,
} as const);
export type Scope = 'user' | 'project';
export type AgentName = 'codex' | 'claude';
export type HostOS = 'win32' | 'darwin' | 'linux' | 'other';
export interface CliOptions {
  readonly command: string;
  readonly agents: readonly AgentName[];
  readonly scope: Scope;
  readonly cwd: string;
  readonly home: string;
  readonly dataDir?: string | undefined;
  readonly configDir?: string | undefined;
  readonly json: boolean;
  readonly nonInteractive: boolean;
  readonly yes: boolean;
  readonly dryRun: boolean;
  readonly deleteData: boolean;
  readonly noBrowser: boolean;
  readonly port?: number | undefined;
  readonly replayFile?: string | undefined;
}
export interface CliResult {
  readonly code: number;
  readonly message?: string;
  readonly data?: unknown;
}
const COMMANDS = [
  'install',
  'start',
  'status',
  'doctor',
  'replay',
  'upgrade',
  'uninstall',
] as const;
const AGENTS: readonly AgentName[] = ['codex', 'claude'];
const isAgent = (v: string): v is AgentName => (AGENTS as readonly string[]).includes(v);
const host = (value: string): HostOS =>
  value === 'win32' || value === 'darwin' || value === 'linux' ? value : 'other';
function usage(command?: string): string {
  if (command && COMMANDS.includes(command as (typeof COMMANDS)[number]))
    return `Usage: ${cliName} ${command} [options]\n\n  --agent codex|claude|all  --scope user|project  --json  --non-interactive  --yes  --dry-run\n  ${command === 'start' ? '--port <1-65535>  --no-browser' : command === 'uninstall' ? '--delete-data' : command === 'replay' ? '--file <journal.jsonl>' : ''}`;
  return `Usage: ${cliName} <command> [options]\n\nCommands:\n  install    Compose agent hooks (user scope by default)\n  start      Start the local runtime and optionally open a browser\n  status     Show installation and runtime status\n  doctor     Check hooks, storage, IPC, assets, and a synthetic event round trip\n  replay     Replay a canonical journal without invoking an agent\n  upgrade    Validate compatibility, then update owned integration files\n  uninstall  Remove only owned hooks (recordings are retained)\n\nOptions:\n  --agent codex|claude|all  --scope user|project  --json  --non-interactive  --yes  --dry-run\n  --data-dir <path>  Override application data root\n  --config-dir <path>  Override user agent configuration root\n  -h, --help  Show help   --version  Show CLI version`;
}
export class UsageError extends Error {
  readonly code = EXIT_CODES.usage;
}
function valueAfter(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) throw new UsageError(`Missing value for ${flag}`);
  return value;
}
/** Parse arguments without reading files, making this safe and deterministic to test. */
export function parseArgs(
  argv: readonly string[],
  env: Record<string, string | undefined> = process.env,
): CliOptions {
  let command = '';
  let agents: AgentName[] = [...AGENTS];
  let scope: Scope = 'user';
  let cwd = env.CODEINVADERS_CWD ?? process.cwd();
  let home = env.CODEINVADERS_HOME ?? env.USERPROFILE ?? env.HOME ?? homedir();
  let dataDir: string | undefined = env.CODEINVADERS_DATA_DIR;
  let configDir: string | undefined = env.CODEINVADERS_CONFIG_DIR;
  let json = false,
    nonInteractive = false,
    yes = false,
    dryRun = false,
    deleteData = false,
    noBrowser = false;
  let port: number | undefined;
  let replayFile: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '-h' || arg === '--help')
      return {
        command: command || 'help',
        agents,
        scope,
        cwd,
        home,
        dataDir,
        configDir,
        json,
        nonInteractive,
        yes,
        dryRun,
        deleteData,
        noBrowser,
      };
    if (arg === '--version')
      return {
        command: 'version',
        agents,
        scope,
        cwd,
        home,
        dataDir,
        configDir,
        json,
        nonInteractive,
        yes,
        dryRun,
        deleteData,
        noBrowser,
      };
    if (!arg.startsWith('-') && !command) {
      command = arg;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--non-interactive' || arg === '--noninteractive') {
      nonInteractive = true;
      continue;
    }
    if (arg === '--yes' || arg === '-y') {
      yes = true;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--delete-data') {
      deleteData = true;
      continue;
    }
    if (arg === '--no-browser') {
      noBrowser = true;
      continue;
    }
    if (arg === '--scope') {
      const v = valueAfter(argv, i++, arg);
      if (v !== 'user' && v !== 'project') throw new UsageError('Scope must be user or project');
      scope = v;
      continue;
    }
    if (arg === '--agent' || arg === '--agents') {
      const v = valueAfter(argv, i++, arg);
      if (v === 'all') agents = [...AGENTS];
      else {
        const selected = v.split(',').filter(isAgent);
        if (!selected.length || selected.length !== v.split(',').length)
          throw new UsageError('Agent must be codex, claude, or all');
        agents = [...new Set(selected)];
      }
      continue;
    }
    if (arg === '--cwd') {
      cwd = resolve(valueAfter(argv, i++, arg));
      continue;
    }
    if (arg === '--home') {
      home = resolve(valueAfter(argv, i++, arg));
      continue;
    }
    if (arg === '--data-dir') {
      dataDir = resolve(valueAfter(argv, i++, arg));
      continue;
    }
    if (arg === '--config-dir') {
      configDir = resolve(valueAfter(argv, i++, arg));
      continue;
    }
    if (arg === '--file' || arg === '--journal') {
      replayFile = resolve(valueAfter(argv, i++, arg));
      continue;
    }
    if (arg === '--port') {
      const raw = valueAfter(argv, i++, arg);
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 65535)
        throw new UsageError('Port must be an integer between 1 and 65535');
      port = n;
      continue;
    }
    if (arg.startsWith('-')) throw new UsageError(`Unknown option: ${arg}`);
    if (command === 'replay' && !replayFile) {
      replayFile = resolve(arg);
      continue;
    }
    throw new UsageError(`Unexpected argument: ${arg}`);
  }
  if (!command) command = 'help';
  if (!['help', 'version', ...COMMANDS].includes(command))
    throw new UsageError(`Unknown command: ${command}`);
  return {
    command,
    agents,
    scope,
    cwd: resolve(cwd),
    home: resolve(home),
    dataDir,
    configDir,
    json,
    nonInteractive,
    yes,
    dryRun,
    deleteData,
    noBrowser,
    ...(port === undefined ? {} : { port }),
    ...(replayFile === undefined ? {} : { replayFile }),
  };
}

export interface CliPaths {
  readonly dataRoot: string;
  readonly configRoot: string;
  readonly runtimeFile: string;
  readonly hooksRoot: string;
  readonly recoveryRoot: string;
}
export function resolvePaths(
  options: Pick<CliOptions, 'home' | 'cwd' | 'dataDir' | 'configDir' | 'scope'>,
  os: HostOS = host(hostPlatform()),
): CliPaths {
  const dataRoot = resolve(
    options.dataDir ??
      (os === 'win32'
        ? join(options.home, 'AppData', 'Local', 'CodeInvaders')
        : join(options.home, '.local', 'share', 'codeinvaders')),
  );
  return {
    dataRoot,
    configRoot: resolve(
      options.configDir ??
        (options.scope === 'project'
          ? options.cwd
          : join(options.home, os === 'win32' ? 'AppData' : '.config')),
    ),
    runtimeFile: join(dataRoot, 'runtime.json'),
    hooksRoot: join(dataRoot, 'hooks'),
    recoveryRoot: join(dataRoot, 'recovery'),
  };
}
export interface AgentSurface {
  readonly agent: AgentName;
  readonly configPath: string;
  readonly installed: boolean;
  readonly executable: boolean;
  readonly pluginSupported: boolean;
  readonly manualHookSupported: boolean;
  readonly limitations: readonly string[];
}
export interface DetectionResult {
  readonly surfaces: readonly AgentSurface[];
  readonly supported: boolean;
}
const agentConfigPath = (agent: AgentName, root: string, scope: Scope, cwd: string): string => {
  const base = scope === 'project' ? cwd : root;
  const suffix = agent === 'codex' ? '.codex' : '.claude';
  return base.toLowerCase().endsWith(suffix)
    ? join(base, agent === 'codex' ? 'config.toml' : 'settings.json')
    : join(base, agent === 'codex' ? '.codex/config.toml' : '.claude/settings.json');
};
async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
async function commandAvailable(
  name: string,
  env: Record<string, string | undefined>,
  os: HostOS,
): Promise<boolean> {
  if (env[`CODEINVADERS_${name.toUpperCase()}_INSTALLED`] === '1') return true;
  const override = env[`CODEINVADERS_${name.toUpperCase()}_BIN`];
  const forms = os === 'win32' ? [name, `${name}.exe`, `${name}.cmd`, `${name}.bat`] : [name];
  if (override) {
    const overrideForms =
      os === 'win32' && !/\.[^\\/]+$/.test(override)
        ? [override, `${override}.exe`, `${override}.cmd`, `${override}.bat`]
        : [override];
    for (const candidate of overrideForms) if (await exists(candidate)) return true;
    // A bare override may intentionally name a command supplied through PATH.
    if (!/[\\/]/.test(override))
      for (const dir of (env.PATH ?? '').split(os === 'win32' ? ';' : ':').filter(Boolean))
        for (const form of os === 'win32'
          ? [override, `${override}.exe`, `${override}.cmd`, `${override}.bat`]
          : [override])
          if (await exists(join(dir, form))) return true;
    return false;
  }
  for (const dir of (env.PATH ?? '').split(os === 'win32' ? ';' : ':').filter(Boolean))
    for (const form of forms) if (await exists(join(dir, form))) return true;
  return false;
}
async function probeCodexPlugin(
  env: Record<string, string | undefined>,
  os: HostOS,
  executable: boolean,
): Promise<boolean> {
  if (!executable) return false;
  const override = env.CODEINVADERS_CODEX_PLUGIN_SUPPORTED;
  if (override === '1') return true;
  if (override === '0') return false;
  const command = env.CODEINVADERS_CODEX_BIN ?? 'codex';
  const result = await runExternal(command, ['plugin', '--help'], os, env);
  return result.status === 0 && /\bplugin\b/i.test(result.output ?? '');
}
export async function detectSurfaces(
  options: Pick<CliOptions, 'home' | 'cwd' | 'scope' | 'configDir'>,
  env: Record<string, string | undefined> = process.env,
  os: HostOS = host(hostPlatform()),
): Promise<DetectionResult> {
  const surfaces: AgentSurface[] = [];
  for (const agent of AGENTS) {
    const configuredRoot = agent === 'codex' ? env.CODEX_HOME : env.CLAUDE_CONFIG_DIR;
    const configPath = configuredRoot
      ? resolve(configuredRoot, agent === 'codex' ? 'config.toml' : 'settings.json')
      : agentConfigPath(agent, options.configDir ?? options.home, options.scope, options.cwd);
    const installed = await exists(configPath);
    const executable = await commandAvailable(agent, env, os);
    const pluginSupported =
      agent === 'codex'
        ? await probeCodexPlugin(env, os, executable)
        : installed && env.CODEINVADERS_CLAUDE_PLUGIN !== '0';
    const limitations =
      agent === 'codex'
        ? [
            'Codex is installed through the native plugin flow when capability is confirmed; otherwise manual hook setup is required.',
          ]
        : [
            'Claude task-plan and manual-denial coverage depends on hooks emitted by the installed version.',
          ];
    if (!pluginSupported)
      limitations.push(
        'No native plugin success is claimed; generated direct/manual hook is used.',
      );
    surfaces.push({
      agent,
      configPath,
      installed,
      executable,
      pluginSupported,
      manualHookSupported: true,
      limitations,
    });
  }
  return { surfaces, supported: surfaces.some((s) => s.installed || s.executable) };
}

export interface ConfigDiff {
  readonly agent: AgentName;
  readonly path: string;
  readonly format: 'json' | 'toml';
  readonly changed: boolean;
  readonly before: string;
  readonly after: string;
  readonly added: number;
  readonly removed: number;
  readonly error?: string | undefined;
}
export interface ParsedConfig {
  readonly format: 'json' | 'toml';
  readonly value?: unknown;
  readonly valid: boolean;
  readonly ownedEntries: number;
  readonly error?: string | undefined;
}
function isOwned(value: unknown): boolean {
  if (typeof value === 'string') return value.includes(OWNERSHIP_MARKER);
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    record[OWNERSHIP_MARKER] === true ||
    (typeof record.command === 'string' && record.command.includes(OWNERSHIP_MARKER))
  );
}
function containsOwned(value: unknown): boolean {
  if (isOwned(value)) return true;
  if (!value || typeof value !== 'object') return false;
  return Object.values(value as Record<string, unknown>).some(containsOwned);
}
function countOwned(value: unknown): number {
  if (isOwned(value)) return 1;
  if (!value || typeof value !== 'object') return 0;
  return Object.values(value as Record<string, unknown>).reduce<number>(
    (n, v) => n + countOwned(v),
    0,
  );
}
export function parseConfig(text: string, format: 'json' | 'toml'): ParsedConfig {
  if (format === 'toml') {
    const valid = !text.includes('\0') && balancedToml(text);
    return {
      format,
      valid,
      ownedEntries: (text.match(new RegExp(OWNERSHIP_MARKER, 'g')) ?? []).length,
      ...(valid ? {} : { error: 'invalid-toml' }),
    };
  }
  try {
    const value: unknown = text.trim() ? JSON.parse(text) : {};
    const valid = !!value && typeof value === 'object' && !Array.isArray(value);
    return {
      format,
      valid,
      value,
      ownedEntries: countOwned(value),
      ...(valid ? {} : { error: 'json-root-must-be-object' }),
    };
  } catch {
    return { format, valid: false, ownedEntries: 0, error: 'invalid-json' };
  }
}
function balancedToml(text: string): boolean {
  let quote = false,
    escaped = false;
  for (const c of text) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === '\\' && quote) {
      escaped = true;
      continue;
    }
    if (c === '"') quote = !quote;
  }
  return !quote;
}
const hookEvents: Record<AgentName, readonly string[]> = {
  codex: [
    'SessionStart',
    'SessionEnd',
    'UserPromptSubmit',
    'PreToolUse',
    'PostToolUse',
    'PermissionRequest',
    'SubagentStart',
    'SubagentStop',
    'Stop',
    'PreCompact',
    'PostCompact',
  ],
  claude: [
    'SessionStart',
    'SessionEnd',
    'UserPromptSubmit',
    'PreToolUse',
    'PostToolUse',
    'PostToolUseFailure',
    'PermissionRequest',
    'PermissionDenied',
    'TaskCreated',
    'TaskCompleted',
    'SubagentStart',
    'SubagentStop',
    'Stop',
    'StopFailure',
  ],
};
export function ownedHookCommand(agent: AgentName, hooksRoot: string): string {
  return ownedHookCommandForPlatform(agent, hooksRoot, host(hostPlatform()));
}

async function marketplaceRoot(cwd: string): Promise<string | undefined> {
  const candidates = [
    join(cwd, 'packaging', 'marketplace'),
    resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packaging', 'marketplace'),
  ];
  for (const candidate of candidates)
    if (await exists(join(candidate, '.agents', 'plugins', 'marketplace.json'))) return candidate;
  return undefined;
}
interface CommandResult {
  readonly status: number;
  readonly output?: string;
}
function windowsCommandLine(command: string, args: readonly string[]): string {
  const quote = (value: string) => {
    if (!/[\s"]/.test(value)) return value;
    return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`;
  };
  return [command, ...args].map(quote).join(' ');
}
async function runExternal(
  command: string,
  args: readonly string[],
  os: HostOS = host(hostPlatform()),
  env: Record<string, string | undefined> = process.env,
): Promise<CommandResult> {
  return new Promise((resolveResult) => {
    const childEnv = { ...process.env, ...env };
    const windowsScript = os === 'win32' && !/\.(?:exe|com)$/i.test(command);
    const child = (windowsScript
      ? spawn('cmd.exe', ['/d', '/s', '/c', windowsCommandLine(command, args)], {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          windowsVerbatimArguments: true,
          env: childEnv,
        })
      : spawn(command, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: os === 'win32',
          env: childEnv,
        })) as unknown as {
      readonly stdout?: { on(event: string, listener: (chunk: unknown) => void): void };
      readonly stderr?: { on(event: string, listener: (chunk: unknown) => void): void };
      kill(): void;
      once(event: string, listener: (...args: unknown[]) => void): void;
    };
    let output = '';
    const append = (chunk: unknown) => {
      if (output.length < 32_768) output += String(chunk).slice(0, 32_768 - output.length);
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    const timer = setTimeout(() => child.kill(), 750);
    child.once('error', () => {
      clearTimeout(timer);
      resolveResult({ status: 1, output });
    });
    child.once('close', (status: unknown) => {
      clearTimeout(timer);
      resolveResult({ status: typeof status === 'number' ? status : 1, output });
    });
  });
}
interface CodexPluginState {
  readonly pluginInstalled: boolean;
  readonly pluginKnown: boolean;
  readonly marketplaceOwned: boolean;
  readonly marketplaceKnown: boolean;
}
function exactListedValue(
  output: string | undefined,
  expected: string,
  firstColumnOnly = false,
): boolean {
  if (!output) return false;
  try {
    const parsed: unknown = JSON.parse(output);
    const visit = (value: unknown): boolean =>
      typeof value === 'string'
        ? value === expected
        : Array.isArray(value)
          ? value.some(visit)
          : !!value &&
            typeof value === 'object' &&
            Object.values(value as Record<string, unknown>).some(visit);
    if (visit(parsed)) return true;
  } catch {
    /* Human-readable list output is handled below. */
  }
  return output.split(/\r?\n/).some((line) => {
    const trimmed = line.trim().replace(/^['"]|['"]$/g, '');
    if (trimmed === expected) return true;
    // Codex's human table puts the identity in a distinct whitespace-delimited
    // column (selector/name first, source path last). Never use substring
    // matching: similarly named third-party plugins must remain unrelated.
    const columns = trimmed.split(/\s{2,}/).map((value) => value.trim());
    if (firstColumnOnly) return columns[0] === expected || trimmed.split(/\s+/)[0] === expected;
    return columns.includes(expected) || trimmed.split(/\s+/).includes(expected);
  });
}
async function codexPluginState(
  command: string,
  source: string,
  os: HostOS,
  env: Record<string, string | undefined> = process.env,
): Promise<CodexPluginState> {
  const plugins = await runExternal(command, ['plugin', 'list'], os, env);
  const marketplaces = await runExternal(command, ['plugin', 'marketplace', 'list'], os, env);
  return {
    pluginInstalled: exactListedValue(plugins.output, CODEX_PLUGIN_SELECTOR, true),
    pluginKnown: plugins.status === 0,
    marketplaceOwned: exactListedValue(marketplaces.output, source),
    marketplaceKnown: marketplaces.status === 0,
  };
}
interface CodexPluginTransaction {
  readonly command: string;
  readonly source: string;
  readonly newlyInstalled: boolean;
  readonly newlyMarketplace: boolean;
  readonly rollback: () => Promise<void>;
}
async function installCodexPlugin(
  options: CliOptions,
  env: Record<string, string | undefined>,
  os: HostOS,
): Promise<{ result?: CliResult; transaction?: CodexPluginTransaction }> {
  if (!options.agents.includes('codex')) return {};
  const detected = await detectSurfaces(options, env, os);
  const codex = detected.surfaces.find((surface) => surface.agent === 'codex');
  if (!codex || (!codex.executable && !codex.installed)) return {};
  if (!codex.pluginSupported)
    return {
      result: {
        code: EXIT_CODES.unsupported,
        message:
          'Codex plugin capability is unavailable. No fictitious TOML hooks were written; use the supported manual direct-hook path or install a Codex surface with plugin support.',
        data: { surfaces: detected.surfaces, manualCommand: `node ${prebuiltHookPath('codex')}` },
      },
    };
  const source = await marketplaceRoot(options.cwd);
  if (!source)
    return {
      result: {
        code: EXIT_CODES.failed,
        message:
          'Codex marketplace source is missing; build/package the staged marketplace before installing.',
      },
    };
  const command = env.CODEINVADERS_CODEX_BIN ?? 'codex';
  const before = await codexPluginState(command, source, os, env);
  const marketplaceAdded = !before.marketplaceKnown || before.marketplaceOwned ? false : true;
  if (!before.marketplaceOwned) {
    const marketplace = await runExternal(
      command,
      ['plugin', 'marketplace', 'add', source],
      os,
      env,
    );
    if (marketplace.status !== 0)
      return {
        result: {
          code: EXIT_CODES.failed,
          message: 'Codex marketplace registration failed; no hook configuration was changed.',
        },
      };
  }
  const pluginAdded = before.pluginKnown && !before.pluginInstalled;
  if (!before.pluginInstalled) {
    const plugin = await runExternal(command, ['plugin', 'add', CODEX_PLUGIN_SELECTOR], os, env);
    if (plugin.status !== 0) {
      const after = await codexPluginState(command, source, os, env);
      if (marketplaceAdded && after.marketplaceOwned)
        await runExternal(
          command,
          ['plugin', 'marketplace', 'remove', CODEX_MARKETPLACE_NAME],
          os,
          env,
        );
      if (pluginAdded && after.pluginInstalled)
        await runExternal(command, ['plugin', 'remove', CODEX_PLUGIN_SELECTOR], os, env);
      return {
        result: {
          code: EXIT_CODES.failed,
          message:
            'Codex plugin installation failed; review the native Codex trust prompt and retry.',
        },
      };
    }
  }
  const transaction: CodexPluginTransaction = {
    command,
    source,
    newlyInstalled: pluginAdded,
    newlyMarketplace: marketplaceAdded,
    rollback: async () => {
      const after = await codexPluginState(command, source, os, env);
      if (pluginAdded && after.pluginInstalled)
        await runExternal(command, ['plugin', 'remove', CODEX_PLUGIN_SELECTOR], os, env);
      if (marketplaceAdded && after.marketplaceOwned)
        await runExternal(
          command,
          ['plugin', 'marketplace', 'remove', CODEX_MARKETPLACE_NAME],
          os,
          env,
        );
    },
  };
  return { transaction };
}
export function prebuiltHookPath(agent: AgentName): string {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  return agent === 'codex'
    ? join(
        repositoryRoot,
        'packaging',
        'marketplace',
        'plugins',
        'codeinvaders',
        'scripts',
        'codeinvaders-codex-hook.mjs',
      )
    : join(
        repositoryRoot,
        'packaging',
        'manual',
        'claude',
        'scripts',
        'codeinvaders-claude-hook.mjs',
      );
}
function ownedHookCommandForPlatform(agent: AgentName, hooksRoot: string, os: HostOS): string {
  // Claude Code invokes command hooks through a POSIX shell on Windows. Keep
  // Codex's native Windows command form, but give Claude shell-safe paths and
  // environment syntax on every platform.
  const posixShell = os !== 'win32' || agent === 'claude';
  const shellPath = (value: string) =>
    posixShell && os === 'win32' ? value.replaceAll('\\', '/') : value;
  const posixQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const cmdPath = (value: string) => value.replace(/([%&|<>^()!])/g, '^$1');
  const root = shellPath(dirname(hooksRoot));
  const hook = shellPath(join(hooksRoot, `${agent}-hook.mjs`));
  const command = !posixShell
    ? `setlocal DisableDelayedExpansion && set "CODEINVADERS_DATA_DIR=${cmdPath(root)}" && node "${cmdPath(hook)}"`
    : `CODEINVADERS_DATA_DIR=${posixQuote(root)} node ${posixQuote(hook)}`;
  return `${command} ${posixShell ? '#' : '& rem'} ${OWNERSHIP_MARKER}`;
}
function jsonHookEntry(agent: AgentName, hooksRoot: string, os: HostOS): Record<string, unknown> {
  return {
    type: 'command',
    command: ownedHookCommandForPlatform(agent, hooksRoot, os),
    timeout: 1,
    [OWNERSHIP_MARKER]: true,
  };
}
function removeOwnedJson(value: unknown): { value: unknown; removed: number } {
  if (Array.isArray(value)) {
    let removed = 0;
    const out: unknown[] = [];
    for (const item of value) {
      if (isOwned(item)) {
        removed += 1;
        continue;
      }
      const next = removeOwnedJson(item);
      removed += next.removed;
      out.push(next.value);
    }
    return { value: out, removed };
  }
  if (!value || typeof value !== 'object') return { value, removed: 0 };
  let removed = 0;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const next = removeOwnedJson(v);
    removed += next.removed;
    out[k] = next.value;
  }
  return { value: out, removed };
}
export function composeJsonConfig(
  before: string,
  agent: AgentName,
  hooksRoot: string,
  os: HostOS = host(hostPlatform()),
): ConfigDiff {
  const parsed = parseConfig(before, 'json');
  if (!parsed.valid)
    return {
      agent,
      path: '',
      format: 'json',
      changed: false,
      before,
      after: before,
      added: 0,
      removed: 0,
      error: parsed.error,
    };
  const root = structuredClone(parsed.value) as Record<string, unknown>;
  const hooks = (
    root.hooks && typeof root.hooks === 'object' && !Array.isArray(root.hooks) ? root.hooks : {}
  ) as Record<string, unknown>;
  let added = 0;
  for (const event of hookEvents[agent]) {
    const current = Array.isArray(hooks[event]) ? [...(hooks[event] as unknown[])] : [];
    if (!current.some(containsOwned)) {
      current.push({ hooks: [jsonHookEntry(agent, hooksRoot, os)] });
      added += 1;
    }
    hooks[event] = current;
  }
  root.hooks = hooks;
  const after = JSON.stringify(root, null, 2) + '\n';
  return {
    agent,
    path: '',
    format: 'json',
    changed: after !== before,
    before,
    after,
    added,
    removed: 0,
  };
}
export function composeTomlConfig(
  before: string,
  agent: AgentName,
  hooksRoot: string,
  os: HostOS = host(hostPlatform()),
): ConfigDiff {
  const parsed = parseConfig(before, 'toml');
  if (!parsed.valid)
    return {
      agent,
      path: '',
      format: 'toml',
      changed: false,
      before,
      after: before,
      added: 0,
      removed: 0,
      error: parsed.error,
    };
  const marker = new RegExp(
    `\\n?# ${OWNERSHIP_MARKER}\\n[\\s\\S]*?# ${OWNERSHIP_MARKER} end\\n?`,
    'g',
  );
  const cleaned = before.replace(marker, '');
  const block = `\n# ${OWNERSHIP_MARKER}\n[hooks.codeinvaders]\ncommand = ${JSON.stringify(ownedHookCommandForPlatform(agent, hooksRoot, os))}\nevents = ${JSON.stringify(hookEvents[agent])}\n# ${OWNERSHIP_MARKER} end\n`;
  return {
    agent,
    path: '',
    format: 'toml',
    changed: cleaned.replace(/\s*$/, '') + block !== before,
    before,
    after: cleaned.replace(/\s*$/, '') + block,
    added: before === cleaned ? 1 : 0,
    removed: before === cleaned ? 0 : 1,
  };
}
export function removeOwnedConfig(
  before: string,
  format: 'json' | 'toml',
  agent: AgentName,
): { after: string; removed: number; error?: string | undefined } {
  void agent;
  const parsed = parseConfig(before, format);
  if (!parsed.valid) return { after: before, removed: 0, error: parsed.error };
  if (format === 'toml') {
    const marker = new RegExp(
      `\\n?# ${OWNERSHIP_MARKER}\\n[\\s\\S]*?# ${OWNERSHIP_MARKER} end\\n?`,
      'g',
    );
    const after = before.replace(marker, '').replace(/\n{3,}/g, '\n\n');
    return { after, removed: before === after ? 0 : 1 };
  }
  const next = removeOwnedJson(parsed.value);
  return { after: JSON.stringify(next.value, null, 2) + '\n', removed: next.removed };
}

async function readOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}
async function rollbackConfigs(diffs: readonly ConfigDiff[]): Promise<void> {
  for (const diff of diffs) {
    try {
      if (!diff.before) await rm(diff.path, { force: true });
      else
        await transactionalWrite(
          diff.path,
          diff.before,
          (text) => parseConfig(text, diff.format).valid,
        );
    } catch {
      // The recovery copy created by the original transaction remains available.
    }
  }
}
export async function transactionalWrite(
  path: string,
  content: string,
  validate: (text: string) => boolean,
): Promise<{ ok: boolean; backup?: string; rolledBack: boolean }> {
  const previous = await readOrEmpty(path);
  // Markers are intentionally human-readable, but ':' is not a legal Windows
  // filename character; use a portable recovery suffix for the backup path.
  const backup = `${path}${RECOVERY_SUFFIX}`;
  const atomic = async (target: string, text: string) => {
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    const handle = await open(temp, 'wx', 0o600);
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, target);
    try {
      await chmod(target, 0o600);
    } catch {
      /* ACLs are inherited on Windows. */
    }
  };
  try {
    if (previous) await atomic(backup, previous);
    await atomic(path, content);
    if (!validate(await readFile(path, 'utf8'))) throw new Error('post-write-validation');
    return { ok: true, ...(previous ? { backup } : {}), rolledBack: false };
  } catch {
    try {
      if (previous) await atomic(path, previous);
      else await rm(path, { force: true });
    } catch {
      /* recovery copy remains */
    }
    return { ok: false, ...(previous ? { backup } : {}), rolledBack: true };
  }
}
async function confirm(options: CliOptions, prompt: string): Promise<boolean> {
  if (options.yes) return true;
  if (options.nonInteractive || !process.stdin.isTTY) return false;
  process.stdout.write(`${prompt} [y/N] `);
  return new Promise((answer) => {
    process.stdin.once('data', (chunk: string | Uint8Array) =>
      answer(String(chunk).trim().toLowerCase() === 'y'),
    );
  });
}

export async function install(
  options: CliOptions,
  os: HostOS = host(hostPlatform()),
  env: Record<string, string | undefined> = process.env,
): Promise<CliResult> {
  const paths = resolvePaths(options, os);
  const detection = await detectSurfaces(options, env, os);
  const codexSurface = detection.surfaces.find(
    (surface) => surface.agent === 'codex' && options.agents.includes('codex'),
  );
  if (
    codexSurface &&
    (codexSurface.installed || codexSurface.executable) &&
    !codexSurface.pluginSupported
  ) {
    return {
      code: EXIT_CODES.unsupported,
      message:
        'Codex plugin capability is unavailable. No fictitious TOML hooks were written; use the supported manual direct-hook path or install a Codex surface with plugin support.',
      data: {
        surfaces: detection.surfaces,
        manualCommand: `node ${prebuiltHookPath('codex')}`,
      },
    };
  }
  const codexNative =
    codexSurface?.pluginSupported === true && (codexSurface.installed || codexSurface.executable);
  const selected = detection.surfaces.filter(
    (s) => options.agents.includes(s.agent) && s.agent !== 'codex' && (s.installed || s.executable),
  );
  if (!selected.length && !codexNative)
    return {
      code: EXIT_CODES.notConfigured,
      message:
        'No supported Codex or Claude Code installation was detected. Install an agent, then retry.',
      data: { surfaces: detection.surfaces },
    };
  if (
    options.scope === 'project' &&
    !(await confirm(
      options,
      'Project scope writes repository-visible agent configuration. Continue?',
    ))
  )
    return {
      code: EXIT_CODES.cancelled,
      message: 'Project installation cancelled; no files were changed.',
    };
  if (!selected.length && codexNative && options.dryRun)
    return {
      code: EXIT_CODES.ok,
      message:
        'Dry run: no files changed. Codex native plugin commands would be executed after confirmation.',
      data: {
        surfaces: detection.surfaces,
        codexPluginCommands: [
          'codex plugin marketplace add <repo>/packaging/marketplace',
          `codex plugin add ${CODEX_PLUGIN_SELECTOR}`,
        ],
      },
    };
  const pluginInstall = options.dryRun ? {} : await installCodexPlugin(options, env, os);
  if (pluginInstall.result) return pluginInstall.result;
  const pluginTransaction = pluginInstall.transaction;
  const diffs: ConfigDiff[] = [];
  for (const surface of selected) {
    const before = await readOrEmpty(surface.configPath);
    const format = surface.agent === 'claude' ? 'json' : 'toml';
    const diff =
      format === 'json'
        ? composeJsonConfig(before, surface.agent, paths.hooksRoot, os)
        : composeTomlConfig(before, surface.agent, paths.hooksRoot, os);
    diffs.push({ ...diff, path: surface.configPath });
  }
  if (options.dryRun)
    return {
      code: EXIT_CODES.ok,
      message: 'Dry run: no files changed.',
      data: {
        scope: options.scope,
        diffs,
        surfaces: detection.surfaces,
        ...(codexSurface?.pluginSupported
          ? {
              codexPluginCommands: [
                'codex plugin marketplace add <repo>/packaging/marketplace',
                `codex plugin add ${CODEX_PLUGIN_SELECTOR}`,
              ],
            }
          : {}),
      },
    };
  await mkdir(paths.dataRoot, { recursive: true, mode: 0o700 });
  const stagedAssets: { target: string; existed: boolean }[] = [];
  try {
    await mkdir(paths.hooksRoot, { recursive: true, mode: 0o700 });
    for (const surface of selected) {
      const source = prebuiltHookPath(surface.agent);
      const target = join(paths.hooksRoot, `${surface.agent}-hook.mjs`);
      const sourceBytes = await readFile(source, 'utf8');
      if (sourceBytes.length === 0) throw new Error(`empty direct hook asset: ${source}`);
      const existed = await exists(target);
      await copyFile(source, target);
      stagedAssets.push({ target, existed });
    }
  } catch (error) {
    for (const asset of stagedAssets) if (!asset.existed) await rm(asset.target, { force: true });
    return {
      code: EXIT_CODES.failed,
      message: `Direct hook assets are unavailable; no configuration was changed (${error instanceof Error ? error.message : 'copy failed'}).`,
      data: { diffs },
    };
  }
  const results: unknown[] = [];
  const written: ConfigDiff[] = [];
  const cleanupAssets = async () => {
    for (const asset of stagedAssets) if (!asset.existed) await rm(asset.target, { force: true });
  };
  for (const diff of diffs) {
    if (diff.error) {
      await pluginTransaction?.rollback();
      await cleanupAssets();
      return {
        code: EXIT_CODES.failed,
        message: `Cannot parse ${diff.path}: ${diff.error}`,
        data: { diffs },
      };
    }
    const tx = await transactionalWrite(
      diff.path,
      diff.after,
      (text) => parseConfig(text, diff.format).valid,
    );
    if (!tx.ok) {
      await rollbackConfigs(written);
      await pluginTransaction?.rollback();
      await cleanupAssets();
      return {
        code: EXIT_CODES.failed,
        message: `Configuration write failed and was rolled back: ${diff.path}`,
        data: { diffs, result: tx },
      };
    }
    written.push(diff);
    results.push({ agent: diff.agent, path: diff.path, backup: tx.backup, added: diff.added });
  }
  const verification = await doctor({ ...options, command: 'doctor' }, os, env);
  if (verification.code !== EXIT_CODES.ok) {
    await rollbackConfigs(diffs);
    await pluginTransaction?.rollback();
    await cleanupAssets();
    return {
      code: EXIT_CODES.failed,
      message: 'Post-install doctor failed; all modified agent configuration was rolled back.',
      data: { verification, diffs },
    };
  }
  for (const diff of diffs) await rm(`${diff.path}${RECOVERY_SUFFIX}`, { force: true });
  return {
    code: EXIT_CODES.ok,
    message: 'CodeInvaders hooks installed.',
    data: {
      scope: options.scope,
      results,
      limitations: detection.surfaces
        .filter((surface) => options.agents.includes(surface.agent))
        .map((surface) => ({ agent: surface.agent, limitations: surface.limitations })),
    },
  };
}

export interface RuntimeStatus {
  readonly running: boolean;
  readonly pid?: number;
  readonly port?: number;
  readonly stale?: boolean;
  readonly dataRoot: string;
}
async function runtimeStatus(paths: CliPaths): Promise<RuntimeStatus> {
  const raw = await readOrEmpty(paths.runtimeFile);
  if (!raw) return { running: false, dataRoot: paths.dataRoot };
  try {
    const value = JSON.parse(raw) as { pid?: number; port?: number };
    const pid = value.pid;
    if (!Number.isSafeInteger(pid) || pid === undefined || pid <= 0)
      return { running: false, stale: true, dataRoot: paths.dataRoot };
    try {
      process.kill(pid, 0);
      return {
        running: true,
        pid,
        ...(value.port === undefined ? {} : { port: value.port }),
        dataRoot: paths.dataRoot,
      };
    } catch {
      return {
        running: false,
        stale: true,
        pid,
        ...(value.port === undefined ? {} : { port: value.port }),
        dataRoot: paths.dataRoot,
      };
    }
  } catch {
    return { running: false, stale: true, dataRoot: paths.dataRoot };
  }
}
export async function status(
  options: CliOptions,
  os: HostOS = host(hostPlatform()),
  env: Record<string, string | undefined> = process.env,
): Promise<CliResult> {
  const paths = resolvePaths(options, os);
  const detection = await detectSurfaces(options, env, os);
  return {
    code: EXIT_CODES.ok,
    data: {
      version: cliVersion,
      paths: { dataRoot: paths.dataRoot, runtimeFile: paths.runtimeFile },
      runtime: await runtimeStatus(paths),
      surfaces: detection.surfaces,
    },
  };
}
export async function start(
  options: CliOptions,
  os: HostOS = host(hostPlatform()),
  env: Record<string, string | undefined> = process.env,
): Promise<CliResult> {
  const paths = resolvePaths(options, os);
  await mkdir(paths.dataRoot, { recursive: true, mode: 0o700 });
  const current = await runtimeStatus(paths);
  if (current.running)
    return {
      code: EXIT_CODES.ok,
      message: `Runtime already running (pid ${current.pid}).`,
      data: current,
    };
  if (current.stale) await rm(paths.runtimeFile, { force: true });
  const port = options.port ?? Number(env.CODEINVADERS_PORT ?? 43177);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    return { code: EXIT_CODES.usage, message: 'Port must be an integer between 1 and 65535.' };
  const runtime =
    env.CODEINVADERS_RUNTIME_COMMAND ?? join(options.cwd, 'apps', 'local', 'dist', 'runtime.js');
  if (!(await exists(runtime)) && !env.CODEINVADERS_RUNTIME_COMMAND)
    return {
      code: EXIT_CODES.failed,
      message: `Local runtime assets are unavailable at ${runtime}. Build the project first with pnpm build.`,
    };
  const secret =
    env.CODEINVADERS_BROWSER_SECRET ??
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const command = env.CODEINVADERS_RUNTIME_COMMAND
    ? process.platform === 'win32'
      ? 'cmd.exe'
      : 'sh'
    : process.execPath;
  const args = env.CODEINVADERS_RUNTIME_COMMAND
    ? process.platform === 'win32'
      ? ['/d', '/s', '/c', env.CODEINVADERS_RUNTIME_COMMAND]
      : ['-c', env.CODEINVADERS_RUNTIME_COMMAND]
    : [runtime];
  let child: ChildProcess;
  try {
    child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      env: {
        ...env,
        CODEINVADERS_DATA_DIR: paths.dataRoot,
        CODEINVADERS_PORT: String(port),
        CODEINVADERS_BIND: '127.0.0.1',
        CODEINVADERS_BROWSER_SECRET: secret,
      },
    });
    child.unref();
  } catch (error) {
    return {
      code: EXIT_CODES.failed,
      message: `Unable to start local runtime: ${error instanceof Error ? error.message : 'spawn failed'}`,
    };
  }
  if (!child.pid)
    return { code: EXIT_CODES.failed, message: 'Local runtime did not provide a process id.' };
  const ready = await waitForRuntime(paths, child.pid, port);
  if (!ready) {
    try {
      process.kill(child.pid, 'SIGTERM');
    } catch {
      /* child may have already exited */
    }
    await rm(paths.runtimeFile, { force: true });
    return {
      code: EXIT_CODES.failed,
      message:
        'Local runtime did not publish valid secret-free readiness metadata; inspect the data directory and retry.',
    };
  }
  let browserLaunched = false;
  if (!options.noBrowser) {
    browserLaunched = await launchBrowser(
      `http://127.0.0.1:${port}/#${encodeURIComponent(secret)}`,
      os,
      env,
    );
  }
  return {
    code: EXIT_CODES.ok,
    message: `Runtime started on http://127.0.0.1:${port}.`,
    data: { pid: child.pid, port, browserLaunched },
  };
}
async function waitForRuntime(
  paths: CliPaths,
  childPid: number,
  expectedPort: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const value = JSON.parse(await readFile(paths.runtimeFile, 'utf8')) as {
        pid?: number;
        port?: number;
        bind?: string;
        startedAt?: string;
        epochId?: string;
      };
      if (
        value.pid === childPid &&
        value.port === expectedPort &&
        value.bind === '127.0.0.1' &&
        typeof value.startedAt === 'string' &&
        typeof value.epochId === 'string' &&
        !JSON.stringify(value).includes('CODEINVADERS_BROWSER_SECRET')
      )
        return true;
    } catch {
      /* Child startup is still in progress. */
    }
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 50));
  }
  return false;
}
async function launchBrowser(
  url: string,
  os: HostOS,
  env: Record<string, string | undefined>,
): Promise<boolean> {
  const override = env.CODEINVADERS_BROWSER_COMMAND;
  const command =
    override ?? (os === 'win32' ? 'explorer.exe' : os === 'darwin' ? 'open' : 'xdg-open');
  try {
    const child = spawn(command, [url], { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export interface DoctorCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}
async function childHookRoundTrip(root: string): Promise<boolean> {
  const hook = prebuiltHookPath('codex');
  if (!(await exists(hook))) return false;
  await mkdir(join(root, 'spool'), { recursive: true, mode: 0o700 });
  const child = spawn(process.execPath, [hook], {
    env: { ...process.env, CODEINVADERS_DATA_DIR: root },
    stdio: ['pipe', 'pipe', 'ignore'],
  }) as unknown as {
    readonly stdin: { write(value: string): void; end(): void };
    once(event: string, listener: (...args: unknown[]) => void): void;
  };
  await new Promise<void>((resolveChild) => {
    child.once('error', () => resolveChild());
    child.once('close', () => resolveChild());
    child.stdin.write(JSON.stringify({ hook: 'SessionStart', sessionId: 'doctor-synthetic' }));
    child.stdin.end();
  });
  const names = await readdir(join(root, 'spool'));
  return names.some((name) => name.endsWith('.ingress'));
}
function deriveRuntimeIpcPath(root: string, os: HostOS): string {
  if (os !== 'win32') return join(root, 'CodeInvaders.sock');
  let hash = 2166136261;
  for (let index = 0; index < root.length; index += 1)
    hash = Math.imul(hash ^ root.charCodeAt(index), 16777619);
  return `\\\\.\\pipe\\CodeInvaders-${(hash >>> 0).toString(16)}`;
}
async function probeIpc(path: string): Promise<boolean> {
  return new Promise((resolveProbe) => {
    let done = false;
    const finish = (value: boolean) => {
      if (done) return;
      done = true;
      resolveProbe(value);
    };
    try {
      const socket = createConnection(path) as unknown as {
        once(event: string, listener: (...args: unknown[]) => void): void;
        destroy(): void;
      };
      socket.once('connect', () => {
        socket.destroy();
        finish(true);
      });
      socket.once('error', () => finish(false));
      setTimeout(() => {
        socket.destroy();
        finish(false);
      }, 500);
    } catch {
      finish(false);
    }
  });
}
async function sendSyntheticIpc(path: string, event: unknown): Promise<boolean> {
  return new Promise((resolveSend) => {
    let done = false;
    const finish = (value: boolean) => {
      if (done) return;
      done = true;
      resolveSend(value);
    };
    try {
      const body = Buffer.from(JSON.stringify(event), 'utf8');
      const frame = Buffer.concat([
        Buffer.from(`CIIP/1 ${body.byteLength}:`, 'ascii'),
        body,
        Buffer.from('\n', 'ascii'),
      ]);
      const socket = createConnection(path) as unknown as {
        once(event: string, listener: (...args: unknown[]) => void): void;
        on(event: string, listener: (...args: unknown[]) => void): void;
        write(value: string | Uint8Array): void;
        destroy(): void;
      };
      socket.once('connect', () => socket.write(frame));
      socket.on('data', (chunk: unknown) => {
        const text = String(chunk);
        if (text === 'ACK\n') {
          socket.destroy();
          finish(true);
        } else if (text.includes('ERR\n')) {
          socket.destroy();
          finish(false);
        }
      });
      socket.once('error', () => finish(false));
      setTimeout(() => {
        socket.destroy();
        finish(false);
      }, 1000);
    } catch {
      finish(false);
    }
  });
}
export async function doctor(
  options: CliOptions,
  os: HostOS = host(hostPlatform()),
  env: Record<string, string | undefined> = process.env,
): Promise<CliResult> {
  const paths = resolvePaths(options, os);
  const detection = await detectSurfaces(options, env, os);
  const checks: DoctorCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const configuredSurfaces = detection.surfaces.filter(
    (x) => options.agents.includes(x.agent) && (x.installed || x.executable),
  );
  if (!configuredSurfaces.length)
    add('agent surface', false, 'no selected agent installation detected');
  for (const s of configuredSurfaces) {
    const text = await readOrEmpty(s.configPath);
    const parsed = parseConfig(text, s.agent === 'claude' ? 'json' : 'toml');
    if (s.agent === 'codex' && s.pluginSupported) {
      const pluginState = await codexPluginState(
        env.CODEINVADERS_CODEX_BIN ?? 'codex',
        (await marketplaceRoot(options.cwd)) ?? '',
        os,
        env,
      );
      add(
        'codex native plugin',
        pluginState.pluginInstalled,
        pluginState.pluginInstalled
          ? `installed selector ${CODEX_PLUGIN_SELECTOR} verified from Codex plugin list`
          : `selector ${CODEX_PLUGIN_SELECTOR} was not found in Codex plugin list`,
      );
      continue;
    }
    add(
      `${s.agent} configuration`,
      parsed.valid && parsed.ownedEntries > 0,
      parsed.valid
        ? `${parsed.ownedEntries} owned hook entr${parsed.ownedEntries === 1 ? 'y' : 'ies'} recognized`
        : 'configuration is missing or invalid',
    );
    add(
      `${s.agent} direct entry`,
      (await exists(prebuiltHookPath(s.agent))) &&
        (await exists(join(paths.hooksRoot, `${s.agent}-hook.mjs`))),
      `source ${prebuiltHookPath(s.agent)} and installed asset ${join(paths.hooksRoot, `${s.agent}-hook.mjs`)} must be present`,
    );
  }
  try {
    await mkdir(paths.dataRoot, { recursive: true, mode: 0o700 });
    const info = await stat(paths.dataRoot);
    add('private storage', info.isDirectory(), paths.dataRoot);
  } catch {
    add('private storage', false, 'application data directory unavailable');
  }
  add(
    'loopback policy',
    (env.CODEINVADERS_BIND ?? '127.0.0.1') === '127.0.0.1' ||
      (env.CODEINVADERS_BIND ?? '127.0.0.1') === '::1',
    'browser service must bind to loopback',
  );
  const endpoint = deriveRuntimeIpcPath(paths.dataRoot, os);
  const runtime = await runtimeStatus(paths);
  const ipcOk = runtime.running ? await probeIpc(endpoint) : true;
  add(
    'local IPC endpoint',
    ipcOk,
    runtime.running ? endpoint : `${endpoint} will be verified when the runtime is started`,
  );
  add(
    'browser assets',
    (await exists(join(options.cwd, 'apps', 'local', 'dist', 'runtime.js'))) ||
      (await exists(join(options.cwd, 'apps', 'local', 'dist', 'broker.js'))) ||
      (await exists(join(options.cwd, '..', '..', 'apps', 'local', 'src', 'ui.ts'))) ||
      (await exists(join(options.cwd, '..', '..', 'apps', 'local', 'dist', 'index.js'))) ||
      (await exists(
        join(
          dirname(fileURLToPath(import.meta.url)),
          '..',
          '..',
          '..',
          'apps',
          'local',
          'dist',
          'runtime.js',
        ),
      )) ||
      (await exists(
        join(
          dirname(fileURLToPath(import.meta.url)),
          '..',
          '..',
          '..',
          'apps',
          'local',
          'src',
          'ui.ts',
        ),
      )),
    'production local runtime and browser assets present',
  );
  if (runtime.running && runtime.port !== undefined) {
    try {
      const health = await fetch(`http://127.0.0.1:${runtime.port}/api/health`);
      add(
        'browser authentication service',
        health.status === 200,
        `health status ${health.status}`,
      );
      const asset = await fetch(`http://127.0.0.1:${runtime.port}/assets/app.v0.1.0.js`);
      add('browser immutable assets', asset.status === 200, `app asset status ${asset.status}`);
      const unauthenticated = await fetch(`http://127.0.0.1:${runtime.port}/api/state`, {
        headers: { Origin: `http://127.0.0.1:${runtime.port}` },
      });
      add(
        'browser authentication boundary',
        unauthenticated.status === 401,
        `unauthenticated state status ${unauthenticated.status}`,
      );
    } catch {
      add('browser authentication service', false, 'runtime HTTP endpoint unavailable');
      add('browser immutable assets', false, 'runtime asset endpoint unavailable');
      add('browser authentication boundary', false, 'runtime HTTP endpoint unavailable');
    }
  } else {
    add(
      'browser authentication service',
      true,
      'runtime not running; start before browser verification',
    );
    add(
      'browser immutable assets',
      true,
      'production assets will be checked against the running runtime',
    );
    add(
      'browser authentication boundary',
      true,
      'runtime not running; start before browser verification',
    );
  }
  try {
    const fixture = validEventFixture('session.started') as Record<string, unknown>;
    const synthetic = {
      ...fixture,
      eventId: 'doctor-round-trip-event',
      source: { ...(fixture.source as Record<string, unknown>), streamId: 'doctor-stream' },
    };
    const journal = new EventJournal({
      root: join(paths.dataRoot, 'doctor-round-trip'),
      streamId: 'doctor-stream',
    });
    const appended = await journal.append(synthetic);
    const events = await journal.events();
    const delivered = runtime.running
      ? await sendSyntheticIpc(endpoint, synthetic)
      : await childHookRoundTrip(join(paths.dataRoot, 'doctor-child'));
    add(
      'synthetic privacy-safe round trip',
      appended.ok && events.ok && events.value.length === 1 && delivered,
      appended.ok && events.ok && delivered
        ? 'validated, appended, read back, and delivered one synthetic event'
        : 'protocol or journal rejected synthetic event',
    );
  } catch {
    add('synthetic privacy-safe round trip', false, 'journal round trip unavailable');
  }
  const ok = checks.every((c) => c.ok);
  return {
    code: ok ? EXIT_CODES.ok : EXIT_CODES.failed,
    message: ok ? 'Doctor passed.' : 'Doctor found one or more problems.',
    data: { checks, limitations: configuredSurfaces.flatMap((surface) => surface.limitations) },
  };
}
export async function replay(options: CliOptions): Promise<CliResult> {
  if (!options.replayFile)
    return {
      code: EXIT_CODES.usage,
      message: 'Replay requires a journal path (`codeinvaders replay --file <path>`).',
    };
  try {
    const lines = (await readFile(options.replayFile, 'utf8')).split('\n').filter(Boolean);
    const records: unknown[] = [];
    for (const line of lines) {
      try {
        const value: unknown = JSON.parse(line);
        const checked = validateEvent(value);
        if (checked.status === 'accepted') records.push(checked.event);
      } catch {
        /* corrupt records are skipped */
      }
    }
    return {
      code: EXIT_CODES.ok,
      message: `Replay loaded ${records.length} canonical record${records.length === 1 ? '' : 's'}.`,
      data: {
        file: options.replayFile,
        records: records.length,
        canonicalOnly: true,
        invokedAgent: false,
      },
    };
  } catch {
    return {
      code: EXIT_CODES.failed,
      message: `Replay journal is unavailable: ${options.replayFile}`,
    };
  }
}
export async function uninstall(
  options: CliOptions,
  os: HostOS = host(hostPlatform()),
  env: Record<string, string | undefined> = process.env,
): Promise<CliResult> {
  const paths = resolvePaths(options, os);
  const detection = await detectSurfaces(options, env, os);
  if (options.deleteData && !(await confirm(options, 'Delete all CodeInvaders recordings?')))
    return {
      code: EXIT_CODES.cancelled,
      message: 'Data deletion cancelled; no files were changed.',
    };
  const diffs: unknown[] = [];
  const written: ConfigDiff[] = [];
  const recoveryBackups: string[] = [];
  const codex = detection.surfaces.find((surface) => surface.agent === 'codex');
  const nativeCodexSelected =
    !options.dryRun && options.agents.includes('codex') && !!codex?.executable;
  const nativeSource = nativeCodexSelected ? await marketplaceRoot(options.cwd) : undefined;
  const nativeState = nativeCodexSelected
    ? await codexPluginState(env.CODEINVADERS_CODEX_BIN ?? 'codex', nativeSource ?? '', os, env)
    : undefined;
  for (const s of detection.surfaces.filter((x) => options.agents.includes(x.agent))) {
    const before = await readOrEmpty(s.configPath);
    const format = s.agent === 'claude' ? 'json' : 'toml';
    const result = removeOwnedConfig(before, format, s.agent);
    if (result.error)
      return { code: EXIT_CODES.failed, message: `Cannot parse ${s.configPath}: ${result.error}` };
    if (!options.dryRun && result.removed) {
      const tx = await transactionalWrite(
        s.configPath,
        result.after,
        (text) => parseConfig(text, format).valid && parseConfig(text, format).ownedEntries === 0,
      );
      if (!tx.ok)
        return {
          code: EXIT_CODES.failed,
          message: `Uninstall was rolled back for ${s.configPath}`,
        };
      if (tx.backup) recoveryBackups.push(tx.backup);
      written.push({
        agent: s.agent,
        path: s.configPath,
        format,
        changed: true,
        before,
        after: result.after,
        added: 0,
        removed: result.removed,
      });
    }
    diffs.push({ agent: s.agent, path: s.configPath, removed: result.removed });
  }
  if (nativeCodexSelected && nativeState?.pluginKnown && nativeState.pluginInstalled) {
    const command = env.CODEINVADERS_CODEX_BIN ?? 'codex';
    const removed = await runExternal(
      command,
      ['plugin', 'remove', CODEX_PLUGIN_SELECTOR],
      os,
      env,
    );
    if (removed.status !== 0) {
      await rollbackConfigs(written);
      return {
        code: EXIT_CODES.failed,
        message: `Codex plugin ${CODEX_PLUGIN_SELECTOR} could not be removed; configuration was restored.`,
      };
    }
    if (
      nativeState.marketplaceKnown &&
      nativeState.marketplaceOwned &&
      nativeSource !== undefined
    ) {
      const marketplace = await runExternal(
        command,
        ['plugin', 'marketplace', 'remove', CODEX_MARKETPLACE_NAME],
        os,
        env,
      );
      if (marketplace.status !== 0) {
        // The selector was present before uninstall. Restore it if removing
        // its owned marketplace source fails, keeping the operation atomic
        // from the user's perspective.
        await runExternal(command, ['plugin', 'add', CODEX_PLUGIN_SELECTOR], os, env);
        await rollbackConfigs(written);
        return {
          code: EXIT_CODES.failed,
          message:
            'CodeInvaders marketplace source could not be removed; configuration was restored.',
        };
      }
    }
  }
  if (!options.dryRun) {
    for (const s of detection.surfaces.filter((x) => options.agents.includes(x.agent)))
      await rm(join(paths.hooksRoot, `${s.agent}-hook.mjs`), { force: true });
    if (options.deleteData) await removeRecordingsSafely(paths.dataRoot);
    // Recovery copies are only needed while the multi-surface transaction can
    // still roll back. Once every operation has succeeded, remove them so a
    // second copy of the user's configuration is not retained on disk.
    for (const backup of recoveryBackups) await rm(backup, { force: true });
  }
  return {
    code: EXIT_CODES.ok,
    message: options.deleteData
      ? 'Uninstalled; owned hooks removed and recordings deletion requested.'
      : 'Uninstalled; owned hooks removed and recordings preserved.',
    data: { diffs, recordingsPreserved: !options.deleteData },
  };
}

/** Delete only known recording artifacts; symlinked directories are retained. */
async function removeRecordingsSafely(root: string): Promise<readonly string[]> {
  const skipped: string[] = [];
  for (const name of [
    'journal',
    'spool',
    'snapshots',
    'diagnostics',
    'doctor-round-trip',
    'manifest.json',
  ]) {
    const path = join(root, name);
    try {
      if ((await lstat(path)).isSymbolicLink()) {
        skipped.push(name);
        continue;
      }
      await rm(path, { recursive: name !== 'manifest.json', force: true });
    } catch {
      skipped.push(name);
    }
  }
  return skipped;
}

interface JournalCompatibility {
  readonly ok: boolean;
  readonly unsupported?: boolean;
  readonly detail?: string;
}

function decodeJournalStreamDirectory(name: string): string {
  if (!name.startsWith('s64-')) return name;
  try {
    const decoded = Buffer.from(name.slice(4), 'base64url').toString('utf8');
    return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(decoded) ? decoded : name;
  } catch {
    return name;
  }
}

/** Inspect journals without constructing EventJournal (which intentionally repairs on startup). */
async function inspectJournalCompatibility(root: string): Promise<JournalCompatibility> {
  const journalRoot = join(root, 'journal');
  let rootInfo: Awaited<ReturnType<typeof lstat>>;
  try {
    rootInfo = await lstat(journalRoot);
  } catch {
    return { ok: true };
  }
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory())
    return { ok: false, detail: 'journal root is not a private directory' };
  let streams: string[];
  try {
    streams = await readdir(journalRoot);
  } catch {
    return { ok: false, detail: 'journal root cannot be read' };
  }
  for (const directory of streams) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(directory))
      return { ok: false, detail: `unsafe journal stream directory: ${directory}` };
    const streamRoot = join(journalRoot, directory);
    let streamInfo: Awaited<ReturnType<typeof lstat>>;
    try {
      streamInfo = await lstat(streamRoot);
    } catch {
      return { ok: false, detail: `journal stream disappeared: ${directory}` };
    }
    if (streamInfo.isSymbolicLink() || !streamInfo.isDirectory())
      return { ok: false, detail: `journal stream is not a private directory: ${directory}` };
    const streamId = decodeJournalStreamDirectory(directory);
    const manifestPath = join(streamRoot, 'manifest.json');
    let manifest: Record<string, unknown>;
    try {
      const manifestInfo: Awaited<ReturnType<typeof lstat>> = await lstat(manifestPath);
      if (manifestInfo.isSymbolicLink() || !manifestInfo.isFile() || manifestInfo.size > 1_048_576)
        return { ok: false, detail: `journal manifest is unsafe: ${directory}` };
      const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('root');
      manifest = parsed as Record<string, unknown>;
    } catch {
      return { ok: false, detail: `journal manifest is corrupt: ${directory}` };
    }
    const segments = manifest.segments;
    if (
      manifest.version !== 1 ||
      manifest.streamId !== streamId ||
      !Number.isSafeInteger(manifest.nextSequence) ||
      (manifest.nextSequence as number) < 1 ||
      !Array.isArray(segments) ||
      segments.some((name) => typeof name !== 'string' || !/^segment-\d{8}\.jsonl$/.test(name)) ||
      new Set(segments as string[]).size !== segments.length
    )
      return {
        ok: false,
        unsupported: typeof manifest.version === 'number' && manifest.version !== 1,
        detail: `journal manifest is incompatible: ${directory}`,
      };
    let highest = 0;
    const listed = new Set(segments as string[]);
    let names: string[];
    try {
      names = await readdir(streamRoot);
    } catch {
      return { ok: false, detail: `journal stream cannot be read: ${directory}` };
    }
    for (const name of names) {
      if (/^segment-\d{8}\.jsonl$/.test(name) && !listed.has(name))
        return {
          ok: false,
          detail: `journal segment is not listed by manifest: ${directory}/${name}`,
        };
    }
    for (const segment of segments as string[]) {
      const segmentPath = join(streamRoot, segment);
      let segmentInfo: Awaited<ReturnType<typeof lstat>>;
      let text: string;
      try {
        segmentInfo = await lstat(segmentPath);
        if (
          segmentInfo.isSymbolicLink() ||
          !segmentInfo.isFile() ||
          segmentInfo.size > 16 * 1024 * 1024
        )
          return { ok: false, detail: `journal segment is unsafe: ${directory}/${segment}` };
        text = await readFile(segmentPath, 'utf8');
      } catch {
        return { ok: false, detail: `journal segment is unreadable: ${directory}/${segment}` };
      }
      if (text.length && !text.endsWith('\n'))
        return {
          ok: false,
          detail: `journal segment has an incomplete record: ${directory}/${segment}`,
        };
      for (const line of text.split('\n')) {
        if (!line) continue;
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch {
          return {
            ok: false,
            detail: `journal segment contains invalid JSON: ${directory}/${segment}`,
          };
        }
        const checked = validateEvent(value);
        if (checked.status === 'quarantined')
          return {
            ok: false,
            unsupported: true,
            detail: `journal event has unsupported protocol: ${directory}/${segment}`,
          };
        if (checked.status !== 'accepted' && checked.status !== 'preserved-extension')
          return { ok: false, detail: `journal event is invalid: ${directory}/${segment}` };
        const event = checked.event as { source?: { streamId?: unknown }; sequence?: unknown };
        if (
          event.source?.streamId !== streamId ||
          !Number.isSafeInteger(event.sequence) ||
          (event.sequence as number) < 1
        )
          return {
            ok: false,
            detail: `journal event does not match its stream: ${directory}/${segment}`,
          };
        highest = Math.max(highest, event.sequence as number);
      }
    }
    if ((manifest.nextSequence as number) <= highest)
      return { ok: false, detail: `journal manifest sequence is behind its records: ${directory}` };
  }
  return { ok: true };
}
export async function upgrade(
  options: CliOptions,
  os: HostOS = host(hostPlatform()),
  env: Record<string, string | undefined> = process.env,
): Promise<CliResult> {
  const paths = resolvePaths(options, os);
  const compatibility = await inspectJournalCompatibility(paths.dataRoot);
  if (!compatibility.ok)
    return {
      code: compatibility.unsupported ? EXIT_CODES.unsupported : EXIT_CODES.failed,
      message: `${compatibility.detail ?? 'Stored journal is incompatible'}; no files were changed.`,
    };
  const result = await install({ ...options, dryRun: false, yes: true }, os, env);
  return result.code === EXIT_CODES.ok
    ? {
        ...result,
        message: 'Compatible upgrade completed; owned configuration was replaced transactionally.',
      }
    : result;
}
export async function runCli(
  argv: readonly string[] = process.argv.slice(2),
  env: Record<string, string | undefined> = process.env,
): Promise<CliResult> {
  try {
    const options = parseArgs(argv, env);
    if (options.command === 'help') return { code: EXIT_CODES.ok, message: usage() };
    if (options.command === 'version')
      return { code: EXIT_CODES.ok, message: `${cliName} ${cliVersion}` };
    if (options.command === 'install') return install(options, host(hostPlatform()), env);
    if (options.command === 'start') return start(options, host(hostPlatform()), env);
    if (options.command === 'status') return status(options, host(hostPlatform()), env);
    if (options.command === 'doctor') return doctor(options, host(hostPlatform()), env);
    if (options.command === 'replay') return replay(options);
    if (options.command === 'upgrade') return upgrade(options, host(hostPlatform()), env);
    if (options.command === 'uninstall') return uninstall(options, host(hostPlatform()), env);
    return { code: EXIT_CODES.usage, message: usage() };
  } catch (error) {
    const message =
      error instanceof UsageError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Unexpected CLI error';
    return { code: error instanceof UsageError ? EXIT_CODES.usage : EXIT_CODES.failed, message };
  }
}

/** Keep configuration contents out of both human and machine-readable output. */
function summarizeDiff(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return { changed: false };
  const diff = value as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  for (const key of ['agent', 'path', 'format', 'changed', 'added', 'removed']) {
    if (diff[key] !== undefined) summary[key] = diff[key];
  }
  if (typeof diff.error === 'string') summary.error = diff.error.slice(0, 240);
  return summary;
}
function sanitizeOutputData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeOutputData);
  if (!value || typeof value !== 'object') return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    output[key] =
      key === 'diffs' && Array.isArray(child)
        ? child.map(summarizeDiff)
        : sanitizeOutputData(child);
  }
  return output;
}
export function renderResult(result: CliResult, json = false): string {
  const data = result.data === undefined ? undefined : sanitizeOutputData(result.data);
  return json
    ? JSON.stringify(
        {
          code: result.code,
          ...(result.message ? { message: result.message } : {}),
          ...(data === undefined ? {} : { data }),
        },
        null,
        2,
      )
    : [result.message, data === undefined ? '' : JSON.stringify(data, null, 2)]
        .filter(Boolean)
        .join('\n');
}
const invoked =
  process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (invoked)
  void runCli().then((result) => {
    process.stdout.write(renderResult(result, process.argv.includes('--json')) + '\n');
    process.exitCode = result.code;
  });
