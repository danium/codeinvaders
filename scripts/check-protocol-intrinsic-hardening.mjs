import { spawnSync } from 'node:child_process';
import { validEventFixture } from '../packages/protocol/dist/fixtures/index.js';
import { validateEvent } from '../packages/protocol/dist/index.js';

const core = validEventFixture('session.started');
const extension = {
  ...core,
  type: 'x.io.example.telemetry',
  extension: { fallback: 'preserve-in-journal', documentation: 'opaque' },
  data: { value: 'opaque' },
};
const invalid = { ...core, type: 'vendor.secret.event' };

const originals = {
  keys: Object.keys,
  getPrototypeOf: Object.getPrototypeOf,
  getOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
  create: Object.create,
  defineProperty: Object.defineProperty,
  isArray: Array.isArray,
  stringify: JSON.stringify,
  call: Function.prototype.call,
  apply: Function.prototype.apply,
  reflectApply: Reflect.apply,
  ownKeys: Reflect.ownKeys,
  regExpTest: Object.getOwnPropertyDescriptor(RegExp.prototype, 'test'),
};

let postImportResults;
try {
  globalThis.process.stdout.write('');
  globalThis.process.stderr.write('');
  const poison = () => {
    throw new Error('synthetic protocol intrinsic poison');
  };
  Object.keys = () => [];
  Object.getPrototypeOf = poison;
  Object.getOwnPropertyDescriptor = poison;
  Object.create = poison;
  Object.defineProperty = poison;
  Array.isArray = poison;
  JSON.stringify = () => 'synthetic serializer poison';
  Function.prototype.call = poison;
  Function.prototype.apply = poison;
  Reflect.apply = poison;
  Reflect.ownKeys = poison;
  RegExp.prototype.test = () => true;
  const regexCanary = 'PROTOCOL_BUILT_REGEXP_NATIVE_CANARY';
  const malformedVersion = { ...core, version: regexCanary };
  const malformedId = { ...core, eventId: `${regexCanary} ` };
  const malformedType = { ...core, type: `x.Bad.${regexCanary}` };
  const malformedField = {
    ...core,
    type: 'tool.started',
    data: { name: `${regexCanary} `, category: 'shell' },
  };
  postImportResults = [
    validateEvent(core),
    validateEvent(extension),
    validateEvent(invalid),
    validateEvent(malformedVersion),
    validateEvent(malformedId),
    validateEvent(malformedType),
    validateEvent(malformedField),
  ];
} finally {
  Object.keys = originals.keys;
  Object.getPrototypeOf = originals.getPrototypeOf;
  Object.getOwnPropertyDescriptor = originals.getOwnPropertyDescriptor;
  Object.create = originals.create;
  Object.defineProperty = originals.defineProperty;
  Array.isArray = originals.isArray;
  JSON.stringify = originals.stringify;
  Function.prototype.call = originals.call;
  Function.prototype.apply = originals.apply;
  Reflect.apply = originals.reflectApply;
  Reflect.ownKeys = originals.ownKeys;
  if (originals.regExpTest === undefined) delete RegExp.prototype.test;
  else Object.defineProperty(RegExp.prototype, 'test', originals.regExpTest);
}

if (
  postImportResults[0]?.status !== 'accepted' ||
  postImportResults[1]?.status !== 'preserved-extension' ||
  postImportResults[2]?.status !== 'rejected' ||
  postImportResults[3]?.status !== 'rejected' ||
  postImportResults[4]?.status !== 'rejected' ||
  postImportResults[5]?.status !== 'rejected' ||
  postImportResults[6]?.status !== 'rejected' ||
  originals.stringify(postImportResults).includes('synthetic') ||
  originals.stringify(postImportResults).includes('PROTOCOL_BUILT_REGEXP_NATIVE_CANARY') ||
  originals.stringify(Object.getOwnPropertyDescriptor(RegExp.prototype, 'test')) !==
    originals.stringify(originals.regExpTest)
)
  throw new Error('built protocol post-import intrinsic hardening failed');

