import { isProxy as nodeIsProxy } from 'node:util/types';
import { appendArrayValue, harden } from './immutable.js';

/**
 * Small, non-coercing snapshots for hostile adapter input.
 *
 * Only explicitly requested own data properties are inspected. Accessors,
 * inherited properties, symbols, and unknown metadata are intentionally
 * ignored. The snapshot contains the value returned by the descriptor once;
 * callers must still validate that value before putting anything in a payload.
 */

const getPrototypeOf = Object.getPrototypeOf;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const freeze = harden;
const create = Object.create;
const defineProperty = Object.defineProperty;
const preventExtensions = Object.preventExtensions;
const isArray = Array.isArray;

export interface SafePropertySnapshot {
  readonly key: string;
  readonly value: unknown;
}

/** Creates a pollution-proof immutable record with only the supplied own keys. */
export function makeImmutableRecord<T extends object>(
  entries: readonly (readonly [string, unknown])[],
): T {
  const output = create(null) as Record<string, unknown>;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === undefined) continue;
    defineProperty(output, entry[0], {
      configurable: false,
      enumerable: true,
      value: entry[1],
      writable: false,
    });
  }
  preventExtensions(output);
  return output as T;
}

function isPlainRecord(value: unknown): value is object {
  if (value === null || typeof value !== 'object') return false;

  try {
    if (nodeIsProxy(value)) return false;
    if (isArray(value)) return false;
    const prototype = getPrototypeOf(value);
    if (prototype === null) return true;
    return getPrototypeOf(prototype) === null;
  } catch {
    return false;
  }
}

/** Takes one safe descriptor snapshot for each allowlisted property. */
export function snapshotAllowedProperties(
  input: unknown,
  keys: readonly string[],
): readonly SafePropertySnapshot[] {
  if (!isPlainRecord(input)) return freeze([]);

  const snapshot: SafePropertySnapshot[] = [];
  try {
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (key === undefined) continue;
      const descriptor = getOwnPropertyDescriptor(input, key);
      if (descriptor === undefined) continue;
      const valueDescriptor = getOwnPropertyDescriptor(descriptor, 'value');
      if (valueDescriptor === undefined) continue;
      appendArrayValue(
        snapshot,
        makeImmutableRecord<SafePropertySnapshot>([
          ['key', key],
          ['value', valueDescriptor.value],
        ]),
      );
    }
  } catch {
    return freeze([]);
  }

  return freeze(snapshot);
}

/** Reads a previously snapshotted property without touching the native input. */
export function readSnapshot(
  snapshot: readonly SafePropertySnapshot[],
  key: string,
): unknown | undefined {
  for (let index = 0; index < snapshot.length; index += 1) {
    const property = snapshot[index];
    if (property !== undefined && property.key === key) return property.value;
  }
  return undefined;
}

/** Returns the first present value from an explicit ordered allowlist. */
export function readFirstSnapshot(
  snapshot: readonly SafePropertySnapshot[],
  keys: readonly string[],
): unknown | undefined {
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === undefined) continue;
    const value = readSnapshot(snapshot, key);
    if (value !== undefined) return value;
  }
  return undefined;
}
