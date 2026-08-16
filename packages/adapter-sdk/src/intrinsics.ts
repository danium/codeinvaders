/**
 * Adapter-local intrinsic capture.
 *
 * A poisoned structural intrinsic is not repaired or treated as usable. The
 * complete capture is either behaviorally verified or unavailable; callers
 * must fail closed in the latter case. Keeping this decision in one module
 * also prevents top-level registries from invoking a poisoned function while
 * the rest of the SDK is bootstrapping.
 */
export interface AdapterIntrinsics {
  readonly arrayConstructor: typeof Array;
  readonly arrayIsArray: typeof Array.isArray;
  readonly arrayBufferIsView: typeof ArrayBuffer.isView;
  readonly functionApply: typeof Function.prototype.apply;
  readonly functionCall: typeof Function.prototype.call;
  readonly objectCreate: typeof Object.create;
  readonly objectDefineProperty: typeof Object.defineProperty;
  readonly objectGetOwnPropertyDescriptor: typeof Object.getOwnPropertyDescriptor;
  readonly objectGetPrototypeOf: typeof Object.getPrototypeOf;
  readonly objectKeys: typeof Object.keys;
  readonly objectPreventExtensions: typeof Object.preventExtensions;
  readonly reflectApply: typeof Reflect.apply;
  readonly reflectOwnKeys: typeof Reflect.ownKeys;
  readonly regExpConstructor: typeof RegExp;
  readonly regExpPrototype: typeof RegExp.prototype;
  readonly regExpTest: typeof RegExp.prototype.test;
  readonly textEncoderConstructor: typeof TextEncoder;
  readonly textEncoderEncode: typeof TextEncoder.prototype.encode;
  readonly typedArrayByteLengthGetter: () => number;
  readonly typedArrayBufferGetter: () => ArrayBuffer;
  readonly typedArrayByteOffsetGetter: () => number;
  readonly typedArrayFill: typeof Uint8Array.prototype.fill;
  readonly typedArraySet: typeof Uint8Array.prototype.set;
  readonly typedArrayTagGetter: () => string;
  readonly uint8ArrayConstructor: typeof Uint8Array;
  readonly uint8ArrayPrototype: typeof Uint8Array.prototype;
}