const preImportProbes = [
  ['Object.keys', "Object.keys = () => { throw new Error('synthetic poison'); };"],
  [
    'Object.getPrototypeOf',
    "Object.getPrototypeOf = () => { throw new Error('synthetic poison'); };",
  ],
  [
    'Object.getOwnPropertyDescriptor',
    "Object.getOwnPropertyDescriptor = () => { throw new Error('synthetic poison'); };",
  ],
  ['Object.create', "Object.create = () => { throw new Error('synthetic poison'); };"],
  [
    'Object.defineProperty',
    "Object.defineProperty = () => { throw new Error('synthetic poison'); };",
  ],
  ['Array.isArray', "Array.isArray = () => { throw new Error('synthetic poison'); };"],
  ['JSON.stringify', "JSON.stringify = () => { throw new Error('synthetic poison'); };"],
  [
    'Function.prototype.call',
    "Function.prototype.call = () => { throw new Error('synthetic poison'); };",
  ],
  [
    'Function.prototype.apply',
    "Function.prototype.apply = () => { throw new Error('synthetic poison'); };",
  ],
  ['Reflect.ownKeys', "Reflect.ownKeys = () => { throw new Error('synthetic poison'); };"],
  [
    'TextEncoder',
    'globalThis.TextEncoder = class { encode(value) { return new Uint8Array(value.length); } };',
  ],
  [
    'RegExp.prototype.test',
    "RegExp.prototype.test = () => { throw new Error('synthetic regex poison'); };",
  ],
];

const neutralBaseline = spawnSync(
  globalThis.process.execPath,
  [
    '--input-type=module',
    '--eval',
    "const neutral = await import('data:text/javascript,export const marker%3D%22neutral-loader%22'); if (neutral.marker !== 'neutral-loader') throw new Error('neutral baseline failed'); process.stdout.write('neutral-loader');",
  ],
  {
    cwd: new globalThis.URL('../packages/protocol/', import.meta.url),
    encoding: 'utf8',
    windowsHide: true,
  },
);
if (neutralBaseline.status !== 0 || neutralBaseline.stdout !== 'neutral-loader')
  throw new Error('neutral loader baseline failed');

for (const [name, poison] of preImportProbes) {
  const script = `
    await import('./node_modules/ajv/dist/2020.js');
    await import('./node_modules/ajv-formats/dist/index.js');
    globalThis.process.stdout.write('');
    globalThis.process.stderr.write('');
    const safeStringify = JSON.stringify;
    ${poison}
    const protocol = await import('./dist/index.js');
    if (protocol.validateEvent({}).status !== 'rejected') throw new Error('not fail closed');
    const preImportCanary = 'PROTOCOL_PREIMPORT_REGEXP_NATIVE_CANARY';
    const malformed = { ...${JSON.stringify(core)}, version: preImportCanary };
    const malformedResult = protocol.validateEvent(malformed);
    if (malformedResult.status !== 'rejected' || safeStringify(malformedResult).includes(preImportCanary))
      throw new Error('pre-import regex canary escaped');
    if (${JSON.stringify(name)} === 'TextEncoder') {
      let byteLength;
      try { byteLength = protocol.canonicalUtf8ByteLength('😀'.repeat(4096)); } catch {}
      const oversized = {
        ...${JSON.stringify(core)},
        type: 'x.io.example.oversized',
        extension: { fallback: 'preserve-in-journal', documentation: 'opaque' },
        data: { value: 'x'.repeat(16 * 1024) },
      };
      if (byteLength === 0 || protocol.validateEvent(oversized).status === 'preserved-extension')
        throw new Error('fake TextEncoder was accepted');
    }
    process.stdout.write('pre-import-rejected');
  `;
  const child = spawnSync(globalThis.process.execPath, ['--input-type=module', '--eval', script], {
    cwd: new globalThis.URL('../packages/protocol/', import.meta.url),
    encoding: 'utf8',
    windowsHide: true,
  });
  const loaderLimitation =
    child.status !== 0 &&
    child.stderr.includes('ModuleWrap') &&
    child.stderr.includes('module_value->IsObject()');
  if (child.status === 0 && child.stdout === 'pre-import-rejected') continue;
  if (
    child.stdout.includes('PROTOCOL_PREIMPORT_REGEXP_NATIVE_CANARY') ||
    child.stderr.includes('PROTOCOL_PREIMPORT_REGEXP_NATIVE_CANARY')
  )
    throw new Error(`built protocol pre-import privacy canary escaped: ${name}`);
  if (
    loaderLimitation &&
    (name === 'Function.prototype.call' || name === 'Function.prototype.apply')
  )
    continue;
  throw new Error(`built protocol pre-import probe failed: ${name}`);
}

globalThis.process.stdout.write('protocol intrinsic hardening: passed\n');
