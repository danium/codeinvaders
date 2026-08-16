import * as Ajv2020Module from 'ajv/dist/2020.js';
import * as addFormatsModule from 'ajv-formats';
import type { ErrorObject, KeywordDefinition, ValidateFunction } from 'ajv';

// Capture mutable platform intrinsics while this module is evaluated. The
// validation, canonical-writer, and schema-construction boundaries must not
// start consulting a poisoned global after an adapter has imported the module.
// The probes are deliberate: an import that observes a structurally plausible
// but behaviorally false intrinsic must fail closed instead of warming AJV with
// attacker-controlled semantics.
interface CapturedProtocolIntrinsics {
  readonly arrayConstructor: typeof Array;
  readonly arrayIsArray: typeof Array.isArray;
  readonly arrayBufferIsView: typeof ArrayBuffer.isView;
  readonly arrayPrototype: typeof Array.prototype;
  readonly functionApply: typeof Function.prototype.apply;
  readonly functionCall: typeof Function.prototype.call;
  readonly freeze: typeof Object.freeze;
  readonly objectCreate: typeof Object.create;
  readonly objectDefineProperty: typeof Object.defineProperty;
  readonly objectGetOwnPropertyDescriptor: typeof Object.getOwnPropertyDescriptor;
  readonly objectGetPrototypeOf: typeof Object.getPrototypeOf;
  readonly objectHasOwn: typeof Object.prototype.hasOwnProperty;
  readonly objectIs: typeof Object.is;
  readonly objectIsFrozen: typeof Object.isFrozen;
  readonly objectKeys: typeof Object.keys;
  readonly objectPrototype: typeof Object.prototype;
  readonly objectSetPrototypeOf: typeof Object.setPrototypeOf;
  readonly jsonStringify: typeof JSON.stringify;
  readonly mapConstructor: typeof Map;
  readonly numberConstructor: typeof Number;
  readonly numberIsFinite: typeof Number.isFinite;
  readonly numberIsSafeInteger: typeof Number.isSafeInteger;
  readonly numberMaxSafeInteger: number;
  readonly reflectApply: typeof Reflect.apply;
  readonly reflectOwnKeys: typeof Reflect.ownKeys;
  readonly regExpConstructor: typeof RegExp;
  readonly regExpPrototype: typeof RegExp.prototype;
  readonly regExpTest: typeof RegExp.prototype.test;
  readonly regExpTestDescriptor: PropertyDescriptor;
  readonly setConstructor: typeof Set;
  readonly stringConstructor: typeof String;
  readonly textEncoderConstructor: typeof TextEncoder;
  readonly textEncoderEncode: typeof TextEncoder.prototype.encode;
  readonly typedArrayByteLengthGetter: () => number;
  readonly typedArrayTagGetter: () => string;
  readonly uint8ArrayConstructor: typeof Uint8Array;
  readonly weakSetConstructor: typeof WeakSet;
}

function captureProtocolIntrinsics(): CapturedProtocolIntrinsics | undefined {
  try {
    const objectConstructor = globalThis.Object;
    const arrayConstructor = globalThis.Array;
    const arrayBufferConstructor = globalThis.ArrayBuffer;
    const functionConstructor = globalThis.Function;
    const jsonObject = globalThis.JSON;
    const numberConstructor = globalThis.Number;
    const reflectObject = globalThis.Reflect;
    const regExpConstructor = globalThis.RegExp;
    const setConstructor = globalThis.Set;
    const mapConstructor = globalThis.Map;
    const stringConstructor = globalThis.String;
    const textEncoderConstructor = globalThis.TextEncoder;
    const uint8ArrayConstructor = globalThis.Uint8Array;
    const weakSetConstructor = globalThis.WeakSet;
    const objectGetPrototypeOf = objectConstructor.getPrototypeOf;
    const objectGetOwnPropertyDescriptor = objectConstructor.getOwnPropertyDescriptor;
    const objectDefineProperty = objectConstructor.defineProperty;
    const objectCreate = objectConstructor.create;
    const objectKeys = objectConstructor.keys;
    const objectFreeze = objectConstructor.freeze;
    const objectIsFrozen = objectConstructor.isFrozen;
    const objectIs = objectConstructor.is;
    const objectSetPrototypeOf = objectConstructor.setPrototypeOf;
    const objectPrototype = objectConstructor.prototype;
    const arrayIsArray = arrayConstructor.isArray;
    const arrayBufferIsView = arrayBufferConstructor?.isView;
    const arrayPrototype = arrayConstructor.prototype;
    const reflectApply = reflectObject.apply;
    const reflectOwnKeys = reflectObject.ownKeys;
    const regExpPrototype = regExpConstructor?.prototype;
    const regExpTestDescriptor =
      regExpPrototype === undefined
        ? undefined
        : objectGetOwnPropertyDescriptor(regExpPrototype, 'test');
    const regExpTest = regExpTestDescriptor?.value;
    const functionCall = functionConstructor.prototype.call;
    const functionApply = functionConstructor.prototype.apply;
    const objectHasOwn = objectPrototype.hasOwnProperty;
    const jsonStringify = jsonObject.stringify;
    const numberIsFinite = numberConstructor.isFinite;
    const numberIsSafeInteger = numberConstructor.isSafeInteger;
    const numberMaxSafeInteger = numberConstructor.MAX_SAFE_INTEGER;
    const textEncoderEncode = textEncoderConstructor?.prototype.encode;

    if (
      typeof objectGetPrototypeOf !== 'function' ||
      typeof objectGetOwnPropertyDescriptor !== 'function' ||
      typeof objectDefineProperty !== 'function' ||
      typeof objectCreate !== 'function' ||
      typeof objectKeys !== 'function' ||
      typeof objectFreeze !== 'function' ||
      typeof objectIsFrozen !== 'function' ||
      typeof objectIs !== 'function' ||
      typeof objectSetPrototypeOf !== 'function' ||
      typeof arrayIsArray !== 'function' ||
      typeof arrayBufferIsView !== 'function' ||
      typeof reflectApply !== 'function' ||
      typeof reflectOwnKeys !== 'function' ||
      typeof functionCall !== 'function' ||
      typeof functionApply !== 'function' ||
      typeof objectHasOwn !== 'function' ||
      typeof jsonStringify !== 'function' ||
      typeof numberIsFinite !== 'function' ||
      typeof numberIsSafeInteger !== 'function' ||
      numberMaxSafeInteger !== 9007199254740991 ||
      typeof textEncoderConstructor !== 'function' ||
      typeof textEncoderEncode !== 'function' ||
      typeof arrayConstructor !== 'function' ||
      typeof uint8ArrayConstructor !== 'function' ||
      typeof regExpConstructor !== 'function' ||
      typeof regExpPrototype !== 'object' ||
      regExpPrototype === null ||
      typeof regExpTest !== 'function' ||
      regExpTestDescriptor === undefined ||
      regExpTestDescriptor.get !== undefined ||
      regExpTestDescriptor.set !== undefined ||
      typeof stringConstructor !== 'function' ||
      typeof setConstructor !== 'function' ||
      typeof mapConstructor !== 'function' ||
      typeof weakSetConstructor !== 'function'
    )
      return undefined;

    const probe = reflectApply(objectCreate, undefined, [null]) as Record<string, unknown>;
    reflectApply(objectDefineProperty, undefined, [
      probe,
      'key',
      {
        configurable: true,
        enumerable: true,
        writable: true,
        value: 'value',
      },
    ]);
    const probeDescriptor = reflectApply(objectGetOwnPropertyDescriptor, undefined, [probe, 'key']);
    const probeKeys = reflectApply(objectKeys, undefined, [probe]);
    const probeOwnKeys = reflectApply(reflectOwnKeys, undefined, [probe]);
    if (
      reflectApply(objectGetPrototypeOf, undefined, [probe]) !== null ||
      probeDescriptor?.value !== 'value' ||
      probeKeys.length !== 1 ||
      probeKeys[0] !== 'key' ||
      probeOwnKeys.length !== 1 ||
      probeOwnKeys[0] !== 'key' ||
      reflectApply(objectHasOwn, probe, ['key']) !== true
    )
      return undefined;

    const arrayProbe = new arrayConstructor(1);
    if (
      reflectApply(arrayIsArray, undefined, [arrayProbe]) !== true ||
      reflectApply(arrayIsArray, undefined, [probe]) !== false ||
      reflectApply(objectGetPrototypeOf, undefined, [arrayPrototype]) !== objectPrototype
    )
      return undefined;

    const regExpProbe = new regExpConstructor('^a$');
    if (
      reflectApply(objectGetPrototypeOf, undefined, [regExpProbe]) !== regExpPrototype ||
      reflectApply(regExpTest, regExpProbe, ['a']) !== true ||
      reflectApply(regExpTest, regExpProbe, ['b']) !== false
    )
      return undefined;

    const callProbe = () => 'call-probe';
    const applyProbe = () => 'apply-probe';
    if (
      reflectApply(functionCall, callProbe, []) !== 'call-probe' ||
      reflectApply(functionApply, applyProbe, [[]]) !== 'apply-probe' ||
      reflectApply(reflectApply, undefined, [objectKeys, undefined, [probe]]).length !== 1 ||
      reflectApply(jsonStringify, undefined, ['probe']) !== '"probe"' ||
      reflectApply(numberIsFinite, undefined, [1]) !== true ||
      reflectApply(numberIsSafeInteger, undefined, [1]) !== true
    )
      return undefined;

    const frozenProbe = {};
    reflectApply(objectFreeze, undefined, [frozenProbe]);
    if (reflectApply(objectIsFrozen, undefined, [frozenProbe]) !== true) return undefined;

    const typedArrayPrototype = reflectApply(objectGetPrototypeOf, undefined, [
      uint8ArrayConstructor.prototype,
    ]);
    const typedArrayTagGetter = reflectApply(objectGetOwnPropertyDescriptor, undefined, [
      typedArrayPrototype,
      Symbol.toStringTag,
    ])?.get;
    const typedArrayByteLengthGetter = reflectApply(objectGetOwnPropertyDescriptor, undefined, [
      typedArrayPrototype,
      'byteLength',
    ])?.get;
    if (
      typeof typedArrayTagGetter !== 'function' ||
      typeof typedArrayByteLengthGetter !== 'function'
    )
      return undefined;

    const matchesBytes = (value: unknown, expected: readonly number[]): boolean => {
      try {
        if (
          reflectApply(typedArrayTagGetter, value, []) !== 'Uint8Array' ||
          reflectApply(typedArrayByteLengthGetter, value, []) !== expected.length
        )
          return false;
        for (let index = 0; index < expected.length; index += 1) {
          if ((value as { readonly [index: number]: unknown })[index] !== expected[index])
            return false;
        }
        return true;
      } catch {
        return false;
      }
    };
    const typedArrayProbe = new uint8ArrayConstructor(2);
    if (
      !matchesBytes(typedArrayProbe, [0, 0]) ||
      reflectApply(arrayBufferIsView, undefined, [typedArrayProbe]) !== true
    )
      return undefined;
    const textEncoder = new textEncoderConstructor();
    const ascii = reflectApply(textEncoderEncode, textEncoder, ['Az']);
    const utf8 = reflectApply(textEncoderEncode, textEncoder, ['é😀']);
    if (
      !matchesBytes(ascii, [0x41, 0x7a]) ||
      !matchesBytes(utf8, [0xc3, 0xa9, 0xf0, 0x9f, 0x98, 0x80])
    )
      return undefined;

    return {
      arrayConstructor,
      arrayIsArray,
      arrayBufferIsView,
      arrayPrototype,
      functionApply,
      functionCall,
      freeze: objectFreeze,
      objectCreate,
      objectDefineProperty,
      objectGetOwnPropertyDescriptor,
      objectGetPrototypeOf,
      objectHasOwn,
      objectIs,
      objectIsFrozen,
      objectKeys,
      objectPrototype,
      objectSetPrototypeOf,
      jsonStringify,
      mapConstructor,
      numberConstructor,
      numberIsFinite,
      numberIsSafeInteger,
      numberMaxSafeInteger,
      reflectApply,
      reflectOwnKeys,
      regExpConstructor,
      regExpPrototype,
      regExpTest,
      regExpTestDescriptor,
      setConstructor,
      stringConstructor,
      textEncoderConstructor,
      textEncoderEncode,
      typedArrayByteLengthGetter,
      typedArrayTagGetter,
      uint8ArrayConstructor,
      weakSetConstructor,
    };
  } catch {
    return undefined;
  }
}

const capturedProtocolIntrinsics = captureProtocolIntrinsics();
const protocolIntrinsicsReady = capturedProtocolIntrinsics !== undefined;
const unavailableIntrinsic = (): never => {
  return undefined as never;
};
const arrayConstructor = capturedProtocolIntrinsics?.arrayConstructor ?? globalThis.Array;
const arrayIsArray =
  capturedProtocolIntrinsics?.arrayIsArray ??
  (unavailableIntrinsic as unknown as typeof Array.isArray);
const arrayPrototype = capturedProtocolIntrinsics?.arrayPrototype ?? globalThis.Array.prototype;
const functionCall =
  capturedProtocolIntrinsics?.functionCall ??
  (unavailableIntrinsic as unknown as typeof Function.prototype.call);
const freeze =
  capturedProtocolIntrinsics?.freeze ?? (unavailableIntrinsic as unknown as typeof Object.freeze);
const objectCreate =
  capturedProtocolIntrinsics?.objectCreate ??
  (unavailableIntrinsic as unknown as typeof Object.create);
const objectDefineProperty =
  capturedProtocolIntrinsics?.objectDefineProperty ??
  (unavailableIntrinsic as unknown as typeof Object.defineProperty);
const objectGetOwnPropertyDescriptor =
  capturedProtocolIntrinsics?.objectGetOwnPropertyDescriptor ??
  (unavailableIntrinsic as unknown as typeof Object.getOwnPropertyDescriptor);
const objectGetPrototypeOf =
  capturedProtocolIntrinsics?.objectGetPrototypeOf ??
  (unavailableIntrinsic as unknown as typeof Object.getPrototypeOf);
const objectHasOwn =
  capturedProtocolIntrinsics?.objectHasOwn ??
  (unavailableIntrinsic as unknown as typeof Object.prototype.hasOwnProperty);
const objectIs =
  capturedProtocolIntrinsics?.objectIs ?? (unavailableIntrinsic as unknown as typeof Object.is);
const objectKeys =
  capturedProtocolIntrinsics?.objectKeys ?? (unavailableIntrinsic as unknown as typeof Object.keys);
const objectPrototype =
  capturedProtocolIntrinsics?.objectPrototype ?? ({} as typeof Object.prototype);
const objectSetPrototypeOf =
  capturedProtocolIntrinsics?.objectSetPrototypeOf ??
  (unavailableIntrinsic as unknown as typeof Object.setPrototypeOf);
const jsonStringify =
  capturedProtocolIntrinsics?.jsonStringify ??
  (unavailableIntrinsic as unknown as typeof JSON.stringify);
const mapConstructor = capturedProtocolIntrinsics?.mapConstructor ?? globalThis.Map;
const numberConstructor = capturedProtocolIntrinsics?.numberConstructor ?? globalThis.Number;
const numberIsFinite =
  capturedProtocolIntrinsics?.numberIsFinite ??
  (unavailableIntrinsic as unknown as typeof Number.isFinite);
const numberIsSafeInteger =
  capturedProtocolIntrinsics?.numberIsSafeInteger ??
  (unavailableIntrinsic as unknown as typeof Number.isSafeInteger);
const numberMaxSafeInteger = capturedProtocolIntrinsics?.numberMaxSafeInteger ?? 0;
const reflectApply =
  capturedProtocolIntrinsics?.reflectApply ??
  (unavailableIntrinsic as unknown as typeof Reflect.apply);
const reflectOwnKeys =
  capturedProtocolIntrinsics?.reflectOwnKeys ??
  (unavailableIntrinsic as unknown as typeof Reflect.ownKeys);
const regExpConstructor = capturedProtocolIntrinsics?.regExpConstructor;
const regExpPrototype = capturedProtocolIntrinsics?.regExpPrototype;
const regExpTest = capturedProtocolIntrinsics?.regExpTest;
const regExpTestDescriptor = capturedProtocolIntrinsics?.regExpTestDescriptor;
const setConstructor = capturedProtocolIntrinsics?.setConstructor ?? globalThis.Set;
const stringConstructor = capturedProtocolIntrinsics?.stringConstructor ?? globalThis.String;
const TextEncoderConstructor =
  capturedProtocolIntrinsics?.textEncoderConstructor ??
  (unavailableIntrinsic as unknown as typeof TextEncoder);
const textEncoderEncode =
  capturedProtocolIntrinsics?.textEncoderEncode ??
  (unavailableIntrinsic as unknown as typeof TextEncoder.prototype.encode);
const typedArrayByteLengthGetter = capturedProtocolIntrinsics?.typedArrayByteLengthGetter;
const typedArrayTagGetter = capturedProtocolIntrinsics?.typedArrayTagGetter;
const weakSetConstructor = capturedProtocolIntrinsics?.weakSetConstructor ?? globalThis.WeakSet;

function encodeUtf8(value: string): Uint8Array {
  const encoded = reflectApply(textEncoderEncode, new TextEncoderConstructor(), [value]);
  if (typedArrayTagGetter === undefined || typedArrayByteLengthGetter === undefined)
    throw new Error('UTF-8 encoder unavailable');
  if (reflectApply(typedArrayTagGetter, encoded, []) !== 'Uint8Array')
    throw new Error('UTF-8 encoder returned an invalid byte array');
  reflectApply(typedArrayByteLengthGetter, encoded, []);
  return encoded;
}

function exactByteLength(value: Uint8Array): number {
  if (typedArrayByteLengthGetter === undefined || typedArrayTagGetter === undefined)
    throw new Error('typed-array intrinsic unavailable');
  if (reflectApply(typedArrayTagGetter, value, []) !== 'Uint8Array')
    throw new Error('typed-array intrinsic unavailable');
  return reflectApply(typedArrayByteLengthGetter, value, []);
}

function hasOwnProperty(value: Record<string, unknown>, property: string): boolean {
  return reflectApply(objectHasOwn, value, [property]);
}

function safeRegExpTest(pattern: RegExp | undefined, value: string): boolean {
  if (!protocolIntrinsicsReady || pattern === undefined || regExpTest === undefined) return false;
  try {
    return reflectApply(regExpTest, pattern, [value]) === true;
  } catch {
    return false;
  }
}

const sanitizedTokenPattern =
  regExpConstructor === undefined
    ? undefined
    : new regExpConstructor('^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$');

