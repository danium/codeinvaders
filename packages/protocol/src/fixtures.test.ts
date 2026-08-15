import { describe, expect, it } from 'vitest';
import { coreEventSchemas, serializeCanonicalEvent, validateEvent } from './index.js';
import {
  correlationAmbiguityFixtures,
  coreEventFixtureTypes,
  duplicateFixtures,
  extensionFixtures,
  invalidExtensionFixtures,
  incompatibleVersionFixtures,
  commonScopeOmissionFixtures,
  eventSpecificScopeOmissionFixtures,
  invalidScopeFixtures,
  requiredScopeByEvent,
  unknownOptionalFieldFixtures,
  validCoreEventFixtures,
  validEventFixture,
} from './fixtures/index.js';

describe('protocol conformance fixtures', () => {
  it('provides one meaningful valid fixture for every core event discriminant', () => {
    const registryTypes = Object.keys(coreEventSchemas).sort();
    expect(coreEventFixtureTypes).toHaveLength(31);
    expect([...coreEventFixtureTypes].sort()).toEqual(registryTypes);

    for (const type of coreEventFixtureTypes) {
      const event = validEventFixture(type);
      const result = validateEvent(event);
      expect(result.status, type).toBe('accepted');
      if (result.status !== 'accepted') continue;
      expect(result.diagnostics, type).toEqual([]);
      expect(result.event.type, type).toBe(type);
      expect(result.event.scope.sessionId, type).toBe('session-1');
      expect(validCoreEventFixtures[type].type, type).toBe(type);
    }
  });

  it('rejects each invalid-scope fixture with its bounded exact diagnostic', () => {
    expect(commonScopeOmissionFixtures).toHaveLength(3);
    expect(eventSpecificScopeOmissionFixtures).toHaveLength(23);
    expect(invalidScopeFixtures).toHaveLength(26);
    expect(commonScopeOmissionFixtures.map((fixture) => fixture.name)).toEqual([
      'session.started-missing-workspaceId',
      'session.started-missing-sessionId',
      'task.created-missing-sessionId',
    ]);
    expect(
      eventSpecificScopeOmissionFixtures.every(
        (fixture) => fixture.omittedScope !== 'workspaceId' && fixture.omittedScope !== 'sessionId',
      ),
    ).toBe(true);
    for (const fixture of invalidScopeFixtures) {
      const result = validateEvent(fixture.event);
      expect(result, fixture.name).toEqual({
        status: 'rejected',
        diagnostics: [
          {
            code: 'invalid-scope',
            severity: 'error',
            field: 'scope',
            eventType: fixture.type,
          },
        ],
      });
      expect(fixture.omittedScope in (fixture.event.scope as Record<string, unknown>)).toBe(false);
    }
  });

  it('accepts unknown optional fields while retaining known semantics and fields', () => {
    for (const fixture of unknownOptionalFieldFixtures) {
      const result = validateEvent(fixture.event);
      expect(result.status, fixture.name).toBe('accepted');
      if (result.status !== 'accepted') continue;
      expect(result.diagnostics, fixture.name).toEqual([]);
      expect(fixture.topLevelField in result.event, fixture.name).toBe(true);
      expect(
        fixture.dataField in (result.event.data as Record<string, unknown>),
        fixture.name,
      ).toBe(true);
      expect(result.event.spec, fixture.name).toBe('io.github.danium.codeinvaders.aap');
      expect(result.event.version, fixture.name).toBe('1.1.0');
      expect(result.event.data, fixture.name).toMatchObject(fixture.expectedKnownData);
    }
  });

  it('preserves the valid documented namespaced extension case', () => {
    for (const fixture of extensionFixtures) {
      const result = validateEvent(fixture.event);
      expect(result.status, fixture.name).toBe(fixture.expectedStatus);
      expect(result.diagnostics, fixture.name).toEqual([fixture.expectedDiagnostic]);
      if (result.status === 'preserved-extension') {
        expect(result.event.type, fixture.name).toBe(fixture.event.type);
        expect(result.event.extension.fallback, fixture.name).toBe('preserve-in-journal');
        expect(result.event.extension.vendorField, fixture.name).toBe('opaque');
        expect(result.event.data.marker, fixture.name).toBe('opaque');
      }
    }
  });

  it('enforces the minimum two-component extension namespace', () => {
    const minimum = extensionFixtures.find((fixture) => fixture.event.type === 'x.a.b');
    const oneComponent = invalidExtensionFixtures.find(
      (fixture) => fixture.event.type === 'x.example',
    );
    expect(minimum).toBeDefined();
    expect(oneComponent).toBeDefined();
    if (minimum === undefined || oneComponent === undefined) return;
    expect(validateEvent(minimum.event)).toEqual({
      status: 'preserved-extension',
      event: minimum.event,
      diagnostics: [minimum.expectedDiagnostic],
    });
    expect(validateEvent(oneComponent.event)).toEqual({
      status: 'rejected',
      diagnostics: [oneComponent.expectedDiagnostic],
    });
  });

  it('rejects reusable invalid extension envelopes with exact bounded diagnostics', () => {
    for (const fixture of invalidExtensionFixtures) {
      expect(validateEvent(fixture.event), fixture.name).toEqual({
        status: fixture.expectedStatus,
        diagnostics: [fixture.expectedDiagnostic],
      });
    }
  });

  it('quarantines incompatible major versions before core or extension preservation', () => {
    for (const fixture of incompatibleVersionFixtures) {
      const result = validateEvent(fixture.event);
      expect(result, fixture.name).toEqual({
        status: fixture.expectedStatus,
        diagnostics: [
          {
            code: fixture.expectedCode,
            severity: 'error',
            field: 'version',
            protocolMajor: 9,
          },
        ],
      });
    }
  });

  it('models duplicate delivery by event identity and semantic transition count', () => {
    for (const fixture of duplicateFixtures) {
      const originalResult = validateEvent(fixture.original);
      const retryResult = validateEvent(fixture.retry);
      expect(originalResult.status, fixture.name).toBe('accepted');
      expect(retryResult.status, fixture.name).toBe('accepted');
      expect(fixture.original.eventId, fixture.name).toBe(fixture.retry.eventId);
      expect(fixture.original.sequence, fixture.name).toBe(fixture.retry.sequence);
      expect((fixture.original.scope as Record<string, unknown>).operationId, fixture.name).toBe(
        fixture.expected.operationId,
      );
      expect(new Set([fixture.original.eventId, fixture.retry.eventId]).size, fixture.name).toBe(1);
      expect(serializeCanonicalEvent(fixture.original), fixture.name).toBe(
        serializeCanonicalEvent(fixture.retry),
      );
      expect(fixture.expected.dedupeKey, fixture.name).toBe('eventId');
      expect(fixture.expected.semanticTransitionCount, fixture.name).toBe(1);
      expect(fixture.expected.validatorDeduplicates, fixture.name).toBe(false);
      if (originalResult.status !== 'accepted' || retryResult.status !== 'accepted') continue;
      expect(originalResult.event, fixture.name).not.toBe(retryResult.event);
    }
  });

  it('leaves a permission unlinked when two operation candidates make correlation ambiguous', () => {
    for (const fixture of correlationAmbiguityFixtures) {
      for (const candidate of fixture.candidateOperations) {
        expect(validateEvent(candidate).status, fixture.name).toBe('accepted');
      }
      const [first, second] = fixture.candidateOperations;
      expect(first.type, fixture.name).toBe('tool.requested');
      expect(second.type, fixture.name).toBe('tool.requested');
      expect((first.data as Record<string, unknown>).parallelGroupId, fixture.name).toBe(
        fixture.expected.parallelGroupId,
      );
      expect((second.data as Record<string, unknown>).parallelGroupId, fixture.name).toBe(
        fixture.expected.parallelGroupId,
      );
      expect((first.scope as Record<string, unknown>).operationId, fixture.name).toBe(
        fixture.expected.operationIds[0],
      );
      expect((second.scope as Record<string, unknown>).operationId, fixture.name).toBe(
        fixture.expected.operationIds[1],
      );
      const firstSequence = first.sequence as number;
      const secondSequence = second.sequence as number;
      expect(firstSequence, fixture.name).toBe(fixture.expected.sequences[0]);
      expect(secondSequence, fixture.name).toBe(fixture.expected.sequences[1]);
      expect(firstSequence).toBeLessThan(secondSequence);
      const result = validateEvent(fixture.permission);
      expect(result.status, fixture.name).toBe('accepted');
      const permissionSequence = fixture.permission.sequence as number;
      expect(permissionSequence, fixture.name).toBe(fixture.expected.sequences[2]);
      expect(permissionSequence, fixture.name).toBeGreaterThan(secondSequence);
      expect((fixture.permission.scope as Record<string, unknown>).permissionId, fixture.name).toBe(
        fixture.expected.permissionId,
      );
      expect(
        'operationId' in (fixture.permission.scope as Record<string, unknown>),
        fixture.name,
      ).toBe(false);
      expect('links' in fixture.permission, fixture.name).toBe(false);
      expect(fixture.expected.operationLink, fixture.name).toBe('absent');
      expect(fixture.expected.reason, fixture.name).toBe('missing-correlation');
      expect(fixture.expected.causalLink, fixture.name).toBe('absent');
    }
  });

  it('freezes nested fixture catalogs while keeping validEventFixture detached', () => {
    const before = JSON.stringify({
      types: coreEventFixtureTypes,
      requiredScopes: requiredScopeByEvent,
      core: validCoreEventFixtures,
      common: commonScopeOmissionFixtures,
      specific: eventSpecificScopeOmissionFixtures,
      invalid: invalidScopeFixtures,
      unknown: unknownOptionalFieldFixtures,
      extensions: extensionFixtures,
      invalidExtensions: invalidExtensionFixtures,
      incompatible: incompatibleVersionFixtures,
      duplicates: duplicateFixtures,
      ambiguity: correlationAmbiguityFixtures,
    });
    expect(Object.isFrozen(coreEventFixtureTypes)).toBe(true);
    expect(Object.isFrozen(requiredScopeByEvent)).toBe(true);
    expect(Object.isFrozen(requiredScopeByEvent['task.created'])).toBe(true);
    expect(Object.isFrozen(validCoreEventFixtures)).toBe(true);
    expect(Object.isFrozen(validCoreEventFixtures['source.connected'])).toBe(true);
    expect(Object.isFrozen(validCoreEventFixtures['source.connected'].data)).toBe(true);
    expect(Object.isFrozen(commonScopeOmissionFixtures)).toBe(true);
    expect(Object.isFrozen(commonScopeOmissionFixtures[0]?.event.scope)).toBe(true);
    expect(Object.isFrozen(extensionFixtures[0]?.event.data)).toBe(true);
    expect(Object.isFrozen(invalidExtensionFixtures[0]?.event.extension)).toBe(true);

    const attempt = (mutation: () => void): void => {
      try {
        mutation();
      } catch {
        // Strict-mode assignment to a frozen fixture is expected to throw.
      }
    };
    attempt(() => Reflect.set(coreEventFixtureTypes as unknown as string[], 0, 'tampered'));
    attempt(() =>
      Reflect.set(
        (requiredScopeByEvent['task.created'] ?? {}) as Record<string, unknown>,
        'taskId',
        'tampered',
      ),
    );
    attempt(() =>
      Reflect.set(
        validCoreEventFixtures['source.connected'].data as Record<string, unknown>,
        'tampered',
        true,
      ),
    );
    attempt(() =>
      Reflect.set(
        (commonScopeOmissionFixtures[0]?.event.scope ?? {}) as Record<string, unknown>,
        'workspaceId',
        'tampered',
      ),
    );
    attempt(() =>
      Reflect.set(
        (extensionFixtures[0]?.event.data as Record<string, unknown>).nested as Record<
          string,
          unknown
        >,
        'value',
        'tampered',
      ),
    );
    expect(
      JSON.stringify({
        types: coreEventFixtureTypes,
        requiredScopes: requiredScopeByEvent,
        core: validCoreEventFixtures,
        common: commonScopeOmissionFixtures,
        specific: eventSpecificScopeOmissionFixtures,
        invalid: invalidScopeFixtures,
        unknown: unknownOptionalFieldFixtures,
        extensions: extensionFixtures,
        invalidExtensions: invalidExtensionFixtures,
        incompatible: incompatibleVersionFixtures,
        duplicates: duplicateFixtures,
        ambiguity: correlationAmbiguityFixtures,
      }),
    ).toBe(before);

    const detached = validEventFixture('session.started');
    const otherDetached = validEventFixture('session.started');
    Reflect.set(detached.scope as Record<string, unknown>, 'sessionId', 'mutated');
    expect((otherDetached.scope as Record<string, unknown>).sessionId).toBe('session-1');
    expect(
      (validCoreEventFixtures['session.started'].scope as Record<string, unknown>).sessionId,
    ).toBe('session-1');
  });

  it('keeps fixture content deterministic and privacy-safe', () => {
    const first = JSON.stringify({
      coreEventFixtureTypes,
      requiredScopeByEvent,
      validCoreEventFixtures,
      commonScopeOmissionFixtures,
      eventSpecificScopeOmissionFixtures,
      invalidScopeFixtures,
      unknownOptionalFieldFixtures,
      extensionFixtures,
      invalidExtensionFixtures,
      incompatibleVersionFixtures,
      duplicateFixtures,
      correlationAmbiguityFixtures,
    });
    const second = JSON.stringify({
      coreEventFixtureTypes,
      requiredScopeByEvent,
      validCoreEventFixtures,
      commonScopeOmissionFixtures,
      eventSpecificScopeOmissionFixtures,
      invalidScopeFixtures,
      unknownOptionalFieldFixtures,
      extensionFixtures,
      invalidExtensionFixtures,
      incompatibleVersionFixtures,
      duplicateFixtures,
      correlationAmbiguityFixtures,
    });
    expect(first).toBe(second);
    for (const forbidden of [
      '/home/',
      'C:\\Users\\',
      'PRIVATE',
      'SECRET',
      'password=',
      'Authorization:',
      'https://',
    ])
      expect(first).not.toContain(forbidden);
  });
});
