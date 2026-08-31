import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import {
  assertReleaseVersion,
  extractChangelogSection,
  flattenLicenseInventory,
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
process.stdout.write('release script self-test passed\n');