/** Returns the exact UTF-8 length without exposing a prevalidated byte buffer. */
export function canonicalUtf8ByteLength(value: string): number {
  return exactByteLength(encodeUtf8(value));
}

/** The stable, vendor-neutral Agent Arcade Protocol namespace. */
export const protocolId = 'io.github.danium.codeinvaders.aap' as const;
export const protocolVersion = '1.0.0' as const;
export type ProtocolVersion = `${number}.${number}.${number}`;

export const MAX_EVENT_BYTES = 32_768;
export const MAX_JSON_DEPTH = 12;
export const MAX_EXTENSION_BYTES = 4_096;

/** Resource limits for the generic canonical state/text/UTF-8 APIs. */
export const MAX_CANONICAL_STATE_DEPTH = 64;
export const MAX_CANONICAL_STATE_NODES = 100_000;
export const MAX_CANONICAL_STATE_CONTAINERS = 25_000;
export const MAX_CANONICAL_STATE_BYTES = 1_048_576;
export const MAX_CANONICAL_ARRAY_LENGTH = 100_000;
export const MAX_CANONICAL_OBJECT_KEYS = 10_000;
export const MAX_CANONICAL_STRING_CODE_UNITS = 16_384;
export const MAX_CANONICAL_TOTAL_STRING_CODE_UNITS = 1_000_000;
export const MAX_ENTITY_COLLECTIONS = 128;
export const MAX_ENTITY_PATH_SEGMENTS = 64;
export const MAX_ENTITY_PATH_SEGMENT_CODE_UNITS = 128;
export const MAX_ENTITY_ID_CODE_UNITS = 256;

export type Fidelity = 'observed' | 'derived' | 'synthetic';
export type Finality = 'provisional' | 'confirmed';
export type Support = 'none' | 'derived' | 'observed';
export type Id = string;
export type SignalAvailability = 'unsupported' | 'partial' | 'available';
export type SignalCoverage = 'none' | 'partial' | 'full';
export type SignalFinality = 'provisional' | 'confirmed' | 'mixed';
export const PLAN_ORDINAL_BASE = 0 as const;
export type OpaqueText = string & { readonly __codeinvadersOpaqueText: unique symbol };
export type SanitizedToken = string & { readonly __codeinvadersSanitizedToken: unique symbol };

/** Brands canonical text only after the same bounded checks used by the protocol schema. */
export function opaqueText(value: string, maxLength = 256): OpaqueText {
  let codePointLength = 0;
  for (let index = 0; index < value.length; index += 1) {
    const first = value.charCodeAt(index);
    if (first >= 0xd800 && first <= 0xdbff && index + 1 < value.length) {
      const second = value.charCodeAt(index + 1);
      if (second >= 0xdc00 && second <= 0xdfff) index += 1;
    }
    codePointLength += 1;
  }
  if (codePointLength < 1 || codePointLength > Math.min(maxLength, 2048)) {
    throw new Error('invalid opaque text');
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.codePointAt(index) ?? 0;
    if (code <= 0x1f || code === 0x7f) throw new Error('invalid opaque text');
    if (code > 0xffff) index += 1;
  }
  return value as OpaqueText;
}

export function sanitizedToken(value: string): SanitizedToken {
  if (!safeRegExpTest(sanitizedTokenPattern, value)) throw new Error('invalid sanitized token');
  return value as SanitizedToken;
}

export interface SignalExclusion {
  readonly code:
    | 'hosted-tools'
    | 'manual-denials'
    | 'deny-rules'
    | 'missing-correlation'
    | 'session-configuration'
    | 'unknown';
  readonly scope?: 'platform' | 'session' | 'signal';
}

export type SignalCapability =
  | {
      readonly availability: 'unsupported';
      readonly evidenceQuality: 'none';
      readonly coverage: 'none';
      readonly finality: 'provisional';
      readonly exclusions: readonly SignalExclusion[];
    }
  | {
      readonly availability: 'partial';
      readonly evidenceQuality: Exclude<Support, 'none'>;
      readonly coverage: 'partial';
      readonly finality: SignalFinality;
      readonly exclusions: readonly [SignalExclusion, ...SignalExclusion[]];
    }
  | {
      readonly availability: 'available';
      readonly evidenceQuality: Exclude<Support, 'none'>;
      readonly coverage: 'full';
      readonly finality: Exclude<SignalFinality, 'provisional'>;
      readonly exclusions: readonly SignalExclusion[];
    };

export interface SourceIdentity {
  readonly adapterId: Id;
  readonly adapterVersion: string;
  readonly streamId: Id;
  readonly epochId: Id;
  readonly nativeToken?: SanitizedToken;
}

export interface EventScope {
  readonly workspaceId: Id;
  readonly repoId?: Id;
  readonly sessionId: Id;
  readonly turnId?: Id;
  readonly agentId?: Id;
  readonly taskId?: Id;
  readonly operationId?: Id;
  readonly permissionId?: Id;
}

export interface EventLinks {
  readonly causationEventId?: Id;
  readonly parentAgentId?: Id;
  readonly parentTaskId?: Id;
  readonly correlationId?: Id;
}

export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'denied'
  | 'cancelled'
  | 'abandoned'
  | 'unknown';
export type NonTerminalTaskStatus = 'pending' | 'in_progress' | 'blocked';
export type TerminalTaskStatus = Exclude<TaskStatus, NonTerminalTaskStatus>;
export type TaskOutcome = 'success' | 'failure' | 'denied' | 'cancelled' | 'abandoned' | 'unknown';
type TerminalOutcomeForStatus<Status extends TerminalTaskStatus> = Status extends 'completed'
  ? 'success'
  : Status extends 'failed'
    ? 'failure'
    : Status extends 'denied'
      ? 'denied'
      : Status extends 'cancelled'
        ? 'cancelled'
        : Status extends 'abandoned'
          ? 'abandoned'
          : 'unknown';
export type ToolCategory =
  | 'read'
  | 'search'
  | 'shell'
  | 'edit'
  | 'test'
  | 'build'
  | 'browser'
  | 'web'
  | 'mcp'
  | 'agent'
  | 'planning'
  | 'media'
  | 'other';
export type AgentState =
  'starting' | 'working' | 'waiting' | 'blocked' | 'finishing' | 'finished' | 'failed';

export interface CapabilityProfile {
  readonly revision: number;
  readonly effectiveSequence: number;
  readonly platform: {
    readonly agentKind: SanitizedToken;
    readonly agentVersion?: string;
    readonly configId?: Id;
  };
  readonly session: {
    readonly mode: 'interactive' | 'non-interactive' | 'unknown';
    readonly configurationId?: Id;
  };
  readonly signals: {
    readonly sessions: SignalCapability;
    readonly turns: SignalCapability;
    readonly tasks: SignalCapability;
    readonly taskPlan: SignalCapability;
    readonly agents: SignalCapability;
    readonly tools: SignalCapability;
    readonly permissions: SignalCapability;
  };
  readonly exclusions: readonly SignalExclusion[];
}

export type SemanticMetadata =
  | { readonly kind: 'checkpoint'; readonly terminal: false; readonly basis?: 'native' | 'derived' }
  | {
      readonly kind: 'quiescence';
      readonly terminal: false;
      readonly basis?: 'native' | 'timeout' | 'quiescence';
    }
  | {
      readonly kind: 'outcome';
      readonly terminal: true;
      readonly outcome: 'success';
      /** A timeout may close work conservatively, but never establish success. */
      readonly basis?: 'native' | 'derived' | 'quiescence';
    }
  | {
      readonly kind: 'outcome';
      readonly terminal: true;
      readonly outcome: Exclude<TaskOutcome, 'success'>;
      readonly basis?: 'native' | 'derived' | 'timeout' | 'quiescence';
    }
  | {
      readonly kind: 'correction';
      readonly terminal: false;
      readonly correctionOfEventId: Id;
      readonly correctionOfEntityId: Id;
      readonly basis?: 'correction';
    }
  | { readonly kind: 'capability'; readonly terminal: false; readonly basis?: 'native' | 'derived' }
  | {
      readonly kind: 'gap';
      readonly terminal: false;
      readonly basis?: 'native' | 'derived' | 'timeout';
    };
type RequiredSemantic = SemanticMetadata;
type SemanticRequiredEventType =
  | 'source.capability.changed'
  | 'telemetry.gap'
  | 'turn.quiescent'
  | 'task.completion.requested'
  | 'task.completed'
  | 'task.failed'
  | 'task.denied'
  | 'task.cancelled'
  | 'task.abandoned'
  | 'task.corrected';
type TerminalEventOutcome = {
  'task.completed': 'success';
  'task.failed': 'failure';
  'task.denied': 'denied';
  'task.cancelled': 'cancelled';
  'task.abandoned': 'abandoned';
};
type OutcomeBasis = 'native' | 'derived' | 'timeout' | 'quiescence';
type OutcomeSemantic<Outcome extends TaskOutcome> = {
  readonly kind: 'outcome';
  readonly terminal: true;
  readonly outcome: Outcome;
  readonly basis?: Outcome extends 'success' ? Exclude<OutcomeBasis, 'timeout'> : OutcomeBasis;
};
type SemanticFor<T extends CoreEventType> = T extends 'task.completion.requested'
  ? Extract<RequiredSemantic, { kind: 'checkpoint' }>
  : T extends 'turn.quiescent'
    ? Extract<RequiredSemantic, { kind: 'quiescence' }>
    : T extends 'telemetry.gap'
      ? Extract<RequiredSemantic, { kind: 'gap' }>
      : T extends 'source.capability.changed'
        ? Extract<RequiredSemantic, { kind: 'capability' }>
        : T extends 'task.corrected'
          ? | Extract<RequiredSemantic, { kind: 'correction' }>
            | Extract<RequiredSemantic, { kind: 'outcome' }>
          : T extends keyof TerminalEventOutcome
            ? OutcomeSemantic<TerminalEventOutcome[T]>
            : SemanticMetadata | undefined;

type CanonicalLabel = OpaqueText;
type CanonicalDescription = OpaqueText;
type CanonicalToolName = SanitizedToken;
type InitialCapabilityProfile = Omit<CapabilityProfile, 'revision'> & { revision: 1 };
type DataMap = {
  'source.connected': {
    agentKind: SanitizedToken;
    agentVersion?: string;
    capabilities: InitialCapabilityProfile;
  };
  'source.capability.changed': {
    capabilities: CapabilityProfile;
    previousRevision: number;
    effectiveSequence: number;
  };
  'source.heartbeat': { uptimeMs: number };
  'source.disconnected': { reason: 'normal' | 'timeout' | 'error' | 'unknown' };
  'telemetry.gap': {
    fromSequence?: number;
    toSequence?: number;
    reason: 'dropped' | 'corrupt' | 'out-of-order-timeout' | 'adapter-restart' | 'unknown';
  };
  'workspace.discovered': { label?: CanonicalLabel; vcs?: 'git' | 'other' | 'none' };
  'session.started': { resume: boolean };
  'session.ended': { reason: 'normal' | 'archived' | 'deleted' | 'idle' | 'error' | 'unknown' };
  'turn.started': { objectiveLabel?: CanonicalLabel };
  'turn.finished': { outcome: 'completed' | 'partial' | 'failed' | 'interrupted' | 'unknown' };
  'turn.quiescent': { reason: 'native' | 'timeout' | 'permission' | 'no-active-work' | 'unknown' };
  'agent.spawned': {
    role: 'orchestrator' | 'worker' | 'reviewer' | 'researcher' | 'tester' | 'unknown';
    agentKind?: SanitizedToken;
    label?: CanonicalLabel;
    depth: number;
  };
  'agent.state.changed': {
    from?: AgentState;
    to: AgentState;
    reason?: 'tool' | 'permission' | 'delegation' | 'native' | 'timeout' | 'unknown';
  };
  'agent.finished': { outcome: 'completed' | 'failed' | 'cancelled' | 'unknown' };
  'task.created': {
    label?: CanonicalLabel;
    description?: CanonicalDescription;
    status: TaskStatus;
    ordinal?: number;
    fallback: boolean;
  };
  'task.updated': {
    label?: CanonicalLabel;
    description?: CanonicalDescription;
    status?: TaskStatus;
    ordinal?: number;
  };
  'task.assigned': { assigneeAgentId?: Id };
  'task.completion.requested': { requestedStatus: 'completed'; checkpoint: 'native' | 'derived' };
  'task.completed': { completion: 'observed' | 'derived' };
  'task.failed': { category?: 'tool' | 'validation' | 'agent' | 'unknown' };
  'task.denied': { reason: 'permission' | 'policy' | 'unknown' };
  'task.cancelled': { reason?: 'replanned' | 'user' | 'superseded' | 'unknown' };
  'task.abandoned': { reason: 'timeout' | 'session-ended' | 'telemetry-gap' | 'unknown' };
  'task.corrected': TaskCorrectionData;
  'task.plan.reconciled': PlanReconciledData;
  'tool.requested': { name: CanonicalToolName; category: ToolCategory; parallelGroupId?: Id };
  'tool.started': { name: CanonicalToolName; category: ToolCategory; parallelGroupId?: Id };
  'tool.completed': {
    name: CanonicalToolName;
    category: ToolCategory;
    durationMs?: number;
    resultClass?: 'success' | 'partial' | 'unknown';
  };
  'tool.failed': {
    name: CanonicalToolName;
    category: ToolCategory;
    durationMs?: number;
    failureClass: 'exit_nonzero' | 'timeout' | 'denied' | 'cancelled' | 'exception' | 'unknown';
  };
  'permission.requested': {
    category: ToolCategory;
    riskClass?: 'read' | 'write' | 'network' | 'execute' | 'destructive' | 'unknown';
  };
  'permission.resolved': { outcome: 'allowed' | 'denied' | 'cancelled' | 'timed_out' | 'unknown' };
};

export interface PlanTask {
  readonly taskId: Id;
  readonly status: TaskStatus;
  readonly ordinal: number;
  readonly label?: CanonicalLabel;
  readonly identityBasis:
    'stable-native-id' | 'exact-normalized-identity' | 'exact-ordinal-continuity' | 'new-unmatched';
}

export type TaskCorrectionData =
  | {
      readonly correction: 'reopen';
      readonly correctedEventId: Id;
      readonly correctedEntityId: Id;
      readonly status: NonTerminalTaskStatus;
    }
  | {
      [Status in TerminalTaskStatus]: {
        readonly correction: 'replace-outcome';
        readonly correctedEventId: Id;
        readonly correctedEntityId: Id;
        readonly status: Status;
        readonly resultingOutcome: TerminalOutcomeForStatus<Status>;
      };
    }[TerminalTaskStatus];

declare const planRevisionBrand: unique symbol;
export type PlanRevision = {
  readonly revision: number;
  readonly previousRevision: number;
  readonly [planRevisionBrand]: true;
};

/** Creates the branded exact-predecessor pair required by later plan revisions. */
export function planRevision(revision: number, previousRevision: number): PlanRevision {
  if (
    !numberIsSafeInteger(revision) ||
    revision < 2 ||
    !numberIsSafeInteger(previousRevision) ||
    previousRevision !== revision - 1
  )
    throw new Error('invalid plan revision');
  return freeze({ revision, previousRevision }) as PlanRevision;
}

export type PlanReconciledData =
  | {
      readonly revision: 1;
      readonly previousRevision?: never;
      readonly complete: true;
      readonly items: readonly PlanTask[];
    }
  | (PlanRevision & { readonly complete: true; readonly items: readonly PlanTask[] });

/** Terminal state may transfer only when the identity evidence is exact and durable. */
export function canTransferTerminalState(identityBasis: PlanTask['identityBasis']): boolean {
  return identityBasis === 'stable-native-id' || identityBasis === 'exact-normalized-identity';
}

export type CoreEventType = keyof DataMap;
type RequiredScopeByEvent = {
  'source.connected': 'sessionId';
  'source.capability.changed': 'sessionId';
  'source.heartbeat': 'sessionId';
  'source.disconnected': 'sessionId';
  'telemetry.gap': 'sessionId';
  'workspace.discovered': 'sessionId';
  'session.started': 'sessionId';
  'session.ended': 'sessionId';
  'turn.started': 'sessionId' | 'turnId';
  'turn.finished': 'sessionId' | 'turnId';
  'turn.quiescent': 'sessionId' | 'turnId';
  'agent.spawned': 'sessionId' | 'agentId';
  'agent.state.changed': 'sessionId' | 'agentId';
  'agent.finished': 'sessionId' | 'agentId';
  'task.created': 'sessionId' | 'taskId';
  'task.updated': 'sessionId' | 'taskId';
  'task.assigned': 'sessionId' | 'taskId';
  'task.completion.requested': 'sessionId' | 'taskId';
  'task.completed': 'sessionId' | 'taskId';
  'task.failed': 'sessionId' | 'taskId';
  'task.denied': 'sessionId' | 'taskId';
  'task.cancelled': 'sessionId' | 'taskId';
  'task.abandoned': 'sessionId' | 'taskId';
  'task.corrected': 'sessionId' | 'taskId';
  'task.plan.reconciled': 'sessionId' | 'turnId';
  'tool.requested': 'sessionId' | 'operationId';
  'tool.started': 'sessionId' | 'operationId';
  'tool.completed': 'sessionId' | 'operationId';
  'tool.failed': 'sessionId' | 'operationId';
  'permission.requested': 'sessionId' | 'permissionId';
  'permission.resolved': 'sessionId' | 'permissionId';
};
type ScopeFor<T extends CoreEventType> = EventScope &
  Required<Pick<EventScope, RequiredScopeByEvent[T] | 'workspaceId' | 'sessionId'>>;
type CoreEventEnvelope<T extends CoreEventType> = {
  readonly spec: typeof protocolId;
  readonly version: ProtocolVersion;
  readonly eventId: Id;
  readonly type: T;
  readonly occurredAt: string;
  readonly observedAt: string;
  readonly sequence: number;
  readonly source: SourceIdentity;
  readonly scope: ScopeFor<T>;
  readonly links?: EventLinks;
  readonly fidelity: Fidelity;
  readonly finality: T extends 'task.completion.requested'
    ? 'provisional'
    : T extends
          | 'source.capability.changed'
          | 'task.completed'
          | 'task.failed'
          | 'task.denied'
          | 'task.cancelled'
          | 'task.abandoned'
          | 'task.corrected'
      ? 'confirmed'
      : Finality;
};
type SemanticProperty<T extends CoreEventType> = T extends SemanticRequiredEventType
  ? { readonly semantic: SemanticFor<T> }
  : { readonly semantic?: SemanticFor<T> };
