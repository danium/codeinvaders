import { adapterIntrinsics } from './intrinsics.js';

/** Writes an array element without consulting an inherited numeric property. */
export function writeArrayValue<T>(array: T[], index: number, value: T): void {
  if (adapterIntrinsics === undefined) throw new Error('adapter bootstrap unavailable');
  adapterIntrinsics.objectDefineProperty(array, index, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

/** Appends an array element without consulting an inherited numeric property. */
export function appendArrayValue<T>(array: T[], value: T): void {
  writeArrayValue(array, array.length, value);
}

/** Shallow Object.freeze-equivalent that does not call the mutable intrinsic. */
export function harden<T extends object>(value: T): T {
  if (adapterIntrinsics === undefined) return value;
  const keys = adapterIntrinsics.reflectOwnKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === undefined) continue;
    const descriptor = adapterIntrinsics.objectGetOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) continue;
    if ('writable' in descriptor) {
      if (descriptor.configurable || descriptor.writable) {
        adapterIntrinsics.objectDefineProperty(value, key, {
          configurable: false,
          enumerable: descriptor.enumerable === true,
          value: descriptor.value,
          writable: false,
        });
      }
    } else if (descriptor.configurable) {
      const immutableDescriptor: PropertyDescriptor = {
        configurable: false,
        enumerable: descriptor.enumerable === true,
      };
      if (descriptor.get !== undefined) immutableDescriptor.get = descriptor.get;
      if (descriptor.set !== undefined) immutableDescriptor.set = descriptor.set;
      adapterIntrinsics.objectDefineProperty(value, key, immutableDescriptor);
    }
  }
  adapterIntrinsics.objectPreventExtensions(value);
  return value;
}
