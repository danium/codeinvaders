import { protocolDiagnosticCodes, type ProtocolDiagnosticCode } from '@codeinvaders/protocol';
import { isProxy as nodeIsProxy } from 'node:util/types';
import {
  combineHardenedDiagnosticArrays,
  createHardenedDiagnosticArray,
} from './diagnostic-registry.js';
import { appendArrayValue } from './immutable.js';
import { adapterIntrinsics, adapterIntrinsicsReady } from './intrinsics.js';
import { makeImmutableRecord, readSnapshot, type SafePropertySnapshot } from './safe-input.js';

const isSafeInteger = Number.isSafeInteger;
const isFiniteNumber = Number.isFinite;
const isProxy = nodeIsProxy;

const safeProtocolDiagnosticCodes = protocolDiagnosticCodes ?? [];

function degradedDiagnostic(): AdapterDiagnostic {
  return {
    __proto__: null,
    code: 'diagnostic-invalid',
    severity: 'error',
    boundary: 'adapter',
  } as unknown as AdapterDiagnostic;
}

/**
 * A diagnostic count is a summary of one bounded adapter batch, not a generic
 * canonical collection. One thousand and twenty-four records is enough to
 * describe a burst while keeping one diagnostic bounded and reviewable.
 * Invalid or oversized values are omitted; they are never rounded or coerced.
 */
export const MAX_DIAGNOSTIC_COUNT = 1_024;

/**
 * Runtime and observed operation durations are bounded to one day in ms.
 * Longer values are stale or semantically implausible at this boundary and
 * are rejected rather than allowing the protocol's generic integer ceiling.
 */
export const MAX_DIAGNOSTIC_DURATION_MS = 86_400_000;

const MAX_DIAGNOSTIC_INPUT_NODES = 1_024;
const MAX_DIAGNOSTIC_INPUT_DEPTH = 32;
const MAX_DIAGNOSTIC_INPUT_PROPERTIES = 256;

/**
 * Each inspected own property consumes two units: one descriptor lookup on
 * the input and one lookup proving that descriptor contains a data value.
 * The resnapshot of selected root properties uses the same accounting.
 * This aggregate cap bounds descriptor work across the complete hostile graph,
 * rather than multiplying the per-node limits into a 262k-property scan.
 */
export const MAX_DIAGNOSTIC_INPUT_WORK = 16_384;

/** Codes owned by the adapter boundary. Protocol codes are reused below. */
export const adapterBoundaryDiagnosticCodes = createHardenedDiagnosticArray([
  'native-input-invalid',
  'native-schema-unsupported',
  'native-field-invalid',
  'native-correlation-ambiguous',
  'native-correlation-missing',
  'identity-derivation-failed',
  'payload-build-failed',
  'capability-degraded',
  'delivery-unavailable',
  'runtime-timeout',
  'runtime-limit-exceeded',
  'diagnostic-invalid',
] as const);

export type AdapterBoundaryDiagnosticCode = (typeof adapterBoundaryDiagnosticCodes)[number];

/**
 * The closed protocol code vocabulary is reused here, while each record is
 * re-normalized. Protocol-only metadata such as eventType and protocolMajor
 * is deliberately not copied across this adapter boundary.
 */
export const adapterDiagnosticCodes = combineHardenedDiagnosticArrays(
  safeProtocolDiagnosticCodes,
  adapterBoundaryDiagnosticCodes,
);

export type AdapterDiagnosticCode = (typeof adapterDiagnosticCodes)[number];

export const protocolDiagnosticFields = createHardenedDiagnosticArray([
  'spec',
  'version',
  'eventId',
  'type',
  'timestamps',
  'sequence',
  'source',
  'scope',
  'fidelity',
  'finality',
  'data',
  'size',
  'depth',
  'extension',
] as const);

export const adapterDiagnosticFields = createHardenedDiagnosticArray([
  'native-input',
  'native-schema',
  'native-field',
  'event',
  'correlation',
  'identity',
  'payload',
  'capability',
  'delivery',
  'runtime',
  'count',
  'duration',
  'code',
] as const);

export type ProtocolDiagnosticField = (typeof protocolDiagnosticFields)[number];
export type AdapterDiagnosticField =
  ProtocolDiagnosticField | (typeof adapterDiagnosticFields)[number];

export const adapterDiagnosticSeverities = createHardenedDiagnosticArray([
  'info',
  'warning',
  'error',
] as const);
export type AdapterDiagnosticSeverity = (typeof adapterDiagnosticSeverities)[number];

