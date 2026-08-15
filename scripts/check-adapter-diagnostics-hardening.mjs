import { spawnSync } from 'node:child_process';
import {
  adapterBoundaryDiagnosticCodes,
  adapterDiagnosticCodes,
  adapterDiagnosticFields,
  adapterDiagnosticSeverities,
  buildAdapterDiagnostic,
  protocolDiagnosticFields,
} from '../packages/adapter-sdk/dist/index.js';
import { MAX_JSON_DEPTH, validateEvent } from '../packages/protocol/dist/index.js';
import { validEventFixture } from '../packages/protocol/dist/fixtures/index.js';

const packageRoot = new globalThis.URL('../packages/adapter-sdk/', import.meta.url);

function runFreshPoisonProbe(poison) {
  const script = `
    await import('@codeinvaders/protocol');
    ${poison}
    const sdk = await import('./dist/index.js');
    if (sdk.adapterDiagnosticCodes[0] !== 'invalid-envelope') throw new Error('registry import failed');
    const result = sdk.buildAdapterDiagnostic({ code: 'native-input-invalid', field: 'native-input' });
    if (result.code !== 'native-input-invalid') throw new Error('diagnostic import failed');
  `;
  const child = spawnSync(globalThis.process.execPath, ['--input-type=module', '--eval', script], {
    cwd: packageRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (child.status !== 0) throw new Error('fresh-module intrinsic-poison probe failed');
}

runFreshPoisonProbe("Object.freeze = () => { throw new Error('synthetic freeze poison'); };");
runFreshPoisonProbe(
  "Object.defineProperty(Array.prototype, Symbol.iterator, { configurable: true, value: () => { throw new Error('synthetic iterator poison'); }, writable: true });",
);

const numericProbe = `
  await import('@codeinvaders/protocol');
  const nativeInput = { code: 'native-input-invalid', field: 'native-input', sensitive: 'NUMERIC_POLLUTION_CANARY' };
  let getterCalls = 0;
  let setterCalls = 0;
  const originalNumeric = Object.getOwnPropertyDescriptor(Array.prototype, '0');
  Object.defineProperty(Array.prototype, '0', {
    configurable: true,
    enumerable: false,
    get() { getterCalls += 1; return undefined; },
    set() { setterCalls += 1; },
  });
  try {
    const sdk = await import('./dist/index.js');
    const result = sdk.buildAdapterDiagnostic(nativeInput);
    if (result.code !== 'native-input-invalid' || result.field !== 'native-input') throw new Error('numeric pollution changed diagnostic');
    if (getterCalls !== 0 || setterCalls !== 0) throw new Error('numeric pollution was observed');
    if (JSON.stringify(result).includes('NUMERIC_POLLUTION_CANARY')) throw new Error('numeric canary serialized');
    console.log('ADAPTER_SDK_NUMERIC_PREIMPORT_EXECUTED');
  } finally {
    if (originalNumeric === undefined) Reflect.deleteProperty(Array.prototype, '0');
    else Object.defineProperty(Array.prototype, '0', originalNumeric);
  }
`;
const numericBaseline = `
  const originalNumeric = Object.getOwnPropertyDescriptor(Array.prototype, '0');
  Object.defineProperty(Array.prototype, '0', {
    configurable: true,
    enumerable: false,
    get() { return undefined; },
    set() {},
  });
  try {
    const neutral = await import('data:text/javascript,export const marker%3D%22NUMERIC_NEUTRAL_BASELINE_EXECUTED%22');
    if (neutral.marker !== 'NUMERIC_NEUTRAL_BASELINE_EXECUTED') throw new Error('neutral baseline marker missing');
    console.log('NUMERIC_NEUTRAL_BASELINE_EXECUTED');
  } finally {
    if (originalNumeric === undefined) Reflect.deleteProperty(Array.prototype, '0');
    else Object.defineProperty(Array.prototype, '0', originalNumeric);
  }
`;
const numericBaselineChild = spawnSync(
  globalThis.process.execPath,
  ['--input-type=module', '--eval', numericBaseline],
  {
    cwd: packageRoot,
    encoding: 'utf8',
    windowsHide: true,
  },
);
const numericChild = spawnSync(
  globalThis.process.execPath,
  ['--input-type=module', '--eval', numericProbe],
  {
    cwd: packageRoot,
    encoding: 'utf8',
    windowsHide: true,
  },
);
const isNumericLoaderLimitation = (child) =>
  child.status !== 0 &&
  child.stderr.includes('ModuleWrap') &&
  child.stderr.includes('module_value->IsObject()');
if (numericBaselineChild.status !== 0) throw new Error('neutral numeric-loader baseline failed');
if (!numericBaselineChild.stdout.includes('NUMERIC_NEUTRAL_BASELINE_EXECUTED'))
  throw new Error('neutral numeric-loader baseline marker missing');

const sdkExecuted =
  numericChild.status === 0 &&
  numericChild.stdout.includes('ADAPTER_SDK_NUMERIC_PREIMPORT_EXECUTED');
if (!sdkExecuted && !isNumericLoaderLimitation(numericChild))
  throw new Error('SDK numeric pre-evaluation probe failed before an execution marker');
if (sdkExecuted && numericChild.status !== 0)
  throw new Error('SDK numeric pre-evaluation execution returned a nonzero status');
if (!sdkExecuted) {
  globalThis.console.log(
    `adapter diagnostics numeric pre-evaluation: SDK execution unavailable on Node ${globalThis.process.version}; ` +
      'Node ESM ModuleWrap limitation observed before SDK evaluation',
  );
}

function structuralFailureValue() {
  return new Proxy(Object.create(null), {
    getPrototypeOf: () => {
      throw new Error('synthetic structural failure');
    },
  });
}

function validatorInputs() {
  const inputs = [];
  for (let index = 0; index < protocolDiagnosticFields.length; index += 1) {
    const field = protocolDiagnosticFields[index];
    if (field === undefined || field === 'size' || field === 'depth') continue;
    const event = validEventFixture('session.started');
    if (field === 'timestamps') event.occurredAt = structuralFailureValue();
    else if (field === 'type') event.type = Symbol('synthetic-type');
    else event[field] = structuralFailureValue();
    inputs[inputs.length] = event;
  }

  const invalidScope = validEventFixture('session.started');
  invalidScope.scope = Symbol('synthetic-scope');
  inputs[inputs.length] = invalidScope;
  const invalidData = validEventFixture('session.started');
  invalidData.data = Symbol('synthetic-data');
  inputs[inputs.length] = invalidData;
  const tooLarge = validEventFixture('session.started');
  tooLarge.data = { resume: false, padding: 'x'.repeat(17_000) };
  inputs[inputs.length] = tooLarge;
  const tooDeep = validEventFixture('session.started');
  let nested = { leaf: true };
  for (let index = 0; index <= MAX_JSON_DEPTH; index += 1) nested = { nested };
  tooDeep.data = { resume: false, nested };
  inputs[inputs.length] = tooDeep;

  const unsupportedMajor = validEventFixture('session.started');
  unsupportedMajor.version = '9.0.0';
  inputs[inputs.length] = unsupportedMajor;
  const invalidVersion = validEventFixture('session.started');
  invalidVersion.version = 'not-semver';
  inputs[inputs.length] = invalidVersion;
  const unknownEvent = validEventFixture('session.started');
  unknownEvent.type = 'vendor.secret.event';
  inputs[inputs.length] = unknownEvent;
  const invalidExtensionType = validEventFixture('session.started');
  invalidExtensionType.type = 'x.example';
  inputs[inputs.length] = invalidExtensionType;
  const invalidExtension = validEventFixture('session.started');
  invalidExtension.type = 'x.io.example.telemetry';
  invalidExtension.extension = { fallback: 'drop', documentation: 'synthetic' };
  inputs[inputs.length] = invalidExtension;
  const preservedExtension = validEventFixture('session.started');
  preservedExtension.type = 'x.io.example.telemetry';
  preservedExtension.extension = {
    fallback: 'preserve-in-journal',
    documentation: 'synthetic extension',
  };
  inputs[inputs.length] = preservedExtension;
  inputs[inputs.length] = new Proxy(validEventFixture('session.started'), {
    ownKeys: () => {
      throw new Error('synthetic root structural failure');
    },
  });
  return inputs;
}

const observed = new Set();
for (const input of validatorInputs()) {
  const result = validateEvent(input);
  const diagnostic = result.diagnostics[0];
  if (result.status === 'accepted' || diagnostic === undefined)
    throw new Error('built validator produced no rejection diagnostic');
  const key = `${diagnostic.code}:${diagnostic.field ?? ''}`;
  observed.add(key);
  const normalized = buildAdapterDiagnostic(diagnostic);
  if (normalized.code !== diagnostic.code || normalized.field !== diagnostic.field)
    throw new Error(`built validator mapping lost ${key}`);
}
for (let codeIndex = 0; codeIndex < 10; codeIndex += 1) {
  const code = adapterDiagnosticCodes[codeIndex];
  if (code === undefined) continue;
  for (let fieldIndex = 0; fieldIndex < protocolDiagnosticFields.length; fieldIndex += 1) {
    const field = protocolDiagnosticFields[fieldIndex];
    if (field === undefined) continue;
    const result = buildAdapterDiagnostic({ code, field });
    if (observed.has(`${code}:${field}`) !== (result.field === field))
      throw new Error(`built false field combination accepted: ${code}:${field}`);
  }
}

const originalFreeze = Object.freeze;
const originalIterator = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
const originalToJSON = Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON');
const originalNumeric = Object.getOwnPropertyDescriptor(Array.prototype, '0');
const registries = [
  adapterBoundaryDiagnosticCodes,
  adapterDiagnosticCodes,
  protocolDiagnosticFields,
  adapterDiagnosticFields,
  adapterDiagnosticSeverities,
];
const expectedJson = registries.map((registry) => JSON.stringify(registry));
try {
  Object.freeze = () => {
    throw new Error('synthetic post-import freeze poison');
  };
  Object.defineProperty(Array.prototype, Symbol.iterator, {
    configurable: true,
    value: () => {
      throw new Error('synthetic post-import iterator poison');
    },
    writable: true,
  });
  Object.defineProperty(Array.prototype, 'toJSON', {
    configurable: true,
    enumerable: false,
    value: () => 'POLLUTED',
    writable: true,
  });
  for (let index = 0; index < registries.length; index += 1) {
    if (JSON.stringify(registries[index]) !== expectedJson[index])
      throw new Error('polluted registry serialization');
    if (!Object.isFrozen(registries[index])) throw new Error('registry lost immutability');
  }
  const diagnostic = buildAdapterDiagnostic({ code: 'invalid-envelope', field: 'extension' });
  if (diagnostic.field !== 'extension') throw new Error('polluted diagnostic mapping');

  const nativeInput = {
    code: 'native-input-invalid',
    field: 'native-input',
    sensitive: 'NUMERIC_POST_IMPORT_CANARY',
  };
  let numericGetterCalls = 0;
  let numericSetterCalls = 0;
  const seenNumericValues = new Set();
  Object.defineProperty(Array.prototype, '0', {
    configurable: true,
    enumerable: false,
    get: () => {
      numericGetterCalls += 1;
      return undefined;
    },
    set: (value) => {
      numericSetterCalls += 1;
      seenNumericValues.add(value);
    },
  });
  try {
    const numericDiagnostic = buildAdapterDiagnostic(nativeInput);
    if (numericDiagnostic.code !== 'native-input-invalid')
      throw new Error('numeric diagnostic invalid');
    if (numericGetterCalls !== 0 || numericSetterCalls !== 0)
      throw new Error('numeric pollution was observed');
    if (seenNumericValues.has(nativeInput)) throw new Error('native input was observed');
    if (JSON.stringify(numericDiagnostic).includes('NUMERIC_POST_IMPORT_CANARY'))
      throw new Error('numeric canary serialized');
  } finally {
    if (originalNumeric === undefined) Reflect.deleteProperty(Array.prototype, '0');
    else Object.defineProperty(Array.prototype, '0', originalNumeric);
  }
} finally {
  Object.freeze = originalFreeze;
  if (originalIterator === undefined) delete Array.prototype[Symbol.iterator];
  else Object.defineProperty(Array.prototype, Symbol.iterator, originalIterator);
  if (originalToJSON === undefined) delete Array.prototype.toJSON;
  else Object.defineProperty(Array.prototype, 'toJSON', originalToJSON);
}

globalThis.console.log('adapter diagnostics intrinsic and serialization hardening: passed');
