import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const packageRoot = new globalThis.URL('..', import.meta.url);

const probes = [
  ['Object.keys', "Object.keys = () => { throw new Error('synthetic bootstrap poison'); };"],
  [
    'Object.getPrototypeOf',
    "Object.getPrototypeOf = () => { throw new Error('synthetic bootstrap poison'); };",
  ],
  [
    'Object.getOwnPropertyDescriptor',
    "Object.getOwnPropertyDescriptor = () => { throw new Error('synthetic bootstrap poison'); };",
  ],
  ['Object.create', "Object.create = () => { throw new Error('synthetic bootstrap poison'); };"],
  [
    'Object.defineProperty',
    "Object.defineProperty = () => { throw new Error('synthetic bootstrap poison'); };",
  ],
  ['Array.isArray', "Array.isArray = () => { throw new Error('synthetic bootstrap poison'); };"],
  ['JSON.stringify', "JSON.stringify = () => { throw new Error('synthetic bootstrap poison'); };"],
  [
    'Function.prototype.call',
    "Function.prototype.call = () => { throw new Error('synthetic bootstrap poison'); };",
  ],
  [
    'Function.prototype.apply',
    "Function.prototype.apply = () => { throw new Error('synthetic bootstrap poison'); };",
  ],
  ['Reflect.apply', "Reflect.apply = () => { throw new Error('synthetic bootstrap poison'); };"],
  [
    'Reflect.ownKeys',
    "Reflect.ownKeys = () => { throw new Error('synthetic bootstrap poison'); };",
  ],
  [
    'TextEncoder',
    'globalThis.TextEncoder = class { encode(value) { return new Uint8Array(value.length); } };',
  ],
];

const neutralProbe = `
  const neutral = await import('data:text/javascript,export const marker%3D%22neutral-loader%22');
  if (neutral.marker !== 'neutral-loader') process.exitCode = 11;
`;

const sdkProbe = (poison) => `
  ${neutralProbe}
  await import('@codeinvaders/protocol');
  ${poison}
  const sdk = await import('@codeinvaders/adapter-sdk');
  const diagnostic = sdk.buildAdapterDiagnostic({
    code: 'native-input-invalid',
    field: 'native-field',
    secret: 'BOOTSTRAP_PRIVACY_CANARY',
  });
  if (
    diagnostic.code !== 'diagnostic-invalid' ||
    diagnostic.severity !== 'error' ||
    diagnostic.boundary !== 'adapter' ||
    diagnostic.field !== undefined
  ) process.exitCode = 12;
  const firstDegradedDiagnostic = sdk.buildAdapterDiagnostic({ code: 'native-input-invalid' });
  firstDegradedDiagnostic.code = 'poisoned-diagnostic';
  const laterDegradedDiagnostic = sdk.buildAdapterDiagnostic({ code: 'native-input-invalid' });
  if (
    firstDegradedDiagnostic === laterDegradedDiagnostic ||
    laterDegradedDiagnostic.code !== 'diagnostic-invalid'
  ) process.exitCode = 19;
  const firstDegradedRejection = sdk.sanitizeIngressRecord({ secret: 'BOOTSTRAP_PRIVACY_CANARY' });
  firstDegradedRejection.status = 'accepted';
  firstDegradedRejection.diagnostics[0].code = 'poisoned-diagnostic';
  firstDegradedRejection.diagnostics.push({
    code: 'native-input-invalid',
    severity: 'error',
    boundary: 'adapter',
  });
  const laterDegradedRejection = sdk.sanitizeIngressRecord({ secret: 'BOOTSTRAP_PRIVACY_CANARY' });
  if (
    firstDegradedRejection === laterDegradedRejection ||
    firstDegradedRejection.diagnostics === laterDegradedRejection.diagnostics ||
    firstDegradedRejection.diagnostics[0] === laterDegradedRejection.diagnostics[0] ||
    laterDegradedRejection.status !== 'rejected' ||
    laterDegradedRejection.diagnostics.length !== 1 ||
    laterDegradedRejection.diagnostics[0].code !== 'diagnostic-invalid'
  ) process.exitCode = 20;
  if (sdk.categorizeTool({ name: 'shell', secret: 'BOOTSTRAP_PRIVACY_CANARY' }) !== 'other')
    process.exitCode = 13;
  if (sdk.isOpaqueId('oid1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA') !== false)
    process.exitCode = 14;
  if (sdk.sanitizeIngressRecord({ secret: 'BOOTSTRAP_PRIVACY_CANARY' }).status !== 'rejected')
    process.exitCode = 15;
  let payloadError;
  try {
    sdk.buildToolStartedPayload({ secret: 'BOOTSTRAP_PRIVACY_CANARY' });
  } catch (error) {
    payloadError = error;
  }
  if (payloadError?.code !== 'invalid-agent-state') process.exitCode = 16;
  let identityError;
  try {
    await sdk.createOpaqueIdDeriver(new Uint8Array(32));
  } catch (error) {
    identityError = error;
  }
  if (identityError?.code !== 'crypto-unavailable') process.exitCode = 17;
  let retryError;
  try {
    await sdk.deriveStableRetryEventId({ derive: async () => 'x' }, 'BOOTSTRAP_PRIVACY_CANARY');
  } catch (error) {
    retryError = error;
  }
  if (retryError?.code !== 'retry-derivation-failed') process.exitCode = 18;
`;

function isNodeLoaderLimitation(result) {
  return (
    result.status !== 0 &&
    result.stderr.includes('ModuleWrap') &&
    result.stderr.includes('module_value->IsObject()')
  );
}

describe('adapter bootstrap hardening', () => {
  it('keeps a neutral loader baseline distinct from degraded SDK evaluation', () => {
    for (const [name, poison] of probes) {
      const baseline = spawnSync(
        globalThis.process.execPath,
        ['--input-type=module', '--eval', `${neutralProbe} process.exitCode ??= 0;`],
        { cwd: packageRoot, encoding: 'utf8', windowsHide: true },
      );
      expect(baseline.status, `${name}: neutral data-module baseline`).toBe(0);

      const child = spawnSync(
        globalThis.process.execPath,
        ['--input-type=module', '--eval', sdkProbe(poison)],
        { cwd: packageRoot, encoding: 'utf8', windowsHide: true },
      );
      if (isNodeLoaderLimitation(child)) {
        expect(
          ['Function.prototype.call', 'Function.prototype.apply', 'Reflect.apply'],
          `${name}: recognized Node loader limitation`,
        ).toContain(name);
        continue;
      }
      expect(child.status, `${name}: adapter bootstrap`).toBe(0);
      expect(child.stdout, `${name}: no probe output`).toBe('');
    }

    const poisonedIdentity = spawnSync(
      globalThis.process.execPath,
      [
        '--input-type=module',
        '--eval',
        `
          globalThis.TextEncoder = class {
            encode(value) { return new Uint8Array(value.length); }
          };
          const sdk = await import('@codeinvaders/adapter-sdk');
          const key = new Uint8Array(32);
          let error;
          try {
            await sdk.deriveOpaqueId(key, 'stream', 'fixed-vector');
          } catch (caught) {
            error = caught;
          }
          if (error?.code !== 'crypto-unavailable') process.exitCode = 21;
        `,
      ],
      { cwd: packageRoot, encoding: 'utf8', windowsHide: true },
    );
    expect(poisonedIdentity.status, 'pre-import TextEncoder identity poison').toBe(0);
    expect(poisonedIdentity.stdout, 'pre-import TextEncoder identity output').toBe('');
  }, 30_000);
});
