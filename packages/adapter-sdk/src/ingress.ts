import {
  MAX_EVENT_BYTES,
  MAX_JSON_DEPTH,
  canonicalizeEvent,
  canonicalUtf8ByteLength,
  protocolVersion,
  serializeCanonicalEvent,
  validateEvent,
  type AnyCoreEvent,
  type CoreEventType,
} from '@codeinvaders/protocol';
import { isProxy as nodeIsProxy } from 'node:util/types';
import {
  buildAdapterDiagnostic,
  createAdapterDiagnostic,
  type AdapterDiagnostic,
} from './diagnostics.js';
import {
  MAX_OPAQUE_ID_COMPONENT_CODE_UNITS,
  MAX_OPAQUE_ID_COMPONENTS,
  type OpaqueId,
  type OpaqueIdDeriver,
  isOpaqueId,
} from './identity.js';
import { appendArrayValue, harden } from './immutable.js';
import { adapterIntrinsics, adapterIntrinsicsReady } from './intrinsics.js';
import { canonicalToolNameForCategory, categorizeBuiltinTool } from './tool-category.js';
import {
  makeImmutableRecord,
  readSnapshot,
  snapshotAllowedProperties,
  type SafePropertySnapshot,
} from './safe-input.js';

const isSafeInteger = Number.isSafeInteger;
const stringConstructor = String;
const isProxy = nodeIsProxy;
const freeze = harden;

/** The maximum UTF-8 size of one sanitized event crossing the local boundary. */
export const MAX_INGRESS_RECORD_BYTES = MAX_EVENT_BYTES;
/** The maximum JSON nesting accepted for one sanitized ingress record. */
export const MAX_INGRESS_RECORD_DEPTH = MAX_JSON_DEPTH;

const EMPTY_DIAGNOSTICS = freeze([]) as readonly [];
function degradedIngressRejection(): IngressPreparationResult {
  return {
    __proto__: null,
    status: 'rejected',
    diagnostics: [
      {
        __proto__: null,
        code: 'diagnostic-invalid',
        severity: 'error',
        boundary: 'adapter',
      },
    ],
  } as unknown as IngressPreparationResult;
}
const RETRY_ID_DOMAIN = 'event';

const EVENT_PROPERTY_KEYS = freeze([
  'spec',
  'version',
  'eventId',
  'type',
  'occurredAt',
  'observedAt',
  'sequence',
  'source',
  'scope',
  'links',
  'semantic',
  'fidelity',
  'finality',
  'data',
] as const);
const SOURCE_PROPERTY_KEYS = freeze([
  'adapterId',
  'adapterVersion',
  'streamId',
  'epochId',
] as const);
const SCOPE_PROPERTY_KEYS = freeze([
  'workspaceId',
  'repoId',
  'sessionId',
  'turnId',
  'agentId',
  'taskId',
  'operationId',
  'permissionId',
] as const);
const LINK_PROPERTY_KEYS = freeze([
  'causationEventId',
  'parentAgentId',
  'parentTaskId',
  'correlationId',
] as const);
const SEMANTIC_PROPERTY_KEYS = freeze([
  'kind',
  'terminal',
  'outcome',
  'basis',
  'correctionOfEventId',
  'correctionOfEntityId',
] as const);
const CAPABILITY_PROPERTY_KEYS = freeze([
  'revision',
  'effectiveSequence',
  'platform',
  'session',
  'signals',
  'exclusions',
] as const);
const CAPABILITY_PLATFORM_PROPERTY_KEYS = freeze([
  'agentKind',
  'agentVersion',
  'configId',
] as const);
const CAPABILITY_SESSION_PROPERTY_KEYS = freeze(['mode', 'configurationId'] as const);
const SIGNAL_PROPERTY_KEYS = freeze([
  'availability',
  'evidenceQuality',
  'coverage',
  'finality',
  'exclusions',
] as const);
const EXCLUSION_PROPERTY_KEYS = freeze(['code', 'scope'] as const);
const PLAN_ITEM_PROPERTY_KEYS = freeze([
  'taskId',
  'status',
  'ordinal',
  'label',
  'identityBasis',
] as const);

const SIGNAL_NAMES = freeze([
  'sessions',
  'turns',
  'tasks',
  'taskPlan',
  'agents',
  'tools',
  'permissions',
] as const);

const DATA_PROPERTY_KEYS = freeze([
  'name',
  'agentKind',
  'agentVersion',
  'capabilities',
  'previousRevision',
  'effectiveSequence',
  'uptimeMs',
  'reason',
  'fromSequence',
  'toSequence',
  'vcs',
  'resume',
  'outcome',
  'objectiveLabel',
  'role',
  'depth',
  'from',
  'to',
  'status',
  'ordinal',
  'fallback',
  'assigneeAgentId',
  'requestedStatus',
  'checkpoint',
  'completion',
  'category',
  'failureClass',
  'resultClass',
  'riskClass',
  'parallelGroupId',
  'durationMs',
  'correction',
  'correctedEventId',
  'correctedEntityId',
  'resultingOutcome',
  'revision',
  'previousRevision',
  'complete',
  'items',
] as const);

// These fields are public metadata, not native identity. Keeping their values
// closed prevents an arbitrary sanitized-token canary from becoming durable
// metadata while still allowing the two supported adapter families.
const CLOSED_ADAPTER_IDS = freeze([
  'adapter-1',
  'codeinvaders-codex',
  'codeinvaders-claude-code',
] as const);
const CLOSED_AGENT_KINDS = freeze(['codex', 'claude-code', 'unknown'] as const);
// Numeric release versions are public metadata. Reject prerelease/build
// payloads so a native token cannot be smuggled through a version field.
// The pattern is constructed only from behaviorally verified intrinsics.
const SEMVER_PATTERN_SOURCE = '^(0|[1-9]\\d{0,3})\\.(0|[1-9]\\d{0,3})\\.(0|[1-9]\\d{0,3})$';
const SEMVER_PATTERN =
  adapterIntrinsicsReady && adapterIntrinsics !== undefined
    ? new adapterIntrinsics.regExpConstructor(SEMVER_PATTERN_SOURCE)
    : undefined;

