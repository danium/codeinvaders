import { describe, expect, it } from 'vitest';
import { auditRuntimeSources } from '../../scripts/security-audit.mjs';

describe('offline runtime release gate', () => {
  it('finds no remote endpoint or analytics surface in production runtime sources', async () => {
    expect(await auditRuntimeSources()).toEqual([]);
  });
});