export type CoreEventPayload<T extends CoreEventType> = T extends 'task.corrected'
  ? | {
        readonly data: Extract<TaskCorrectionData, { correction: 'reopen' }>;
        readonly semantic: Extract<RequiredSemantic, { kind: 'correction' }>;
      }
    | {
        [Status in TerminalTaskStatus]: {
          readonly data: Extract<
            TaskCorrectionData,
            { correction: 'replace-outcome'; status: Status }
          >;
          readonly semantic: OutcomeSemantic<TerminalOutcomeForStatus<Status>>;
        };
      }[TerminalTaskStatus]
  : { readonly data: DataMap[T] } & SemanticProperty<T>;
export type CoreEvent<T extends CoreEventType = CoreEventType> = CoreEventEnvelope<T> &
  CoreEventPayload<T>;
export type AnyCoreEvent = { [T in CoreEventType]: CoreEvent<T> }[CoreEventType];

/** Stable diagnostic-code registry used by documentation and integrations. */
export const protocolDiagnosticCodes = freeze([
  'invalid-envelope',
  'invalid-scope',
  'invalid-data',
  'event-too-large',
  'event-too-deep',
  'unsupported-major',
  'invalid-version',
  'unknown-event',
  'invalid-extension',
  'extension-preserved',
] as const);
export type ProtocolDiagnosticCode = (typeof protocolDiagnosticCodes)[number];

export interface ProtocolDiagnostic {
  readonly code: ProtocolDiagnosticCode;
  readonly severity: 'error' | 'warning';
  readonly field?:
    | 'spec'
    | 'version'
    | 'eventId'
    | 'type'
    | 'timestamps'
    | 'sequence'
    | 'source'
    | 'scope'
    | 'fidelity'
    | 'finality'
    | 'data'
    | 'size'
    | 'depth'
    | 'extension';
  readonly eventType?: CoreEventType;
  readonly protocolMajor?: number;
}

export type ValidationResult =
  | { readonly status: 'accepted'; readonly event: AnyCoreEvent; readonly diagnostics: readonly [] }
  | {
      readonly status: 'preserved-extension';
      readonly event: ExtensionEvent;
      readonly diagnostics: readonly [ExtensionPreservedDiagnostic];
    }
  | {
      readonly status: 'rejected' | 'quarantined';
      readonly diagnostics: readonly [ProtocolDiagnostic, ...ProtocolDiagnostic[]];
    };

export interface ExtensionPreservedDiagnostic extends ProtocolDiagnostic {
  readonly code: 'extension-preserved';
  readonly severity: 'warning';
  readonly field: 'type';
}

// Keep this list explicit: it is the public discriminant registry and its order is stable.
const coreTypes: readonly CoreEventType[] = [
  'source.connected',
  'source.capability.changed',
  'source.heartbeat',
  'source.disconnected',
  'telemetry.gap',
  'workspace.discovered',
  'session.started',
  'session.ended',
  'turn.started',
  'turn.finished',
  'turn.quiescent',
  'agent.spawned',
  'agent.state.changed',
  'agent.finished',
  'task.created',
  'task.updated',
  'task.assigned',
  'task.completion.requested',
  'task.completed',
  'task.failed',
  'task.denied',
  'task.cancelled',
  'task.abandoned',
  'task.corrected',
  'task.plan.reconciled',
  'tool.requested',
  'tool.started',
  'tool.completed',
  'tool.failed',
  'permission.requested',
  'permission.resolved',
];
const scopeRules: Record<CoreEventType, readonly (keyof EventScope)[]> = {
  'source.connected': ['sessionId'],
  'source.capability.changed': ['sessionId'],
  'source.heartbeat': ['sessionId'],
  'source.disconnected': ['sessionId'],
  'telemetry.gap': ['sessionId'],
  'workspace.discovered': ['sessionId'],
  'session.started': ['sessionId'],
  'session.ended': ['sessionId'],
  'turn.started': ['sessionId', 'turnId'],
  'turn.finished': ['sessionId', 'turnId'],
  'turn.quiescent': ['sessionId', 'turnId'],
  'agent.spawned': ['sessionId', 'agentId'],
  'agent.state.changed': ['sessionId', 'agentId'],
  'agent.finished': ['sessionId', 'agentId'],
  'task.created': ['sessionId', 'taskId'],
  'task.updated': ['sessionId', 'taskId'],
  'task.assigned': ['sessionId', 'taskId'],
  'task.completion.requested': ['sessionId', 'taskId'],
  'task.completed': ['sessionId', 'taskId'],
  'task.failed': ['sessionId', 'taskId'],
  'task.denied': ['sessionId', 'taskId'],
  'task.cancelled': ['sessionId', 'taskId'],
  'task.abandoned': ['sessionId', 'taskId'],
  'task.corrected': ['sessionId', 'taskId'],
  'task.plan.reconciled': ['sessionId', 'turnId'],
  'tool.requested': ['sessionId', 'operationId'],
  'tool.started': ['sessionId', 'operationId'],
  'tool.completed': ['sessionId', 'operationId'],
  'tool.failed': ['sessionId', 'operationId'],
  'permission.requested': ['sessionId', 'permissionId'],
  'permission.resolved': ['sessionId', 'permissionId'],
};

const idSchema = {
  type: 'string',
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$',
};
const opaqueTextSchema = {
  type: 'string',
  minLength: 1,
  maxLength: 256,
  pattern: '^[^\\u0000-\\u001f\\u007f]+$',
};
const descriptionSchema = { ...opaqueTextSchema, maxLength: 2048 };
const sanitizedTokenSchema = {
  type: 'string',
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$',
};
const textSchema = opaqueTextSchema;
const semverPattern =
  '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$';
const integerSchema = { type: 'integer', minimum: 0, maximum: numberMaxSafeInteger };
const enumSchema = (values: readonly string[]) => ({ type: 'string', enum: values });
const supportSchema = enumSchema(['none', 'derived', 'observed']);
const signalCapabilitySchema = {
  type: 'object',
  additionalProperties: true,
  required: ['availability', 'evidenceQuality', 'coverage', 'finality', 'exclusions'],
  properties: {
    availability: enumSchema(['unsupported', 'partial', 'available']),
    evidenceQuality: supportSchema,
    coverage: enumSchema(['none', 'partial', 'full']),
    finality: enumSchema(['provisional', 'confirmed', 'mixed']),
    exclusions: {
      type: 'array',
      maxItems: 32,
      items: {
        type: 'object',
        additionalProperties: true,
        required: ['code'],
        properties: {
          code: enumSchema([
            'hosted-tools',
            'manual-denials',
            'deny-rules',
            'missing-correlation',
            'session-configuration',
            'unknown',
          ]),
          scope: enumSchema(['platform', 'session', 'signal']),
        },
      },
    },
  },
};
const capabilityMatrixSchema = {
  oneOf: [
    {
      type: 'object',
      properties: {
        availability: { const: 'unsupported' },
        evidenceQuality: { const: 'none' },
        coverage: { const: 'none' },
        finality: { const: 'provisional' },
        exclusions: {},
      },
      required: ['availability', 'evidenceQuality', 'coverage', 'finality', 'exclusions'],
    },
    {
      type: 'object',
      properties: {
        availability: { const: 'partial' },
        evidenceQuality: { enum: ['observed', 'derived'] },
        coverage: { const: 'partial' },
        finality: { enum: ['provisional', 'confirmed', 'mixed'] },
        exclusions: {},
      },
      required: ['availability', 'coverage', 'exclusions'],
      allOf: [
        {
          type: 'object',
          properties: { exclusions: { type: 'array', minItems: 1 } },
        },
      ],
    },
    {
      type: 'object',
      properties: {
        availability: { const: 'available' },
        evidenceQuality: { enum: ['observed', 'derived'] },
        coverage: { const: 'full' },
        finality: { enum: ['confirmed', 'mixed'] },
        exclusions: {},
      },
      required: ['availability', 'evidenceQuality', 'coverage', 'finality', 'exclusions'],
    },
  ],
};
const signalCapabilityWithMatrixSchema = {
  ...signalCapabilitySchema,
  allOf: [capabilityMatrixSchema],
};
const capabilitySchema = {
  type: 'object',
  additionalProperties: true,
  required: ['revision', 'effectiveSequence', 'platform', 'session', 'signals', 'exclusions'],
  properties: {
    revision: integerSchema,
    effectiveSequence: integerSchema,
    platform: {
      type: 'object',
      additionalProperties: true,
      required: ['agentKind'],
      properties: {
        agentKind: sanitizedTokenSchema,
        agentVersion: { ...textSchema, pattern: semverPattern },
        configId: idSchema,
      },
    },
    session: {
      type: 'object',
      additionalProperties: true,
      required: ['mode'],
      properties: {
        mode: enumSchema(['interactive', 'non-interactive', 'unknown']),
        configurationId: idSchema,
      },
    },
    signals: {
      type: 'object',
      additionalProperties: true,
      required: ['sessions', 'turns', 'tasks', 'taskPlan', 'agents', 'tools', 'permissions'],
      properties: {
        sessions: signalCapabilityWithMatrixSchema,
        turns: signalCapabilityWithMatrixSchema,
        tasks: signalCapabilityWithMatrixSchema,
        taskPlan: signalCapabilityWithMatrixSchema,
        agents: signalCapabilityWithMatrixSchema,
        tools: signalCapabilityWithMatrixSchema,
        permissions: signalCapabilityWithMatrixSchema,
      },
    },
    exclusions: {
      type: 'array',
      maxItems: 32,
      items: {
        type: 'object',
        additionalProperties: true,
        required: ['code'],
        properties: {
          code: enumSchema([
            'hosted-tools',
            'manual-denials',
            'deny-rules',
            'missing-correlation',
            'session-configuration',
            'unknown',
          ]),
          scope: enumSchema(['platform', 'session', 'signal']),
        },
      },
    },
  },
};
const dataProps: Record<CoreEventType, Record<string, unknown>> = {
  'source.connected': {
    agentKind: sanitizedTokenSchema,
    agentVersion: { ...textSchema, pattern: semverPattern },
    capabilities: capabilitySchema,
  },
  'source.capability.changed': {
    capabilities: capabilitySchema,
    previousRevision: integerSchema,
    effectiveSequence: integerSchema,
  },
  'source.heartbeat': { uptimeMs: integerSchema },
  'source.disconnected': { reason: enumSchema(['normal', 'timeout', 'error', 'unknown']) },
  'telemetry.gap': {
    fromSequence: integerSchema,
    toSequence: integerSchema,
    reason: enumSchema([
      'dropped',
      'corrupt',
      'out-of-order-timeout',
      'adapter-restart',
      'unknown',
    ]),
  },
  'workspace.discovered': { label: textSchema, vcs: enumSchema(['git', 'other', 'none']) },
  'session.started': { resume: { type: 'boolean' } },
  'session.ended': {
    reason: enumSchema(['normal', 'archived', 'deleted', 'idle', 'error', 'unknown']),
  },
  'turn.started': { objectiveLabel: textSchema },
  'turn.finished': {
    outcome: enumSchema(['completed', 'partial', 'failed', 'interrupted', 'unknown']),
  },
  'turn.quiescent': {
    reason: enumSchema(['native', 'timeout', 'permission', 'no-active-work', 'unknown']),
  },
  'agent.spawned': {
    role: enumSchema(['orchestrator', 'worker', 'reviewer', 'researcher', 'tester', 'unknown']),
    agentKind: sanitizedTokenSchema,
    label: textSchema,
    depth: { ...integerSchema, maximum: MAX_JSON_DEPTH },
  },
  'agent.state.changed': {
    from: enumSchema([
      'starting',
      'working',
      'waiting',
      'blocked',
      'finishing',
      'finished',
      'failed',
    ]),
    to: enumSchema([
      'starting',
      'working',
      'waiting',
      'blocked',
      'finishing',
      'finished',
      'failed',
    ]),
    reason: enumSchema(['tool', 'permission', 'delegation', 'native', 'timeout', 'unknown']),
  },
  'agent.finished': { outcome: enumSchema(['completed', 'failed', 'cancelled', 'unknown']) },
  'task.created': {
    label: textSchema,
    description: descriptionSchema,
    status: enumSchema([
      'pending',
      'in_progress',
      'blocked',
      'completed',
      'failed',
      'denied',
      'cancelled',
      'abandoned',
      'unknown',
    ]),
    ordinal: integerSchema,
    fallback: { type: 'boolean' },
  },
  'task.updated': {
    label: textSchema,
    description: descriptionSchema,
    status: enumSchema([
      'pending',
      'in_progress',
      'blocked',
      'completed',
      'failed',
      'denied',
      'cancelled',
      'abandoned',
      'unknown',
    ]),
    ordinal: integerSchema,
  },
  'task.assigned': { assigneeAgentId: idSchema },
  'task.completion.requested': {
    requestedStatus: enumSchema(['completed']),
    checkpoint: enumSchema(['native', 'derived']),
  },
  'task.completed': { completion: enumSchema(['observed', 'derived']) },
  'task.failed': { category: enumSchema(['tool', 'validation', 'agent', 'unknown']) },
  'task.denied': { reason: enumSchema(['permission', 'policy', 'unknown']) },
  'task.cancelled': { reason: enumSchema(['replanned', 'user', 'superseded', 'unknown']) },
  'task.abandoned': {
    reason: enumSchema(['timeout', 'session-ended', 'telemetry-gap', 'unknown']),
  },
  'task.corrected': {
    correction: enumSchema(['reopen', 'replace-outcome']),
    correctedEventId: idSchema,
    correctedEntityId: idSchema,
    status: enumSchema([
      'pending',
      'in_progress',
      'blocked',
      'completed',
      'failed',
      'denied',
      'cancelled',
      'abandoned',
      'unknown',
    ]),
    resultingOutcome: enumSchema([
      'success',
      'failure',
      'denied',
      'cancelled',
      'abandoned',
      'unknown',
    ]),
  },
  'task.plan.reconciled': {
    revision: integerSchema,
    previousRevision: integerSchema,
    complete: { const: true },
    items: {
      type: 'array',
      maxItems: 1024,
      items: {
        type: 'object',
        additionalProperties: true,
        required: ['taskId', 'status', 'ordinal', 'identityBasis'],
        properties: {
          taskId: idSchema,
          status: enumSchema([
            'pending',
            'in_progress',
            'blocked',
            'completed',
            'failed',
            'denied',
            'cancelled',
            'abandoned',
            'unknown',
          ]),
          ordinal: integerSchema,
          label: textSchema,
          identityBasis: enumSchema([
            'stable-native-id',
            'exact-normalized-identity',
            'exact-ordinal-continuity',
            'new-unmatched',
          ]),
        },
      },
    },
  },
  'tool.requested': {
    name: sanitizedTokenSchema,
    category: enumSchema([
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
    ]),
    parallelGroupId: idSchema,
  },
  'tool.started': {
    name: sanitizedTokenSchema,
    category: enumSchema([
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
    ]),
    parallelGroupId: idSchema,
  },
  'tool.completed': {
    name: sanitizedTokenSchema,
    category: enumSchema([
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
    ]),
    durationMs: integerSchema,
    resultClass: enumSchema(['success', 'partial', 'unknown']),
  },
  'tool.failed': {
    name: sanitizedTokenSchema,
    category: enumSchema([
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
    ]),
    durationMs: integerSchema,
    failureClass: enumSchema([
      'exit_nonzero',
      'timeout',
      'denied',
      'cancelled',
      'exception',
      'unknown',
    ]),
  },
  'permission.requested': {
    category: enumSchema([
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
    ]),
    riskClass: enumSchema(['read', 'write', 'network', 'execute', 'destructive', 'unknown']),
  },
  'permission.resolved': {
    outcome: enumSchema(['allowed', 'denied', 'cancelled', 'timed_out', 'unknown']),
  },
};
const requiredData: Partial<Record<CoreEventType, readonly string[]>> = {
  'source.connected': ['agentKind', 'capabilities'],
  'source.capability.changed': ['capabilities', 'previousRevision', 'effectiveSequence'],
  'source.heartbeat': ['uptimeMs'],
  'source.disconnected': ['reason'],
  'telemetry.gap': ['reason'],
  'session.started': ['resume'],
  'session.ended': ['reason'],
  'turn.finished': ['outcome'],
  'turn.quiescent': ['reason'],
  'agent.spawned': ['role', 'depth'],
  'agent.state.changed': ['to'],
  'agent.finished': ['outcome'],
  'task.created': ['status', 'fallback'],
  'task.completion.requested': ['requestedStatus', 'checkpoint'],
  'task.completed': ['completion'],
  'task.denied': ['reason'],
  'task.abandoned': ['reason'],
  'task.corrected': ['correction', 'correctedEventId', 'correctedEntityId', 'status'],
  'task.plan.reconciled': ['revision', 'complete', 'items'],
  'tool.requested': ['name', 'category'],
  'tool.started': ['name', 'category'],
  'tool.completed': ['name', 'category'],
  'tool.failed': ['name', 'category', 'failureClass'],
  'permission.requested': ['category'],
  'permission.resolved': ['outcome'],
};

/** Custom keywords emitted by the protocol schemas for constraints JSON Schema cannot express. */
export const protocolSchemaKeywordNames = {
  planRevision: 'x-codeinvaders-plan-revision',
  correctionReferences: 'x-codeinvaders-correction-references',
  capabilityCoherence: 'x-codeinvaders-capability-coherence',
  planItems: 'x-codeinvaders-plan-items',
  noTimeoutSuccess: 'x-codeinvaders-no-timeout-success',
  schemaKeywords: 'x-codeinvaders-schema-keywords',
  limits: 'x-codeinvaders-limits',
  compatibility: 'x-codeinvaders-compatibility',
  requiredScope: 'x-codeinvaders-required-scope',
} as const;
export const protocolSchemaKeywordDocumentation = {
  [protocolSchemaKeywordNames.planRevision]:
    'Revision one omits previousRevision; later revisions require previousRevision === revision - 1.',
  [protocolSchemaKeywordNames.correctionReferences]:
    'A reopen correction requires semantic correction references to equal its data references.',
  [protocolSchemaKeywordNames.capabilityCoherence]:
    'Connected capabilities start at revision one and use the event sequence; capability changes use the event sequence and exact revision predecessor.',
  [protocolSchemaKeywordNames.planItems]:
    'Plan items have unique task IDs, zero-based contiguous ordered ordinals, and never transfer terminal state through ordinal-only or new identities.',
  [protocolSchemaKeywordNames.noTimeoutSuccess]:
    'An outcome with success may not use timeout as its semantic basis.',
  [protocolSchemaKeywordNames.schemaKeywords]:
    'Registry of executable and annotation keywords used by the exported schemas.',
  [protocolSchemaKeywordNames.limits]:
    'Documented protocol size and depth limits enforced at the validation boundary.',
  [protocolSchemaKeywordNames.compatibility]:
    'Documented forward-compatibility behavior for optional fields and extension events.',
  [protocolSchemaKeywordNames.requiredScope]:
    'The event-specific scope fields required by the protocol schema.',
} as const;