export interface IngressRecordOptions {
  /** An opaque ID derived from the logical native checkpoint, if supplied. */
  readonly stableEventId?: unknown;
}

export type SanitizedIngressRecord = AnyCoreEvent;

/**
 * Canonical JSON text is immutable at the JavaScript value level. The brand
 * documents that this string is produced only after ingress sanitization,
 * protocol validation, canonicalization, and the byte limit check.
 */
export type CanonicalIngressJson = string & {
  readonly __codeinvadersCanonicalIngressJson: unique symbol;
};

/**
 * A transport consumes the exact validated canonical text. It must encode and
 * write this value during the handoff; no mutable byte buffer is retained by
 * the ingress result and no event is reconstructed after validation. A writer
 * receives the exact immutable canonical text once per handoff.
 */
export type IngressTransportWriter = (canonicalJson: CanonicalIngressJson) => void;

/** Closed, native-error-free result returned by the accepted handoff. */
export type IngressHandoffResult =
  | { readonly status: 'written' }
  | {
      readonly status: 'rejected';
      readonly code: 'writer-invalid' | 'writer-failed' | 'writer-reentrant';
    };

export type AcceptedIngressPreparation = {
  readonly status: 'accepted';
  readonly record: SanitizedIngressRecord;
  readonly eventId: OpaqueId;
  readonly canonicalJson: CanonicalIngressJson;
  readonly byteLength: number;
  readonly diagnostics: readonly [];
  readonly handoff: (writer: unknown) => IngressHandoffResult;
};

export type IngressPreparationResult =
  | AcceptedIngressPreparation
  | {
      readonly status: 'rejected';
      readonly diagnostics: readonly [AdapterDiagnostic, ...AdapterDiagnostic[]];
    };

export type StableRetryEventIdErrorCode =
  'retry-key-invalid' | 'retry-key-too-large' | 'retry-deriver-invalid' | 'retry-derivation-failed';

const STABLE_RETRY_EVENT_ID_ERROR_CODES = freeze([
  'retry-key-invalid',
  'retry-key-too-large',
  'retry-deriver-invalid',
  'retry-derivation-failed',
] as const);

function isStableRetryEventIdErrorCode(value: unknown): value is StableRetryEventIdErrorCode {
  if (typeof value !== 'string') return false;
  for (let index = 0; index < STABLE_RETRY_EVENT_ID_ERROR_CODES.length; index += 1) {
    if (STABLE_RETRY_EVENT_ID_ERROR_CODES[index] === value) return true;
  }
  return false;
}

/** Stable retry errors contain only a closed public code. */
export class StableRetryEventIdError extends Error {
  readonly code: StableRetryEventIdErrorCode;

  constructor(code: StableRetryEventIdErrorCode) {
    const safeCode = isStableRetryEventIdErrorCode(code) ? code : 'retry-derivation-failed';
    super(`stable retry event id failed: ${safeCode}`);
    this.name = 'StableRetryEventIdError';
    this.code = safeCode;
    freeze(this);
  }
}

function oneDiagnostic(diagnostic: AdapterDiagnostic): readonly [AdapterDiagnostic] {
  const diagnostics: AdapterDiagnostic[] = [];
  appendArrayValue(diagnostics, diagnostic);
  return freeze(diagnostics) as unknown as readonly [AdapterDiagnostic];
}

function rejected(diagnostic: AdapterDiagnostic): IngressPreparationResult {
  return makeImmutableRecord<Extract<IngressPreparationResult, { status: 'rejected' }>>([
    ['status', 'rejected'],
    ['diagnostics', oneDiagnostic(diagnostic)],
  ]);
}

function protocolRejected(
  result: Exclude<ReturnType<typeof validateEvent>, { status: 'accepted' }>,
): IngressPreparationResult {
  const first = result.diagnostics[0];
  if (first === undefined)
    return rejected(createAdapterDiagnostic('native-input-invalid', { field: 'event' }));
  if (result.status === 'preserved-extension')
    return rejected(
      createAdapterDiagnostic('native-schema-unsupported', { field: 'native-schema' }),
    );
  return rejected(buildAdapterDiagnostic(first));
}

function isPlainRecord(value: unknown): value is object {
  if (!adapterIntrinsicsReady || adapterIntrinsics === undefined) return false;
  if (value === null || typeof value !== 'object') return false;
  try {
    if (isProxy(value) || adapterIntrinsics.arrayIsArray(value)) return false;
    const prototype = adapterIntrinsics.objectGetPrototypeOf(value);
    if (prototype === null) return true;
    return adapterIntrinsics.objectGetPrototypeOf(prototype) === null;
  } catch {
    return false;
  }
}

function stringValue(snapshot: readonly SafePropertySnapshot[], key: string): string | undefined {
  const value = readSnapshot(snapshot, key);
  return typeof value === 'string' ? value : undefined;
}

function closedStringValue(
  snapshot: readonly SafePropertySnapshot[],
  key: string,
  values: readonly string[],
): string | null | undefined {
  const value = readSnapshot(snapshot, key);
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  for (let index = 0; index < values.length; index += 1) if (values[index] === value) return value;
  return null;
}

function semverValue(
  snapshot: readonly SafePropertySnapshot[],
  key: string,
): string | null | undefined {
  const value = readSnapshot(snapshot, key);
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || SEMVER_PATTERN === undefined) return null;
  try {
    return adapterIntrinsics !== undefined &&
      adapterIntrinsics.reflectApply(adapterIntrinsics.regExpTest, SEMVER_PATTERN, [value]) === true
      ? value
      : null;
  } catch {
    return null;
  }
}

