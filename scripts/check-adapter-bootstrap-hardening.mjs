import { spawnSync } from 'node:child_process';

const packageRoot = new globalThis.URL('../packages/adapter-sdk/', import.meta.url);
const builtSdk = await import(
  new globalThis.URL('../packages/adapter-sdk/dist/index.js', import.meta.url)
);
const { validEventFixture } = await import(
  new globalThis.URL('../packages/protocol/dist/fixtures/index.js', import.meta.url)
);

const probes = [
  ['Object.keys', "Object.keys = () => { throw new Error('synthetic adapter poison'); };"],
  [
    'Object.getPrototypeOf',
    "Object.getPrototypeOf = () => { throw new Error('synthetic adapter poison'); };",
  ],
  [
    'Object.getOwnPropertyDescriptor',
    "Object.getOwnPropertyDescriptor = () => { throw new Error('synthetic adapter poison'); };",
  ],
  ['Object.create', "Object.create = () => { throw new Error('synthetic adapter poison'); };"],
  [
    'Object.defineProperty',
    "Object.defineProperty = () => { throw new Error('synthetic adapter poison'); };",
  ],
  ['Array.isArray', "Array.isArray = () => { throw new Error('synthetic adapter poison'); };"],
  ['JSON.stringify', "JSON.stringify = () => { throw new Error('synthetic adapter poison'); };"],
  [
    'Function.prototype.call',
    "Function.prototype.call = () => { throw new Error('synthetic adapter poison'); };",
  ],
  [
    'Function.prototype.apply',
    "Function.prototype.apply = () => { throw new Error('synthetic adapter poison'); };",
  ],
  ['Reflect.apply', "Reflect.apply = () => { throw new Error('synthetic adapter poison'); };"],
  ['Reflect.ownKeys', "Reflect.ownKeys = () => { throw new Error('synthetic adapter poison'); };"],
  [
    'TextEncoder',
    'globalThis.TextEncoder = class { encode(value) { return new Uint8Array(value.length); } };',
  ],
  [
    'RegExp.prototype.test',
    "RegExp.prototype.test = () => { throw new Error('synthetic adapter regex poison'); };",
  ],
];

const postImportRegexDescriptor = Object.getOwnPropertyDescriptor(RegExp.prototype, 'test');
const postImportRegexCanary = 'ADAPTER_BUILT_REGEXP_NATIVE_CANARY';
const postImportRegexEvent = validEventFixture('session.started');
postImportRegexEvent.eventId = 'oid1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
postImportRegexEvent.source.streamId = 'oid1_EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE';
postImportRegexEvent.source.epochId = 'oid1_IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII';
postImportRegexEvent.source.adapterVersion = postImportRegexCanary;
postImportRegexEvent.scope.workspaceId = 'oid1_MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM';
postImportRegexEvent.scope.sessionId = 'oid1_QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ';
let postImportRegexResult;
let postImportRegexThrown;
try {
  Object.defineProperty(RegExp.prototype, 'test', {
    configurable: postImportRegexDescriptor?.configurable ?? true,
    enumerable: postImportRegexDescriptor?.enumerable ?? false,
    writable: postImportRegexDescriptor?.writable ?? true,
    value: () => true,
  });
  try {
    postImportRegexResult = builtSdk.sanitizeIngressRecord(postImportRegexEvent);
  } catch (error) {
    postImportRegexThrown = error;
  }
} finally {
  if (postImportRegexDescriptor === undefined) delete RegExp.prototype.test;
  else Object.defineProperty(RegExp.prototype, 'test', postImportRegexDescriptor);
}
if (
  postImportRegexThrown !== undefined ||
  postImportRegexResult?.status !== 'rejected' ||
  JSON.stringify(postImportRegexResult).includes(postImportRegexCanary) ||
  JSON.stringify(Object.getOwnPropertyDescriptor(RegExp.prototype, 'test')) !==
    JSON.stringify(postImportRegexDescriptor)
)
  throw new Error('built adapter RegExp hardening failed');

const neutral = `
  const marker = await import('data:text/javascript,export const value%3D%22neutral-loader%22');
  if (marker.value !== 'neutral-loader') process.exitCode = 11;
`;

const loaderLimitation = (result) =>
  result.status !== 0 &&
  result.stderr.includes('ModuleWrap') &&
  result.stderr.includes('module_value->IsObject()');