function captureAdapterIntrinsics(): AdapterIntrinsics | undefined {
  try {
    const objectConstructor = globalThis.Object;
    const arrayConstructor = globalThis.Array;
    const arrayBufferConstructor = globalThis.ArrayBuffer;
    const functionConstructor = globalThis.Function;
    const jsonObject = globalThis.JSON;
    const reflectObject = globalThis.Reflect;
    const textEncoderConstructor = globalThis.TextEncoder;
    const uint8ArrayConstructor = globalThis.Uint8Array;
    const objectCreate = objectConstructor.create;
    const objectDefineProperty = objectConstructor.defineProperty;
    const objectGetOwnPropertyDescriptor = objectConstructor.getOwnPropertyDescriptor;
    const objectGetPrototypeOf = objectConstructor.getPrototypeOf;
    const objectKeys = objectConstructor.keys;
    const objectPreventExtensions = objectConstructor.preventExtensions;
    const arrayIsArray = arrayConstructor.isArray;
    const arrayBufferIsView = arrayBufferConstructor?.isView;
    const reflectApply = reflectObject.apply;
    const reflectOwnKeys = reflectObject.ownKeys;
    const regExpConstructor = globalThis.RegExp;
    const functionApply = functionConstructor.prototype.apply;
    const functionCall = functionConstructor.prototype.call;
    const textEncoderEncode = textEncoderConstructor?.prototype.encode;
    const regExpPrototype = regExpConstructor?.prototype;
    const regExpTestDescriptor =
      regExpPrototype === undefined
        ? undefined
        : objectGetOwnPropertyDescriptor(regExpPrototype, 'test');
    const regExpTest = regExpTestDescriptor?.value;

    if (
      typeof objectCreate !== 'function' ||
      typeof objectDefineProperty !== 'function' ||
      typeof objectGetOwnPropertyDescriptor !== 'function' ||
      typeof objectGetPrototypeOf !== 'function' ||
      typeof objectKeys !== 'function' ||
      typeof objectPreventExtensions !== 'function' ||
      typeof arrayIsArray !== 'function' ||
      typeof arrayBufferIsView !== 'function' ||
      typeof reflectApply !== 'function' ||
      typeof reflectOwnKeys !== 'function' ||
      typeof functionApply !== 'function' ||
      typeof functionCall !== 'function' ||
      typeof regExpConstructor !== 'function' ||
      typeof regExpPrototype !== 'object' ||
      regExpPrototype === null ||
      typeof regExpTest !== 'function' ||
      regExpTestDescriptor?.get !== undefined ||
      regExpTestDescriptor?.set !== undefined ||
      typeof textEncoderConstructor !== 'function' ||
      typeof textEncoderEncode !== 'function' ||
      typeof uint8ArrayConstructor !== 'function'
    )
      return undefined;

    const probe = objectCreate(null) as Record<string, unknown>;
    objectDefineProperty(probe, 'key', {
      configurable: true,
      enumerable: true,
      value: 'value',
      writable: true,
    });
    const descriptor = objectGetOwnPropertyDescriptor(probe, 'key');
    const keys = objectKeys(probe);
    const ownKeys = reflectOwnKeys(probe);
    if (
      objectGetPrototypeOf(probe) !== null ||
      descriptor?.value !== 'value' ||
      keys.length !== 1 ||
      keys[0] !== 'key' ||
      ownKeys.length !== 1 ||
      ownKeys[0] !== 'key'
    )
      return undefined;

    const arrayProbe = new arrayConstructor(1);
    if (!arrayIsArray(arrayProbe) || arrayIsArray(probe)) return undefined;

    const regExpProbe = new regExpConstructor('^a$');
    if (
      objectGetPrototypeOf(regExpProbe) !== regExpPrototype ||
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
      reflectApply(jsonObject.stringify, undefined, ['probe']) !== '"probe"'
    )
      return undefined;

    objectPreventExtensions(probe);

    const typedArrayPrototype = objectGetPrototypeOf(uint8ArrayConstructor.prototype);
    if (typeof typedArrayPrototype !== 'object' || typedArrayPrototype === null) return undefined;
    const tagDescriptor = objectGetOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag);
    const bufferDescriptor = objectGetOwnPropertyDescriptor(typedArrayPrototype, 'buffer');
    const byteOffsetDescriptor = objectGetOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset');
    const byteLengthDescriptor = objectGetOwnPropertyDescriptor(typedArrayPrototype, 'byteLength');
    const typedArrayTagGetter = tagDescriptor?.get;
    const typedArrayBufferGetter = bufferDescriptor?.get;
    const typedArrayByteOffsetGetter = byteOffsetDescriptor?.get;
    const typedArrayByteLengthGetter = byteLengthDescriptor?.get;
    const typedArrayFill = uint8ArrayConstructor.prototype.fill;
    const typedArraySet = uint8ArrayConstructor.prototype.set;
    if (
      typeof typedArrayTagGetter !== 'function' ||
      typeof typedArrayBufferGetter !== 'function' ||
      typeof typedArrayByteOffsetGetter !== 'function' ||
      typeof typedArrayByteLengthGetter !== 'function' ||
      typeof typedArrayFill !== 'function' ||
      typeof typedArraySet !== 'function'
    )
      return undefined;

    const typedArrayProbe = new uint8ArrayConstructor(4);
    const typedArrayProbeTag = reflectApply(typedArrayTagGetter, typedArrayProbe, []);
    if (
      typedArrayProbeTag !== 'Uint8Array' ||
      reflectApply(typedArrayByteLengthGetter, typedArrayProbe, []) !== 4 ||
      reflectApply(arrayBufferIsView, undefined, [typedArrayProbe]) !== true ||
      reflectApply(arrayBufferIsView, undefined, [{}]) !== false
    )
      return undefined;
    reflectApply(typedArrayFill, typedArrayProbe, [0]);
    if (typedArrayProbe[0] !== 0) return undefined;
    const typedArrayViewProbe = new uint8ArrayConstructor(
      reflectApply(typedArrayBufferGetter, typedArrayProbe, []),
      1,
      2,
    );
    if (
      reflectApply(typedArrayTagGetter, typedArrayViewProbe, []) !== 'Uint8Array' ||
      reflectApply(typedArrayByteOffsetGetter, typedArrayViewProbe, []) !== 1 ||
      reflectApply(typedArrayByteLengthGetter, typedArrayViewProbe, []) !== 2
    )
      return undefined;
    const typedArraySource = new uint8ArrayConstructor(2);
    typedArraySource[0] = 0xa5;
    typedArraySource[1] = 0x5a;
    reflectApply(typedArraySet, typedArrayProbe, [typedArraySource, 1]);
    if (typedArrayProbe[1] !== 0xa5 || typedArrayProbe[2] !== 0x5a) return undefined;

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
      functionApply,
      functionCall,
      objectCreate,
      objectDefineProperty,
      objectGetOwnPropertyDescriptor,
      objectGetPrototypeOf,
      objectKeys,
      objectPreventExtensions,
      reflectApply,
      reflectOwnKeys,
      regExpConstructor,
      regExpPrototype,
      regExpTest,
      textEncoderConstructor,
      textEncoderEncode,
      typedArrayByteLengthGetter,
      typedArrayBufferGetter,
      typedArrayByteOffsetGetter,
      typedArrayFill,
      typedArraySet,
      typedArrayTagGetter,
      uint8ArrayConstructor,
      uint8ArrayPrototype: uint8ArrayConstructor.prototype,
    };
  } catch {
    return undefined;
  }
}

export const adapterIntrinsics = captureAdapterIntrinsics();
export const adapterIntrinsicsReady = adapterIntrinsics !== undefined;