export type AdapterDiagnosticBoundary = 'protocol' | 'adapter';

/** A diagnostic contains no message, stack, native value, or free-form text. */
export interface AdapterDiagnostic {
  readonly code: AdapterDiagnosticCode;
  readonly severity: AdapterDiagnosticSeverity;
  readonly boundary: AdapterDiagnosticBoundary;
  readonly field?: AdapterDiagnosticField;
  readonly count?: number;
  readonly durationMs?: number;
}

export type AdapterDiagnosticRecord = AdapterDiagnostic;

export interface AdapterDiagnosticInput {
  readonly code?: unknown;
  readonly severity?: unknown;
  readonly field?: unknown;
  readonly count?: unknown;
  readonly durationMs?: unknown;
}

const DIAGNOSTIC_INPUT_PROPERTY_KEYS = createHardenedDiagnosticArray([
  'code',
  'severity',
  'field',
  'count',
  'durationMs',
] as const);

function contains<T extends string>(values: readonly T[], value: unknown): value is T {
  if (typeof value !== 'string') return false;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === value) return true;
  }
  return false;
}

export function isAdapterDiagnosticCode(value: unknown): value is AdapterDiagnosticCode {
  if (!adapterIntrinsicsReady) return false;
  return contains(adapterDiagnosticCodes, value);
}

export function isAdapterBoundaryDiagnosticCode(
  value: unknown,
): value is AdapterBoundaryDiagnosticCode {
  if (!adapterIntrinsicsReady) return false;
  return contains(adapterBoundaryDiagnosticCodes, value);
}

export function isProtocolDiagnosticCode(value: unknown): value is ProtocolDiagnosticCode {
  if (!adapterIntrinsicsReady) return false;
  return contains(safeProtocolDiagnosticCodes, value);
}

function isProtocolField(value: unknown): value is ProtocolDiagnosticField {
  if (!adapterIntrinsicsReady) return false;
  return contains(protocolDiagnosticFields, value);
}

function isAdapterField(value: unknown): value is (typeof adapterDiagnosticFields)[number] {
  return contains(adapterDiagnosticFields, value);
}

function defaultSeverity(code: AdapterDiagnosticCode): AdapterDiagnosticSeverity {
  switch (code) {
    case 'extension-preserved':
    case 'native-schema-unsupported':
    case 'native-correlation-ambiguous':
    case 'native-correlation-missing':
    case 'capability-degraded':
    case 'delivery-unavailable':
    case 'runtime-timeout':
      return 'warning';
    default:
      return 'error';
  }
}

function protocolFieldAllowed(code: ProtocolDiagnosticCode, value: unknown): boolean {
  if (!isProtocolField(value)) return false;
  switch (code) {
    case 'invalid-envelope':
      return (
        value === 'spec' ||
        value === 'version' ||
        value === 'eventId' ||
        value === 'type' ||
        value === 'timestamps' ||
        value === 'sequence' ||
        value === 'source' ||
        value === 'scope' ||
        value === 'fidelity' ||
        value === 'finality' ||
        value === 'data' ||
        value === 'extension'
      );
    case 'invalid-scope':
      return value === 'scope';
    case 'invalid-data':
      return value === 'data';
    case 'event-too-large':
      return value === 'size';
    case 'event-too-deep':
      return value === 'depth';
    case 'unsupported-major':
    case 'invalid-version':
      return value === 'version';
    case 'unknown-event':
      return value === 'type';
    case 'invalid-extension':
      return value === 'type' || value === 'extension';
    case 'extension-preserved':
      return value === 'type';
  }
}

function adapterFieldAllowed(code: AdapterBoundaryDiagnosticCode, value: unknown): boolean {
  if (!isAdapterField(value)) return false;
  switch (code) {
    case 'native-input-invalid':
      return value === 'native-input';
    case 'native-schema-unsupported':
      return value === 'native-schema';
    case 'native-field-invalid':
      return value === 'native-field';
    case 'native-correlation-ambiguous':
    case 'native-correlation-missing':
      return value === 'correlation';
    case 'identity-derivation-failed':
      return value === 'identity';
    case 'payload-build-failed':
      return value === 'payload';
    case 'capability-degraded':
      return value === 'capability';
    case 'delivery-unavailable':
      return value === 'delivery';
    case 'runtime-timeout':
      return value === 'runtime' || value === 'duration';
    case 'runtime-limit-exceeded':
      return value === 'runtime' || value === 'count' || value === 'duration';
    case 'diagnostic-invalid':
      return value === 'code';
  }
}