for (const [name, poison] of probes) {
  const baseline = spawnSync(
    globalThis.process.execPath,
    ['--input-type=module', '--eval', `${neutral} process.exitCode ??= 0;`],
    { cwd: packageRoot, encoding: 'utf8', windowsHide: true },
  );
  if (baseline.status !== 0) throw new Error(`neutral data-module baseline failed: ${name}`);

  const script = `
    ${neutral}
    await import('@codeinvaders/protocol');
    ${poison}
    const sdk = await import('@codeinvaders/adapter-sdk');
    const diagnostic = sdk.buildAdapterDiagnostic({
      code: 'native-input-invalid',
      field: 'native-field',
      secret: 'ADAPTER_BOOTSTRAP_PRIVACY_CANARY',
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
    const firstDegradedRejection = sdk.sanitizeIngressRecord({ secret: 'ADAPTER_BOOTSTRAP_PRIVACY_CANARY' });
    firstDegradedRejection.status = 'accepted';
    firstDegradedRejection.diagnostics[0].code = 'poisoned-diagnostic';
    firstDegradedRejection.diagnostics.push({
      code: 'native-input-invalid',
      severity: 'error',
      boundary: 'adapter',
    });
    const laterDegradedRejection = sdk.sanitizeIngressRecord({ secret: 'ADAPTER_BOOTSTRAP_PRIVACY_CANARY' });
    if (
      firstDegradedRejection === laterDegradedRejection ||
      firstDegradedRejection.diagnostics === laterDegradedRejection.diagnostics ||
      firstDegradedRejection.diagnostics[0] === laterDegradedRejection.diagnostics[0] ||
      laterDegradedRejection.status !== 'rejected' ||
      laterDegradedRejection.diagnostics.length !== 1 ||
      laterDegradedRejection.diagnostics[0].code !== 'diagnostic-invalid'
    ) process.exitCode = 20;
    if (sdk.categorizeTool({ name: 'shell', secret: 'ADAPTER_BOOTSTRAP_PRIVACY_CANARY' }) !== 'other')
      process.exitCode = 13;
    if (sdk.isOpaqueId('oid1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA') !== false)
      process.exitCode = 14;
    if (sdk.sanitizeIngressRecord({ secret: 'ADAPTER_BOOTSTRAP_PRIVACY_CANARY' }).status !== 'rejected')
      process.exitCode = 15;
    let payloadError;
    try {
      sdk.buildToolStartedPayload({ secret: 'ADAPTER_BOOTSTRAP_PRIVACY_CANARY' });
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
      await sdk.deriveStableRetryEventId({ derive: async () => 'x' }, 'ADAPTER_BOOTSTRAP_PRIVACY_CANARY');
    } catch (error) {
      retryError = error;
    }
    if (retryError?.code !== 'retry-derivation-failed') process.exitCode = 18;
  `;
  const child = spawnSync(globalThis.process.execPath, ['--input-type=module', '--eval', script], {
    cwd: packageRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (loaderLimitation(child)) {
    if (!['Function.prototype.call', 'Function.prototype.apply', 'Reflect.apply'].includes(name))
      throw new Error(`unexpected Node loader limitation: ${name}`);
    continue;
  }
  if (child.status !== 0) throw new Error(`adapter bootstrap failed: ${name}`);
  if (child.stdout !== '') throw new Error(`adapter bootstrap emitted output: ${name}`);
  if (
    child.stdout.includes('ADAPTER_BOOTSTRAP_PRIVACY_CANARY') ||
    child.stderr.includes('ADAPTER_BOOTSTRAP_PRIVACY_CANARY')
  )
    throw new Error(`adapter bootstrap privacy canary escaped: ${name}`);
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
if (poisonedIdentity.status !== 0 || poisonedIdentity.stdout !== '')
  throw new Error('pre-import TextEncoder identity poison was not fail-closed');

const fixedVectorKey = new Uint8Array(32);
for (let index = 0; index < fixedVectorKey.length; index += 1) fixedVectorKey[index] = index;
const fixedVectorDeriver = await builtSdk.createOpaqueIdDeriver(fixedVectorKey);
const fixedVectorExpected = 'oid1_O-Fm4IplbxSLURA5_kWch4V5_OmsJg2Y2GlozEnO6Po';
const originalUint8Array = Object.getOwnPropertyDescriptor(globalThis, 'Uint8Array');
const originalArrayBuffer = Object.getOwnPropertyDescriptor(globalThis, 'ArrayBuffer');
try {
  Object.defineProperty(globalThis, 'Uint8Array', {
    configurable: true,
    writable: true,
    value: class PoisonedUint8Array {},
  });
  Object.defineProperty(globalThis, 'ArrayBuffer', {
    configurable: true,
    writable: true,
    value: class PoisonedArrayBuffer {},
  });
  const fixedVectorAfterPoison = await fixedVectorDeriver.derive('stream', 'fixed-vector');
  if (fixedVectorAfterPoison !== fixedVectorExpected)
    throw new Error('built identity binary intrinsic hardening failed');
} finally {
  Object.defineProperty(globalThis, 'Uint8Array', originalUint8Array);
  Object.defineProperty(globalThis, 'ArrayBuffer', originalArrayBuffer);
}

globalThis.process.stdout.write('adapter bootstrap hardening: passed\n');