function opaqueIdValue(
  snapshot: readonly SafePropertySnapshot[],
  key: string,
): OpaqueId | null | undefined {
  const value = readSnapshot(snapshot, key);
  if (value === undefined) return undefined;
  return isOpaqueId(value) ? value : null;
}

function requiredOpaqueId(
  snapshot: readonly SafePropertySnapshot[],
  key: string,
): OpaqueId | undefined {
  const value = opaqueIdValue(snapshot, key);
  return value === null || value === undefined ? undefined : value;
}

function booleanValue(snapshot: readonly SafePropertySnapshot[], key: string): boolean | undefined {
  const value = readSnapshot(snapshot, key);
  return typeof value === 'boolean' ? value : undefined;
}

function integerValue(snapshot: readonly SafePropertySnapshot[], key: string): number | undefined {
  const value = readSnapshot(snapshot, key);
  return typeof value === 'number' && isSafeInteger(value) && value >= 0 ? value : undefined;
}

function enumValue<T extends string>(
  snapshot: readonly SafePropertySnapshot[],
  key: string,
  values: readonly T[],
): T | undefined {
  const value = stringValue(snapshot, key);
  if (value === undefined) return undefined;
  for (let index = 0; index < values.length; index += 1)
    if (values[index] === value) return value as T;
  return undefined;
}

function optionalEntry(entries: [string, unknown][], key: string, value: unknown): void {
  if (value !== undefined) appendArrayValue(entries, [key, value]);
}

function requiredRecord(value: unknown): readonly SafePropertySnapshot[] | undefined {
  if (!isPlainRecord(value)) return undefined;
  return snapshotAllowedProperties(value, DATA_PROPERTY_KEYS);
}

function arrayValues(value: unknown, maximum: number): readonly unknown[] | undefined {
  if (
    !adapterIntrinsicsReady ||
    adapterIntrinsics === undefined ||
    !adapterIntrinsics.arrayIsArray(value) ||
    isProxy(value)
  )
    return undefined;
  try {
    const lengthDescriptor = adapterIntrinsics.objectGetOwnPropertyDescriptor(value, 'length');
    if (lengthDescriptor === undefined || !('value' in lengthDescriptor)) return undefined;
    const length = lengthDescriptor.value;
    if (!isSafeInteger(length) || length < 0 || length > maximum) return undefined;
    const values: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = adapterIntrinsics.objectGetOwnPropertyDescriptor(
        value,
        stringConstructor(index),
      );
      if (descriptor === undefined || !('value' in descriptor)) return undefined;
      appendArrayValue(values, descriptor.value);
    }
    return freeze(values);
  } catch {
    return undefined;
  }
}

function sanitizeExclusions(value: unknown): readonly object[] | undefined {
  const values = arrayValues(value, 32);
  if (values === undefined) return undefined;
  const output: object[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const snapshot = snapshotAllowedProperties(values[index], EXCLUSION_PROPERTY_KEYS);
    const code = enumValue(snapshot, 'code', [
      'hosted-tools',
      'manual-denials',
      'deny-rules',
      'missing-correlation',
      'session-configuration',
      'unknown',
    ] as const);
    if (code === undefined) return undefined;
    const entries: [string, unknown][] = [['code', code]];
    const scope = enumValue(snapshot, 'scope', ['platform', 'session', 'signal'] as const);
    optionalEntry(entries, 'scope', scope);
    appendArrayValue(output, makeImmutableRecord(entries));
  }
  return freeze(output);
}

function sanitizeSignal(value: unknown): object | undefined {
  const snapshot = snapshotAllowedProperties(value, SIGNAL_PROPERTY_KEYS);
  const availability = enumValue(snapshot, 'availability', [
    'unsupported',
    'partial',
    'available',
  ] as const);
  const evidenceQuality = enumValue(snapshot, 'evidenceQuality', [
    'none',
    'derived',
    'observed',
  ] as const);
  const coverage = enumValue(snapshot, 'coverage', ['none', 'partial', 'full'] as const);
  const finality = enumValue(snapshot, 'finality', ['provisional', 'confirmed', 'mixed'] as const);
  const exclusions = sanitizeExclusions(readSnapshot(snapshot, 'exclusions'));
  if (
    availability === undefined ||
    evidenceQuality === undefined ||
    coverage === undefined ||
    finality === undefined ||
    exclusions === undefined
  )
    return undefined;
  return makeImmutableRecord([
    ['availability', availability],
    ['evidenceQuality', evidenceQuality],
    ['coverage', coverage],
    ['finality', finality],
    ['exclusions', exclusions],
  ]);
}

