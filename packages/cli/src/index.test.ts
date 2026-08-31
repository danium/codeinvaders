import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EXIT_CODES,
  OWNERSHIP_MARKER,
  composeJsonConfig,
  composeTomlConfig,
  detectSurfaces,
  doctor,
  install,
  parseArgs,
  parseConfig,
  removeOwnedConfig,
  resolvePaths,
  renderResult,
  runCli,
  upgrade,
  uninstall,
  CODEX_PLUGIN_SELECTOR,
} from './index.js';

describe('CLI output privacy', () => {
  it('does not render configuration contents in human or JSON output', () => {
    const secret = 'CODEINVADERS_SENTINEL_DO_NOT_PRINT';
    const result = {
      code: EXIT_CODES.ok,
      message: 'Dry run: no files changed.',
      data: {
        diffs: [
          {
            agent: 'claude',
            path: 'settings.json',
            format: 'json',
            changed: true,
            before: JSON.stringify({ apiKey: secret }),
            after: JSON.stringify({ apiKey: secret, hook: 'owned' }),
            added: 1,
            removed: 0,
          },
        ],
      },
    };
    for (const output of [renderResult(result, false), renderResult(result, true)]) {
      expect(output).not.toContain(secret);
      expect(output).not.toContain('before');
      expect(output).not.toContain('after');
      expect(output).toContain('settings.json');
      expect(output).toContain('"added"');
    }
  });
});

const opts = (home: string, cwd: string, dataDir: string) => ({
  command: 'install',
  agents: ['claude'] as const,
  scope: 'user' as const,
  cwd,
  home,
  dataDir,
  configDir: undefined,
  json: true,
  nonInteractive: true,
  yes: true,
  dryRun: false,
  deleteData: false,
  noBrowser: true,
});
const repositoryRoot = process.cwd().toLowerCase().endsWith(join('packages', 'cli').toLowerCase())
  ? join(process.cwd(), '..', '..')
  : process.cwd();

async function fakeCodex(root: string, state: Record<string, unknown> = {}) {
  const statePath = join(root, 'fake-codex-state.json');
  await writeFile(statePath, JSON.stringify({ plugins: [], marketplaces: [], ...state }), 'utf8');
  const fixture = join(
    repositoryRoot,
    'fixtures',
    'cli',
    process.platform === 'win32' ? 'fake-codex.cmd' : 'fake-codex.mjs',
  );
  if (process.platform !== 'win32') await chmod(fixture, 0o755);
  return {
    statePath,
    env: {
      CODEINVADERS_CODEX_BIN: fixture,
      CODEINVADERS_FAKE_CODEX_STATE: statePath,
    },
  };
}

