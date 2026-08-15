/**
 * Keyed, privacy-safe identities used at the adapter boundary.
 *
 * Identifiers are normalized with Unicode NFC only. No trimming, case folding,
 * path conversion, separator rewriting, or locale-sensitive transformation is
 * performed. A caller that needs session-scoped native identifiers can pass
 * the stable namespace and identifier as separate components; framing keeps
 * those components unambiguous without persisting either value.
 */

const OPAQUE_ID_DOMAIN = 'io.github.danium.codeinvaders.opaque-id';
const OPAQUE_ID_FORMAT = 'oid1_';
const HMAC_HASH = 'SHA-256';
const TEXT_ENCODER = new TextEncoder();
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
type Bytes = Uint8Array<ArrayBuffer>;

/** HMAC keys are exactly 256 bits to keep the key contract unambiguous. */
export const OPAQUE_ID_KEY_BYTES = 32;
/** HMAC-SHA-256 output is retained in full; the encoded ID is 43 characters. */
export const OPAQUE_ID_OUTPUT_BYTES = 32;
/** Maximum UTF-16 code units accepted for one input component. */
export const MAX_OPAQUE_ID_COMPONENT_CODE_UNITS = 1_024;
/** Maximum number of namespace/identifier components in one derivation. */
export const MAX_OPAQUE_ID_COMPONENTS = 8;
/** Maximum UTF-8 bytes across all canonicalized input components. */
export const MAX_OPAQUE_ID_INPUT_BYTES = 4_096;

export const opaqueIdEntityTypes = Object.freeze([
  'installation',
  'workspace',
  'repository',
  'stream',
  'turn',
  'agent',
  'task',
  'operation',
  'permission',
] as const);

export type OpaqueIdEntityType = (typeof opaqueIdEntityTypes)[number];
export type OpaqueId = string & { readonly __codeinvadersOpaqueId: unique symbol };

/**
 * A single identifier or an ordered namespace plus identifier tuple.
 * Components are framed independently, so `['ab', 'c']` differs from
 * `['a', 'bc']` and does not depend on a separator that could occur in input.
 */
export type OpaqueIdInput = string | readonly string[];
export type OpaqueIdKey = Readonly<Uint8Array> | Readonly<Int8Array> | Readonly<Uint8ClampedArray>;

export type OpaqueIdErrorCode =
  | 'invalid-key'
  | 'invalid-entity-type'
  | 'invalid-identifier'
  | 'identifier-too-large'
  | 'crypto-unavailable'
  | 'derivation-failed';

const OPAQUE_ID_ERROR_CODES = Object.freeze([
  'invalid-key',
  'invalid-entity-type',
  'invalid-identifier',
  'identifier-too-large',
  'crypto-unavailable',
  'derivation-failed',
] as const);

function isOpaqueIdErrorCode(value: unknown): value is OpaqueIdErrorCode {
  if (typeof value !== 'string') return false;
  for (let index = 0; index < OPAQUE_ID_ERROR_CODES.length; index += 1) {
    if (OPAQUE_ID_ERROR_CODES[index] === value) return true;
  }
  return false;
}

/** Errors intentionally contain only a bounded public code, never input data. */
export class OpaqueIdError extends Error {
  readonly code: OpaqueIdErrorCode;

  constructor(code: OpaqueIdErrorCode) {
    const safeCode = isOpaqueIdErrorCode(code) ? code : 'derivation-failed';
    super(`opaque id derivation failed: ${safeCode}`);
    this.name = 'OpaqueIdError';
    this.code = safeCode;
    Object.freeze(this);
  }
}

export interface OpaqueIdDeriver {
  readonly derive: (entityType: OpaqueIdEntityType, input: OpaqueIdInput) => Promise<OpaqueId>;
}

function opaqueError(code: OpaqueIdErrorCode): OpaqueIdError {
  return new OpaqueIdError(code);
}

const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype);
const TYPED_ARRAY_TAG_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  Symbol.toStringTag,
)?.get;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  'buffer',
)?.get;
const TYPED_ARRAY_BYTE_OFFSET_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  'byteOffset',
)?.get;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  'byteLength',
)?.get;