function sanitizeCapability(value: unknown): object | undefined {
  const snapshot = snapshotAllowedProperties(value, CAPABILITY_PROPERTY_KEYS);
  const revision = integerValue(snapshot, 'revision');
  const effectiveSequence = integerValue(snapshot, 'effectiveSequence');
  const platformSnapshot = snapshotAllowedProperties(
    readSnapshot(snapshot, 'platform'),
    CAPABILITY_PLATFORM_PROPERTY_KEYS,
  );
  const agentKind = closedStringValue(platformSnapshot, 'agentKind', CLOSED_AGENT_KINDS);
  const sessionSnapshot = snapshotAllowedProperties(
    readSnapshot(snapshot, 'session'),
    CAPABILITY_SESSION_PROPERTY_KEYS,
  );
  const mode = enumValue(sessionSnapshot, 'mode', [
    'interactive',
    'non-interactive',
    'unknown',
  ] as const);
  const signalsSnapshot = snapshotAllowedProperties(
    readSnapshot(snapshot, 'signals'),
    SIGNAL_NAMES,
  );
  const exclusions = sanitizeExclusions(readSnapshot(snapshot, 'exclusions'));
  const agentVersion = semverValue(platformSnapshot, 'agentVersion');
  const configId = opaqueIdValue(platformSnapshot, 'configId');
  const configurationId = opaqueIdValue(sessionSnapshot, 'configurationId');
  if (
    revision === undefined ||
    effectiveSequence === undefined ||
    agentKind === undefined ||
    agentKind === null ||
    agentVersion === null ||
    configId === null ||
    configurationId === null ||
    mode === undefined ||
    exclusions === undefined
  )
    return undefined;

  const platformEntries: [string, unknown][] = [['agentKind', agentKind]];
  optionalEntry(platformEntries, 'agentVersion', agentVersion);
  optionalEntry(platformEntries, 'configId', configId);
  const sessionEntries: [string, unknown][] = [['mode', mode]];
  optionalEntry(sessionEntries, 'configurationId', configurationId);
  const signalEntries: [string, unknown][] = [];
  for (let index = 0; index < SIGNAL_NAMES.length; index += 1) {
    const name = SIGNAL_NAMES[index];
    if (name === undefined) return undefined;
    const signal = sanitizeSignal(readSnapshot(signalsSnapshot, name));
    if (signal === undefined) return undefined;
    appendArrayValue(signalEntries, [name, signal]);
  }
  return makeImmutableRecord([
    ['revision', revision],
    ['effectiveSequence', effectiveSequence],
    ['platform', makeImmutableRecord(platformEntries)],
    ['session', makeImmutableRecord(sessionEntries)],
    ['signals', makeImmutableRecord(signalEntries)],
    ['exclusions', exclusions],
  ]);
}

function sanitizeSemantic(value: unknown): object | undefined {
  const snapshot = snapshotAllowedProperties(value, SEMANTIC_PROPERTY_KEYS);
  const kind = enumValue(snapshot, 'kind', [
    'checkpoint',
    'quiescence',
    'outcome',
    'correction',
    'capability',
    'gap',
  ] as const);
  const terminal = booleanValue(snapshot, 'terminal');
  if (kind === undefined || terminal === undefined) return undefined;
  const entries: [string, unknown][] = [
    ['kind', kind],
    ['terminal', terminal],
  ];
  optionalEntry(
    entries,
    'outcome',
    enumValue(snapshot, 'outcome', [
      'success',
      'failure',
      'denied',
      'cancelled',
      'abandoned',
      'unknown',
    ] as const),
  );
  optionalEntry(
    entries,
    'basis',
    enumValue(snapshot, 'basis', [
      'native',
      'derived',
      'timeout',
      'quiescence',
      'reconciliation',
      'correction',
    ] as const),
  );
  const correctionOfEventId = opaqueIdValue(snapshot, 'correctionOfEventId');
  const correctionOfEntityId = opaqueIdValue(snapshot, 'correctionOfEntityId');
  if (correctionOfEventId === null || correctionOfEntityId === null) return undefined;
  optionalEntry(entries, 'correctionOfEventId', correctionOfEventId);
  optionalEntry(entries, 'correctionOfEntityId', correctionOfEntityId);
  return makeImmutableRecord(entries);
}

function sanitizeSource(value: unknown): object | undefined {
  const snapshot = snapshotAllowedProperties(value, SOURCE_PROPERTY_KEYS);
  const adapterId = closedStringValue(snapshot, 'adapterId', CLOSED_ADAPTER_IDS);
  const adapterVersion = semverValue(snapshot, 'adapterVersion');
  const streamId = requiredOpaqueId(snapshot, 'streamId');
  const epochId = requiredOpaqueId(snapshot, 'epochId');
  if (
    adapterId === undefined ||
    adapterId === null ||
    adapterVersion === undefined ||
    adapterVersion === null ||
    streamId === undefined ||
    epochId === undefined
  )
    return undefined;
  return makeImmutableRecord([
    ['adapterId', adapterId],
    ['adapterVersion', adapterVersion],
    ['streamId', streamId],
    ['epochId', epochId],
  ]);
}

function sanitizeScope(value: unknown): object | undefined {
  const snapshot = snapshotAllowedProperties(value, SCOPE_PROPERTY_KEYS);
  const workspaceId = requiredOpaqueId(snapshot, 'workspaceId');
  const sessionId = requiredOpaqueId(snapshot, 'sessionId');
  if (workspaceId === undefined || sessionId === undefined) return undefined;
  const entries: [string, unknown][] = [
    ['workspaceId', workspaceId],
    ['sessionId', sessionId],
  ];
  for (let index = 0; index < SCOPE_PROPERTY_KEYS.length; index += 1) {
    const key = SCOPE_PROPERTY_KEYS[index];
    if (key === undefined || key === 'workspaceId' || key === 'sessionId') continue;
    const value = opaqueIdValue(snapshot, key);
    if (value === null) return undefined;
    optionalEntry(entries, key, value);
  }
  return makeImmutableRecord(entries);
}

function sanitizeLinks(value: unknown): object | undefined {
  if (value === undefined) return undefined;
  if (!isPlainRecord(value)) return undefined;
  const snapshot = snapshotAllowedProperties(value, LINK_PROPERTY_KEYS);
  const entries: [string, unknown][] = [];
  for (let index = 0; index < LINK_PROPERTY_KEYS.length; index += 1) {
    const key = LINK_PROPERTY_KEYS[index];
    if (key === undefined) continue;
    const value = opaqueIdValue(snapshot, key);
    if (value === null) return undefined;
    optionalEntry(entries, key, value);
  }
  return makeImmutableRecord(entries);
}