/** The Ajv surface needed to register the protocol's executable schema keywords. */
export interface ProtocolSchemaCompiler {
  addKeyword(definition: KeywordDefinition): unknown;
  getKeyword(keyword: string): unknown;
}

function isKeywordRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !arrayIsArray(value);
}

function hasOwn(value: Record<string, unknown>, property: string): boolean {
  return hasOwnProperty(value, property);
}

function tryDefineOwnProperty(
  target: object,
  property: PropertyKey,
  descriptor: PropertyDescriptor,
): boolean {
  try {
    if (protocolIntrinsicsReady) {
      reflectApply(objectDefineProperty, undefined, [target, property, descriptor]);
      return true;
    }
    if (!('value' in descriptor) || typeof property !== 'string') return false;
    (target as Record<string, unknown>)[property] = descriptor.value;
    return true;
  } catch {
    return false;
  }
}

function defineOwnArraySlot<T>(array: T[], index: number, value: T): void {
  tryDefineOwnProperty(array, stringConstructor(index), {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

function readOwnArraySlot<T>(array: readonly T[], index: number): T | undefined {
  if (!protocolIntrinsicsReady) {
    try {
      return array[index];
    } catch {
      return undefined;
    }
  }
  const descriptor = objectGetOwnPropertyDescriptor(array, stringConstructor(index));
  return descriptor !== undefined && 'value' in descriptor ? (descriptor.value as T) : undefined;
}

function containsString(values: readonly string[], needle: string): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (readOwnArraySlot(values, index) === needle) return true;
  }
  return false;
}

const validPlanStatuses = new setConstructor<string>();
validPlanStatuses.add('pending');
validPlanStatuses.add('in_progress');
validPlanStatuses.add('blocked');
validPlanStatuses.add('completed');
validPlanStatuses.add('failed');
validPlanStatuses.add('denied');
validPlanStatuses.add('cancelled');
validPlanStatuses.add('abandoned');
validPlanStatuses.add('unknown');
const validPlanIdentityBases = new setConstructor<string>();
validPlanIdentityBases.add('stable-native-id');
validPlanIdentityBases.add('exact-normalized-identity');
validPlanIdentityBases.add('exact-ordinal-continuity');
validPlanIdentityBases.add('new-unmatched');
const terminalPlanStatuses = new setConstructor<string>();
terminalPlanStatuses.add('completed');
terminalPlanStatuses.add('failed');
terminalPlanStatuses.add('denied');
terminalPlanStatuses.add('cancelled');
terminalPlanStatuses.add('abandoned');
terminalPlanStatuses.add('unknown');
const protocolIdPatternSource = '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$';
const protocolIdPattern =
  regExpConstructor === undefined ? undefined : new regExpConstructor(protocolIdPatternSource);

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && numberIsSafeInteger(value) && value >= 0;
}

/** Returns true for malformed data so ordinary JSON Schema validation owns type errors. */
function validateCapabilityCoherenceKeyword(mode: unknown, value: unknown): boolean {
  if (
    (mode !== 'connected' && mode !== 'changed') ||
    !isKeywordRecord(value) ||
    !isSafeNonNegativeInteger(value.sequence) ||
    !isKeywordRecord(value.data) ||
    !isKeywordRecord(value.data.capabilities)
  )
    return true;

  const data = value.data;
  const capabilities = value.data.capabilities;
  if (
    !isKeywordRecord(capabilities) ||
    !isSafeNonNegativeInteger(capabilities.revision) ||
    !isSafeNonNegativeInteger(capabilities.effectiveSequence)
  )
    return true;

  if (mode === 'connected')
    return capabilities.revision === 1 && capabilities.effectiveSequence === value.sequence;

  if (
    !isSafeNonNegativeInteger(data.previousRevision) ||
    !isSafeNonNegativeInteger(data.effectiveSequence)
  )
    return true;
  return (
    data.previousRevision >= 1 &&
    capabilities.revision === data.previousRevision + 1 &&
    data.effectiveSequence === value.sequence &&
    capabilities.effectiveSequence === data.effectiveSequence
  );
}

/** Returns true for malformed data so ordinary JSON Schema validation owns type errors. */
function validatePlanItemsKeyword(schema: boolean, value: unknown): boolean {
  if (!schema || !isKeywordRecord(value) || !arrayIsArray(value.items)) return true;

  const items = value.items;
  const parsedItems: Array<{
    taskId: string;
    status: string;
    ordinal: number;
    identityBasis: PlanTask['identityBasis'];
  }> = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = readOwnArraySlot(items, index);
    if (
      !isKeywordRecord(item) ||
      typeof item.taskId !== 'string' ||
      !safeRegExpTest(protocolIdPattern, item.taskId) ||
      typeof item.status !== 'string' ||
      !validPlanStatuses.has(item.status) ||
      !isSafeNonNegativeInteger(item.ordinal) ||
      typeof item.identityBasis !== 'string' ||
      !validPlanIdentityBases.has(item.identityBasis)
    )
      return true;
    defineOwnArraySlot(parsedItems, parsedItems.length, {
      taskId: item.taskId,
      status: item.status,
      ordinal: item.ordinal,
      identityBasis: item.identityBasis as PlanTask['identityBasis'],
    });
  }

  const ids = new setConstructor<string>();
  for (let index = 0; index < parsedItems.length; index += 1) {
    const item = readOwnArraySlot(parsedItems, index);
    if (!item) return true;
    if (
      ids.has(item.taskId) ||
      item.ordinal !== PLAN_ORDINAL_BASE + index ||
      (terminalPlanStatuses.has(item.status) && !canTransferTerminalState(item.identityBasis))
    )
      return false;
    ids.add(item.taskId);
  }
  return true;
}

/** Returns true for malformed data so ordinary JSON Schema validation owns type errors. */
function validateNoTimeoutSuccessKeyword(schema: boolean, value: unknown): boolean {
  if (!schema || !isKeywordRecord(value) || !isKeywordRecord(value.semantic)) return true;
  const semantic = value.semantic;
  if (semantic.kind !== 'outcome' || semantic.outcome !== 'success' || semantic.basis !== 'timeout')
    return true;
  return false;
}

function validatePlanRevisionKeyword(schema: boolean, value: unknown): boolean {
  if (!schema || !isKeywordRecord(value)) return true;
  const revision = value.revision;
  if (revision === 1) {
    if (!hasOwn(value, 'previousRevision')) return true;
    const previousRevision = value.previousRevision;
    return typeof previousRevision !== 'number' || !numberIsSafeInteger(previousRevision);
  }
  if (typeof revision !== 'number' || !numberIsSafeInteger(revision) || revision < 2) return true;
  if (!hasOwn(value, 'previousRevision')) return false;
  const previousRevision = value.previousRevision;
  if (
    typeof previousRevision !== 'number' ||
    !numberIsSafeInteger(previousRevision) ||
    previousRevision < 0
  )
    return true;
  return previousRevision === revision - 1;
}

function validateCorrectionReferencesKeyword(schema: boolean, value: unknown): boolean {
  if (!schema || !isKeywordRecord(value)) return true;
  const data = value.data;
  const semantic = value.semantic;
  if (!isKeywordRecord(data) || data.correction !== 'reopen' || !isKeywordRecord(semantic))
    return true;
  if (!hasOwn(semantic, 'correctionOfEventId') || !hasOwn(semantic, 'correctionOfEntityId'))
    return true;
  if (
    typeof data.correctedEventId !== 'string' ||
    !safeRegExpTest(protocolIdPattern, data.correctedEventId) ||
    typeof data.correctedEntityId !== 'string' ||
    !safeRegExpTest(protocolIdPattern, data.correctedEntityId) ||
    typeof semantic.correctionOfEventId !== 'string' ||
    !safeRegExpTest(protocolIdPattern, semantic.correctionOfEventId) ||
    typeof semantic.correctionOfEntityId !== 'string' ||
    !safeRegExpTest(protocolIdPattern, semantic.correctionOfEntityId)
  )
    return true;
  return (
    semantic.correctionOfEventId === data.correctedEventId &&
    semantic.correctionOfEntityId === data.correctedEntityId
  );
}

const planRevisionKeyword: KeywordDefinition = {
  keyword: protocolSchemaKeywordNames.planRevision,
  type: 'object',
  schemaType: 'boolean',
  errors: false,
  validate: validatePlanRevisionKeyword,
};
const correctionReferencesKeyword: KeywordDefinition = {
  keyword: protocolSchemaKeywordNames.correctionReferences,
  type: 'object',
  schemaType: 'boolean',
  errors: false,
  validate: validateCorrectionReferencesKeyword,
};

const capabilityCoherenceKeyword: KeywordDefinition = {
  keyword: protocolSchemaKeywordNames.capabilityCoherence,
  type: 'object',
  schemaType: 'string',
  errors: false,
  validate: validateCapabilityCoherenceKeyword,
};
const planItemsKeyword: KeywordDefinition = {
  keyword: protocolSchemaKeywordNames.planItems,
  type: 'object',
  schemaType: 'boolean',
  errors: false,
  validate: validatePlanItemsKeyword,
};
const noTimeoutSuccessKeyword: KeywordDefinition = {
  keyword: protocolSchemaKeywordNames.noTimeoutSuccess,
  type: 'object',
  schemaType: 'boolean',
  errors: false,
  validate: validateNoTimeoutSuccessKeyword,
};
const annotationKeywords: readonly KeywordDefinition[] = [
  { keyword: protocolSchemaKeywordNames.schemaKeywords, valid: true },
  { keyword: protocolSchemaKeywordNames.limits, valid: true },
  { keyword: protocolSchemaKeywordNames.compatibility, valid: true },
  { keyword: protocolSchemaKeywordNames.requiredScope, valid: true },
];
const functionalKeywords: readonly KeywordDefinition[] = [
  planRevisionKeyword,
  correctionReferencesKeyword,
  capabilityCoherenceKeyword,
  planItemsKeyword,
  noTimeoutSuccessKeyword,
];
const allProtocolKeywords: KeywordDefinition[] = new arrayConstructor(
  functionalKeywords.length + annotationKeywords.length,
);
for (let index = 0; index < functionalKeywords.length; index += 1) {
  const definition = readOwnArraySlot(functionalKeywords, index);
  if (definition === undefined) throw new Error('invalid protocol keyword registry');
  defineOwnArraySlot(allProtocolKeywords, index, definition);
}
for (let index = 0; index < annotationKeywords.length; index += 1) {
  const definition = readOwnArraySlot(annotationKeywords, index);
  if (definition === undefined) throw new Error('invalid protocol keyword registry');
  defineOwnArraySlot(allProtocolKeywords, functionalKeywords.length + index, definition);
}

// AJV's generated validators call executable keyword functions through their
// `.call` property. Give those functions an own, immutable-at-runtime target
// so a later Function.prototype.call replacement cannot redirect validation.
function captureAjvKeywordCall(target: object): void {
  tryDefineOwnProperty(target, 'call', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: functionCall,
  });
}

captureAjvKeywordCall(validatePlanRevisionKeyword);
captureAjvKeywordCall(validateCorrectionReferencesKeyword);
captureAjvKeywordCall(validateCapabilityCoherenceKeyword);
captureAjvKeywordCall(validatePlanItemsKeyword);
captureAjvKeywordCall(validateNoTimeoutSuccessKeyword);
const functionalKeywordNames = new setConstructor<string>();
for (let index = 0; index < functionalKeywords.length; index += 1) {
  const definition = readOwnArraySlot(functionalKeywords, index);
  if (definition === undefined) throw new Error('invalid protocol keyword registry');
  if (typeof definition.keyword === 'string') functionalKeywordNames.add(definition.keyword);
  else {
    for (let nameIndex = 0; nameIndex < definition.keyword.length; nameIndex += 1) {
      const name = readOwnArraySlot(definition.keyword, nameIndex);
      if (name === undefined) throw new Error('invalid protocol keyword registry');
      functionalKeywordNames.add(name);
    }
  }
}

/** Register executable and annotation keywords required by every exported protocol schema. */
export function registerProtocolSchemaKeywords(instance: ProtocolSchemaCompiler): void {
  for (let index = 0; index < allProtocolKeywords.length; index += 1) {
    const definition = readOwnArraySlot(allProtocolKeywords, index);
    if (definition === undefined) continue;
    if (typeof definition.keyword === 'string') {
      if (!instance.getKeyword(definition.keyword)) instance.addKeyword(definition);
      continue;
    }
    let missing = false;
    for (let nameIndex = 0; nameIndex < definition.keyword.length; nameIndex += 1) {
      const name = readOwnArraySlot(definition.keyword, nameIndex);
      if (name !== undefined && !instance.getKeyword(name)) missing = true;
    }
    if (missing) instance.addKeyword(definition);
  }
}

const semanticRequired = new setConstructor<CoreEventType>();
semanticRequired.add('source.capability.changed');
semanticRequired.add('telemetry.gap');
semanticRequired.add('turn.quiescent');
semanticRequired.add('task.completion.requested');
semanticRequired.add('task.completed');
semanticRequired.add('task.failed');
semanticRequired.add('task.denied');
semanticRequired.add('task.cancelled');
semanticRequired.add('task.abandoned');
semanticRequired.add('task.corrected');
const terminalOutcomeByStatus = {
  completed: 'success',
  failed: 'failure',
  denied: 'denied',
  cancelled: 'cancelled',
  abandoned: 'abandoned',
  unknown: 'unknown',
} as const satisfies Record<TerminalTaskStatus, TaskOutcome>;
const terminalOutcomeByEvent = {
  'task.completed': 'success',
  'task.failed': 'failure',
  'task.denied': 'denied',
  'task.cancelled': 'cancelled',
  'task.abandoned': 'abandoned',
} as const satisfies Partial<Record<CoreEventType, TaskOutcome>>;
const semanticRules: Partial<Record<CoreEventType, readonly object[]>> = {
  'task.completion.requested': [
    {
      type: 'object',
      properties: {
        finality: { const: 'provisional' },
        semantic: {
          type: 'object',
          required: ['kind', 'terminal'],
          properties: { kind: { const: 'checkpoint' }, terminal: { const: false } },
        },
      },
    },
  ],
  'turn.quiescent': [
    {
      type: 'object',
      properties: {
        semantic: {
          type: 'object',
          required: ['kind', 'terminal'],
          properties: { kind: { const: 'quiescence' }, terminal: { const: false } },
        },
      },
    },
  ],
  'telemetry.gap': [
    {
      type: 'object',
      properties: {
        semantic: {
          type: 'object',
          required: ['kind', 'terminal'],
          properties: { kind: { const: 'gap' }, terminal: { const: false } },
        },
      },
    },
  ],
  'task.completed': [
    {
      type: 'object',
      properties: {
        finality: { const: 'confirmed' },
        semantic: {
          type: 'object',
          properties: {
            kind: { const: 'outcome' },
            terminal: { const: true },
            outcome: { const: terminalOutcomeByEvent['task.completed'] },
          },
          required: ['kind', 'terminal', 'outcome'],
        },
      },
    },
  ],
  'task.failed': [
    {
      type: 'object',
      properties: {
        finality: { const: 'confirmed' },
        semantic: {
          type: 'object',
          properties: {
            kind: { const: 'outcome' },
            terminal: { const: true },
            outcome: { const: terminalOutcomeByEvent['task.failed'] },
          },
          required: ['kind', 'terminal', 'outcome'],
        },
      },
    },
  ],
  'task.denied': [
    {
      type: 'object',
      properties: {
        finality: { const: 'confirmed' },
        semantic: {
          type: 'object',
          properties: {
            kind: { const: 'outcome' },
            terminal: { const: true },
            outcome: { const: terminalOutcomeByEvent['task.denied'] },
          },
          required: ['kind', 'terminal', 'outcome'],
        },
      },
    },
  ],
  'task.cancelled': [
    {
      type: 'object',
      properties: {
        finality: { const: 'confirmed' },
        semantic: {
          type: 'object',
          properties: {
            kind: { const: 'outcome' },
            terminal: { const: true },
            outcome: { const: terminalOutcomeByEvent['task.cancelled'] },
          },
          required: ['kind', 'terminal', 'outcome'],
        },
      },
    },
  ],
  'task.abandoned': [
    {
      type: 'object',
      properties: {
        finality: { const: 'confirmed' },
        semantic: {
          type: 'object',
          properties: {
            kind: { const: 'outcome' },
            terminal: { const: true },
            outcome: { const: terminalOutcomeByEvent['task.abandoned'] },
          },
          required: ['kind', 'terminal', 'outcome'],
        },
      },
    },
  ],
  'source.capability.changed': [
    {
      type: 'object',
      properties: {
        finality: { const: 'confirmed' },
        semantic: {
          type: 'object',
          required: ['kind', 'terminal'],
          properties: { kind: { const: 'capability' }, terminal: { const: false } },
        },
      },
    },
  ],
};
const terminalTaskStatuses: readonly TerminalTaskStatus[] = [
  'completed',
  'failed',
  'denied',
  'cancelled',
  'abandoned',
  'unknown',
];
const taskCorrectedOneOfRules: object[] = new arrayConstructor(terminalTaskStatuses.length + 1);
defineOwnArraySlot(taskCorrectedOneOfRules, 0, {
  type: 'object',
  properties: {
    finality: { const: 'confirmed' },
    data: {
      type: 'object',
      properties: {
        correction: { const: 'reopen' },
        status: enumSchema(['pending', 'in_progress', 'blocked']),
        correctedEventId: {},
        correctedEntityId: {},
      },
      required: ['correction', 'correctedEventId', 'correctedEntityId', 'status'],
      not: {
        type: 'object',
        properties: { resultingOutcome: {} },
        required: ['resultingOutcome'],
      },
    },
    semantic: {
      type: 'object',
      required: ['kind', 'terminal', 'correctionOfEventId', 'correctionOfEntityId'],
      properties: {
        kind: { const: 'correction' },
        terminal: { const: false },
        correctionOfEventId: {},
        correctionOfEntityId: {},
      },
    },
  },
  required: ['finality', 'data', 'semantic'],
});
for (let index = 0; index < terminalTaskStatuses.length; index += 1) {
  const status = readOwnArraySlot(terminalTaskStatuses, index);
  if (status === undefined) throw new Error('invalid terminal task status registry');
  const outcome = terminalOutcomeByStatus[status];
  defineOwnArraySlot(taskCorrectedOneOfRules, index + 1, {
    type: 'object',
    properties: {
      finality: { const: 'confirmed' },
      data: {
        type: 'object',
        properties: {
          correction: { const: 'replace-outcome' },
          status: { const: status },
          resultingOutcome: { const: outcome },
          correctedEventId: {},
          correctedEntityId: {},
        },
        required: [
          'correction',
          'correctedEventId',
          'correctedEntityId',
          'status',
          'resultingOutcome',
        ],
      },
      semantic: {
        type: 'object',
        required: ['kind', 'terminal', 'outcome'],
        properties: {
          kind: { const: 'outcome' },
          terminal: { const: true },
          outcome: { const: outcome },
        },
      },
    },
    required: ['finality', 'data', 'semantic'],
  });
}