async function fakeState(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

describe('argument parsing and configuration composition', () => {
  it('parses all lifecycle commands and stable options', async () => {
    expect(
      parseArgs(['replay', '--file', './events.jsonl', '--json', '--non-interactive']),
    ).toMatchObject({
      command: 'replay',
      replayFile: join(process.cwd(), 'events.jsonl'),
      json: true,
      nonInteractive: true,
    });
    expect(parseArgs(['install', '--agent', 'codex', '--scope', 'project', '--yes'])).toMatchObject(
      {
        agents: ['codex'],
        scope: 'project',
        yes: true,
      },
    );
    await expect(runCli(['not-a-command'])).resolves.toMatchObject({ code: EXIT_CODES.usage });
  });

  it('composes JSON hooks while retaining unrelated hooks and is idempotent', () => {
    const before = JSON.stringify({
      hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'user-tool' }] }] },
    });
    const first = composeJsonConfig(before, 'claude', '/tmp/ci-hooks');
    expect(first.error).toBeUndefined();
    expect(first.after).toContain('user-tool');
    expect(first.after).toContain(OWNERSHIP_MARKER);
    expect(first.after).toContain('claude-hook.mjs');
    expect(first.after).toContain('CODEINVADERS_DATA_DIR');
    const windows = composeJsonConfig(before, 'claude', '/tmp/ci-hooks', 'win32');
    expect(windows.after).toContain("CODEINVADERS_DATA_DIR='/tmp'");
    expect(windows.after).not.toContain('set \\"CODEINVADERS_DATA_DIR');
    expect(windows.after).not.toContain('& rem codeinvaders-owned:v1');
    const hostile = composeJsonConfig(
      before,
      'claude',
      "/tmp/$(touch pwned)`echo pwned`'dir/hooks",
      'win32',
    );
    expect(hostile.after).toContain(
      "CODEINVADERS_DATA_DIR='/tmp/$(touch pwned)`echo pwned`'\\\\''dir'",
    );
    const hostileCodex = composeTomlConfig('', 'codex', 'C:\\tmp\\100%\\!dir\\hooks', 'win32');
    expect(hostileCodex.after).toContain('setlocal DisableDelayedExpansion');
    expect(hostileCodex.after).toContain('100^%\\\\^!dir');
    const second = composeJsonConfig(first.after, 'claude', '/tmp/ci-hooks');
    expect(second.added).toBe(0);
    const removed = removeOwnedConfig(first.after, 'json', 'claude');
    expect(removed.error).toBeUndefined();
    expect(removed.after).toContain('user-tool');
    expect(removed.after).not.toContain(OWNERSHIP_MARKER);
  });
  it('does not treat an unrelated key containing the product name as owned', () => {
    const before = JSON.stringify({
      codeinvadersUserSetting: true,
      hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'user-tool' }] }] },
    });
    const removed = removeOwnedConfig(before, 'json', 'claude');
    expect(removed.removed).toBe(0);
    expect(removed.after).toContain('codeinvadersUserSetting');
  });
  it('reports the supported Codex plugin/manual limitation without inventing TOML hooks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeinvaders-codex-'));
    try {
      const home = join(root, 'home');
      const configPath = join(home, '.codex', 'config.toml');
      const { mkdir } = await import('node:fs/promises');
      await mkdir(join(home, '.codex'), { recursive: true });
      await writeFile(configPath, 'trusted_setting = true\n', 'utf8');
      const result = await install(
        { ...opts(home, process.cwd(), join(root, 'data')), agents: ['codex'] },
        'linux',
        { CODEINVADERS_CODEX_INSTALLED: '1', CODEINVADERS_CODEX_PLUGIN_SUPPORTED: '0' },
      );
      expect(result.code).toBe(EXIT_CODES.unsupported);
      expect(await readFile(configPath, 'utf8')).toBe('trusted_setting = true\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('treats CODEX_HOME as the direct Codex configuration directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeinvaders-codex-home-'));
    try {
      const codexHome = join(root, 'isolated-codex-config');
      await mkdir(codexHome, { recursive: true });
      await writeFile(join(codexHome, 'config.toml'), 'model = "gpt-5.6-luna"\n', 'utf8');
      const result = await detectSurfaces(
        opts(join(root, 'home'), process.cwd(), join(root, 'data')),
        {
          CODEX_HOME: codexHome,
          CODEINVADERS_CODEX_INSTALLED: '1',
          CODEINVADERS_CODEX_PLUGIN_SUPPORTED: '1',
        },
        'win32',
      );
      expect(result.surfaces.find((surface) => surface.agent === 'codex')).toMatchObject({
        configPath: join(codexHome, 'config.toml'),
        installed: true,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('composes and removes only the marked TOML block', () => {
    const first = composeTomlConfig('timeout = 20\n', 'codex', '/tmp/ci-hooks');
    expect(first.after).toContain('timeout = 20');
    expect(parseConfig(first.after, 'toml').ownedEntries).toBeGreaterThan(0);
    const removed = removeOwnedConfig(first.after, 'toml', 'codex');
    expect(removed.after).toContain('timeout = 20');
    expect(removed.removed).toBe(1);
  });
});

describe('isolated install, doctor, and uninstall lifecycle', () => {
  it('installs in user scope, runs privacy-safe doctor, and retains recordings on uninstall', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeinvaders-cli-'));
    const home = join(root, 'home');
    const cwd = process.cwd();
    const dataDir = join(root, 'data');
    const configPath = join(home, '.claude', 'settings.json');
    await writeFile(
      configPath,
      JSON.stringify({
        hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'keep-me' }] }] },
      }),
      { encoding: 'utf8' },
    ).catch(async () => {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(join(home, '.claude'), { recursive: true });
      await writeFile(
        configPath,
        JSON.stringify({
          hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'keep-me' }] }] },
        }),
        'utf8',
      );
    });
    const options = opts(home, cwd, dataDir);
    const installed = await install(options, 'linux', {});
    expect(installed.code).toBe(EXIT_CODES.ok);
    expect((await readFile(configPath, 'utf8')).includes('keep-me')).toBe(true);
    const checked = await doctor(options, 'linux', {});
    expect(checked.code).toBe(EXIT_CODES.ok);
    const removed = await uninstall(options, 'linux', {});
    expect(removed.code).toBe(EXIT_CODES.ok);
    expect((await readFile(configPath, 'utf8')).includes('keep-me')).toBe(true);
    expect(
      await readFile(configPath + '.codeinvaders-recovery.bak', 'utf8').catch(() => null),
    ).toBeNull();
    expect(removed.data).toMatchObject({ recordingsPreserved: true });
    expect(resolvePaths(options, 'linux').dataRoot).toBe(dataDir);
  });
});