function sanitizePlanItems(value: unknown): readonly object[] | undefined {
  const values = arrayValues(value, 1_024);
  if (values === undefined) return undefined;
  const output: object[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const snapshot = snapshotAllowedProperties(values[index], PLAN_ITEM_PROPERTY_KEYS);
    const taskId = requiredOpaqueId(snapshot, 'taskId');
    const status = enumValue(snapshot, 'status', [
      'pending',
      'in_progress',
      'blocked',
      'completed',
      'failed',
      'denied',
      'cancelled',
      'abandoned',
      'unknown',
    ] as const);
    const ordinal = integerValue(snapshot, 'ordinal');
    const identityBasis = enumValue(snapshot, 'identityBasis', [
      'stable-native-id',
      'exact-normalized-identity',
      'exact-ordinal-continuity',
      'new-unmatched',
    ] as const);
    if (
      taskId === undefined ||
      status === undefined ||
      ordinal === undefined ||
      identityBasis === undefined
    )
      return undefined;
    const entries: [string, unknown][] = [
      ['taskId', taskId],
      ['status', status],
      ['ordinal', ordinal],
      ['identityBasis', identityBasis],
    ];
    appendArrayValue(output, makeImmutableRecord(entries));
  }
  return freeze(output);
}

const TOOL_CATEGORIES = freeze([
  'read',
  'search',
  'shell',
  'edit',
  'test',
  'build',
  'browser',
  'web',
  'mcp',
  'agent',
  'planning',
  'media',
  'other',
] as const);

/**
 * Copies only a required canonical tool descriptor. The incoming name is
 * used solely for closed-list categorization; the returned name is always a
 * fixed SDK token and can never contain an attacker-controlled native name.
 */
function sanitizeToolProperties(
  snapshot: readonly SafePropertySnapshot[],
): readonly [readonly [string, unknown], readonly [string, unknown]] | undefined {
  const nativeName = stringValue(snapshot, 'name');
  const suppliedCategory = enumValue(snapshot, 'category', TOOL_CATEGORIES);
  if (nativeName === undefined || suppliedCategory === undefined) return undefined;
  const category = categorizeBuiltinTool(nativeName);
  return [
    ['name', canonicalToolNameForCategory(category)],
    ['category', category],
  ];
}

