import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { assertReleaseVersion } from './release-utils.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const expected = process.argv.find((value) => value.startsWith('--version='))?.slice(10);
const packageFiles = ['package.json'];

for (const directory of ['packages', 'apps']) {
  for (const name of await readdir(resolve(root, directory), { withFileTypes: true })) {
    if (name.isDirectory()) packageFiles.push(`${directory}/${name.name}/package.json`);
  }
}

const records = [];
for (const file of packageFiles.sort()) {
  const value = JSON.parse(await readFile(resolve(root, file), 'utf8'));
  if (typeof value.name !== 'string' || typeof value.version !== 'string') {
    throw new Error(`${file} is missing a package name or version`);
  }
  records.push({ file, name: value.name, version: value.version, private: value.private === true });
}

const cliSource = await readFile(resolve(root, 'packages/cli/src/index.ts'), 'utf8');
const cliVersion = /export const cliVersion = '([^']+)'/.exec(cliSource)?.[1];
if (cliVersion !== records[0]?.version) {
  throw new Error(
    `CLI source version ${cliVersion ?? '<missing>'} does not match workspace ${records[0]?.version}`,
  );
}

const pluginManifestPath = resolve(
  root,
  'packaging/marketplace/plugins/codeinvaders/.codex-plugin/plugin.json',
);
const pluginManifest = JSON.parse(await readFile(pluginManifestPath, 'utf8'));
if (typeof pluginManifest.version !== 'string' || pluginManifest.version !== records[0]?.version) {
  throw new Error(
    `Codex plugin version ${pluginManifest.version ?? '<missing>'} does not match workspace ${records[0]?.version}`,
  );
}
const claudeManifestPath = resolve(root, 'packaging/manual/claude/manifest.json');
const claudeManifest = JSON.parse(await readFile(claudeManifestPath, 'utf8'));
if (claudeManifest.version !== records[0]?.version) {
  throw new Error(
    `Claude manual hook version ${claudeManifest.version ?? '<missing>'} does not match workspace ${records[0]?.version}`,
  );
}

const versions = new Set(records.map((record) => record.version));
if (versions.size !== 1) {
  throw new Error(`workspace versions differ: ${[...versions].sort().join(', ')}`);
}
const version = records[0]?.version;
if (!version || (expected && expected !== version)) {
  throw new Error(`release version ${expected ?? '<missing>'} does not match workspace ${version}`);
}
assertReleaseVersion(version);

process.stdout.write(`${JSON.stringify({ version, packages: records }, null, 2)}\n`);
