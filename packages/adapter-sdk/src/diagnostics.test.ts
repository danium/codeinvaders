import { MAX_JSON_DEPTH, protocolDiagnosticCodes, validateEvent } from '@codeinvaders/protocol';
import { validEventFixture } from '@codeinvaders/protocol/fixtures';
import { describe, expect, it } from 'vitest';
import {
  adapterBoundaryDiagnosticCodes,
  adapterDiagnosticCodes,
  adapterDiagnosticFields,
  adapterDiagnosticSeverities,
  buildAdapterDiagnostic,
  createAdapterDiagnostic,
  MAX_DIAGNOSTIC_COUNT,
  MAX_DIAGNOSTIC_DURATION_MS,
  MAX_DIAGNOSTIC_INPUT_WORK,
  normalizeAdapterDiagnostic,
  protocolDiagnosticFields,
} from './index.js';

const canary = 'DIAGNOSTIC_CANARY command --secret /private https://example.invalid';

function structuralFailureValue(): object {
  return new Proxy(Object.create(null), {
    getPrototypeOf: () => {
      throw new Error('synthetic structural failure');
    },
  });
}

function generatedProtocolDiagnosticInputs(): readonly Record<string, unknown>[] {
  const inputs: Record<string, unknown>[] = [];
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
  let nested: unknown = { leaf: true };
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

  const noField = new Proxy(validEventFixture('session.started'), {
    ownKeys: () => {
      throw new Error('synthetic root structural failure');
    },
  });
  inputs[inputs.length] = noField;
  return inputs;
}

function diagnosticGraph(lastChildPropertyCount: number): Record<string, unknown> {
  const root = Object.create(null) as Record<string, unknown>;
  root.code = 'native-input-invalid';
  for (let childIndex = 0; childIndex < 255; childIndex += 1) {
    const child = Object.create(null) as Record<string, unknown>;
    const propertyCount = childIndex === 254 ? lastChildPropertyCount : 31;
    for (let propertyIndex = 0; propertyIndex < propertyCount; propertyIndex += 1)
      child[`property-${childIndex}-${propertyIndex}`] = propertyIndex;
    root[`child-${childIndex}`] = child;
  }
  return root;
}