describe('Codex native plugin lifecycle', () => {
  it('probes a real Codex executable and installs the exact selector for Codex-only', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeinvaders-codex-native-'));
    try {
      const fake = await fakeCodex(root);
      const options = {
        ...opts(join(root, 'home'), process.cwd(), join(root, 'data')),
        agents: ['codex'] as const,
      };
      const installed = await install(
        options,
        process.platform === 'win32' ? 'win32' : 'linux',
        fake.env,
      );
      expect(installed.code).toBe(EXIT_CODES.ok);
      const state = await fakeState(fake.statePath);
      expect(state.plugins).toEqual([CODEX_PLUGIN_SELECTOR]);
      const marketplace = (state.marketplaces as string[])[0];
      expect(marketplace).toBeDefined();
      expect(marketplace?.replaceAll('\\', '/')).toContain('packaging/marketplace');
      const checked = await doctor(
        options,
        process.platform === 'win32' ? 'win32' : 'linux',
        fake.env,
      );
      expect(checked.code).toBe(EXIT_CODES.ok);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rolls back a newly registered marketplace when native plugin installation fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeinvaders-codex-rollback-'));
    try {
      const fake = await fakeCodex(root);
      const options = {
        ...opts(join(root, 'home'), process.cwd(), join(root, 'data')),
        agents: ['codex'] as const,
      };
      const result = await install(options, process.platform === 'win32' ? 'win32' : 'linux', {
        ...fake.env,
        CODEINVADERS_FAKE_CODEX_FAIL: 'plugin-add',
      });
      expect(result.code).toBe(EXIT_CODES.failed);
      expect(await fakeState(fake.statePath)).toEqual({ plugins: [], marketplaces: [] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not re-install a preconfigured selector or marketplace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeinvaders-codex-preconfigured-'));
    try {
      const fake = await fakeCodex(root, {
        plugins: [CODEX_PLUGIN_SELECTOR],
        marketplaces: [join(repositoryRoot, 'packaging', 'marketplace')],
      });
      const options = {
        ...opts(join(root, 'home'), process.cwd(), join(root, 'data')),
        agents: ['codex'] as const,
      };
      const result = await install(
        options,
        process.platform === 'win32' ? 'win32' : 'linux',
        fake.env,
      );
      expect(result.code).toBe(EXIT_CODES.ok);
      expect(await fakeState(fake.statePath)).toEqual({
        plugins: [CODEX_PLUGIN_SELECTOR],
        marketplaces: [join(repositoryRoot, 'packaging', 'marketplace')],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rolls back native plugin state when a later Claude configuration step is invalid', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeinvaders-codex-config-rollback-'));
    try {
      const home = join(root, 'home');
      await mkdir(join(home, '.claude'), { recursive: true });
      const settings = join(home, '.claude', 'settings.json');
      await writeFile(settings, '{not-json', 'utf8');
      const fake = await fakeCodex(root);
      const options = {
        ...opts(home, process.cwd(), join(root, 'data')),
        agents: ['codex', 'claude'] as const,
      };
      const result = await install(
        options,
        process.platform === 'win32' ? 'win32' : 'linux',
        fake.env,
      );
      expect(result.code).toBe(EXIT_CODES.failed);
      expect(await fakeState(fake.statePath)).toEqual({ plugins: [], marketplaces: [] });
      expect(await readFile(settings, 'utf8')).toBe('{not-json');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uninstalls only owned native state and preserves unrelated plugin state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeinvaders-codex-uninstall-'));
    try {
      const fake = await fakeCodex(root, {
        plugins: [CODEX_PLUGIN_SELECTOR, 'other@vendor'],
        marketplaces: ['https://example.invalid/other-marketplace'],
      });
      const options = {
        ...opts(join(root, 'home'), process.cwd(), join(root, 'data')),
        agents: ['codex'] as const,
      };
      const removed = await uninstall(
        options,
        process.platform === 'win32' ? 'win32' : 'linux',
        fake.env,
      );
      expect(removed.code).toBe(EXIT_CODES.ok);
      expect(await fakeState(fake.statePath)).toEqual({
        plugins: ['other@vendor'],
        marketplaces: ['https://example.invalid/other-marketplace'],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('upgrade journal compatibility gate', () => {
  it('rejects a corrupt per-stream segment before writing configuration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeinvaders-upgrade-corrupt-'));
    try {
      const stream = join(root, 'data', 'journal', 's64-c3RyZWFtLTE');
      await mkdir(stream, { recursive: true });
      await writeFile(
        join(stream, 'manifest.json'),
        JSON.stringify({
          version: 1,
          streamId: 'stream-1',
          nextSequence: 1,
          segments: ['segment-00000000.jsonl'],
        }),
        'utf8',
      );
      await writeFile(join(stream, 'segment-00000000.jsonl'), '{broken}\n', 'utf8');
      const result = await upgrade(
        { ...opts(join(root, 'home'), process.cwd(), join(root, 'data')), agents: ['claude'] },
        'linux',
        {},
      );
      expect(result.code).toBe(EXIT_CODES.failed);
      expect(await readFile(join(stream, 'segment-00000000.jsonl'), 'utf8')).toBe('{broken}\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects an unsupported per-stream manifest version without touching data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeinvaders-upgrade-unsupported-'));
    try {
      const stream = join(root, 'data', 'journal', 'stream-1');
      await mkdir(stream, { recursive: true });
      const manifest = join(stream, 'manifest.json');
      await writeFile(
        manifest,
        JSON.stringify({ version: 2, streamId: 'stream-1', nextSequence: 1, segments: [] }),
        'utf8',
      );
      const result = await upgrade(
        { ...opts(join(root, 'home'), process.cwd(), join(root, 'data')), agents: ['claude'] },
        'linux',
        {},
      );
      expect(result.code).toBe(EXIT_CODES.unsupported);
      expect(await readFile(manifest, 'utf8')).toContain('"version":2');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
