import { runInNewContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { buildAdapterDiagnostic, createAdapterDiagnostic } from './index.js';

describe('cross-realm adapter diagnostics', () => {
  it('imports the complete adapter after pre-import intrinsic poisoning', () => {
    const probes = [
      "Object.freeze = () => { throw new Error('synthetic freeze poison'); };",
      "Object.defineProperty(Array.prototype, Symbol.iterator, { configurable: true, value: () => { throw new Error('synthetic iterator poison'); }, writable: true });",
    ];
    for (const poison of probes) {
      const child = spawnSync(
        globalThis.process.execPath,
        [
          '--input-type=module',
          '--eval',
          `await import('@codeinvaders/protocol'); ${poison} const sdk = await import('./dist/index.js'); if (sdk.adapterDiagnosticCodes[0] !== 'invalid-envelope') throw new Error('registry import failed');`,
        ],
        { cwd: new globalThis.URL('..', import.meta.url), encoding: 'utf8', windowsHide: true },
      );
      expect(child.status, 'fresh-module poison probe').toBe(0);
    }
  });

  it('does not consult numeric Array prototype accessors during diagnostic building', () => {
    const child = spawnSync(
      globalThis.process.execPath,
      [
        '--input-type=module',
        '--eval',
        `
          const sdk = await import('./dist/index.js');
          const nativeInput = { code: 'native-input-invalid', field: 'native-input', sensitive: 'NUMERIC_POLLUTION_CANARY' };
          let getterCalls = 0;
          let setterCalls = 0;
          const originalNumeric = Object.getOwnPropertyDescriptor(Array.prototype, '0');
          Object.defineProperty(Array.prototype, '0', {
            configurable: true,
            enumerable: false,
            get() { getterCalls += 1; return undefined; },
            set() { setterCalls += 1; },
          });
          try {
            const result = sdk.buildAdapterDiagnostic(nativeInput);
            if (result.code !== 'native-input-invalid' || result.field !== 'native-input') throw new Error('numeric pollution changed diagnostic');
            if (getterCalls !== 0 || setterCalls !== 0) throw new Error('numeric pollution was observed');
            console.log('ADAPTER_SDK_NUMERIC_ACCESSOR_SAFE');
          } finally {
            if (originalNumeric === undefined) Reflect.deleteProperty(Array.prototype, '0');
            else Object.defineProperty(Array.prototype, '0', originalNumeric);
          }
        `,
      ],
      { cwd: new globalThis.URL('..', import.meta.url), encoding: 'utf8', windowsHide: true },
    );
    expect(child.status, `numeric accessor probe failed: ${child.stderr}`).toBe(0);
    expect(child.stdout, 'numeric accessor safety marker').toContain(
      'ADAPTER_SDK_NUMERIC_ACCESSOR_SAFE',
    );
  });

  it('accepts genuine cross-realm records without copying extra text', () => {
    const canary = 'CROSS_REALM_DIAGNOSTIC_CANARY prompt /secret';
    const input = runInNewContext(`({
      code: 'native-field-invalid',
      severity: 'warning',
      field: 'native-field',
      count: 3,
      durationMs: 5,
      message: '${canary}',
      nested: { leak: '${canary}' }
    })`);
    const diagnostic = buildAdapterDiagnostic(input);
    expect(diagnostic).toEqual({
      code: 'native-field-invalid',
      severity: 'error',
      boundary: 'adapter',
      field: 'native-field',
      count: 3,
      durationMs: 5,
    });
    expect(JSON.stringify(diagnostic)).not.toContain(canary);
    expect(Object.getPrototypeOf(diagnostic)).toBeNull();
  });

  it('fails closed for cross-realm proxies and coercion objects', () => {
    const canary = 'CROSS_REALM_PROXY_CANARY command --token';
    const proxy = runInNewContext(`new Proxy({ code: 'native-input-invalid' }, {
      getOwnPropertyDescriptor() { throw new Error('${canary}'); },
      getPrototypeOf() { throw new Error('${canary}'); }
    })`);
    const coercion = runInNewContext(`({
      code: { valueOf() { throw new Error('${canary}'); } },
      count: { [Symbol.toPrimitive]() { throw new Error('${canary}'); } }
    })`);

    expect(() => buildAdapterDiagnostic(proxy)).not.toThrow();
    expect(buildAdapterDiagnostic(proxy)).toEqual({
      code: 'diagnostic-invalid',
      severity: 'error',
      boundary: 'adapter',
    });
    expect(() => createAdapterDiagnostic('runtime-timeout', coercion)).not.toThrow();
    expect(createAdapterDiagnostic('runtime-timeout', coercion)).toEqual({
      code: 'diagnostic-invalid',
      severity: 'error',
      boundary: 'adapter',
    });
  });
});