const dataRules: Partial<Record<CoreEventType, readonly object[]>> = {
  'source.connected': [
    {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          properties: {
            capabilities: {
              type: 'object',
              required: ['revision'],
              properties: { revision: { const: 1 } },
            },
          },
        },
      },
    },
  ],
  'task.corrected': [
    {
      oneOf: taskCorrectedOneOfRules,
    },
  ],
  'task.plan.reconciled': [
    {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          oneOf: [
            {
              type: 'object',
              properties: { revision: { const: 1 } },
              not: {
                type: 'object',
                properties: { previousRevision: {} },
                required: ['previousRevision'],
              },
            },
            {
              type: 'object',
              properties: {
                revision: { type: 'number', minimum: 2 },
                previousRevision: { type: 'integer', minimum: 1 },
              },
              required: ['revision', 'previousRevision'],
            },
          ],
        },
      },
    },
  ],
};

function requiredEnvelopeProperties(type: CoreEventType): string[] {
  const required = new arrayConstructor<string>(12 + (semanticRequired.has(type) ? 1 : 0));
  defineOwnArraySlot(required, 0, 'spec');
  defineOwnArraySlot(required, 1, 'version');
  defineOwnArraySlot(required, 2, 'eventId');
  defineOwnArraySlot(required, 3, 'type');
  defineOwnArraySlot(required, 4, 'occurredAt');
  defineOwnArraySlot(required, 5, 'observedAt');
  defineOwnArraySlot(required, 6, 'sequence');
  defineOwnArraySlot(required, 7, 'source');
  defineOwnArraySlot(required, 8, 'scope');
  defineOwnArraySlot(required, 9, 'fidelity');
  defineOwnArraySlot(required, 10, 'finality');
  defineOwnArraySlot(required, 11, 'data');
  if (semanticRequired.has(type)) {
    defineOwnArraySlot(required, 12, 'semantic');
  }
  return required;
}

function requiredScopeProperties(type: CoreEventType): string[] {
  const required = new arrayConstructor<string>(1 + scopeRules[type].length);
  defineOwnArraySlot(required, 0, 'workspaceId');
  let length = 1;
  for (let index = 0; index < scopeRules[type].length; index += 1) {
    const property = readOwnArraySlot(scopeRules[type], index);
    if (property === undefined) throw new Error('invalid scope registry');
    if (!containsString(required, property)) {
      defineOwnArraySlot(required, length, property);
      length += 1;
    }
  }
  required.length = length;
  return required;
}

function combinedSchemaRules(
  semantic: readonly object[] | undefined,
  data: readonly object[] | undefined,
): readonly object[] | undefined {
  if (semantic === undefined && data === undefined) return undefined;
  const semanticLength = semantic?.length ?? 0;
  const dataLength = data?.length ?? 0;
  const combined = new arrayConstructor<object>(semanticLength + dataLength);
  let outputIndex = 0;
  for (let index = 0; index < semanticLength; index += 1) {
    const rule = readOwnArraySlot(semantic as readonly object[], index);
    if (rule === undefined) throw new Error('invalid semantic rule registry');
    defineOwnArraySlot(combined, outputIndex, rule);
    outputIndex += 1;
  }
  for (let index = 0; index < dataLength; index += 1) {
    const rule = readOwnArraySlot(data as readonly object[], index);
    if (rule === undefined) throw new Error('invalid data rule registry');
    defineOwnArraySlot(combined, outputIndex, rule);
    outputIndex += 1;
  }
  return combined;
}

const baseSchema = (type: CoreEventType) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${protocolId}/events/${type}`,
  type: 'object',
  additionalProperties: true,
  required: requiredEnvelopeProperties(type),
  properties: {
    spec: { const: protocolId },
    version: { type: 'string', pattern: semverPattern },
    eventId: idSchema,
    type: { const: type },
    occurredAt: { type: 'string', format: 'date-time' },
    observedAt: { type: 'string', format: 'date-time' },
    sequence: integerSchema,
    source: {
      type: 'object',
      additionalProperties: true,
      not: {
        type: 'object',
        properties: { nativeEvent: {} },
        required: ['nativeEvent'],
      },
      required: ['adapterId', 'adapterVersion', 'streamId', 'epochId'],
      properties: {
        adapterId: idSchema,
        adapterVersion: { type: 'string', pattern: semverPattern },
        streamId: idSchema,
        epochId: idSchema,
        nativeToken: sanitizedTokenSchema,
        nativeEvent: textSchema,
      },
    },
    scope: {
      type: 'object',
      additionalProperties: true,
      required: requiredScopeProperties(type),
      properties: {
        workspaceId: idSchema,
        repoId: idSchema,
        sessionId: idSchema,
        turnId: idSchema,
        agentId: idSchema,
        taskId: idSchema,
        operationId: idSchema,
        permissionId: idSchema,
      },
    },
    links: {
      type: 'object',
      additionalProperties: true,
      properties: {
        causationEventId: idSchema,
        parentAgentId: idSchema,
        parentTaskId: idSchema,
        correlationId: idSchema,
      },
    },
    semantic: {
      type: 'object',
      additionalProperties: true,
      required: ['kind', 'terminal'],
      properties: {
        kind: enumSchema([
          'checkpoint',
          'quiescence',
          'outcome',
          'correction',
          'capability',
          'gap',
        ]),
        terminal: { type: 'boolean' },
        outcome: enumSchema(['success', 'failure', 'denied', 'cancelled', 'abandoned', 'unknown']),
        basis: enumSchema([
          'native',
          'derived',
          'timeout',
          'quiescence',
          'reconciliation',
          'correction',
        ]),
        correctionOfEventId: idSchema,
        correctionOfEntityId: idSchema,
      },
    },
    fidelity: enumSchema(['observed', 'derived', 'synthetic']),
    finality: enumSchema(['provisional', 'confirmed']),
    data: {
      type: 'object',
      additionalProperties: true,
      required: requiredData[type] ?? [],
      properties: dataProps[type],
      ...(type === 'task.plan.reconciled'
        ? {
            [protocolSchemaKeywordNames.planRevision]: true,
            [protocolSchemaKeywordNames.planItems]: true,
          }
        : {}),
    },
  },
  ...(combinedSchemaRules(semanticRules[type], dataRules[type]) === undefined
    ? {}
    : { allOf: combinedSchemaRules(semanticRules[type], dataRules[type]) }),
  [protocolSchemaKeywordNames.noTimeoutSuccess]: true,
  ...(type === 'source.connected'
    ? { [protocolSchemaKeywordNames.capabilityCoherence]: 'connected' }
    : type === 'source.capability.changed'
      ? { [protocolSchemaKeywordNames.capabilityCoherence]: 'changed' }
      : {}),
  ...(type === 'task.corrected' ? { [protocolSchemaKeywordNames.correctionReferences]: true } : {}),
  [protocolSchemaKeywordNames.schemaKeywords]: protocolSchemaKeywordDocumentation,
  [protocolSchemaKeywordNames.limits]: {
    maxBytes: MAX_EVENT_BYTES,
    maxDepth: MAX_JSON_DEPTH,
    maxExtensionBytes: MAX_EXTENSION_BYTES,
  },
  [protocolSchemaKeywordNames.compatibility]: {
    unknownOptionalFields: 'ignore',
    unknownExtensionFallback: 'preserve-in-journal',
  },
  [protocolSchemaKeywordNames.requiredScope]: scopeRules[type],
});

const coreEventSchemaRecord = detachedObject<Record<CoreEventType, Record<string, unknown>>>();
for (let index = 0; index < coreTypes.length; index += 1) {
  const type = readOwnArraySlot(coreTypes, index);
  if (type === undefined) throw new Error('invalid core event registry');
  tryDefineOwnProperty(coreEventSchemaRecord, type, {
    configurable: true,
    enumerable: true,
    writable: true,
    value: baseSchema(type),
  });
}
export const coreEventSchemas = coreEventSchemaRecord as Readonly<
  Record<CoreEventType, Record<string, unknown>>
>;
const extensionPatternSource =
  '^x\\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$';
const extensionPattern =
  regExpConstructor === undefined ? undefined : new regExpConstructor(extensionPatternSource);

export interface ExtensionMetadata {
  readonly fallback: 'preserve-in-journal';
  readonly documentation: string;
  readonly [key: string]: unknown;
}

export interface ExtensionEvent {
  readonly spec: typeof protocolId;
  readonly version: ProtocolVersion;
  readonly eventId: Id;
  readonly type: `x.${string}`;
  readonly occurredAt: string;
  readonly observedAt: string;
  readonly sequence: number;
  readonly source: SourceIdentity;
  readonly scope: EventScope;
  readonly links?: EventLinks;
  readonly semantic?: SemanticMetadata;
  readonly fidelity: Fidelity;
  readonly finality: Finality;
  readonly extension: ExtensionMetadata;
  readonly data: Record<string, unknown>;
  readonly [key: string]: unknown;
}

const extensionEventSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${protocolId}/events/extension`,
  type: 'object',
  additionalProperties: true,
  required: [
    'spec',
    'version',
    'eventId',
    'type',
    'occurredAt',
    'observedAt',
    'sequence',
    'source',
    'scope',
    'fidelity',
    'finality',
    'extension',
    'data',
  ],
  properties: {
    spec: { const: protocolId },
    version: { type: 'string', pattern: semverPattern },
    eventId: idSchema,
    type: { type: 'string', pattern: extensionPatternSource },
    occurredAt: { type: 'string', format: 'date-time' },
    observedAt: { type: 'string', format: 'date-time' },
    sequence: integerSchema,
    source: baseSchema('source.connected').properties.source,
    scope: {
      type: 'object',
      additionalProperties: true,
      required: ['workspaceId', 'sessionId'],
      properties: {
        workspaceId: idSchema,
        repoId: idSchema,
        sessionId: idSchema,
        turnId: idSchema,
        agentId: idSchema,
        taskId: idSchema,
        operationId: idSchema,
        permissionId: idSchema,
      },
    },
    links: baseSchema('source.connected').properties.links,
    fidelity: enumSchema(['observed', 'derived', 'synthetic']),
    finality: enumSchema(['provisional', 'confirmed']),
    extension: {
      type: 'object',
      additionalProperties: true,
      required: ['fallback', 'documentation'],
      properties: {
        fallback: { const: 'preserve-in-journal' },
        documentation: { type: 'string', minLength: 1, maxLength: 512 },
      },
    },
    data: { type: 'object', additionalProperties: true },
  },
  [protocolSchemaKeywordNames.noTimeoutSuccess]: true,
  [protocolSchemaKeywordNames.schemaKeywords]: protocolSchemaKeywordDocumentation,
  [protocolSchemaKeywordNames.limits]: {
    maxBytes: MAX_EVENT_BYTES,
    maxDepth: MAX_JSON_DEPTH,
    maxExtensionBytes: MAX_EXTENSION_BYTES,
  },
  [protocolSchemaKeywordNames.compatibility]: {
    unknownOptionalFields: 'ignore',
    unknownExtensionFallback: 'preserve-in-journal',
  },
};
export { extensionEventSchema };

type AjvLike = ProtocolSchemaCompiler & { compile: (schema: object) => ValidateFunction };
const AjvConstructor = Ajv2020Module.default as unknown as new (options: object) => AjvLike;
const addFormats = addFormatsModule.default as unknown as (instance: AjvLike) => void;
interface AjvRuntime {
  readonly ajv: AjvLike;
  readonly validators: Map<CoreEventType, ValidateFunction>;
  readonly extensionValidator: ValidateFunction;
}
let ajvRuntime: AjvRuntime | undefined;
let ajvInitializationFailed = false;

function getAjvRuntime(): AjvRuntime {
  if (ajvRuntime !== undefined) return ajvRuntime;
  if (!protocolIntrinsicsReady) {
    ajvInitializationFailed = true;
    throw new Error('protocol validators unavailable');
  }
  if (ajvInitializationFailed) throw new Error('protocol validators unavailable');
  try {
    const ajv = new AjvConstructor({ strict: false, allErrors: false, validateFormats: true });
    addFormats(ajv);
    registerProtocolSchemaKeywords(ajv);
    const validators = new mapConstructor<CoreEventType, ValidateFunction>();
    for (let index = 0; index < coreTypes.length; index += 1) {
      const type = readOwnArraySlot(coreTypes, index);
      if (type === undefined) throw new Error('invalid core event registry');
      validators.set(type, ajv.compile(coreEventSchemas[type]));
    }
    const runtime = { ajv, validators, extensionValidator: ajv.compile(extensionEventSchema) };
    ajvRuntime = runtime;
    return runtime;
  } catch {
    ajvInitializationFailed = true;
    throw new Error('protocol validator initialization failed');
  }
}

// Compile while the importing realm is still healthy. If the realm was
// polluted before evaluation, importing the protocol remains safe, but every
// later validation attempt fails closed instead of compiling on demand.
try {
  getAjvRuntime();
} catch {
  ajvInitializationFailed = true;
}

const diagnostic = (
  code: ProtocolDiagnostic['code'],
  field?: ProtocolDiagnostic['field'],
  eventType?: CoreEventType,
  protocolMajor?: number,
): ProtocolDiagnostic => {
  const result = detachedObject<Record<string, unknown>>();
  result.code = code;
  result.severity = 'error';
  if (field) result.field = field;
  if (eventType) result.eventType = eventType;
  if (protocolMajor !== undefined) result.protocolMajor = protocolMajor;
  return result as unknown as ProtocolDiagnostic;
};
const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false;
  try {
    return !arrayIsArray(value);
  } catch {
    return false;
  }
};
const semverPatternMatcher =
  regExpConstructor === undefined ? undefined : new regExpConstructor(semverPattern);
const semver = (value: unknown): value is string =>
  typeof value === 'string' && safeRegExpTest(semverPatternMatcher, value);
const safeMajor = (version: string): number | undefined => {
  const major = numberConstructor(version.split('.')[0]);
  return numberIsSafeInteger(major) && major >= 0 && major <= 9999 ? major : undefined;
};

function validExtensionEnvelope(value: Record<string, unknown>): boolean {
  return runAjvValidator(getAjvRuntime().extensionValidator, value);
}

/**
 * AJV's generated functions contain a direct Array.isArray reference. Keep
 * that third-party execution on the captured target even if the host replaces
 * the global property after protocol import, and restore its exact descriptor
 * before returning to caller code.
 */
function runAjvValidator(validator: ValidateFunction, value: unknown): boolean {
  let arrayDescriptor: PropertyDescriptor | undefined;
  let regExpDescriptor: PropertyDescriptor | undefined;
  let valid = false;
  let arrayRestored = false;
  let regExpRestored = false;
  try {
    if (regExpPrototype === undefined || regExpTestDescriptor === undefined) return false;
    arrayDescriptor = objectGetOwnPropertyDescriptor(arrayConstructor, 'isArray');
    regExpDescriptor = objectGetOwnPropertyDescriptor(regExpPrototype, 'test');
    if (
      arrayDescriptor === undefined ||
      arrayDescriptor.configurable !== true ||
      arrayDescriptor.writable !== true ||
      regExpDescriptor === undefined ||
      regExpDescriptor.configurable !== true ||
      regExpDescriptor.writable !== true
    )
      return false;
    reflectApply(objectDefineProperty, undefined, [
      arrayConstructor,
      'isArray',
      {
        configurable: arrayDescriptor.configurable,
        enumerable: arrayDescriptor.enumerable,
        writable: arrayDescriptor.writable,
        value: arrayIsArray,
      },
    ]);
    reflectApply(objectDefineProperty, undefined, [regExpPrototype, 'test', regExpTestDescriptor]);
    valid = validator(value) === true;
  } catch {
    // The false initializer preserves fail-closed behavior.
  } finally {
    if (regExpDescriptor !== undefined && regExpPrototype !== undefined) {
      try {
        reflectApply(objectDefineProperty, undefined, [regExpPrototype, 'test', regExpDescriptor]);
        regExpRestored = true;
      } catch {
        // A failed restore makes the realm unsafe for this validation call.
      }
    }
    if (arrayDescriptor !== undefined) {
      try {
        reflectApply(objectDefineProperty, undefined, [
          arrayConstructor,
          'isArray',
          arrayDescriptor,
        ]);
        arrayRestored = true;
      } catch {
        // A failed restore makes the realm unsafe for this validation call.
      }
    }
  }
  return valid && arrayRestored && regExpRestored;
}

interface ValidationSnapshotContext {
  readonly ancestors: WeakSet<object>;
  nodes: number;
  stringCodeUnits: number;
}

interface ValidationSnapshotSuccess {
  readonly ok: true;
  readonly value: unknown;
}

interface ValidationSnapshotFailure {
  readonly ok: false;
  readonly diagnostic: ProtocolDiagnostic;
}

type ValidationSnapshotResult = ValidationSnapshotSuccess | ValidationSnapshotFailure;

function isValidationSnapshotFailure(value: object): value is ValidationSnapshotFailure {
  return (
    hasOwn(value as Record<string, unknown>, 'ok') &&
    (value as Record<string, unknown>).ok === false
  );
}

function validationFieldForPath(path: readonly string[]): ProtocolDiagnostic['field'] | undefined {
  switch (readOwnArraySlot(path, 0)) {
    case 'spec':
      return 'spec';
    case 'version':
      return 'version';
    case 'eventId':
      return 'eventId';
    case 'type':
      return 'type';
    case 'occurredAt':
    case 'observedAt':
      return 'timestamps';
    case 'sequence':
      return 'sequence';
    case 'source':
      return 'source';
    case 'scope':
      return 'scope';
    case 'fidelity':
      return 'fidelity';
    case 'finality':
      return 'finality';
    case 'data':
    case 'semantic':
      return 'data';
    case 'extension':
      return 'extension';
    default:
      return undefined;
  }
}