function sanitizeData(type: CoreEventType, value: unknown): object | undefined {
  const snapshot = requiredRecord(value);
  if (snapshot === undefined) return undefined;
  const entries: [string, unknown][] = [];
  switch (type) {
    case 'source.connected':
      {
        const agentKind = closedStringValue(snapshot, 'agentKind', CLOSED_AGENT_KINDS);
        const agentVersion = semverValue(snapshot, 'agentVersion');
        if (agentKind === null || agentVersion === null) return undefined;
        optionalEntry(entries, 'agentKind', agentKind);
        optionalEntry(entries, 'agentVersion', agentVersion);
      }
      optionalEntry(
        entries,
        'capabilities',
        sanitizeCapability(readSnapshot(snapshot, 'capabilities')),
      );
      break;
    case 'source.capability.changed':
      optionalEntry(
        entries,
        'capabilities',
        sanitizeCapability(readSnapshot(snapshot, 'capabilities')),
      );
      optionalEntry(entries, 'previousRevision', integerValue(snapshot, 'previousRevision'));
      optionalEntry(entries, 'effectiveSequence', integerValue(snapshot, 'effectiveSequence'));
      break;
    case 'source.heartbeat':
      optionalEntry(entries, 'uptimeMs', integerValue(snapshot, 'uptimeMs'));
      break;
    case 'source.disconnected':
      optionalEntry(
        entries,
        'reason',
        enumValue(snapshot, 'reason', ['normal', 'timeout', 'error', 'unknown'] as const),
      );
      break;
    case 'telemetry.gap':
      optionalEntry(entries, 'fromSequence', integerValue(snapshot, 'fromSequence'));
      optionalEntry(entries, 'toSequence', integerValue(snapshot, 'toSequence'));
      optionalEntry(
        entries,
        'reason',
        enumValue(snapshot, 'reason', [
          'dropped',
          'corrupt',
          'out-of-order-timeout',
          'adapter-restart',
          'unknown',
        ] as const),
      );
      break;
    case 'workspace.discovered':
      optionalEntry(entries, 'vcs', enumValue(snapshot, 'vcs', ['git', 'other', 'none'] as const));
      break;
    case 'session.started':
      optionalEntry(entries, 'resume', booleanValue(snapshot, 'resume'));
      break;
    case 'session.ended':
      optionalEntry(
        entries,
        'reason',
        enumValue(snapshot, 'reason', [
          'normal',
          'archived',
          'deleted',
          'idle',
          'error',
          'unknown',
        ] as const),
      );
      break;
    case 'turn.started':
      break;
    case 'turn.finished':
      optionalEntry(
        entries,
        'outcome',
        enumValue(snapshot, 'outcome', [
          'completed',
          'partial',
          'failed',
          'interrupted',
          'unknown',
        ] as const),
      );
      break;
    case 'turn.quiescent':
      optionalEntry(
        entries,
        'reason',
        enumValue(snapshot, 'reason', [
          'native',
          'timeout',
          'permission',
          'no-active-work',
          'unknown',
        ] as const),
      );
      break;
    case 'agent.spawned':
      optionalEntry(
        entries,
        'role',
        enumValue(snapshot, 'role', [
          'orchestrator',
          'worker',
          'reviewer',
          'researcher',
          'tester',
          'unknown',
        ] as const),
      );
      {
        const agentKind = closedStringValue(snapshot, 'agentKind', CLOSED_AGENT_KINDS);
        if (agentKind === null) return undefined;
        optionalEntry(entries, 'agentKind', agentKind);
      }
      optionalEntry(entries, 'depth', integerValue(snapshot, 'depth'));
      break;
    case 'agent.state.changed':
      optionalEntry(
        entries,
        'from',
        enumValue(snapshot, 'from', [
          'starting',
          'working',
          'waiting',
          'blocked',
          'finishing',
          'finished',
          'failed',
        ] as const),
      );
      optionalEntry(
        entries,
        'to',
        enumValue(snapshot, 'to', [
          'starting',
          'working',
          'waiting',
          'blocked',
          'finishing',
          'finished',
          'failed',
        ] as const),
      );
      optionalEntry(
        entries,
        'reason',
        enumValue(snapshot, 'reason', [
          'tool',
          'permission',
          'delegation',
          'native',
          'timeout',
          'unknown',
        ] as const),
      );
      break;
    case 'agent.finished':
      optionalEntry(
        entries,
        'outcome',
        enumValue(snapshot, 'outcome', ['completed', 'failed', 'cancelled', 'unknown'] as const),
      );
      break;
    case 'task.created':
      optionalEntry(
        entries,
        'status',
        enumValue(snapshot, 'status', [
          'pending',
          'in_progress',
          'blocked',
          'completed',
          'failed',
          'denied',
          'cancelled',
          'abandoned',
          'unknown',
        ] as const),
      );
      optionalEntry(entries, 'ordinal', integerValue(snapshot, 'ordinal'));
      optionalEntry(entries, 'fallback', booleanValue(snapshot, 'fallback'));
      break;
    case 'task.updated':
      optionalEntry(
        entries,
        'status',
        enumValue(snapshot, 'status', [
          'pending',
          'in_progress',
          'blocked',
          'completed',
          'failed',
          'denied',
          'cancelled',
          'abandoned',
          'unknown',
        ] as const),
      );
      optionalEntry(entries, 'ordinal', integerValue(snapshot, 'ordinal'));
      break;
    case 'task.assigned':
      {
        const assigneeAgentId = opaqueIdValue(snapshot, 'assigneeAgentId');
        if (assigneeAgentId === null) return undefined;
        optionalEntry(entries, 'assigneeAgentId', assigneeAgentId);
      }
      break;
    case 'task.completion.requested':
      optionalEntry(
        entries,
        'requestedStatus',
        enumValue(snapshot, 'requestedStatus', ['completed'] as const),
      );
      optionalEntry(
        entries,
        'checkpoint',
        enumValue(snapshot, 'checkpoint', ['native', 'derived'] as const),
      );
      break;
    case 'task.completed':
      optionalEntry(
        entries,
        'completion',
        enumValue(snapshot, 'completion', ['observed', 'derived'] as const),
      );
      break;
    case 'task.failed':
      optionalEntry(
        entries,
        'category',
        enumValue(snapshot, 'category', ['tool', 'validation', 'agent', 'unknown'] as const),
      );
      break;
    case 'task.denied':
      optionalEntry(
        entries,
        'reason',
        enumValue(snapshot, 'reason', ['permission', 'policy', 'unknown'] as const),
      );
      break;
    case 'task.cancelled':
      optionalEntry(
        entries,
        'reason',
        enumValue(snapshot, 'reason', ['replanned', 'user', 'superseded', 'unknown'] as const),
      );
      break;
    case 'task.abandoned':
      optionalEntry(
        entries,
        'reason',
        enumValue(snapshot, 'reason', [
          'timeout',
          'session-ended',
          'telemetry-gap',
          'unknown',
        ] as const),
      );
      break;
    case 'task.corrected':
      optionalEntry(
        entries,
        'correction',
        enumValue(snapshot, 'correction', ['reopen', 'replace-outcome'] as const),
      );
      {
        const correctedEventId = opaqueIdValue(snapshot, 'correctedEventId');
        const correctedEntityId = opaqueIdValue(snapshot, 'correctedEntityId');
        if (correctedEventId === null || correctedEntityId === null) return undefined;
        optionalEntry(entries, 'correctedEventId', correctedEventId);
        optionalEntry(entries, 'correctedEntityId', correctedEntityId);
      }
      optionalEntry(
        entries,
        'status',
        enumValue(snapshot, 'status', [
          'pending',
          'in_progress',
          'blocked',
          'completed',
          'failed',
          'denied',
          'cancelled',
          'abandoned',
          'unknown',
        ] as const),
      );
      optionalEntry(
        entries,
        'resultingOutcome',
        enumValue(snapshot, 'resultingOutcome', [
          'success',
          'failure',
          'denied',
          'cancelled',
          'abandoned',
          'unknown',
        ] as const),
      );
      break;
    case 'task.plan.reconciled':
      optionalEntry(entries, 'revision', integerValue(snapshot, 'revision'));
      optionalEntry(entries, 'previousRevision', integerValue(snapshot, 'previousRevision'));
      optionalEntry(entries, 'complete', booleanValue(snapshot, 'complete'));
      optionalEntry(entries, 'items', sanitizePlanItems(readSnapshot(snapshot, 'items')));
      break;
    case 'tool.requested':
    case 'tool.started':
      {
        const toolProperties = sanitizeToolProperties(snapshot);
        if (toolProperties === undefined) return undefined;
        appendArrayValue(entries, toolProperties[0]);
        appendArrayValue(entries, toolProperties[1]);
      }
      {
        const parallelGroupId = opaqueIdValue(snapshot, 'parallelGroupId');
        if (parallelGroupId === null) return undefined;
        optionalEntry(entries, 'parallelGroupId', parallelGroupId);
      }
      break;
    case 'tool.completed':
      {
        const toolProperties = sanitizeToolProperties(snapshot);
        if (toolProperties === undefined) return undefined;
        appendArrayValue(entries, toolProperties[0]);
        appendArrayValue(entries, toolProperties[1]);
      }
      optionalEntry(entries, 'durationMs', integerValue(snapshot, 'durationMs'));
      optionalEntry(
        entries,
        'resultClass',
        enumValue(snapshot, 'resultClass', ['success', 'partial', 'unknown'] as const),
      );
      break;
    case 'tool.failed':
      {
        const toolProperties = sanitizeToolProperties(snapshot);
        if (toolProperties === undefined) return undefined;
        appendArrayValue(entries, toolProperties[0]);
        appendArrayValue(entries, toolProperties[1]);
      }
      optionalEntry(entries, 'durationMs', integerValue(snapshot, 'durationMs'));
      optionalEntry(
        entries,
        'failureClass',
        enumValue(snapshot, 'failureClass', [
          'exit_nonzero',
          'timeout',
          'denied',
          'cancelled',
          'exception',
          'unknown',
        ] as const),
      );
      break;
    case 'permission.requested':
      optionalEntry(
        entries,
        'category',
        enumValue(snapshot, 'category', [
          'read',
          'search',
          'shell',
          'edit',
          'test',
          'build',
          'browser',
          'web',
          'mcp',
          'agent',
          'planning',
          'media',
          'other',
        ] as const),
      );
      optionalEntry(
        entries,
        'riskClass',
        enumValue(snapshot, 'riskClass', [
          'read',
          'write',
          'network',
          'execute',
          'destructive',
          'unknown',
        ] as const),
      );
      break;
    case 'permission.resolved':
      optionalEntry(
        entries,
        'outcome',
        enumValue(snapshot, 'outcome', [
          'allowed',
          'denied',
          'cancelled',
          'timed_out',
          'unknown',
        ] as const),
      );
      break;
    default:
      return undefined;
  }
  return makeImmutableRecord(entries);
}

