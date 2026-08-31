import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import {
  assertReleaseVersion,
  extractChangelogSection,
  filterPlatformPackages,
  flattenLicenseInventory,
  getPlatformPackageIds,
  releaseProvenance,
  sha256Hex,
} from './release-utils.mjs';

assert.equal(assertReleaseVersion('1.2.3-rc.1'), '1.2.3-rc.1');
assert.throws(() => assertReleaseVersion('v1.2.3'));
const changelog =
  '# Changelog\n\n## [1.2.3]\n\n### Fixed\n\n- Stable fix.\n\n## [1.2.2]\n\n- Older fix.\n';
assert.match(extractChangelogSection(changelog, '1.2.3'), /Stable fix/);
assert.doesNotMatch(extractChangelogSection(changelog, '1.2.3'), /Older fix/);
assert.match(
  extractChangelogSection('# Changelog\n\n## [Unreleased]\n\n- Next.\n', '1.0.0'),
  /Next/,
);
assert.equal(
  sha256Hex(Buffer.from('CodeInvaders', 'utf8')),
  '82107760edea260597677b7b25f2fe3e7e141386c003f3ae368e54ad7836e67a',
);
assert.deepEqual(
  flattenLicenseInventory({
    MIT: [{ name: 'zeta', versions: ['2.0.0'], license: 'MIT', paths: ['private'] }],
    ISC: [{ name: 'alpha', versions: ['1.0.0'], license: 'ISC' }],
  }),
  [
    { name: 'alpha', version: '1.0.0', license: 'ISC' },
    { name: 'zeta', version: '2.0.0', license: 'MIT' },
  ],
);
assert.throws(() => flattenLicenseInventory({ MIT: [{ name: 'bad', versions: [1] }] }));
const lockfile = `lockfileVersion: '9.0'\n\npackages:\n  '@native/pkg@1.0.0':\n    resolution: {integrity: sha512-test}\n    os: [win32]\n  portable@1.0.0:\n    resolution: {integrity: sha512-test}\n\nsnapshots:\n`;
assert.deepEqual([...getPlatformPackageIds(lockfile)], ['@native/pkg@1.0.0']);
assert.deepEqual(
  filterPlatformPackages(
    [
      { name: '@native/pkg', version: '1.0.0', license: 'MIT' },
      { name: 'portable', version: '1.0.0', license: 'MIT' },
    ],
    lockfile,
  ),
  [{ name: 'portable', version: '1.0.0', license: 'MIT' }],
);
assert.match(releaseProvenance({}), /^pending \(not generated locally;/u);
assert.match(
  releaseProvenance({ RELEASE_PROVENANCE: 'untrusted local claim' }),
  /^pending \(not generated locally;/u,
);
assert.equal(
  releaseProvenance({
    GITHUB_ACTIONS: 'true',
    GITHUB_WORKFLOW: 'Release',
    GITHUB_REF_TYPE: 'tag',
  }),
  'GitHub Actions artifact attestation for the release archive',
);
assert.equal(
  releaseProvenance({
    GITHUB_ACTIONS: 'true',
    GITHUB_WORKFLOW: 'Release',
    GITHUB_REF_TYPE: 'tag',
    RELEASE_PROVENANCE: 'trusted CI provenance recorded',
  }),
  'trusted CI provenance recorded',
);
assert.equal(
  releaseProvenance(
    {
      GITHUB_ACTIONS: 'true',
      GITHUB_WORKFLOW: 'Release',
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      CODEINVADERS_VERIFIED_RELEASE_TAG: 'v0.1.0',
    },
    '0.1.0',
  ),
  'GitHub Actions artifact attestation for the release archive',
);
assert.match(
  releaseProvenance(
    {
      GITHUB_ACTIONS: 'true',
      GITHUB_WORKFLOW: 'Release',
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      CODEINVADERS_VERIFIED_RELEASE_TAG: 'v0.1.1',
    },
    '0.1.0',
  ),
  /^pending \(not generated locally;/u,
);
process.stdout.write('release script self-test passed\n');