function snapshotInvalidValueCode(path: readonly string[]): ProtocolDiagnostic['code'] {
  const first = readOwnArraySlot(path, 0);
  if (first === 'scope') return 'invalid-scope';
  if (first === 'data' || first === 'semantic') return 'invalid-data';
  return 'invalid-envelope';
}

function snapshotFailure(
  code: ProtocolDiagnostic['code'],
  path: readonly string[],
  field?: ProtocolDiagnostic['field'],
): ValidationSnapshotFailure {
  return {
    ok: false,
    diagnostic: diagnostic(code, field ?? validationFieldForPath(path)),
  };
}

interface ValidationPrototypeSuccess {
  readonly ok: true;
  readonly prototype: object | null;
}

type ValidationPrototypeResult = ValidationPrototypeSuccess | ValidationSnapshotFailure;

function safeSnapshotPrototype(value: object, path: readonly string[]): ValidationPrototypeResult {
  try {
    return { ok: true, prototype: objectGetPrototypeOf(value) };
  } catch {
    return snapshotFailure('invalid-envelope', path);
  }
}

function safeSnapshotKeys(
  value: object,
  path: readonly string[],
): readonly (string | symbol)[] | ValidationSnapshotFailure {
  try {
    return reflectOwnKeys(value);
  } catch {
    return snapshotFailure('invalid-envelope', path);
  }
}

function safeSnapshotDescriptor(
  value: object,
  key: string,
  path: readonly string[],
): PropertyDescriptor | undefined | ValidationSnapshotFailure {
  try {
    return objectGetOwnPropertyDescriptor(value, key);
  } catch {
    return snapshotFailure('invalid-envelope', path);
  }
}

/** Detached objects never consult a potentially polluted global prototype. */
function detachedObject<T extends object = Record<string, unknown>>(): T {
  if (!protocolIntrinsicsReady) return {} as T;
  try {
    return objectCreate(null) as T;
  } catch {
    return {} as T;
  }
}

function detachedArray<T>(length: number): T[] {
  try {
    return new arrayConstructor<T>(length);
  } catch {
    return [] as T[];
  }
}

function appendPath<T>(path: readonly T[], part: T): T[] {
  const output = detachedArray<T>(path.length + 1);
  for (let index = 0; index < path.length; index += 1) {
    const value = readOwnArraySlot(path, index);
    if (value === undefined) throw new Error('invalid structural path');
    defineOwnArraySlot(output, index, value);
  }
  defineOwnArraySlot(output, path.length, part);
  return output;
}

function codePointLength(value: string): number {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const first = value.charCodeAt(index);
    if (first >= 0xd800 && first <= 0xdbff && index + 1 < value.length) {
      const second = value.charCodeAt(index + 1);
      if (second >= 0xdc00 && second <= 0xdfff) index += 1;
    }
    count += 1;
  }
  return count;
}

function snapshotValidationValue(
  value: unknown,
  path: readonly string[],
  depth: number,
  context: ValidationSnapshotContext,
): ValidationSnapshotResult {
  if (depth > MAX_JSON_DEPTH) return snapshotFailure('event-too-deep', path, 'depth');
  context.nodes += 1;
  if (context.nodes > MAX_CANONICAL_STATE_NODES)
    return snapshotFailure('event-too-large', path, 'size');

  if (value === null) return { ok: true, value: null };
  if (typeof value === 'boolean') return { ok: true, value };
  if (typeof value === 'string') {
    if (value.length > MAX_CANONICAL_STRING_CODE_UNITS)
      return snapshotFailure('event-too-large', path, 'size');
    context.stringCodeUnits += value.length;
    if (context.stringCodeUnits > MAX_CANONICAL_TOTAL_STRING_CODE_UNITS)
      return snapshotFailure('event-too-large', path, 'size');
    return { ok: true, value };
  }
  if (typeof value === 'number') {
    return numberIsFinite(value)
      ? { ok: true, value }
      : snapshotFailure(snapshotInvalidValueCode(path), path);
  }
  if (typeof value !== 'object' || value === null)
    return snapshotFailure(snapshotInvalidValueCode(path), path);

  let isArray: boolean;
  try {
    isArray = arrayIsArray(value);
  } catch {
    return snapshotFailure('invalid-envelope', path);
  }
  const prototypeResult = safeSnapshotPrototype(value, path);
  if (!prototypeResult.ok) return prototypeResult;
  const prototype = prototypeResult.prototype;
  const expectedPrototype = isArray ? arrayPrototype : objectPrototype;
  if (prototype !== expectedPrototype && prototype !== null)
    return snapshotFailure('invalid-envelope', path);
  if (context.ancestors.has(value)) return snapshotFailure(snapshotInvalidValueCode(path), path);
  context.ancestors.add(value);
  try {
    const keys = safeSnapshotKeys(value, path);
    if (isValidationSnapshotFailure(keys)) return keys;
    if (keys.length > MAX_CANONICAL_OBJECT_KEYS)
      return snapshotFailure('event-too-large', path, 'size');

    if (isArray) {
      const lengthDescriptor = safeSnapshotDescriptor(value, 'length', path);
      if (lengthDescriptor === undefined || isValidationSnapshotFailure(lengthDescriptor)) {
        return lengthDescriptor === undefined
          ? snapshotFailure(snapshotInvalidValueCode(path), path)
          : lengthDescriptor;
      }
      if (
        !hasOwn(lengthDescriptor as Record<string, unknown>, 'value') ||
        !numberIsSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0 ||
        lengthDescriptor.value > MAX_CANONICAL_ARRAY_LENGTH
      )
        return snapshotFailure('event-too-large', path, 'size');
      const length = lengthDescriptor.value as number;
      const output = detachedArray<unknown>(length);
      const present = detachedArray<boolean>(length);
      for (let index = 0; index < length; index += 1) defineOwnArraySlot(present, index, false);
      let sawLength = false;
      for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
        const key = readOwnArraySlot(keys, keyIndex);
        if (typeof key !== 'string') return snapshotFailure(snapshotInvalidValueCode(path), path);
        if (key === 'length') {
          sawLength = true;
          continue;
        }
        if (!isCanonicalArrayIndex(key))
          return snapshotFailure(snapshotInvalidValueCode(path), path);
        const index = numberConstructor(key);
        if (index >= length || readOwnArraySlot(present, index) === true)
          return snapshotFailure(snapshotInvalidValueCode(path), path);
        const propertyPath = appendPath(path, key);
        const descriptor = safeSnapshotDescriptor(value, key, propertyPath);
        if (descriptor === undefined)
          return snapshotFailure(snapshotInvalidValueCode(path), propertyPath);
        if (isValidationSnapshotFailure(descriptor)) return descriptor;
        if (
          !hasOwn(descriptor as Record<string, unknown>, 'value') ||
          descriptor.enumerable !== true
        )
          return snapshotFailure(snapshotInvalidValueCode(path), propertyPath);
        const child = snapshotValidationValue(descriptor.value, propertyPath, depth + 1, context);
        if (!child.ok) return child;
        defineOwnArraySlot(output, index, child.value);
        defineOwnArraySlot(present, index, true);
      }
      if (!sawLength) return snapshotFailure(snapshotInvalidValueCode(path), path);
      for (let index = 0; index < length; index += 1)
        if (readOwnArraySlot(present, index) !== true)
          return snapshotFailure(snapshotInvalidValueCode(path), path);
      try {
        freeze(output);
      } catch {
        return snapshotFailure('invalid-envelope', path);
      }
      return { ok: true, value: output };
    }

    const output = detachedObject<Record<string, unknown>>();
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      const key = readOwnArraySlot(keys, keyIndex);
      if (typeof key !== 'string') return snapshotFailure(snapshotInvalidValueCode(path), path);
      if (key.length > MAX_CANONICAL_STRING_CODE_UNITS)
        return snapshotFailure('event-too-large', path, 'size');
      context.stringCodeUnits += key.length;
      if (context.stringCodeUnits > MAX_CANONICAL_TOTAL_STRING_CODE_UNITS)
        return snapshotFailure('event-too-large', path, 'size');
      const propertyPath = appendPath(path, key);
      const descriptor = safeSnapshotDescriptor(value, key, propertyPath);
      if (descriptor === undefined)
        return snapshotFailure(snapshotInvalidValueCode(propertyPath), propertyPath);
      if (isValidationSnapshotFailure(descriptor)) return descriptor;
      if (descriptor.enumerable !== true || !hasOwn(descriptor as Record<string, unknown>, 'value'))
        return snapshotFailure(snapshotInvalidValueCode(propertyPath), propertyPath);
      const child = snapshotValidationValue(descriptor.value, propertyPath, depth + 1, context);
      if (!child.ok) return child;
      try {
        if (
          !tryDefineOwnProperty(output, key, {
            configurable: true,
            enumerable: true,
            writable: true,
            value: child.value,
          })
        )
          return snapshotFailure('invalid-envelope', path);
      } catch {
        return snapshotFailure('invalid-envelope', path);
      }
    }
    try {
      freeze(output);
    } catch {
      return snapshotFailure('invalid-envelope', path);
    }
    return { ok: true, value: output };
  } finally {
    context.ancestors.delete(value);
  }
}

function createValidationSnapshot(input: unknown): ValidationSnapshotResult {
  const snapshot = snapshotValidationValue(input, [], 0, {
    ancestors: new weakSetConstructor<object>(),
    nodes: 0,
    stringCodeUnits: 0,
  });
  if (!snapshot.ok) return snapshot;
  if (snapshot.value === null || typeof snapshot.value !== 'object')
    return snapshotFailure('invalid-envelope', []);
  try {
    if (arrayIsArray(snapshot.value)) return snapshotFailure('invalid-envelope', []);
  } catch {
    return snapshotFailure('invalid-envelope', []);
  }
  return snapshot;
}

function serializedBounds(
  value: unknown,
  byteLimit = MAX_EVENT_BYTES,
): { bytes?: number; depth?: number } | ProtocolDiagnostic {
  const seen = new weakSetConstructor<object>();
  let maxDepth = 0;
  let nodes = 0;
  let failure: ProtocolDiagnostic | undefined;
  let bytes = 0;
  const append = (fragment: string): void => {
    if (failure) return;
    try {
      const fragmentBytes = canonicalUtf8ByteLength(fragment);
      if (fragmentBytes > byteLimit - bytes) {
        failure = diagnostic('event-too-large', 'size');
        return;
      }
      bytes += fragmentBytes;
    } catch {
      failure = diagnostic('invalid-envelope');
    }
  };

  const write = (item: unknown, level: number): void => {
    if (failure) return;
    maxDepth = Math.max(maxDepth, level);
    if (level > MAX_JSON_DEPTH) {
      failure = diagnostic('event-too-deep', 'depth');
      return;
    }
    nodes += 1;
    if (nodes > MAX_CANONICAL_STATE_NODES) {
      failure = diagnostic('event-too-large', 'size');
      return;
    }
    if (item === null) {
      append('null');
      return;
    }
    if (typeof item === 'boolean') {
      append(item ? 'true' : 'false');
      return;
    }
    if (typeof item === 'string') {
      let encoded: string | undefined;
      try {
        encoded = reflectApply(jsonStringify, undefined, [item]);
      } catch {
        failure = diagnostic('invalid-envelope');
        return;
      }
      if (encoded === undefined) {
        failure = diagnostic('invalid-envelope');
        return;
      }
      append(encoded);
      return;
    }
    if (typeof item === 'number') {
      if (!numberIsFinite(item)) {
        failure = diagnostic('invalid-envelope');
        return;
      }
      append(stringConstructor(item));
      return;
    }
    if (typeof item !== 'object') {
      failure = diagnostic('invalid-envelope');
      return;
    }
    if (seen.has(item)) {
      failure = diagnostic('invalid-envelope');
      return;
    }
    seen.add(item);

    let isArray: boolean;
    try {
      isArray = arrayIsArray(item);
    } catch {
      failure = diagnostic('invalid-envelope');
      return;
    }
    if (isArray) {
      let lengthDescriptor: PropertyDescriptor | undefined;
      try {
        lengthDescriptor = objectGetOwnPropertyDescriptor(item, 'length');
      } catch {
        failure = diagnostic('invalid-envelope');
        return;
      }
      if (
        lengthDescriptor === undefined ||
        !hasOwn(lengthDescriptor as Record<string, unknown>, 'value') ||
        !numberIsSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0 ||
        lengthDescriptor.value > MAX_CANONICAL_ARRAY_LENGTH
      ) {
        failure = diagnostic('event-too-large', 'size');
        return;
      }
      const length = lengthDescriptor.value as number;
      append('[');
      for (let index = 0; index < length; index += 1) {
        let descriptor: PropertyDescriptor | undefined;
        try {
          descriptor = objectGetOwnPropertyDescriptor(item, stringConstructor(index));
        } catch {
          failure = diagnostic('invalid-envelope');
          return;
        }
        if (
          descriptor === undefined ||
          !hasOwn(descriptor as Record<string, unknown>, 'value') ||
          descriptor.enumerable !== true
        ) {
          failure = diagnostic('invalid-envelope');
          return;
        }
        if (index > 0) append(',');
        write(descriptor.value, level + 1);
        if (failure) return;
      }
      append(']');
      return;
    }

    let keys: string[];
    try {
      keys = reflectApply(objectKeys, undefined, [item]);
    } catch {
      failure = diagnostic('invalid-envelope');
      return;
    }
    if (keys.length > MAX_CANONICAL_OBJECT_KEYS) {
      failure = diagnostic('event-too-large', 'size');
      return;
    }
    append('{');
    for (let index = 0; index < keys.length; index += 1) {
      const key = readOwnArraySlot(keys, index);
      if (key === undefined) {
        failure = diagnostic('invalid-envelope');
        return;
      }
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = objectGetOwnPropertyDescriptor(item, key);
      } catch {
        failure = diagnostic('invalid-envelope');
        return;
      }
      if (
        descriptor === undefined ||
        !hasOwn(descriptor as Record<string, unknown>, 'value') ||
        descriptor.enumerable !== true
      ) {
        failure = diagnostic('invalid-envelope');
        return;
      }
      let encodedKey: string | undefined;
      try {
        encodedKey = reflectApply(jsonStringify, undefined, [key]);
      } catch {
        failure = diagnostic('invalid-envelope');
        return;
      }
      if (encodedKey === undefined) {
        failure = diagnostic('invalid-envelope');
        return;
      }
      if (index > 0) append(',');
      append(encodedKey);
      append(':');
      write(descriptor.value, level + 1);
      if (failure) return;
    }
    append('}');
  };

  try {
    write(value, 0);
    if (failure) return failure;
    const result = detachedObject<{ bytes: number; depth: number }>();
    result.bytes = bytes;
    result.depth = maxDepth;
    return result;
  } catch {
    return diagnostic('invalid-envelope');
  }
}

function mapAjvError(
  error: ErrorObject | undefined,
  eventType?: CoreEventType,
): ProtocolDiagnostic {
  const keyword = error?.keyword;
  if (typeof keyword === 'string' && functionalKeywordNames.has(keyword))
    return diagnostic('invalid-data', 'data', eventType);
  if (keyword === 'format' && error?.params?.format === 'date-time')
    return diagnostic('invalid-envelope', 'timestamps', eventType);
  if (
    keyword === 'required' ||
    keyword === 'additionalProperties' ||
    keyword === 'type' ||
    keyword === 'enum' ||
    keyword === 'const' ||
    keyword === 'pattern' ||
    keyword === 'minimum' ||
    keyword === 'maximum' ||
    keyword === 'items' ||
    keyword === 'maxItems'
  ) {
    const field = error?.instancePath.startsWith('/scope')
      ? 'scope'
      : error?.instancePath.startsWith('/data')
        ? 'data'
        : error?.instancePath.includes('sequence')
          ? 'sequence'
          : error?.instancePath.includes('version')
            ? 'version'
            : 'invalid-envelope';
    return diagnostic(
      field === 'scope' ? 'invalid-scope' : field === 'data' ? 'invalid-data' : 'invalid-envelope',
      field === 'invalid-envelope' ? undefined : field,
      eventType,
    );
  }
  return diagnostic('invalid-envelope', undefined, eventType);
}

function semanticError(eventType: CoreEventType): ProtocolDiagnostic {
  return diagnostic('invalid-data', 'data', eventType);
}

function validateSemantics(
  input: Record<string, unknown>,
  eventType: CoreEventType,
): ProtocolDiagnostic | undefined {
  const semantic = input.semantic as Record<string, unknown> | undefined;
  const data = input.data as Record<string, unknown>;
  const finality = input.finality;
  const expectedOutcome = terminalOutcomeByEvent[eventType as keyof typeof terminalOutcomeByEvent];
  if (!validateNoTimeoutSuccessKeyword(true, input)) return semanticError(eventType);
  if (semanticRequired.has(eventType) && !semantic) return semanticError(eventType);
  if (
    eventType === 'task.completion.requested' &&
    (finality !== 'provisional' || semantic?.kind !== 'checkpoint' || semantic.terminal !== false)
  )
    return semanticError(eventType);
  if (
    eventType === 'turn.quiescent' &&
    (semantic?.kind !== 'quiescence' || semantic.terminal !== false)
  )
    return semanticError(eventType);
  if (eventType === 'telemetry.gap' && (semantic?.kind !== 'gap' || semantic.terminal !== false))
    return semanticError(eventType);
  if (
    expectedOutcome !== undefined &&
    (finality !== 'confirmed' || semantic?.kind !== 'outcome' || semantic.terminal !== true)
  )
    return semanticError(eventType);
  if (expectedOutcome !== undefined && semantic?.outcome !== expectedOutcome)
    return semanticError(eventType);
  if (
    eventType === 'task.corrected' &&
    (finality !== 'confirmed' ||
      semantic?.kind === undefined ||
      (data.correction === 'reopen' &&
        (semantic.kind !== 'correction' ||
          semantic.terminal !== false ||
          semantic.correctionOfEventId !== data.correctedEventId ||
          semantic.correctionOfEntityId !== data.correctedEntityId)) ||
      (data.correction === 'replace-outcome' &&
        (semantic.kind !== 'outcome' ||
          semantic.terminal !== true ||
          semantic.outcome !== data.resultingOutcome ||
          terminalOutcomeByStatus[data.status as TerminalTaskStatus] !== data.resultingOutcome)))
  )
    return semanticError(eventType);
  if (eventType === 'source.capability.changed') {
    if (
      finality !== 'confirmed' ||
      semantic?.kind !== 'capability' ||
      semantic.terminal !== false ||
      !validateCapabilityCoherenceKeyword('changed', input)
    )
      return semanticError(eventType);
  }
  if (eventType === 'source.connected') {
    if (!validateCapabilityCoherenceKeyword('connected', input)) return semanticError(eventType);
  }
  if (eventType === 'task.plan.reconciled') {
    const revision = data.revision as number;
    const previous = data.previousRevision as number | undefined;
    if (
      data.complete !== true ||
      !numberIsSafeInteger(revision) ||
      revision < 1 ||
      (revision === 1 ? hasOwn(data, 'previousRevision') : previous !== revision - 1) ||
      !validatePlanItemsKeyword(true, data)
    )
      return semanticError(eventType);
  }
  return undefined;
}

