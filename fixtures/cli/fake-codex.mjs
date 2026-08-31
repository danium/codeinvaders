#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

const statePath = process.env.CODEINVADERS_FAKE_CODEX_STATE;
if (!statePath) process.exit(2);
const state = JSON.parse(await readFile(statePath, 'utf8'));
const args = process.argv.slice(2);
const fail = process.env.CODEINVADERS_FAKE_CODEX_FAIL;
const save = async () => writeFile(statePath, JSON.stringify(state), 'utf8');
const output = (values) => process.stdout.write(values.join('\n') + (values.length ? '\n' : ''));

if (args[0] === 'plugin' && args[1] === '--help') {
  process.stdout.write('plugin list, add, remove, marketplace\n');
  process.exit(0);
}
if (args[0] !== 'plugin') process.exit(2);
if (args[1] === 'list') {
  output((state.plugins ?? []).map((value) => `${value}  installed, enabled  0.1.0  ${value}`));
  process.exit(0);
}
if (args[1] === 'marketplace' && args[2] === 'list') {
  output((state.marketplaces ?? []).map((value) => `codeinvaders-local  ${value}`));
  process.exit(0);
}
if (args[1] === 'marketplace' && args[2] === 'add' && args[3]) {
  if (fail === 'marketplace-add') process.exit(1);
  state.marketplaces = [...new Set([...(state.marketplaces ?? []), args[3]])];
  await save();
  process.exit(0);
}
if (args[1] === 'marketplace' && args[2] === 'remove' && args[3]) {
  if (fail === 'marketplace-remove') process.exit(1);
  state.marketplaces = (state.marketplaces ?? []).filter(
    (value) =>
      value !== args[3] && !String(value).replaceAll('\\', '/').endsWith('/packaging/marketplace'),
  );
  await save();
  process.exit(0);
}
if (args[1] === 'add' && args[2]) {
  if (fail === 'plugin-add') process.exit(1);
  state.plugins = [...new Set([...(state.plugins ?? []), args[2]])];
  await save();
  process.exit(0);
}
if (args[1] === 'remove' && args[2]) {
  if (fail === 'plugin-remove') process.exit(1);
  state.plugins = (state.plugins ?? []).filter((value) => value !== args[2]);
  await save();
  process.exit(0);
}
process.exit(2);