describe('adapter diagnostics', () => {
  it('publishes a closed registry that reuses protocol diagnostic codes', () => {
    expect(adapterDiagnosticCodes.slice(0, protocolDiagnosticCodes.length)).toEqual(
      protocolDiagnosticCodes,
    );
    expect(adapterDiagnosticCodes).toEqual([
      ...protocolDiagnosticCodes,
      ...adapterBoundaryDiagnosticCodes,
    ]);
    expect(Object.isFrozen(adapterDiagnosticCodes)).toBe(true);
    expect(Object.isFrozen(adapterBoundaryDiagnosticCodes)).toBe(true);
    expect(Reflect.set(adapterDiagnosticCodes as unknown as object, '0', canary)).toBe(false);
  });

  it('serializes every public diagnostic registry despite Array prototype pollution', () => {
    const registries = [
      adapterBoundaryDiagnosticCodes,
      adapterDiagnosticCodes,
      protocolDiagnosticFields,
      adapterDiagnosticFields,
      adapterDiagnosticSeverities,
    ] as const;
    const expected: string[] = [];
    for (let index = 0; index < registries.length; index += 1) {
      const registry = registries[index];
      if (registry === undefined) throw new Error('missing diagnostic registry');
      expected[index] = JSON.stringify(registry);
    }

    const originalToJSON = Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON');
    const originalIterator = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
    const observedJson: string[] = [];
    const observedFrozen: boolean[] = [];
    let observedFirst: unknown;
    try {
      Object.defineProperty(Array.prototype, 'toJSON', {
        configurable: true,
        enumerable: false,
        value: () => 'POLLUTED',
        writable: true,
      });
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        configurable: true,
        enumerable: false,
        value: () => {
          throw new Error('synthetic iterator pollution');
        },
        writable: true,
      });

      for (let index = 0; index < registries.length; index += 1) {
        const registry = registries[index];
        if (registry === undefined) {
          observedJson[index] = 'missing';
          observedFrozen[index] = false;
          continue;
        }
        observedJson[index] = JSON.stringify(registry);
        observedFrozen[index] = Object.isFrozen(registry);
      }
      observedFirst = adapterDiagnosticCodes[0];
    } finally {
      if (originalToJSON === undefined) delete (Array.prototype as { toJSON?: unknown }).toJSON;
      else Object.defineProperty(Array.prototype, 'toJSON', originalToJSON);
      if (originalIterator === undefined) Reflect.deleteProperty(Array.prototype, Symbol.iterator);
      else Object.defineProperty(Array.prototype, Symbol.iterator, originalIterator);
    }
    expect(observedJson).toEqual(expected);
    expect(observedFrozen).toEqual(registries.map(() => true));
    expect(observedFirst).toBe(protocolDiagnosticCodes[0]);
  });

  it('does not expose native input through post-import numeric pollution', () => {
    const originalNumeric = Object.getOwnPropertyDescriptor(Array.prototype, '0');
    const nativeInput = {
      code: 'native-input-invalid',
      field: 'native-input',
      sensitive: canary,
    };
    let getterCalls = 0;
    let setterCalls = 0;
    const seenValues = new Set<unknown>();
    let diagnostic: ReturnType<typeof buildAdapterDiagnostic> | undefined;
    try {
      Object.defineProperty(Array.prototype, '0', {
        configurable: true,
        enumerable: false,
        get: () => {
          getterCalls += 1;
          return undefined;
        },
        set: (value: unknown) => {
          setterCalls += 1;
          seenValues.add(value);
        },
      });

      diagnostic = buildAdapterDiagnostic(nativeInput);
    } finally {
      if (originalNumeric === undefined) Reflect.deleteProperty(Array.prototype, '0');
      else Object.defineProperty(Array.prototype, '0', originalNumeric);
    }

    expect(diagnostic).toEqual({
      code: 'native-input-invalid',
      severity: 'error',
      boundary: 'adapter',
      field: 'native-input',
    });
    expect(getterCalls).toBe(0);
    expect(setterCalls).toBe(0);
    expect(seenValues.has(nativeInput)).toBe(false);
    expect(JSON.stringify(diagnostic)).not.toContain(canary);
  });

  it('normalizes protocol and adapter diagnostics to fixed safe records', () => {
    expect(
      buildAdapterDiagnostic({
        code: 'event-too-large',
        severity: 'warning',
        field: 'size',
        count: 2,
        durationMs: 17,
        message: canary,
      }),
    ).toEqual({
      code: 'event-too-large',
      severity: 'error',
      boundary: 'protocol',
      field: 'size',
      count: 2,
      durationMs: 17,
    });
    expect(
      createAdapterDiagnostic('native-input-invalid', {
        severity: 'info',
        field: 'native-input',
      }),
    ).toEqual({
      code: 'native-input-invalid',
      severity: 'error',
      boundary: 'adapter',
      field: 'native-input',
    });
    expect(normalizeAdapterDiagnostic({ code: 'extension-preserved', field: 'type' })).toEqual({
      code: 'extension-preserved',
      severity: 'warning',
      boundary: 'protocol',
      field: 'type',
    });
  });

  it('derives severity from every code and ignores downgrade attempts', () => {
    const warningCodes = new Set([
      'extension-preserved',
      'native-schema-unsupported',
      'native-correlation-ambiguous',
      'native-correlation-missing',
      'capability-degraded',
      'delivery-unavailable',
      'runtime-timeout',
    ]);
    for (const code of adapterDiagnosticCodes) {
      const expected = warningCodes.has(code) ? 'warning' : 'error';
      expect(
        buildAdapterDiagnostic({ code, severity: 'info', field: 'native-input' }),
        code,
      ).toHaveProperty('severity', expected);
      expect(
        createAdapterDiagnostic(code, { severity: 'warning', field: 'native-input' }),
        code,
      ).toHaveProperty('severity', expected);
    }
    expect(buildAdapterDiagnostic({ code: 'native-input-invalid', severity: 'info' })).toEqual({
      code: 'native-input-invalid',
      severity: 'error',
      boundary: 'adapter',
    });
  });

  it('preserves every actual validator code/field pair and omits false combinations', () => {
    const observed = new Set<string>();
    for (const input of generatedProtocolDiagnosticInputs()) {
      const result = validateEvent(input);
      expect(result.status).not.toBe('accepted');
      const diagnostic = result.diagnostics[0];
      if (diagnostic === undefined) throw new Error('validator produced no diagnostic');
      const key = `${diagnostic.code}:${diagnostic.field ?? ''}`;
      observed.add(key);
      const normalized = buildAdapterDiagnostic(diagnostic);
      expect(normalized.code, key).toBe(diagnostic.code);
      if (diagnostic.field === undefined) expect(normalized).not.toHaveProperty('field');
      else expect(normalized).toHaveProperty('field', diagnostic.field);
    }

    for (let codeIndex = 0; codeIndex < protocolDiagnosticCodes.length; codeIndex += 1) {
      const code = protocolDiagnosticCodes[codeIndex];
      if (code === undefined) continue;
      for (let fieldIndex = 0; fieldIndex < protocolDiagnosticFields.length; fieldIndex += 1) {
        const field = protocolDiagnosticFields[fieldIndex];
        if (field === undefined) continue;
        const key = `${code}:${field}`;
        if (observed.has(key)) {
          expect(buildAdapterDiagnostic({ code, field }), key).toHaveProperty('field', field);
        } else {
          expect(buildAdapterDiagnostic({ code, field }), key).not.toHaveProperty('field');
        }
      }
    }
    expect(observed).toContain('invalid-envelope:type');
    expect(observed).toContain('invalid-envelope:extension');
    expect(observed).toContain('invalid-envelope:scope');
    expect(observed).toContain('invalid-envelope:data');
    expect(observed).toContain('invalid-envelope:');
  });

  it('enforces the exact aggregate descriptor-work boundary', () => {
    expect(MAX_DIAGNOSTIC_INPUT_WORK).toBe(16_384);
    expect(buildAdapterDiagnostic(diagnosticGraph(61))).toEqual({
      code: 'native-input-invalid',
      severity: 'error',
      boundary: 'adapter',
    });
    expect(buildAdapterDiagnostic(diagnosticGraph(62))).toEqual({
      code: 'diagnostic-invalid',
      severity: 'error',
      boundary: 'adapter',
    });
  });

  it('keeps adapter fields truthful for adapter-owned codes', () => {
    const allowed: Record<(typeof adapterBoundaryDiagnosticCodes)[number], readonly string[]> = {
      'native-input-invalid': ['native-input'],
      'native-schema-unsupported': ['native-schema'],
      'native-field-invalid': ['native-field'],
      'native-correlation-ambiguous': ['correlation'],
      'native-correlation-missing': ['correlation'],
      'identity-derivation-failed': ['identity'],
      'payload-build-failed': ['payload'],
      'capability-degraded': ['capability'],
      'delivery-unavailable': ['delivery'],
      'runtime-timeout': ['runtime', 'duration'],
      'runtime-limit-exceeded': ['runtime', 'count', 'duration'],
      'diagnostic-invalid': ['code'],
    };
    for (const code of adapterBoundaryDiagnosticCodes) {
      for (const field of adapterDiagnosticFields) {
        const result = buildAdapterDiagnostic({ code, field });
        if (allowed[code].some((allowedField) => allowedField === field))
          expect(result, `${code}:${field}`).toHaveProperty('field', field);
        else expect(result, `${code}:${field}`).not.toHaveProperty('field');
      }
    }
  });

  it('omits invalid metrics and accepts only explicitly bounded integers', () => {
    expect(
      buildAdapterDiagnostic({
        code: 'runtime-limit-exceeded',
        count: 0,
        durationMs: 0,
      }),
    ).toEqual({
      code: 'runtime-limit-exceeded',
      severity: 'error',
      boundary: 'adapter',
      count: 0,
      durationMs: 0,
    });
    expect(
      buildAdapterDiagnostic({
        code: 'runtime-limit-exceeded',
        count: MAX_DIAGNOSTIC_COUNT,
        durationMs: MAX_DIAGNOSTIC_DURATION_MS,
      }),
    ).toEqual({
      code: 'runtime-limit-exceeded',
      severity: 'error',
      boundary: 'adapter',
      count: MAX_DIAGNOSTIC_COUNT,
      durationMs: MAX_DIAGNOSTIC_DURATION_MS,
    });
    expect(
      buildAdapterDiagnostic({
        code: 'runtime-limit-exceeded',
        count: MAX_DIAGNOSTIC_COUNT + 1,
        durationMs: MAX_DIAGNOSTIC_DURATION_MS + 1,
      }),
    ).toEqual({
      code: 'runtime-limit-exceeded',
      severity: 'error',
      boundary: 'adapter',
    });

    const invalidMetrics: readonly unknown[] = [-1, -0.5, 1.5, Number.MAX_SAFE_INTEGER + 1, canary];
    for (const value of invalidMetrics) {
      expect(
        buildAdapterDiagnostic({ code: 'runtime-limit-exceeded', count: value, durationMs: value }),
      ).toEqual({
        code: 'runtime-limit-exceeded',
        severity: 'error',
        boundary: 'adapter',
      });
    }
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        buildAdapterDiagnostic({ code: 'runtime-limit-exceeded', count: value, durationMs: value }),
      ).toEqual({
        code: 'diagnostic-invalid',
        severity: 'error',
        boundary: 'adapter',
      });
    }
    expect(
      buildAdapterDiagnostic({
        code: 'runtime-limit-exceeded',
        count: {
          valueOf: () => {
            throw new Error(canary);
          },
        },
      }),
    ).toEqual({
      code: 'diagnostic-invalid',
      severity: 'error',
      boundary: 'adapter',
    });
  });

  it('fails closed for arbitrary codes, fields, inherited data, symbols, cycles, and proxies', () => {
    const symbol = Symbol('native-secret');
    const inherited = Object.create({
      code: 'event-too-large',
      field: 'size',
      count: 9,
    }) as Record<string | symbol, unknown>;
    inherited.message = canary;
    inherited[symbol] = canary;
    inherited.cycle = inherited;
    expect(buildAdapterDiagnostic(inherited)).toEqual({
      code: 'diagnostic-invalid',
      severity: 'error',
      boundary: 'adapter',
    });

    expect(buildAdapterDiagnostic({ code: canary, field: canary })).toEqual({
      code: 'diagnostic-invalid',
      severity: 'error',
      boundary: 'adapter',
    });

    const transparent = new Proxy(
      { code: 'native-input-invalid' },
      {
        getOwnPropertyDescriptor: () => {
          throw new Error(canary);
        },
        getPrototypeOf: () => {
          throw new Error(canary);
        },
      },
    );
    const revoked = Proxy.revocable({ code: 'native-input-invalid' }, {});
    revoked.revoke();
    expect(() => buildAdapterDiagnostic(transparent)).not.toThrow();
    expect(() => buildAdapterDiagnostic(revoked.proxy)).not.toThrow();
    expect(buildAdapterDiagnostic(transparent)).toEqual({
      code: 'diagnostic-invalid',
      severity: 'error',
      boundary: 'adapter',
    });
    expect(buildAdapterDiagnostic(revoked.proxy)).toEqual({
      code: 'diagnostic-invalid',
      severity: 'error',
      boundary: 'adapter',
    });

    const ownSymbol = Object.create(null) as Record<string | symbol, unknown>;
    ownSymbol.code = 'native-input-invalid';
    ownSymbol[symbol] = canary;
    expect(buildAdapterDiagnostic(ownSymbol)).toEqual({
      code: 'diagnostic-invalid',
      severity: 'error',
      boundary: 'adapter',
    });

    const cycle = { code: 'native-input-invalid' } as Record<string, unknown>;
    cycle.ignored = cycle;
    expect(buildAdapterDiagnostic(cycle)).toEqual({
      code: 'diagnostic-invalid',
      severity: 'error',
      boundary: 'adapter',
    });

    const throwingPrototype = new Proxy(Object.create(null), {
      getPrototypeOf: () => {
        throw new Error(canary);
      },
    });
    const proxyPrototype = Object.create(throwingPrototype) as Record<string, unknown>;
    proxyPrototype.code = 'native-input-invalid';
    expect(() => buildAdapterDiagnostic(proxyPrototype)).not.toThrow();
    expect(buildAdapterDiagnostic(proxyPrototype)).toEqual({
      code: 'diagnostic-invalid',
      severity: 'error',
      boundary: 'adapter',
    });
  });

  it('does not invoke accessors or expose canaries in records or JSON', () => {
    let reads = 0;
    const input = {} as Record<string, unknown>;
    Object.defineProperty(input, 'code', {
      configurable: true,
      get: () => {
        reads += 1;
        throw new Error(canary);
      },
    });
    Object.defineProperty(input, 'count', {
      configurable: true,
      get: () => {
        reads += 1;
        throw new Error(canary);
      },
    });
    Object.defineProperty(input, 'ignored', {
      configurable: true,
      get: () => {
        reads += 1;
        throw new Error(canary);
      },
    });

    const diagnostic = buildAdapterDiagnostic(input);
    expect(reads).toBe(0);
    expect(diagnostic).toEqual({
      code: 'diagnostic-invalid',
      severity: 'error',
      boundary: 'adapter',
    });
    expect(Object.getPrototypeOf(diagnostic)).toBeNull();
    expect(Object.isFrozen(diagnostic)).toBe(true);
    expect(Reflect.set(diagnostic, 'message', canary)).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(diagnostic, 'message')).toBe(false);
    expect(JSON.stringify(diagnostic)).not.toContain(canary);
    expect(JSON.stringify({ diagnostic })).not.toContain(canary);
  });

  it('retains honest null-prototype records while ignoring safe unknown scalars', () => {
    const input = Object.create(null) as Record<string, unknown>;
    input.code = 'native-field-invalid';
    input.field = 'native-field';
    input.message = canary;
    expect(buildAdapterDiagnostic(input)).toEqual({
      code: 'native-field-invalid',
      severity: 'error',
      boundary: 'adapter',
      field: 'native-field',
    });
    expect(JSON.stringify(buildAdapterDiagnostic(input))).not.toContain(canary);
  });

  it('survives Object.prototype toJSON and mutable intrinsic poisoning', () => {
    const originalToJSON = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
    const originalCode = Object.getOwnPropertyDescriptor(Object.prototype, 'code');
    const originalFreeze = Object.freeze;
    let diagnostic: ReturnType<typeof buildAdapterDiagnostic> | undefined;
    let diagnosticPrototype: object | null | undefined;
    let diagnosticFrozen: boolean | undefined;
    let diagnosticJson: string | undefined;
    let hasMessage: boolean | undefined;
    try {
      Object.defineProperty(Object.prototype, 'toJSON', {
        configurable: true,
        enumerable: false,
        value: () => canary,
        writable: true,
      });
      Object.defineProperty(Object.prototype, 'code', {
        configurable: true,
        enumerable: false,
        value: 'event-too-large',
        writable: true,
      });
      Object.freeze = (() => {
        throw new Error(canary);
      }) as typeof Object.freeze;

      diagnostic = buildAdapterDiagnostic({
        code: 'native-input-invalid',
        field: 'native-input',
      });
      diagnosticPrototype = Object.getPrototypeOf(diagnostic);
      diagnosticFrozen = Object.isFrozen(diagnostic);
      diagnosticJson = JSON.stringify(diagnostic);
      hasMessage = Object.prototype.hasOwnProperty.call(diagnostic, 'message');
    } finally {
      Object.freeze = originalFreeze;
      if (originalToJSON === undefined) delete (Object.prototype as { toJSON?: unknown }).toJSON;
      else Object.defineProperty(Object.prototype, 'toJSON', originalToJSON);
      if (originalCode === undefined) delete (Object.prototype as { code?: unknown }).code;
      else Object.defineProperty(Object.prototype, 'code', originalCode);
    }
    expect(diagnosticPrototype).toBeNull();
    expect(diagnosticFrozen).toBe(true);
    expect(diagnosticJson).toBe(
      '{"code":"native-input-invalid","severity":"error","boundary":"adapter","field":"native-input"}',
    );
    expect(hasMessage).toBe(false);
    expect(diagnostic).not.toHaveProperty('message');
  });
});
