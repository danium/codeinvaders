import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const RUNTIME_ROOTS = [
  'apps/local/src',
  'packages/adapter-sdk/src',
  'packages/adapter-codex/src',
  'packages/adapter-claude/src',
];
const SOURCE_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.css', '.html']);
const TEST_FILE = /(?:\.test|\.spec)\.(?:ts|js|mjs)$/;
const LOCAL_URL = /^(?:http:\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?|\$\{this\.host\}))/i;

async function filesUnder(directory) {
  const result = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await filesUnder(path)));
    else if (
      SOURCE_EXTENSIONS.has(path.slice(path.lastIndexOf('.'))) &&
      !TEST_FILE.test(entry.name)
    )
      result.push(path);
  }
  return result;
}

/**
 * Audits production runtime sources for accidental network/analytics surfaces.
 * The returned metadata is deliberately path-relative and never includes source
 * text, URLs, environment values, or user data.
 */
export async function auditRuntimeSources(root = ROOT) {
  const findings = [];
  const roots = [...RUNTIME_ROOTS];
  // Include generated production output when present. Missing build output is
  // handled by the normal build gate; the audit remains useful on source-only
  // checkouts as well.
  for (const relativeRoot of [
    'apps/local/dist',
    'packages/adapter-sdk/dist',
    'packages/adapter-codex/dist',
    'packages/adapter-claude/dist',
  ]) {
    try {
      await readdir(resolve(root, relativeRoot));
      roots.push(relativeRoot);
    } catch {
      // No generated output yet.
    }
  }
  for (const relativeRoot of roots) {
    const files = await filesUnder(resolve(root, relativeRoot));
    for (const path of files) {
      const text = await readFile(path, 'utf8');
      const relativePath = relative(root, path).replaceAll('\\', '/');
      const urls = [...text.matchAll(/https?:\/\/[^\s'"`<>)]*/gi)];
      for (const match of urls) {
        if (!LOCAL_URL.test(match[0])) findings.push({ file: relativePath, rule: 'remote-url' });
      }
      if (
        /\b(?:google-analytics|segment\.com|plausible\.io|posthog|mixpanel|amplitude)\b/i.test(text)
      )
        findings.push({ file: relativePath, rule: 'analytics-identifier' });
      if (/\b(?:navigator\.sendBeacon|XMLHttpRequest)\s*\(/.test(text))
        findings.push({ file: relativePath, rule: 'unreviewed-network-api' });
    }
  }
  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const findings = await auditRuntimeSources();
  const json = process.argv.includes('--json');
  if (json) process.stdout.write(JSON.stringify({ ok: findings.length === 0, findings }) + '\n');
  else if (findings.length === 0)
    process.stdout.write('security-audit: no production runtime findings\n');
  else {
    process.stdout.write(`security-audit: ${findings.length} finding(s)\n`);
    for (const finding of findings) process.stdout.write(`- ${finding.file}: ${finding.rule}\n`);
  }
  process.exitCode = findings.length === 0 ? 0 : 1;
}