function copyKey(key: unknown): Bytes {
  try {
    if (!ArrayBuffer.isView(key) || TYPED_ARRAY_TAG_GETTER === undefined) {
      throw new Error();
    }
    const tag = TYPED_ARRAY_TAG_GETTER.call(key);
    if (tag !== 'Int8Array' && tag !== 'Uint8Array' && tag !== 'Uint8ClampedArray') {
      throw new Error();
    }
    if (
      TYPED_ARRAY_BUFFER_GETTER === undefined ||
      TYPED_ARRAY_BYTE_OFFSET_GETTER === undefined ||
      TYPED_ARRAY_BYTE_LENGTH_GETTER === undefined
    ) {
      throw new Error();
    }

    const byteLength = TYPED_ARRAY_BYTE_LENGTH_GETTER.call(key);
    if (byteLength !== OPAQUE_ID_KEY_BYTES) throw new Error();
    const buffer = TYPED_ARRAY_BUFFER_GETTER.call(key);
    const byteOffset = TYPED_ARRAY_BYTE_OFFSET_GETTER.call(key);
    const source = new Uint8Array(buffer, byteOffset, byteLength);
    const copy = new Uint8Array(OPAQUE_ID_KEY_BYTES);
    copy.set(source);
    return copy;
  } catch {
    throw opaqueError('invalid-key');
  }
}

function isOpaqueIdEntityType(value: string): value is OpaqueIdEntityType {
  for (let index = 0; index < opaqueIdEntityTypes.length; index += 1) {
    if (opaqueIdEntityTypes[index] === value) return true;
  }
  return false;
}

function isControlCodePoint(codePoint: number): boolean {
  return codePoint <= 0x1f || codePoint === 0x7f || (codePoint >= 0x80 && codePoint <= 0x9f);
}

function validateUnicodeScalarString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const first = value.charCodeAt(index);
    if (first >= 0xd800 && first <= 0xdbff) {
      if (index + 1 >= value.length) throw opaqueError('invalid-identifier');
      const second = value.charCodeAt(index + 1);
      if (second < 0xdc00 || second > 0xdfff) throw opaqueError('invalid-identifier');
      const codePoint = 0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00);
      if (isControlCodePoint(codePoint)) throw opaqueError('invalid-identifier');
      index += 1;
      continue;
    }
    if (first >= 0xdc00 && first <= 0xdfff) throw opaqueError('invalid-identifier');
    if (isControlCodePoint(first)) throw opaqueError('invalid-identifier');
  }
}

interface CanonicalComponent {
  readonly bytes: Bytes;
}

function canonicalizeComponent(value: unknown): CanonicalComponent {
  if (typeof value !== 'string') throw opaqueError('invalid-identifier');
  if (value.length < 1) throw opaqueError('invalid-identifier');
  if (value.length > MAX_OPAQUE_ID_COMPONENT_CODE_UNITS) throw opaqueError('identifier-too-large');

  validateUnicodeScalarString(value);
  let normalized: string;
  try {
    normalized = value.normalize('NFC');
  } catch {
    throw opaqueError('invalid-identifier');
  }
  if (normalized.length < 1) throw opaqueError('invalid-identifier');
  if (normalized.length > MAX_OPAQUE_ID_COMPONENT_CODE_UNITS)
    throw opaqueError('identifier-too-large');
  validateUnicodeScalarString(normalized);

  const bytes = TEXT_ENCODER.encode(normalized) as Bytes;
  if (bytes.byteLength > MAX_OPAQUE_ID_INPUT_BYTES) throw opaqueError('identifier-too-large');
  return { bytes };
}

function canonicalizeInput(input: OpaqueIdInput): readonly Bytes[] {
  if (typeof input === 'string') return [canonicalizeComponent(input).bytes];

  let length: number | undefined;
  let values: unknown[] | undefined;
  try {
    if (!Array.isArray(input)) throw new Error();
    length = input.length;
    if (!Number.isInteger(length) || length < 1) throw new Error();
    if (length <= MAX_OPAQUE_ID_COMPONENTS) {
      const snapshot = new Array<unknown>(length);
      for (let index = 0; index < length; index += 1) {
        snapshot[index] = input[index];
      }
      values = snapshot;
    }
  } catch {
    throw opaqueError('invalid-identifier');
  }

  if (length === undefined) throw opaqueError('invalid-identifier');
  if (length > MAX_OPAQUE_ID_COMPONENTS) throw opaqueError('identifier-too-large');
  if (values === undefined) throw opaqueError('invalid-identifier');

  const components: Bytes[] = [];
  let totalBytes = 0;
  for (let index = 0; index < values.length; index += 1) {
    const component = canonicalizeComponent(values[index]);
    totalBytes += component.bytes.byteLength;
    if (totalBytes > MAX_OPAQUE_ID_INPUT_BYTES) throw opaqueError('identifier-too-large');
    components.push(component.bytes);
  }
  return components;
}

function writeUint32(target: Uint8Array, offset: number, value: number): number {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
  return offset + 4;
}