function stableEventIdOption(options: unknown): {
  readonly valid: boolean;
  readonly value?: OpaqueId;
} {
  if (options === undefined) return { valid: true };
  if (!isPlainRecord(options)) return { valid: false };
  try {
    if (adapterIntrinsics === undefined) return { valid: false };
    const descriptor = adapterIntrinsics.objectGetOwnPropertyDescriptor(options, 'stableEventId');
    if (descriptor === undefined) return { valid: true };
    if (!('value' in descriptor) || !isOpaqueId(descriptor.value)) return { valid: false };
    return { valid: true, value: descriptor.value };
  } catch {
    return { valid: false };
  }
}

function sanitizeCoreEvent(
  input: unknown,
  stableId: OpaqueId | undefined,
): AnyCoreEvent | undefined {
  const snapshot = snapshotAllowedProperties(input, EVENT_PROPERTY_KEYS);
  const spec = stringValue(snapshot, 'spec');
  const version = stringValue(snapshot, 'version');
  const eventId = stableId ?? requiredOpaqueId(snapshot, 'eventId');
  const typeValue = stringValue(snapshot, 'type');
  const occurredAt = stringValue(snapshot, 'occurredAt');
  const observedAt = stringValue(snapshot, 'observedAt');
  const sequence = integerValue(snapshot, 'sequence');
  const source = sanitizeSource(readSnapshot(snapshot, 'source'));
  const scope = sanitizeScope(readSnapshot(snapshot, 'scope'));
  const fidelity = enumValue(snapshot, 'fidelity', ['observed', 'derived', 'synthetic'] as const);
  const finality = enumValue(snapshot, 'finality', ['provisional', 'confirmed'] as const);
  if (
    spec === undefined ||
    version !== protocolVersion ||
    eventId === undefined ||
    typeValue === undefined ||
    occurredAt === undefined ||
    observedAt === undefined ||
    sequence === undefined ||
    source === undefined ||
    scope === undefined ||
    fidelity === undefined ||
    finality === undefined
  )
    return undefined;
  const type = typeValue as CoreEventType;
  const data = sanitizeData(type, readSnapshot(snapshot, 'data'));
  if (data === undefined) return undefined;
  const linksInput = readSnapshot(snapshot, 'links');
  const links = sanitizeLinks(linksInput);
  const semanticInput = readSnapshot(snapshot, 'semantic');
  const semantic = sanitizeSemantic(semanticInput);
  if (
    (linksInput !== undefined && links === undefined) ||
    (semanticInput !== undefined && semantic === undefined)
  )
    return undefined;
  const entries: [string, unknown][] = [
    ['spec', spec],
    ['version', version],
    ['eventId', eventId],
    ['type', type],
    ['occurredAt', occurredAt],
    ['observedAt', observedAt],
    ['sequence', sequence],
    ['source', source],
    ['scope', scope],
  ];
  optionalEntry(entries, 'links', links);
  optionalEntry(entries, 'semantic', semantic);
  appendArrayValue(entries, ['fidelity', fidelity]);
  appendArrayValue(entries, ['finality', finality]);
  appendArrayValue(entries, ['data', data]);
  return makeImmutableRecord(entries) as AnyCoreEvent;
}

function copyRetryKey(input: unknown): string | readonly string[] {
  if (typeof input === 'string') {
    if (input.length > MAX_OPAQUE_ID_COMPONENT_CODE_UNITS)
      throw new StableRetryEventIdError('retry-key-too-large');
    return input;
  }
  if (
    !adapterIntrinsicsReady ||
    adapterIntrinsics === undefined ||
    !adapterIntrinsics.arrayIsArray(input) ||
    isProxy(input)
  )
    throw new StableRetryEventIdError('retry-key-invalid');
  try {
    const lengthDescriptor = adapterIntrinsics.objectGetOwnPropertyDescriptor(input, 'length');
    if (lengthDescriptor === undefined || !('value' in lengthDescriptor))
      throw new StableRetryEventIdError('retry-key-invalid');
    const length = lengthDescriptor.value;
    if (!isSafeInteger(length) || length < 1)
      throw new StableRetryEventIdError('retry-key-invalid');
    if (length > MAX_OPAQUE_ID_COMPONENTS) throw new StableRetryEventIdError('retry-key-too-large');
    const output: string[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = adapterIntrinsics.objectGetOwnPropertyDescriptor(
        input,
        stringConstructor(index),
      );
      if (
        descriptor === undefined ||
        !('value' in descriptor) ||
        typeof descriptor.value !== 'string'
      )
        throw new StableRetryEventIdError('retry-key-invalid');
      if (descriptor.value.length > MAX_OPAQUE_ID_COMPONENT_CODE_UNITS)
        throw new StableRetryEventIdError('retry-key-too-large');
      appendArrayValue(output, descriptor.value);
    }
    // The captured length and its indexed data descriptors are the complete
    // retry-key contract. Extra symbols/metadata are intentionally ignored;
    // inspecting ownKeys here would let an attacker make hook work scale with
    // unrelated properties on an otherwise bounded key.
    return freeze(output);
  } catch (error) {
    if (error instanceof StableRetryEventIdError) throw error;
    throw new StableRetryEventIdError('retry-key-invalid');
  }
}

