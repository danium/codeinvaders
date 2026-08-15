const defineProperty = Object.defineProperty;
const preventExtensions = Object.preventExtensions;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ownKeys = Reflect.ownKeys;

/** Writes an array element without consulting an inherited numeric property. */
export function writeArrayValue<T>(array: T[], index: number, value: T): void {
  defineProperty(array, index, {
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
  const keys = ownKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === undefined) continue;
    const descriptor = getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) continue;
    if ('writable' in descriptor) {
      if (descriptor.configurable || descriptor.writable) {
        defineProperty(value, key, {
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
      defineProperty(value, key, immutableDescriptor);
    }
  }
  preventExtensions(value);
  return value;
}
