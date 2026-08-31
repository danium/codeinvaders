import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import process from 'node:process';
import {
  assertReleaseVersion,
  extractChangelogSection,
  flattenLicenseInventory,
  sha256Hex,
} from './release-utils.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const releaseRoot = resolve(root, 'dist', 'release');
const stage = resolve(releaseRoot, 'stage');
const explicitVersion = process.argv.find((value) => value.startsWith('--version='))?.slice(10);
const rootPackage = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const version = assertReleaseVersion(explicitVersion ?? rootPackage.version);

if (releaseRoot !== resolve(root, 'dist', 'release')) throw new Error('unsafe release path');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.stderr || result.stdout || result.error?.message || `${command} failed`);
  }
  return result.stdout ?? '';
}

function pnpm(args, options) {
  const executable = process.env.npm_execpath;
  if (executable && ['.js', '.cjs', '.mjs'].includes(extname(executable).toLowerCase())) {
    return run(process.execPath, [executable, ...args], options);
  }
  return run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, options);
}

run(process.execPath, [
  resolve(root, 'scripts/release/verify-release.mjs'),
  `--version=${version}`,
]);
pnpm(['check']);
// Keep the production-build invocation explicit in release logs even though the root gate also builds.
pnpm(['build']);
run(process.execPath, [resolve(root, 'scripts/release/build-hook-bundles.mjs')]);
run(process.execPath, [resolve(root, 'scripts/release/verify-hook-bundles.mjs')]);

await rm(releaseRoot, { recursive: true, force: true });
await mkdir(stage, { recursive: true });

const copyTargets = [
  'LICENSE',
  'README.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'GOVERNANCE.md',
  'COMPATIBILITY.md',
  'CHANGELOG.md',
  'THIRD-PARTY-NOTICES.md',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.node-version',
  '.nvmrc',
  '.prettierignore',
  '.prettierrc.json',
  'eslint.config.mjs',
  'tsconfig.base.json',
  'vitest.config.mjs',
  '.github',
  'packaging',
  'docs',
  'fixtures',
  'scripts',
  'tests',
];
for (const target of copyTargets) {
  await cp(resolve(root, target), resolve(stage, target), { recursive: true });
}
for (const directory of ['packages', 'apps'])
  await cp(resolve(root, directory), resolve(stage, directory), { recursive: true });

const changelog = await readFile(resolve(root, 'CHANGELOG.md'), 'utf8');
const section = extractChangelogSection(changelog, version);
if (!section) throw new Error('changelog has no release or Unreleased section');
await writeFile(
  resolve(releaseRoot, 'RELEASE_NOTES.md'),
  `# CodeInvaders ${version}\n\n${section.trim()}\n`,
  'utf8',
);

const protocolSource = await readFile(resolve(root, 'packages/protocol/src/index.ts'), 'utf8');
const protocolId = /export const protocolId = '([^']+)'/.exec(protocolSource)?.[1];
const protocolVersion = /export const protocolVersion = '([^']+)'/.exec(protocolSource)?.[1];
if (!protocolId || !protocolVersion) throw new Error('protocol metadata is unavailable');
await writeFile(
  resolve(releaseRoot, 'RELEASE_METADATA.json'),
  `${JSON.stringify(
    {
      schema: 'codeinvaders.release-metadata.v1',
      version,
      sourceTag: `v${version}`,
      protocol: { id: protocolId, version: protocolVersion },
      supported: { node: '24 LTS', pnpm: '10.27.x', platforms: ['windows', 'macos', 'linux'] },
      installation: 'README.md',
      provenance: 'GitHub Actions artifact attestation for the release archive',
    },
    null,
    2,
  )}\n`,
  'utf8',
);

const licenses = JSON.parse(pnpm(['licenses', 'list', '--json', '--long'], { capture: true }));
const inventory = flattenLicenseInventory(licenses);
await writeFile(
  resolve(releaseRoot, 'dependency-inventory.json'),
  `${JSON.stringify({ schema: 'codeinvaders.dependencies.v1', dependencies: inventory }, null, 2)}\n`,
  'utf8',
);

const archive = resolve(releaseRoot, `codeinvaders-${version}.tar.gz`);
run('tar', ['-czf', archive, '-C', stage, '.']);
await rm(stage, { recursive: true, force: true });

const checksumTargets = [
  archive,
  resolve(releaseRoot, 'RELEASE_NOTES.md'),
  resolve(releaseRoot, 'RELEASE_METADATA.json'),
  resolve(releaseRoot, 'dependency-inventory.json'),
];
const checksums = [];
for (const file of checksumTargets) {
  const digest = sha256Hex(await readFile(file));
  checksums.push(`${digest}  ${basename(file)}`);
}
await writeFile(resolve(releaseRoot, 'SHA256SUMS'), `${checksums.join('\n')}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ version, releaseRoot, artifacts: checksums.length })}\n`);
