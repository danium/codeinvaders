import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { delimiter, extname, join, resolve } from 'node:path';
import { filterPlatformPackages } from './release/release-utils.mjs';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'THIRD-PARTY-NOTICES.md');
const check = process.argv.includes('--check');
const pnpmArgs = ['licenses', 'list', '--json', '--long'];
const packageManagerScript = process.env.npm_execpath;
let command;
let args;

if (packageManagerScript && existsSync(packageManagerScript)) {
  const extension = extname(packageManagerScript).toLowerCase();
  if (extension === '.cjs' || extension === '.js' || extension === '.mjs') {
    command = process.execPath;
    args = [packageManagerScript, ...pnpmArgs];
  } else {
    command = packageManagerScript;
    args = pnpmArgs;
  }
} else {
  const localPnpm = resolve(root, 'node_modules/pnpm/bin/pnpm.cjs');
  const globalPnpm = process.env.npm_config_prefix
    ? join(process.env.npm_config_prefix, 'node_modules/pnpm/bin/pnpm.cjs')
    : undefined;
  const pathPnpm = (process.env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .map((directory) => resolve(directory, 'node_modules/pnpm/bin/pnpm.cjs'))
    .find((candidate) => existsSync(candidate));
  const pnpmScript = [localPnpm, globalPnpm, pathPnpm].find(
    (candidate) => candidate && existsSync(candidate),
  );

  if (pnpmScript) {
    command = process.execPath;
    args = [pnpmScript, ...pnpmArgs];
  } else if (process.platform !== 'win32') {
    command = 'pnpm';
    args = pnpmArgs;
  } else {
    process.stderr.write('Unable to resolve the active pnpm JavaScript entry point.\n');
    process.exit(1);
  }
}
const result = spawnSync(command, args, {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

if (result.error || result.status !== 0) {
  process.stderr.write(
    result.stderr || result.stdout || result.error?.message || 'pnpm licenses list failed\n',
  );
  process.exit(result.status ?? 1);
}

const grouped = JSON.parse(result.stdout);
const lockfile = readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8');
const normalizeText = (value) =>
  String(value ?? '')
    .replace(/\s+/gu, ' ')
    .trim();
const records = filterPlatformPackages(
  Object.values(grouped)
    .flat()
    .flatMap((entry) =>
      entry.versions.map((version) => ({
        name: entry.name,
        version,
        license: normalizeText(entry.license),
        author: normalizeText(entry.author),
        homepage: normalizeText(entry.homepage),
        description: normalizeText(entry.description),
      })),
    ),
  lockfile,
).sort((a, b) =>
  `${a.name}\0${a.version}\0${a.license}`.localeCompare(`${b.name}\0${b.version}\0${b.license}`),
);

const lines = [
  '# Third-party notices',
  '',
  'This file is generated from the committed `pnpm-lock.yaml` dependency graph.',
  'Regenerate it with `pnpm third-party-notices:generate`; CI uses',
  '`pnpm third-party-notices:check` to ensure it is current.',
  '',
  `Dependency records: ${records.length}`,
  '',
];

for (const record of records) {
  lines.push(`## ${record.name} ${record.version}`);
  lines.push('');
  lines.push(`- License: ${record.license}`);
  if (record.author) lines.push(`- Author: ${record.author}`);
  if (record.homepage) lines.push(`- Homepage: ${record.homepage}`);
  if (record.description) lines.push(`- Description: ${record.description}`);
  lines.push('');
}

const generated = lines.join('\n');
if (check) {
  const current = readFileSync(output, 'utf8');
  if (current !== generated) {
    process.stderr.write(`${output} is out of date.\n`);
    process.exit(1);
  }
} else {
  writeFileSync(output, generated, 'utf8');
}
