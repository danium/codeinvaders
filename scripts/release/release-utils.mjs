import { createHash } from 'node:crypto';

export const RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function assertReleaseVersion(version) {
  if (typeof version !== 'string' || !RELEASE_VERSION_PATTERN.test(version)) {
    throw new Error(`invalid release version: ${String(version)}`);
  }
  return version;
}

/** Extract one release section without accidentally consuming the next release. */
export function extractChangelogSection(changelog, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const heading = new RegExp(`^## \\[${escaped}\\]`, 'm');
  const start = changelog.search(heading);
  const fallback = start >= 0 ? start : changelog.search(/^## \[Unreleased\]/m);
  if (fallback < 0) return undefined;
  const remainder = changelog.slice(fallback);
  const nextHeading = remainder.search(/\n##(?: |\[)/);
  return remainder.slice(0, nextHeading < 0 ? remainder.length : nextHeading);
}

/** Convert pnpm's grouped license output into a stable, path-free inventory. */
export function flattenLicenseInventory(licenses) {
  if (!licenses || typeof licenses !== 'object' || Array.isArray(licenses)) {
    throw new Error('license output must be an object grouped by license');
  }
  const records = [];
  for (const [group, entries] of Object.entries(licenses)) {
    if (!Array.isArray(entries)) throw new Error(`license group is not an array: ${group}`);
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string') {
        throw new Error(`license entry is missing a package name: ${group}`);
      }
      if (
        !Array.isArray(entry.versions) ||
        entry.versions.some((value) => typeof value !== 'string')
      ) {
        throw new Error(`license entry has invalid versions: ${entry.name}`);
      }
      const license = typeof entry.license === 'string' ? entry.license : group;
      for (const version of entry.versions) records.push({ name: entry.name, version, license });
    }
  }
  return records.sort((a, b) => {
    const left = `${a.name}\u0000${a.version}\u0000${a.license}`;
    const right = `${b.name}\u0000${b.version}\u0000${b.license}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