export function validateEvent(input: unknown): ValidationResult {
  if (!protocolIntrinsicsReady || ajvInitializationFailed)
    return { status: 'rejected', diagnostics: [diagnostic('invalid-envelope')] };
  try {
    const snapshotResult = createValidationSnapshot(input);
    if (!snapshotResult.ok) return { status: 'rejected', diagnostics: [snapshotResult.diagnostic] };
    const event = snapshotResult.value as Record<string, unknown>;
    const bounds = serializedBounds(event);
    if (hasOwn(bounds as Record<string, unknown>, 'code'))
      return { status: 'rejected', diagnostics: [bounds as ProtocolDiagnostic] };
    const sizeBounds = bounds as { bytes?: number; depth?: number };
    if ((sizeBounds.bytes ?? 0) > MAX_EVENT_BYTES)
      return { status: 'rejected', diagnostics: [diagnostic('event-too-large', 'size')] };
    if ((sizeBounds.depth ?? 0) > MAX_JSON_DEPTH)
      return { status: 'rejected', diagnostics: [diagnostic('event-too-deep', 'depth')] };
    if (!semver(event.version))
      return { status: 'rejected', diagnostics: [diagnostic('invalid-version', 'version')] };
    const major = safeMajor(event.version);
    if (major !== 1)
      return {
        status: 'quarantined',
        diagnostics: [diagnostic('unsupported-major', 'version', undefined, major)],
      };
    const type = event.type;
    if (typeof type !== 'string')
      return { status: 'rejected', diagnostics: [diagnostic('unknown-event', 'type')] };
    if (!containsString(coreTypes, type)) {
      if (!type.startsWith('x.'))
        return { status: 'rejected', diagnostics: [diagnostic('unknown-event', 'type')] };
      if (!safeRegExpTest(extensionPattern, type))
        return { status: 'rejected', diagnostics: [diagnostic('invalid-extension', 'type')] };
      const extension = event.extension;
      if (
        !isRecord(extension) ||
        extension.fallback !== 'preserve-in-journal' ||
        typeof extension.documentation !== 'string' ||
        codePointLength(extension.documentation) < 1 ||
        codePointLength(extension.documentation) > 512
      )
        return { status: 'rejected', diagnostics: [diagnostic('invalid-extension', 'extension')] };
      const extensionBytes = serializedBounds(event.data, MAX_EXTENSION_BYTES);
      if (
        hasOwn(extensionBytes as Record<string, unknown>, 'code') ||
        ((extensionBytes as { bytes?: number }).bytes ?? 0) > MAX_EXTENSION_BYTES
      )
        return { status: 'rejected', diagnostics: [diagnostic('event-too-large', 'size')] };
      const extensionValid = validExtensionEnvelope(event);
      if (!extensionValid)
        return {
          status: 'rejected',
          diagnostics: [diagnostic('invalid-extension', 'extension')],
        };
      return {
        status: 'preserved-extension',
        event: event as ExtensionEvent,
        diagnostics: [{ code: 'extension-preserved', severity: 'warning', field: 'type' }],
      };
    }
    const eventType = type as CoreEventType;
    const runtime = getAjvRuntime();
    const validator = runtime.validators.get(eventType);
    const valid = validator === undefined ? false : runAjvValidator(validator, event);
    if (!valid)
      return {
        status: 'rejected',
        diagnostics: [
          mapAjvError(
            validator === undefined ? undefined : readOwnArraySlot(validator.errors ?? [], 0),
            eventType,
          ),
        ],
      };
    const semanticDiagnostic = validateSemantics(event, eventType);
    if (semanticDiagnostic) return { status: 'rejected', diagnostics: [semanticDiagnostic] };
    return { status: 'accepted', event: event as AnyCoreEvent, diagnostics: [] };
  } catch {
    return { status: 'rejected', diagnostics: [diagnostic('invalid-envelope')] };
  }
}

export function isCoreEvent(value: unknown): value is AnyCoreEvent {
  return validateEvent(value).status === 'accepted';
}

/** Exposed for conformance tests and consumers that want to preflight compilation. */
export function compileCoreEventSchemas(): readonly ValidateFunction[] {
  const runtime = getAjvRuntime();
  registerProtocolSchemaKeywords(runtime.ajv);
  const compiled = new arrayConstructor<ValidateFunction>(coreTypes.length);
  for (let index = 0; index < coreTypes.length; index += 1) {
    const type = readOwnArraySlot(coreTypes, index);
    if (type === undefined) throw new Error('invalid core event registry');
    defineOwnArraySlot(compiled, index, runtime.ajv.compile(coreEventSchemas[type]));
  }
  return compiled;
}

/**
 * The JSON value accepted by the canonical state serializer.
 *
 * Runtime serialization is stricter than the TypeScript `number` type: only
 * finite numbers are accepted, and `-0` is represented canonically as `0`.
 */
export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

/** JSON-compatible entity path segments. `{ each: true }` explicitly crosses an array. */
export type CanonicalEntityPathSegment = string | number | { readonly each: true };

/**
 * Explicitly identifies one state array whose records are entities. A path
 * string selects an object property, a number selects an exact array index,
 * and `{ each: true }` selects every array index. The empty path identifies
 * a root array. Unlisted arrays retain their semantic order.
 */
export interface CanonicalEntityCollection {
  readonly path: readonly CanonicalEntityPathSegment[];
  /** Own property containing a non-empty stable string ID on every record. */
  readonly idKey: string;
}

/** Options for canonical state serialization. */
export interface CanonicalStateOptions {
  readonly entityCollections?: readonly CanonicalEntityCollection[];
}

/**
 * Input arrays may use the ordinary Array.prototype or null as their prototype;
 * subclass and arbitrary custom-prototype arrays are rejected. Returned arrays
 * always use the standard Array.prototype and retain normal array behavior.
 */

/** Stable, bounded failure surface for canonical serialization. */
export type CanonicalSerializationErrorCode =
  | 'invalid-json-value'
  | 'sparse-array'
  | 'unsupported-prototype'
  | 'accessor-property'
  | 'unsupported-property'
  | 'cycle'
  | 'invalid-options'
  | 'entity-collection-path'
  | 'entity-collection-not-array'
  | 'missing-entity-id'
  | 'invalid-entity-id'
  | 'duplicate-entity-id'
  | 'event-not-accepted'
  | 'event-quarantined'
  | 'event-extension-not-supported'
  | 'state-too-deep'
  | 'state-too-many-nodes'
  | 'state-too-many-containers'
  | 'state-too-large'
  | 'array-too-large'
  | 'object-too-large'
  | 'string-too-large'
  | 'entity-options-too-large'
  | 'entity-path-too-long'
  | 'entity-path-segment-too-long'
  | 'invalid-entity-path-segment'
  | 'entity-id-too-long'
  | 'ambiguous-entity-collection'
  | 'serialization-failed';

/**
 * Error thrown when a value cannot be represented by the canonical JSON
 * contract. Paths are structural only: object keys, IDs, option strings, and
 * getter messages are never copied into the error.
 */
export class CanonicalSerializationError extends Error {
  override readonly name = 'CanonicalSerializationError';

  constructor(
    readonly code: CanonicalSerializationErrorCode,
    readonly path?: string,
  ) {
    super(`canonical serialization failed: ${code}${path ? ` at ${path}` : ''}`);
    objectSetPrototypeOf(this, new.target.prototype);
  }
}

type CanonicalPathPart = string | number;
type NormalizedEntityPathSegment = CanonicalEntityPathSegment;
interface NormalizedEntityCollection {
  readonly path: readonly NormalizedEntityPathSegment[];
  readonly pathKey: string;
  readonly idKey: string;
}
interface PropertySnapshot {
  readonly key: string;
  readonly value: unknown;
}
interface ObjectSnapshot {
  readonly properties: readonly PropertySnapshot[];
}
interface ArraySnapshot {
  readonly values: readonly unknown[];
}
interface NormalizationContext {
  readonly collections: readonly NormalizedEntityCollection[];
  readonly matchedCollections: Set<string>;
  readonly ancestors: WeakSet<object>;
  nodes: number;
  containers: number;
  stringCodeUnits: number;
}

const MAX_SERIALIZATION_ERROR_PATH = 128;
const authenticCanonicalSerializationErrors = new weakSetConstructor<CanonicalSerializationError>();

function codeUnitCompare(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

/** Converts names to bounded structural placeholders, never echoing input keys. */
function formatSerializationPath(path: readonly CanonicalPathPart[]): string {
  let formatted = '$';
  for (let index = 0; index < path.length; index += 1) {
    const part = readOwnArraySlot(path, index);
    if (part === undefined) return formatted;
    formatted += typeof part === 'number' ? `[${part}]` : '.object';
    if (formatted.length >= MAX_SERIALIZATION_ERROR_PATH)
      return `${formatted.slice(0, MAX_SERIALIZATION_ERROR_PATH - 3)}...`;
  }
  return formatted;
}

function createAuthenticCanonicalSerializationError(
  code: CanonicalSerializationErrorCode,
  path: readonly CanonicalPathPart[] = [],
): CanonicalSerializationError {
  const error = new CanonicalSerializationError(code, formatSerializationPath(path));
  authenticCanonicalSerializationErrors.add(error);
  freeze(error);
  return error;
}

function serializationFailure(
  code: CanonicalSerializationErrorCode,
  path: readonly CanonicalPathPart[] = [],
): never {
  throw createAuthenticCanonicalSerializationError(code, path);
}

function isAuthenticCanonicalSerializationError(
  error: unknown,
): error is CanonicalSerializationError {
  if ((typeof error !== 'object' || error === null) && typeof error !== 'function') return false;
  return authenticCanonicalSerializationErrors.has(error as CanonicalSerializationError);
}

function runCanonical<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (isAuthenticCanonicalSerializationError(error)) throw error;
    serializationFailure('serialization-failed');
  }
}

function safeIsArray(
  value: unknown,
  path: readonly CanonicalPathPart[],
  code: CanonicalSerializationErrorCode = 'invalid-json-value',
): boolean {
  try {
    return arrayIsArray(value);
  } catch {
    serializationFailure(code, path);
  }
}

function safeOwnKeys(
  value: object,
  path: readonly CanonicalPathPart[],
  code: CanonicalSerializationErrorCode,
): readonly (string | symbol)[] {
  try {
    return reflectOwnKeys(value);
  } catch {
    serializationFailure(code, path);
  }
}

function safeOwnPropertyDescriptor(
  value: object,
  key: string | symbol,
  path: readonly CanonicalPathPart[],
  code: CanonicalSerializationErrorCode,
): PropertyDescriptor | undefined {
  try {
    return objectGetOwnPropertyDescriptor(value, key);
  } catch {
    serializationFailure(code, path);
  }
}

function safePrototype(
  value: object,
  path: readonly CanonicalPathPart[],
  code: CanonicalSerializationErrorCode,
): object | null {
  try {
    return objectGetPrototypeOf(value);
  } catch {
    serializationFailure(code, path);
  }
}

function requirePlainObject(
  value: unknown,
  path: readonly CanonicalPathPart[],
  code: CanonicalSerializationErrorCode,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || safeIsArray(value, path, code))
    serializationFailure(code, path);
  const prototype = safePrototype(value, path, code);
  if (prototype !== objectPrototype && prototype !== null)
    serializationFailure(
      code === 'invalid-json-value' || code === 'invalid-entity-id'
        ? 'unsupported-prototype'
        : code,
      path,
    );
}

function isDataDescriptor(
  descriptor: PropertyDescriptor | undefined,
): descriptor is PropertyDescriptor & {
  value: unknown;
} {
  return descriptor !== undefined && 'value' in descriptor;
}

function insertionSort<T>(values: T[], compare: (left: T, right: T) => number): void {
  for (let index = 1; index < values.length; index += 1) {
    const current = readOwnArraySlot(values, index);
    if (current === undefined) throw new Error('invalid structural array');
    let position = index - 1;
    while (position >= 0) {
      const previous = readOwnArraySlot(values, position);
      if (previous === undefined) throw new Error('invalid structural array');
      if (compare(previous, current) <= 0) break;
      defineOwnArraySlot(values, position + 1, previous);
      position -= 1;
    }
    defineOwnArraySlot(values, position + 1, current);
  }
}

function findProperty(
  properties: readonly PropertySnapshot[],
  key: string,
): PropertySnapshot | undefined {
  for (let index = 0; index < properties.length; index += 1) {
    const property = readOwnArraySlot(properties, index);
    if (property?.key === key) return property;
  }
  return undefined;
}

function snapshotObject(
  value: unknown,
  path: readonly CanonicalPathPart[],
  code: CanonicalSerializationErrorCode,
): ObjectSnapshot {
  requirePlainObject(value, path, code);
  const keys = safeOwnKeys(value, path, code);
  if (keys.length > MAX_CANONICAL_OBJECT_KEYS) {
    serializationFailure(
      code === 'invalid-options' ? 'entity-options-too-large' : 'object-too-large',
      path,
    );
  }
  const properties: PropertySnapshot[] = new arrayConstructor<PropertySnapshot>(keys.length);
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    const key = readOwnArraySlot(keys, keyIndex);
    if (typeof key !== 'string')
      serializationFailure(code === 'invalid-options' ? code : 'invalid-json-value', path);
    if (key.length > MAX_CANONICAL_STRING_CODE_UNITS)
      serializationFailure(
        code === 'invalid-options' ? 'entity-path-segment-too-long' : 'string-too-large',
        path,
      );
    const propertyPath = appendPath(path, key);
    const descriptor = safeOwnPropertyDescriptor(value, key, propertyPath, code);
    if (!descriptor) serializationFailure(code, propertyPath);
    if (!descriptor.enumerable)
      serializationFailure(code === 'invalid-options' ? code : 'unsupported-property', path);
    if (!isDataDescriptor(descriptor))
      serializationFailure(code === 'invalid-options' ? code : 'accessor-property', path);
    defineOwnArraySlot(properties, keyIndex, { key, value: descriptor.value });
  }
  insertionSort(properties, (left, right) => codeUnitCompare(left.key, right.key));
  return { properties };
}

function isCanonicalArrayIndex(key: string): boolean {
  const index = numberConstructor(key);
  return (
    numberIsSafeInteger(index) &&
    index >= 0 &&
    index < 2 ** 32 - 1 &&
    stringConstructor(index) === key
  );
}

function snapshotArray(
  value: unknown,
  path: readonly CanonicalPathPart[],
  code: CanonicalSerializationErrorCode,
): ArraySnapshot {
  if (!safeIsArray(value, path, code)) serializationFailure(code, path);
  const arrayValue = value as object;
  const prototype = safePrototype(arrayValue, path, code);
  if (prototype !== arrayPrototype && prototype !== null)
    serializationFailure(code === 'invalid-options' ? code : 'unsupported-prototype', path);
  const lengthDescriptor = safeOwnPropertyDescriptor(arrayValue, 'length', path, code);
  if (!isDataDescriptor(lengthDescriptor) || !numberIsSafeInteger(lengthDescriptor.value))
    serializationFailure(code, path);
  const length = lengthDescriptor.value;
  if (length < 0 || length > MAX_CANONICAL_ARRAY_LENGTH)
    serializationFailure(
      code === 'invalid-options' ? 'entity-options-too-large' : 'array-too-large',
      path,
    );
  const keys = safeOwnKeys(arrayValue, path, code);
  const values = detachedArray<unknown>(length);
  const present = detachedArray<boolean>(length);
  for (let index = 0; index < length; index += 1) defineOwnArraySlot(present, index, false);
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    const key = readOwnArraySlot(keys, keyIndex);
    if (typeof key !== 'string')
      serializationFailure(code === 'invalid-options' ? code : 'invalid-json-value', path);
    if (key === 'length') continue;
    if (!isCanonicalArrayIndex(key))
      serializationFailure(code === 'invalid-options' ? code : 'unsupported-property', path);
    const index = numberConstructor(key);
    if (index >= length)
      serializationFailure(code === 'invalid-options' ? code : 'unsupported-property', path);
    const descriptor = safeOwnPropertyDescriptor(arrayValue, key, appendPath(path, index), code);
    if (!isDataDescriptor(descriptor))
      serializationFailure(code === 'invalid-options' ? code : 'accessor-property', path);
    if (!descriptor.enumerable)
      serializationFailure(code === 'invalid-options' ? code : 'unsupported-property', path);
    defineOwnArraySlot(values, index, descriptor.value);
    defineOwnArraySlot(present, index, true);
  }
  for (let index = 0; index < length; index += 1) {
    if (readOwnArraySlot(present, index) !== true)
      serializationFailure(
        code === 'invalid-options' ? code : 'sparse-array',
        appendPath(path, index),
      );
  }
  return { values };
}

function optionProperties(
  value: unknown,
  path: readonly CanonicalPathPart[],
  allowed: readonly string[],
): ObjectSnapshot {
  const snapshot = snapshotObject(value, path, 'invalid-options');
  for (let index = 0; index < snapshot.properties.length; index += 1) {
    const property = readOwnArraySlot(snapshot.properties, index);
    if (!property) serializationFailure('invalid-options', path);
    if (!containsString(allowed, property.key)) serializationFailure('invalid-options', path);
  }
  return snapshot;
}

function entityPathKey(path: readonly NormalizedEntityPathSegment[]): string {
  let result = '';
  for (let index = 0; index < path.length; index += 1) {
    const part = readOwnArraySlot(path, index);
    if (part === undefined) serializationFailure('invalid-options');
    if (index > 0) result += '|';
    if (typeof part === 'string') result += `s${part.length}:${part}`;
    else if (typeof part === 'number') result += `n${part}`;
    else result += 'w';
  }
  return result;
}

function normalizeEntityPathSegment(
  value: unknown,
  path: readonly CanonicalPathPart[],
): NormalizedEntityPathSegment {
  if (typeof value === 'string') {
    if (value.length > MAX_ENTITY_PATH_SEGMENT_CODE_UNITS)
      serializationFailure('entity-path-segment-too-long', path);
    return value;
  }
  if (typeof value === 'number') {
    if (!numberIsSafeInteger(value) || value < 0 || value > MAX_CANONICAL_ARRAY_LENGTH)
      serializationFailure('invalid-entity-path-segment', path);
    return value;
  }
  const wildcard = readOwnArraySlot(optionProperties(value, path, ['each']).properties, 0);
  if (!wildcard || wildcard.key !== 'each' || wildcard.value !== true)
    serializationFailure('invalid-entity-path-segment', path);
  return { each: true };
}