function framedMessage(entityType: OpaqueIdEntityType, components: readonly Bytes[]): Bytes {
  const staticParts = [
    TEXT_ENCODER.encode(OPAQUE_ID_DOMAIN),
    TEXT_ENCODER.encode('1'),
    TEXT_ENCODER.encode(entityType),
  ];
  let length = 4;
  for (let index = 0; index < staticParts.length; index += 1) {
    const part = staticParts[index];
    if (part === undefined) throw opaqueError('derivation-failed');
    length += 4 + part.byteLength;
  }
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (component === undefined) throw opaqueError('derivation-failed');
    length += 4 + component.byteLength;
  }

  const message = new Uint8Array(new ArrayBuffer(length));
  let offset = writeUint32(message, 0, staticParts.length + components.length);
  for (let index = 0; index < staticParts.length; index += 1) {
    const part = staticParts[index];
    if (part === undefined) throw opaqueError('derivation-failed');
    offset = writeUint32(message, offset, part.byteLength);
    message.set(part, offset);
    offset += part.byteLength;
  }
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (component === undefined) throw opaqueError('derivation-failed');
    offset = writeUint32(message, offset, component.byteLength);
    message.set(component, offset);
    offset += component.byteLength;
  }
  return message;
}

function base64Url(bytes: Uint8Array): string {
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const combined = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    result += BASE64URL_ALPHABET[(combined >>> 18) & 0x3f];
    result += BASE64URL_ALPHABET[(combined >>> 12) & 0x3f];
    if (second !== undefined) result += BASE64URL_ALPHABET[(combined >>> 6) & 0x3f];
    if (third !== undefined) result += BASE64URL_ALPHABET[combined & 0x3f];
  }
  return result;
}

/** Validates the fixed opaque-ID wire format without attempting derivation. */
export function isOpaqueId(value: unknown): value is OpaqueId {
  if (typeof value !== 'string') return false;
  if (value.length !== OPAQUE_ID_FORMAT.length + 43) return false;
  if (!value.startsWith(OPAQUE_ID_FORMAT)) return false;

  for (let index = OPAQUE_ID_FORMAT.length; index < value.length; index += 1) {
    if (BASE64URL_ALPHABET.indexOf(value[index] ?? '') < 0) return false;
  }
  const finalCharacter = value[value.length - 1];
  if (finalCharacter === undefined) return false;
  const finalCharacterIndex = BASE64URL_ALPHABET.indexOf(finalCharacter);
  return finalCharacterIndex >= 0 && (finalCharacterIndex & 0x03) === 0;
}

/**
 * Creates an immutable deriver backed by a non-extractable HMAC key.
 *
 * The key is copied, imported into Web Crypto, and the temporary copy is
 * cleared. The returned object retains no raw identifier and exposes no key
 * material or serialization metadata.
 */
export async function createOpaqueIdDeriver(key: OpaqueIdKey): Promise<OpaqueIdDeriver> {
  const copiedKey = copyKey(key);
  let cryptoApi: Crypto;
  try {
    cryptoApi = globalThis.crypto;
  } catch {
    copiedKey.fill(0);
    throw opaqueError('crypto-unavailable');
  }
  if (cryptoApi === undefined || cryptoApi.subtle === undefined) {
    copiedKey.fill(0);
    throw opaqueError('crypto-unavailable');
  }

  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await cryptoApi.subtle.importKey(
      'raw',
      copiedKey,
      { name: 'HMAC', hash: HMAC_HASH },
      false,
      ['sign'],
    );
  } catch {
    copiedKey.fill(0);
    throw opaqueError('derivation-failed');
  }
  copiedKey.fill(0);

  const derive = async (
    entityType: OpaqueIdEntityType,
    input: OpaqueIdInput,
  ): Promise<OpaqueId> => {
    if (!isOpaqueIdEntityType(entityType)) throw opaqueError('invalid-entity-type');
    const components = canonicalizeInput(input);
    const message = framedMessage(entityType, components);
    let signature: ArrayBuffer;
    try {
      signature = await cryptoApi.subtle.sign('HMAC', cryptoKey, message);
    } catch {
      throw opaqueError('derivation-failed');
    }
    const output = new Uint8Array(signature);
    if (output.byteLength !== OPAQUE_ID_OUTPUT_BYTES) throw opaqueError('derivation-failed');
    return `${OPAQUE_ID_FORMAT}${base64Url(output)}` as OpaqueId;
  };

  return Object.freeze({ derive });
}

/** Convenience form for one derivation; use `createOpaqueIdDeriver` for reuse. */
export async function deriveOpaqueId(
  key: OpaqueIdKey,
  entityType: OpaqueIdEntityType,
  input: OpaqueIdInput,
): Promise<OpaqueId> {
  const deriver = await createOpaqueIdDeriver(key);
  return deriver.derive(entityType, input);
}