function boundedInteger(value: unknown, maximum: number): number | undefined {
  if (typeof value !== 'number' || !isSafeInteger(value) || value < 0 || value > maximum)
    return undefined;
  return value === 0 ? 0 : value;
}

function normalizedCode(value: unknown): AdapterDiagnosticCode {
  return isAdapterDiagnosticCode(value) ? value : 'diagnostic-invalid';
}

function normalizedSeverity(code: AdapterDiagnosticCode): AdapterDiagnosticSeverity {
  return defaultSeverity(code);
}

function normalizedField(
  value: unknown,
  code: AdapterDiagnosticCode,
): AdapterDiagnosticField | undefined {
  if (isProtocolDiagnosticCode(code)) {
    return protocolFieldAllowed(code, value) ? (value as ProtocolDiagnosticField) : undefined;
  }
  return isAdapterBoundaryDiagnosticCode(code) && adapterFieldAllowed(code, value)
    ? (value as AdapterDiagnosticField)
    : undefined;
}

function buildDiagnosticFromSnapshot(
  codeValue: unknown,
  snapshot: readonly SafePropertySnapshot[],
): AdapterDiagnostic {
  const code = normalizedCode(codeValue);
  const boundary: AdapterDiagnosticBoundary = isProtocolDiagnosticCode(code)
    ? 'protocol'
    : 'adapter';
  const field = normalizedField(readSnapshot(snapshot, 'field'), code);
  const count = boundedInteger(readSnapshot(snapshot, 'count'), MAX_DIAGNOSTIC_COUNT);
  const durationMs = boundedInteger(
    readSnapshot(snapshot, 'durationMs'),
    MAX_DIAGNOSTIC_DURATION_MS,
  );
  const entries: [string, unknown][] = [
    ['code', code],
    ['severity', normalizedSeverity(code)],
    ['boundary', boundary],
  ];
  if (field !== undefined) appendArrayValue(entries, ['field', field]);
  if (count !== undefined) appendArrayValue(entries, ['count', count]);
  if (durationMs !== undefined) appendArrayValue(entries, ['durationMs', durationMs]);
  return makeImmutableRecord<AdapterDiagnostic>(entries);
}

interface DiagnosticSnapshotContext {
  nodes: number;
  ancestors: object[];
  descriptorWork: number;
}

function consumeDescriptorWork(context: DiagnosticSnapshotContext): boolean {
  context.descriptorWork += 1;
  return context.descriptorWork <= MAX_DIAGNOSTIC_INPUT_WORK;
}

function isDiagnosticRecord(value: object): boolean {
  if (!adapterIntrinsicsReady || adapterIntrinsics === undefined) return false;
  try {
    if (isProxy(value) || adapterIntrinsics.arrayIsArray(value)) return false;
    const prototype = adapterIntrinsics.objectGetPrototypeOf(value);
    if (prototype === null) return true;
    if (isProxy(prototype)) return false;
    return adapterIntrinsics.objectGetPrototypeOf(prototype) === null;
  } catch {
    return false;
  }
}

function containsAncestor(ancestors: readonly object[], value: object): boolean {
  for (let index = 0; index < ancestors.length; index += 1) {
    if (ancestors[index] === value) return true;
  }
  return false;
}

function isDiagnosticValue(
  value: unknown,
  depth: number,
  context: DiagnosticSnapshotContext,
): boolean {
  if (!adapterIntrinsicsReady || adapterIntrinsics === undefined) return false;
  if (value === null || value === undefined) return true;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true;
    case 'number':
      return isFiniteNumber(value);
    case 'object':
      break;
    default:
      return false;
  }

  if (depth > MAX_DIAGNOSTIC_INPUT_DEPTH || isProxy(value)) return false;
  if (!isDiagnosticRecord(value) || containsAncestor(context.ancestors, value)) return false;
  if (context.nodes >= MAX_DIAGNOSTIC_INPUT_NODES) return false;
  context.nodes += 1;
  appendArrayValue(context.ancestors, value);

  let keys: (string | symbol)[];
  try {
    keys = adapterIntrinsics.reflectOwnKeys(value);
    if (keys.length > MAX_DIAGNOSTIC_INPUT_PROPERTIES) return false;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (typeof key !== 'string') return false;
      if (!consumeDescriptorWork(context)) return false;
      const descriptor = adapterIntrinsics.objectGetOwnPropertyDescriptor(value, key);
      if (descriptor === undefined) return false;
      if (!consumeDescriptorWork(context)) return false;
      const dataDescriptor = adapterIntrinsics.objectGetOwnPropertyDescriptor(descriptor, 'value');
      if (dataDescriptor === undefined) return false;
      if (!isDiagnosticValue(dataDescriptor.value, depth + 1, context)) return false;
    }
  } catch {
    return false;
  } finally {
    context.ancestors.length -= 1;
  }
  return true;
}

