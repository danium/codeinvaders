import { adapterIntrinsics } from './intrinsics.js';
import { writeArrayValue } from './immutable.js';

/**
 * Builds an immutable array without calling Object.freeze or consulting an
 * array iterator. The own toJSON method keeps serialization independent of
 * Array.prototype.toJSON pollution after construction.
 */
export function createHardenedDiagnosticArray<T, R extends readonly T[]>(values: R): R {
  if (adapterIntrinsics === undefined) return values;
  const output: T[] = [];
  for (let index = 0; index < values.length; index += 1) {
    adapterIntrinsics.objectDefineProperty(output, index, {
      configurable: false,
      enumerable: true,
      value: values[index],
      writable: false,
    });
  }
  adapterIntrinsics.objectDefineProperty(output, 'length', {
    configurable: false,
    enumerable: false,
    value: values.length,
    writable: false,
  });
  adapterIntrinsics.objectDefineProperty(output, 'toJSON', {
    configurable: false,
    enumerable: false,
    value: () => output,
    writable: false,
  });
  adapterIntrinsics.objectPreventExtensions(output);
  return output as unknown as R;
}

/** Combines closed string registries using only explicit indexed reads. */
export function combineHardenedDiagnosticArrays<
  A extends readonly string[],
  B extends readonly string[],
>(first: A, second: B): readonly [...A, ...B] {
  if (adapterIntrinsics === undefined) {
    const output: string[] = [];
    let outputIndex = 0;
    for (let index = 0; index < first.length; index += 1) {
      output[outputIndex] = first[index] as string;
      outputIndex += 1;
    }
    for (let index = 0; index < second.length; index += 1) {
      output[outputIndex] = second[index] as string;
      outputIndex += 1;
    }
    return output as unknown as readonly [...A, ...B];
  }
  const values: string[] = [];
  let outputIndex = 0;
  for (let index = 0; index < first.length; index += 1) {
    writeArrayValue(values, outputIndex, first[index] as string);
    outputIndex += 1;
  }
  for (let index = 0; index < second.length; index += 1) {
    writeArrayValue(values, outputIndex, second[index] as string);
    outputIndex += 1;
  }
  return createHardenedDiagnosticArray(values) as unknown as readonly [...A, ...B];
}