/**
 * Derives the same opaque event identifier for every logical retry. The raw
 * logical key is used only inside the keyed deriver and is never returned or
 * copied into an ingress record. Include the native event kind/checkpoint in
 * the key when one native identifier can represent multiple observations.
 */
export async function deriveStableRetryEventId(
  deriver: OpaqueIdDeriver,
  logicalIdentity: unknown,
): Promise<OpaqueId> {
  if (!adapterIntrinsicsReady || adapterIntrinsics === undefined)
    throw new StableRetryEventIdError('retry-derivation-failed');
  const retryKey = copyRetryKey(logicalIdentity);
  const deriverSnapshot = snapshotAllowedProperties(deriver, ['derive']);
  const derive = readSnapshot(deriverSnapshot, 'derive');
  if (typeof derive !== 'function') throw new StableRetryEventIdError('retry-deriver-invalid');
  const framed: string[] = [];
  appendArrayValue(framed, RETRY_ID_DOMAIN);
  if (typeof retryKey === 'string') appendArrayValue(framed, retryKey);
  else {
    for (let index = 0; index < retryKey.length; index += 1) {
      const component = retryKey[index];
      if (component === undefined) throw new StableRetryEventIdError('retry-key-invalid');
      appendArrayValue(framed, component);
    }
  }
  let value: unknown;
  try {
    value = await adapterIntrinsics.reflectApply(derive, deriver, ['stream', framed]);
  } catch {
    throw new StableRetryEventIdError('retry-derivation-failed');
  }
  if (!isOpaqueId(value)) throw new StableRetryEventIdError('retry-derivation-failed');
  return value;
}

/** Alias using the shorter name used by adapter authors. */
export const deriveStableEventId = deriveStableRetryEventId;

/**
 * Sanitizes, validates, canonicalizes, and UTF-8 bounds one ingress event.
 * A rejected result has no record or transport representation, so callers
 * cannot accidentally hand invalid or native-bearing data to IPC or spool
 * code.
 */
export function sanitizeIngressRecord(input: unknown, options?: unknown): IngressPreparationResult {
  if (!adapterIntrinsicsReady) return degradedIngressRejection();
  const option = stableEventIdOption(options);
  if (!option.valid)
    return rejected(createAdapterDiagnostic('identity-derivation-failed', { field: 'identity' }));

  const sanitized = sanitizeCoreEvent(input, option.value);
  if (sanitized === undefined)
    return rejected(createAdapterDiagnostic('native-field-invalid', { field: 'event' }));

  let validation: ReturnType<typeof validateEvent>;
  try {
    validation = validateEvent(sanitized);
  } catch {
    return rejected(createAdapterDiagnostic('native-input-invalid', { field: 'native-input' }));
  }
  if (validation.status !== 'accepted') return protocolRejected(validation);

  let canonical: AnyCoreEvent;
  let canonicalJson: CanonicalIngressJson;
  let byteLength: number;
  try {
    canonical = canonicalizeEvent(sanitized);
    canonicalJson = serializeCanonicalEvent(canonical) as CanonicalIngressJson;
    // Keep only the exact scalar measurement. A prevalidated Uint8Array would
    // remain mutable and its public byteLength can be poisoned after import.
    byteLength = canonicalUtf8ByteLength(canonicalJson);
  } catch {
    return rejected(createAdapterDiagnostic('native-field-invalid', { field: 'event' }));
  }
  if (byteLength > MAX_INGRESS_RECORD_BYTES)
    return rejected(createAdapterDiagnostic('event-too-large', { field: 'size' }));

  if (!isOpaqueId(canonical.eventId))
    return rejected(createAdapterDiagnostic('identity-derivation-failed', { field: 'identity' }));
  const eventId: OpaqueId = canonical.eventId;
  let handoffActive = false;
  const handoff = (writer: unknown): IngressHandoffResult => {
    if (typeof writer !== 'function')
      return makeImmutableRecord<IngressHandoffResult>([
        ['status', 'rejected'],
        ['code', 'writer-invalid'],
      ]);
    if (handoffActive)
      return makeImmutableRecord<IngressHandoffResult>([
        ['status', 'rejected'],
        ['code', 'writer-reentrant'],
      ]);
    handoffActive = true;
    try {
      adapterIntrinsics!.reflectApply(writer, undefined, [canonicalJson]);
      return makeImmutableRecord<IngressHandoffResult>([['status', 'written']]);
    } catch {
      return makeImmutableRecord<IngressHandoffResult>([
        ['status', 'rejected'],
        ['code', 'writer-failed'],
      ]);
    } finally {
      handoffActive = false;
    }
  };
  return makeImmutableRecord<AcceptedIngressPreparation>([
    ['status', 'accepted'],
    ['record', canonical],
    ['eventId', eventId],
    ['canonicalJson', canonicalJson],
    ['byteLength', byteLength],
    ['diagnostics', EMPTY_DIAGNOSTICS],
    ['handoff', handoff],
  ]);
}

/** Descriptive aliases for transport implementations and tests. */
export const prepareSanitizedIngressRecord = sanitizeIngressRecord;
export const buildSanitizedIngressRecord = sanitizeIngressRecord;