function normalizeEntityCollections(options: unknown): readonly NormalizedEntityCollection[] {
  if (options === undefined) return [];
  const properties = optionProperties(options, [], ['entityCollections']);
  const collectionProperty = findProperty(properties.properties, 'entityCollections');
  if (!collectionProperty) return [];
  const collectionArray = snapshotArray(collectionProperty.value, [], 'invalid-options');
  if (collectionArray.values.length > MAX_ENTITY_COLLECTIONS)
    serializationFailure('entity-options-too-large');
  const collections: NormalizedEntityCollection[] = [];
  const pathKeys = new setConstructor<string>();
  for (
    let collectionIndex = 0;
    collectionIndex < collectionArray.values.length;
    collectionIndex += 1
  ) {
    const entryPath: CanonicalPathPart[] = [collectionIndex];
    const collectionValue = readOwnArraySlot(collectionArray.values, collectionIndex);
    const entryProperties = optionProperties(collectionValue, entryPath, ['path', 'idKey']);
    const rawPath = findProperty(entryProperties.properties, 'path')?.value;
    const rawIdKey = findProperty(entryProperties.properties, 'idKey')?.value;
    if (rawPath === undefined || typeof rawIdKey !== 'string' || rawIdKey.length === 0)
      serializationFailure('invalid-options', entryPath);
    if (rawIdKey.length > MAX_ENTITY_ID_CODE_UNITS)
      serializationFailure('entity-id-too-long', entryPath);
    const pathSnapshot = snapshotArray(rawPath, appendPath(entryPath, 0), 'invalid-options');
    if (pathSnapshot.values.length > MAX_ENTITY_PATH_SEGMENTS)
      serializationFailure('entity-path-too-long', entryPath);
    const path: NormalizedEntityPathSegment[] = [];
    for (let index = 0; index < pathSnapshot.values.length; index += 1) {
      const segment = readOwnArraySlot(pathSnapshot.values, index);
      defineOwnArraySlot(
        path,
        path.length,
        normalizeEntityPathSegment(segment, appendPath(entryPath, index)),
      );
    }
    const pathKey = entityPathKey(path);
    if (pathKeys.has(pathKey)) serializationFailure('invalid-options', entryPath);
    pathKeys.add(pathKey);
    defineOwnArraySlot(collections, collections.length, { path, pathKey, idKey: rawIdKey });
  }
  return collections;
}

function matchesEntityPath(
  pattern: readonly NormalizedEntityPathSegment[],
  path: readonly CanonicalPathPart[],
): boolean {
  if (pattern.length !== path.length) return false;
  for (let index = 0; index < pattern.length; index += 1) {
    const segment = readOwnArraySlot(pattern, index);
    const actual = readOwnArraySlot(path, index);
    if (typeof segment === 'string') {
      if (typeof actual !== 'string' || segment !== actual) return false;
    } else if (typeof segment === 'number') {
      if (typeof actual !== 'number' || segment !== actual) return false;
    } else if (typeof actual !== 'number') return false;
  }
  return true;
}

function matchingCollections(
  collections: readonly NormalizedEntityCollection[],
  path: readonly CanonicalPathPart[],
): readonly NormalizedEntityCollection[] {
  const matches: NormalizedEntityCollection[] = [];
  for (let index = 0; index < collections.length; index += 1) {
    const collection = readOwnArraySlot(collections, index);
    if (!collection) serializationFailure('invalid-options', path);
    if (matchesEntityPath(collection.path, path))
      defineOwnArraySlot(matches, matches.length, collection);
  }
  return matches;
}

function consumeNode(context: NormalizationContext, value: unknown): void {
  context.nodes += 1;
  if (context.nodes > MAX_CANONICAL_STATE_NODES) serializationFailure('state-too-many-nodes');
  if (typeof value === 'string') {
    if (value.length > MAX_CANONICAL_STRING_CODE_UNITS) serializationFailure('string-too-large');
    context.stringCodeUnits += value.length;
    if (context.stringCodeUnits > MAX_CANONICAL_TOTAL_STRING_CODE_UNITS)
      serializationFailure('state-too-large');
  }
}

function consumeObjectKeys(
  context: NormalizationContext,
  snapshot: ObjectSnapshot,
  path: readonly CanonicalPathPart[],
): void {
  for (let index = 0; index < snapshot.properties.length; index += 1) {
    const property = readOwnArraySlot(snapshot.properties, index);
    if (property === undefined) serializationFailure('serialization-failed', path);
    if (property.key.length > MAX_CANONICAL_STRING_CODE_UNITS)
      serializationFailure('string-too-large', path);
    context.stringCodeUnits += property.key.length;
    if (context.stringCodeUnits > MAX_CANONICAL_TOTAL_STRING_CODE_UNITS)
      serializationFailure('state-too-large', path);
  }
}

function consumeContainer(context: NormalizationContext): void {
  context.containers += 1;
  if (context.containers > MAX_CANONICAL_STATE_CONTAINERS)
    serializationFailure('state-too-many-containers');
}

function entityItemSnapshot(
  value: unknown,
  idKey: string,
  path: readonly CanonicalPathPart[],
): { readonly id: string; readonly snapshot: ObjectSnapshot } {
  const snapshot = snapshotObject(value, path, 'invalid-entity-id');
  const id = findProperty(snapshot.properties, idKey)?.value;
  if (id === undefined) serializationFailure('missing-entity-id', path);
  if (typeof id !== 'string' || id.length === 0) serializationFailure('invalid-entity-id', path);
  if (id.length > MAX_ENTITY_ID_CODE_UNITS) serializationFailure('entity-id-too-long', path);
  return { id, snapshot };
}

function normalizeJsonValue(
  value: unknown,
  path: readonly CanonicalPathPart[],
  context: NormalizationContext,
  depth: number,
  preloadedObject?: ObjectSnapshot,
): CanonicalJsonValue {
  if (depth > MAX_CANONICAL_STATE_DEPTH) serializationFailure('state-too-deep', path);
  consumeNode(context, value);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!numberIsFinite(value)) serializationFailure('invalid-json-value', path);
    return objectIs(value, -0) ? 0 : value;
  }
  if (
    typeof value !== 'object' ||
    typeof value === 'undefined' ||
    typeof value === 'function' ||
    typeof value === 'symbol' ||
    typeof value === 'bigint'
  )
    serializationFailure('invalid-json-value', path);
  if (context.ancestors.has(value)) serializationFailure('cycle', path);
  context.ancestors.add(value);
  try {
    consumeContainer(context);
    const matches = matchingCollections(context.collections, path);
    if (matches.length > 1) serializationFailure('ambiguous-entity-collection', path);
    const isArray = safeIsArray(value, path);
    if (matches.length === 1 && !isArray) serializationFailure('entity-collection-not-array', path);
    if (isArray) {
      const snapshot = snapshotArray(value, path, 'invalid-json-value');
      const output = detachedArray<CanonicalJsonValue>(snapshot.values.length);
      if (matches.length === 1) {
        const collection = readOwnArraySlot(matches, 0);
        if (!collection) serializationFailure('ambiguous-entity-collection', path);
        context.matchedCollections.add(collection.pathKey);
        const entries: { id: string; item: CanonicalJsonValue }[] = new arrayConstructor(
          snapshot.values.length,
        );
        const ids = new setConstructor<string>();
        for (let index = 0; index < snapshot.values.length; index += 1) {
          const itemPath = appendPath(path, index);
          const rawItem = readOwnArraySlot(snapshot.values, index);
          if (rawItem === undefined) serializationFailure('sparse-array', itemPath);
          const item = entityItemSnapshot(rawItem, collection.idKey, itemPath);
          if (ids.has(item.id)) serializationFailure('duplicate-entity-id', path);
          ids.add(item.id);
          defineOwnArraySlot(entries, index, {
            id: item.id,
            item: normalizeJsonValue(rawItem, itemPath, context, depth + 1, item.snapshot),
          });
        }
        insertionSort(entries, (left, right) => codeUnitCompare(left.id, right.id));
        for (let index = 0; index < entries.length; index += 1) {
          const entry = readOwnArraySlot(entries, index);
          if (!entry) serializationFailure('invalid-json-value', path);
          defineOwnArraySlot(output, index, entry.item);
        }
        return output;
      }
      for (let index = 0; index < snapshot.values.length; index += 1) {
        const child = readOwnArraySlot(snapshot.values, index);
        if (child === undefined) serializationFailure('sparse-array', appendPath(path, index));
        defineOwnArraySlot(
          output,
          index,
          normalizeJsonValue(child, appendPath(path, index), context, depth + 1),
        );
      }
      return output;
    }
    const snapshot = preloadedObject ?? snapshotObject(value, path, 'invalid-json-value');
    consumeObjectKeys(context, snapshot, path);
    const output = detachedObject<Record<string, CanonicalJsonValue>>();
    for (let propertyIndex = 0; propertyIndex < snapshot.properties.length; propertyIndex += 1) {
      const property = readOwnArraySlot(snapshot.properties, propertyIndex);
      if (!property) serializationFailure('invalid-json-value', path);
      const normalized = normalizeJsonValue(
        property.value,
        appendPath(path, property.key),
        context,
        depth + 1,
      );
      if (
        !tryDefineOwnProperty(output, property.key, {
          configurable: true,
          enumerable: true,
          writable: true,
          value: normalized,
        })
      )
        serializationFailure('serialization-failed');
    }
    return output;
  } finally {
    context.ancestors.delete(value);
  }
}

function canonicalOwnDataValue(value: object, key: string): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = objectGetOwnPropertyDescriptor(value, key);
  } catch {
    serializationFailure('serialization-failed');
  }
  if (!isDataDescriptor(descriptor) || descriptor.enumerable !== true)
    serializationFailure('serialization-failed');
  return descriptor.value;
}

function canonicalArrayLength(value: object): number {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = objectGetOwnPropertyDescriptor(value, 'length');
  } catch {
    serializationFailure('serialization-failed');
  }
  if (!isDataDescriptor(descriptor) || !numberIsSafeInteger(descriptor.value))
    serializationFailure('serialization-failed');
  return descriptor.value;
}

interface CanonicalTextWriter {
  text: string;
  bytes: number;
}

function createCanonicalTextWriter(): CanonicalTextWriter {
  return { text: '', bytes: 0 };
}

function appendCanonicalText(writer: CanonicalTextWriter, fragment: string): void {
  let bytes: number;
  try {
    bytes = canonicalUtf8ByteLength(fragment);
  } catch {
    serializationFailure('serialization-failed');
  }
  if (bytes > MAX_CANONICAL_STATE_BYTES - writer.bytes) serializationFailure('state-too-large');
  writer.text += fragment;
  writer.bytes += bytes;
}

function canonicalJsonString(value: CanonicalJsonValue): string {
  const writer = createCanonicalTextWriter();
  const write = (item: CanonicalJsonValue, depth: number): void => {
    if (depth > MAX_CANONICAL_STATE_DEPTH) serializationFailure('state-too-deep');
    if (item === null) {
      appendCanonicalText(writer, 'null');
      return;
    }
    if (typeof item === 'boolean') {
      appendCanonicalText(writer, item ? 'true' : 'false');
      return;
    }
    if (typeof item === 'string') {
      let encoded: string | undefined;
      try {
        encoded = reflectApply(jsonStringify, undefined, [item]);
      } catch {
        serializationFailure('serialization-failed');
      }
      if (encoded === undefined) serializationFailure('invalid-json-value');
      appendCanonicalText(writer, encoded);
      return;
    }
    if (typeof item === 'number') {
      if (!numberIsFinite(item)) serializationFailure('invalid-json-value');
      appendCanonicalText(writer, objectIs(item, -0) ? '0' : stringConstructor(item));
      return;
    }
    if (arrayIsArray(item)) {
      const lengthValue = canonicalArrayLength(item);
      if (lengthValue < 0) serializationFailure('serialization-failed');
      appendCanonicalText(writer, '[');
      for (let index = 0; index < lengthValue; index += 1) {
        if (index > 0) appendCanonicalText(writer, ',');
        write(
          canonicalOwnDataValue(item, stringConstructor(index)) as CanonicalJsonValue,
          depth + 1,
        );
      }
      appendCanonicalText(writer, ']');
      return;
    }
    let keys: string[];
    try {
      keys = reflectApply(objectKeys, undefined, [item]);
    } catch {
      serializationFailure('serialization-failed');
    }
    insertionSort(keys, codeUnitCompare);
    appendCanonicalText(writer, '{');
    for (let index = 0; index < keys.length; index += 1) {
      const key = readOwnArraySlot(keys, index);
      if (key === undefined) serializationFailure('serialization-failed');
      let encodedKey: string | undefined;
      try {
        encodedKey = reflectApply(jsonStringify, undefined, [key]);
      } catch {
        serializationFailure('serialization-failed');
      }
      if (encodedKey === undefined) serializationFailure('invalid-json-value');
      if (index > 0) appendCanonicalText(writer, ',');
      appendCanonicalText(writer, encodedKey);
      appendCanonicalText(writer, ':');
      write(canonicalOwnDataValue(item, key) as CanonicalJsonValue, depth + 1);
    }
    appendCanonicalText(writer, '}');
  };
  write(value, 0);
  return writer.text;
}

function createNormalizationContext(
  collections: readonly NormalizedEntityCollection[],
): NormalizationContext {
  return {
    collections,
    matchedCollections: new setConstructor<string>(),
    ancestors: new weakSetConstructor<object>(),
    nodes: 0,
    containers: 0,
    stringCodeUnits: 0,
  };
}

/**
 * Returns a fresh canonical JSON-compatible state value. Canonical text and
 * bytes sort object keys by UTF-16 code unit, including integer-like keys;
 * JavaScript may enumerate integer-like keys numerically when this returned
 * object is inspected, which is not the byte-order contract. Ordinary arrays
 * preserve order. Entity arrays are sorted only by explicitly configured
 * paths and IDs, using the same UTF-16 code-unit order.
 */
export function canonicalizeState(
  value: unknown,
  options?: CanonicalStateOptions,
): CanonicalJsonValue {
  return runCanonical(() => {
    const collections = normalizeEntityCollections(options);
    const context = createNormalizationContext(collections);
    const result = normalizeJsonValue(value, [], context, 0);
    for (let index = 0; index < collections.length; index += 1) {
      const collection = readOwnArraySlot(collections, index);
      if (!collection) serializationFailure('invalid-options');
      if (!context.matchedCollections.has(collection.pathKey))
        serializationFailure('entity-collection-path');
    }
    freezeCanonicalSnapshot(result);
    canonicalJsonString(result);
    return result;
  });
}

/** Serializes a generic state value as compact canonical JSON text. */
export function serializeCanonicalState(value: unknown, options?: CanonicalStateOptions): string {
  return runCanonical(() => canonicalJsonString(canonicalizeState(value, options)));
}

/** Serializes a generic state value as deterministic UTF-8 canonical JSON bytes. */
export function encodeCanonicalState(value: unknown, options?: CanonicalStateOptions): Uint8Array {
  return runCanonical(() => {
    const text = serializeCanonicalState(value, options);
    try {
      return encodeUtf8(text);
    } catch {
      serializationFailure('serialization-failed');
    }
  });
}

function acceptedCoreEvent(input: unknown): AnyCoreEvent {
  const result = validateEvent(input);
  if (result.status === 'quarantined') serializationFailure('event-quarantined');
  if (result.status === 'preserved-extension')
    serializationFailure('event-extension-not-supported');
  if (result.status !== 'accepted') serializationFailure('event-not-accepted');
  return result.event;
}

function freezeCanonicalSnapshot(value: CanonicalJsonValue): void {
  interface PendingSnapshot {
    readonly value: CanonicalJsonValue;
    readonly next: PendingSnapshot | undefined;
  }
  let pending: PendingSnapshot | undefined = { value, next: undefined };
  const seen = new weakSetConstructor<object>();
  while (pending !== undefined) {
    const current = pending.value;
    pending = pending.next;
    if (current === null || typeof current !== 'object') continue;
    if (seen.has(current)) continue;
    seen.add(current);
    freeze(current);
    if (arrayIsArray(current)) {
      const length = canonicalArrayLength(current);
      for (let index = 0; index < length; index += 1) {
        pending = {
          value: canonicalOwnDataValue(current, stringConstructor(index)) as CanonicalJsonValue,
          next: pending,
        };
      }
    } else {
      const keys = reflectApply(objectKeys, undefined, [current]) as string[];
      for (let index = 0; index < keys.length; index += 1) {
        const key = readOwnArraySlot(keys, index);
        if (key === undefined) serializationFailure('serialization-failed');
        pending = {
          value: canonicalOwnDataValue(current, key) as CanonicalJsonValue,
          next: pending,
        };
      }
    }
  }
}

/**
 * Canonicalizes one semantically accepted core AAP event. The validation
 * boundary first creates an immutable descriptor snapshot; normalization then
 * produces a fresh canonical snapshot that is revalidated before it is
 * returned or serialized. This closes re-entrancy and time-of-check/time-of-use
 * gaps from mutable objects and proxies.
 */
export function canonicalizeEvent(input: unknown): AnyCoreEvent {
  return runCanonical(() => {
    const accepted = acceptedCoreEvent(input);
    const context = createNormalizationContext([]);
    const snapshot = normalizeJsonValue(accepted, [], context, 0);
    freezeCanonicalSnapshot(snapshot);
    const revalidated = validateEvent(snapshot);
    if (revalidated.status === 'quarantined') serializationFailure('event-quarantined');
    if (revalidated.status === 'preserved-extension')
      serializationFailure('event-extension-not-supported');
    if (revalidated.status !== 'accepted') serializationFailure('event-not-accepted');
    canonicalJsonString(snapshot);
    return snapshot as unknown as AnyCoreEvent;
  });
}

/** Serializes one accepted core AAP event as compact canonical JSON text. */
export function serializeCanonicalEvent(input: unknown): string {
  return runCanonical(() =>
    canonicalJsonString(canonicalizeEvent(input) as unknown as CanonicalJsonValue),
  );
}

/** Serializes one accepted core AAP event as deterministic UTF-8 bytes. */
export function encodeCanonicalEvent(input: unknown): Uint8Array {
  return runCanonical(() => {
    const text = serializeCanonicalEvent(input);
    try {
      return encodeUtf8(text);
    } catch {
      serializationFailure('serialization-failed');
    }
  });
}