function isRequestedProperty(key: string, keys: readonly string[]): boolean {
  for (let index = 0; index < keys.length; index += 1) {
    if (keys[index] === key) return true;
  }
  return false;
}

/**
 * Diagnostics use a stricter snapshot than payload categorization. It scans
 * every own descriptor before selecting allowlisted values, so hostile data
 * hidden in an ignored property cannot make the input appear valid.
 */
function snapshotDiagnosticProperties(
  input: unknown,
  keys: readonly string[],
  allowUndefined: boolean,
): readonly SafePropertySnapshot[] | undefined {
  if (!adapterIntrinsicsReady || adapterIntrinsics === undefined) return undefined;
  if (input === undefined && allowUndefined) return createHardenedDiagnosticArray([]);
  if (input === null || typeof input !== 'object' || !isDiagnosticRecord(input)) return undefined;

  const context: DiagnosticSnapshotContext = { nodes: 0, ancestors: [], descriptorWork: 0 };
  if (!isDiagnosticValue(input, 0, context)) return undefined;

  const snapshot: SafePropertySnapshot[] = [];
  try {
    const inputKeys = adapterIntrinsics.reflectOwnKeys(input);
    for (let index = 0; index < inputKeys.length; index += 1) {
      const key = inputKeys[index];
      if (typeof key !== 'string' || !isRequestedProperty(key, keys)) continue;
      if (!consumeDescriptorWork(context)) return undefined;
      const descriptor = adapterIntrinsics.objectGetOwnPropertyDescriptor(input, key);
      if (descriptor === undefined) return undefined;
      if (!consumeDescriptorWork(context)) return undefined;
      const dataDescriptor = adapterIntrinsics.objectGetOwnPropertyDescriptor(descriptor, 'value');
      if (dataDescriptor === undefined) return undefined;
      appendArrayValue(
        snapshot,
        makeImmutableRecord<SafePropertySnapshot>([
          ['key', key],
          ['value', dataDescriptor.value],
        ]),
      );
    }
  } catch {
    return undefined;
  }
  return createHardenedDiagnosticArray(snapshot);
}

function invalidDiagnostic(): AdapterDiagnostic {
  if (!adapterIntrinsicsReady) return degradedDiagnostic();
  return makeImmutableRecord<AdapterDiagnostic>([
    ['code', 'diagnostic-invalid'],
    ['severity', 'error'],
    ['boundary', 'adapter'],
  ]);
}

/**
 * Builds one fixed-shape, privacy-safe diagnostic from an untrusted record.
 * Only data descriptors for the allowlisted fields are read.
 */
export function buildAdapterDiagnostic(input: unknown): AdapterDiagnostic {
  if (!adapterIntrinsicsReady) return degradedDiagnostic();
  try {
    const snapshot = snapshotDiagnosticProperties(input, DIAGNOSTIC_INPUT_PROPERTY_KEYS, false);
    if (snapshot === undefined) return invalidDiagnostic();
    return buildDiagnosticFromSnapshot(readSnapshot(snapshot, 'code'), snapshot);
  } catch {
    return invalidDiagnostic();
  }
}

/** Builds a diagnostic from a code and an independently snapshotted options record. */
export function createAdapterDiagnostic(code: unknown, options?: unknown): AdapterDiagnostic {
  if (!adapterIntrinsicsReady) return degradedDiagnostic();
  try {
    const snapshot = snapshotDiagnosticProperties(options, DIAGNOSTIC_INPUT_PROPERTY_KEYS, true);
    if (snapshot === undefined) return invalidDiagnostic();
    return buildDiagnosticFromSnapshot(code, snapshot);
  } catch {
    return invalidDiagnostic();
  }
}

/** Alias for callers that treat diagnostics as a normalization boundary. */
export const normalizeAdapterDiagnostic = buildAdapterDiagnostic;
