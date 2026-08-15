import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const protocolUrl = pathToFileURL(
  path.join(rootDirectory, 'packages', 'protocol', 'dist', 'index.js'),
).href;
const fixturesUrl = pathToFileURL(
  path.join(rootDirectory, 'packages', 'protocol', 'dist', 'fixtures', 'index.js'),
).href;

const protocol = await import(protocolUrl);
const fixtures = await import(fixturesUrl);

const {
  MAX_EVENT_BYTES,
  MAX_EXTENSION_BYTES,
  MAX_JSON_DEPTH,
  coreEventSchemas,
  extensionEventSchema,
  protocolDiagnosticCodes,
  protocolId,
  protocolSchemaKeywordNames,
  protocolVersion,
  serializeCanonicalEvent,
  validateEvent,
} = protocol;
const {
  correlationAmbiguityFixtures,
  coreEventFixtureTypes,
  duplicateFixtures,
  extensionFixtures,
  incompatibleVersionFixtures,
  invalidExtensionFixtures,
  invalidScopeFixtures,
  unknownOptionalFieldFixtures,
  validCoreEventFixtures,
} = fixtures;

const beginMarker = '<!-- BEGIN GENERATED PROTOCOL CONTRACT -->';
const endMarker = '<!-- END GENERATED PROTOCOL CONTRACT -->';
const documentationPath = path.join(rootDirectory, 'docs', 'protocol-compatibility.md');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function record(value, label) {
  assert(
    typeof value === 'object' && value !== null && !Array.isArray(value),
    `${label} is not an object`,
  );
  return value;
}

function property(value, key, label) {
  return record(value, label)[key];
}

function stableJson(value) {
  return JSON.stringify(value);
}

function equalArrays(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function inline(value) {
  return `\`${String(value).replaceAll('`', '\\`')}\``;
}

function requiredScopeFor(schema) {
  const eventSpecific = property(
    schema,
    protocolSchemaKeywordNames.requiredScope,
    'required-scope metadata',
  );
  assert(Array.isArray(eventSpecific), 'required-scope metadata is not an array');
  return [...new Set(['workspaceId', 'sessionId', ...eventSpecific])];
}

function assertExactResult(result, status, diagnostics, label) {
  assert(result.status === status, `${label} has status ${String(result.status)}`);
  assert(
    stableJson(result.diagnostics) === stableJson(diagnostics),
    `${label} has unexpected diagnostics`,
  );
}

function assertBoundedCatalog(catalog, label) {
  assert(Array.isArray(catalog), `${label} is not an array`);
  assert(catalog.length <= 512, `${label} exceeds the deterministic fixture bound`);
}

const registryTypes = Object.keys(coreEventSchemas);
assert(
  equalArrays(registryTypes, [...coreEventFixtureTypes]),
  'the public fixture registry does not match the executable core-event schema registry',
);
assert(
  Object.keys(validCoreEventFixtures).length === registryTypes.length,
  'the valid fixture catalog does not cover every executable core-event schema',
);

const firstCoreSchema = coreEventSchemas[registryTypes[0]];
assert(firstCoreSchema !== undefined, 'the executable core-event schema registry is empty');
const compatibility = record(
  property(firstCoreSchema, protocolSchemaKeywordNames.compatibility, 'compatibility metadata'),
  'compatibility metadata',
);
const limits = record(
  property(firstCoreSchema, protocolSchemaKeywordNames.limits, 'limit metadata'),
  'limit metadata',
);
const supportedMajor = Number.parseInt(String(protocolVersion).split('.')[0] ?? '', 10);
assert(
  Number.isSafeInteger(supportedMajor),
  'protocol version does not contain a safe major number',
);

for (const [type, schema] of Object.entries(coreEventSchemas)) {
  assert(
    stableJson(
      property(schema, protocolSchemaKeywordNames.compatibility, `${type} compatibility`),
    ) === stableJson(compatibility),
    `${type} has compatibility metadata that differs from the registry baseline`,
  );
  assert(
    stableJson(property(schema, protocolSchemaKeywordNames.limits, `${type} limits`)) ===
      stableJson(limits),
    `${type} has limit metadata that differs from the registry baseline`,
  );
}

const extensionProperties = record(
  property(extensionEventSchema, 'properties', 'extension schema properties'),
  'extension schema properties',
);
const extensionMetadataSchema = record(
  property(extensionProperties, 'extension', 'extension metadata schema'),
  'extension metadata schema',
);
const extensionMetadataProperties = record(
  property(extensionMetadataSchema, 'properties', 'extension metadata properties'),
  'extension metadata properties',
);
const extensionRequired = property(extensionEventSchema, 'required', 'extension required fields');
const extensionMetadataRequired = property(
  extensionMetadataSchema,
  'required',
  'extension metadata required fields',
);
assert(Array.isArray(extensionRequired), 'extension required fields are not an array');
assert(
  Array.isArray(extensionMetadataRequired),
  'extension metadata required fields are not an array',
);
assert(
  stableJson(
    property(
      extensionEventSchema,
      protocolSchemaKeywordNames.compatibility,
      'extension compatibility',
    ),
  ) === stableJson(compatibility),
  'extension compatibility metadata differs from the core registry baseline',
);
assert(
  stableJson(
    property(extensionEventSchema, protocolSchemaKeywordNames.limits, 'extension limits'),
  ) === stableJson(limits),
  'extension limit metadata differs from the core registry baseline',
);

const diagnosticDescriptions = new Map([
  ['invalid-envelope', 'The envelope shape or a common envelope field is invalid.'],
  ['invalid-scope', 'A required scope field is missing or invalid.'],
  ['invalid-data', 'The event data, semantic metadata, or executable semantic rule is invalid.'],
  ['event-too-large', 'The event or bounded structure exceeds an executable size/count limit.'],
  ['event-too-deep', 'The event exceeds the executable JSON depth limit.'],
  ['unsupported-major', 'The protocol major is not supported; the event is quarantined.'],
  ['invalid-version', 'The protocol version is not valid semantic-version text.'],
  ['unknown-event', 'A non-namespaced unknown type is not a registered core event.'],
  [
    'invalid-extension',
    'A malformed x.* extension namespace, metadata, or payload envelope is invalid.',
  ],
  [
    'extension-preserved',
    'validateEvent returned preserved-extension; future journal consumers must preserve the valid unknown extension.',
  ],
]);
assert(
  protocolDiagnosticCodes.length === diagnosticDescriptions.size &&
    equalArrays([...protocolDiagnosticCodes], [...diagnosticDescriptions.keys()]),
  'diagnostic descriptions are out of sync with the executable diagnostic-code registry',
);

for (const catalog of [
  invalidScopeFixtures,
  unknownOptionalFieldFixtures,
  extensionFixtures,
  invalidExtensionFixtures,
  incompatibleVersionFixtures,
  duplicateFixtures,
  correlationAmbiguityFixtures,
]) {
  assertBoundedCatalog(catalog, 'fixture catalog');
}

for (const [type, fixture] of Object.entries(validCoreEventFixtures)) {
  const result = validateEvent(fixture);
  assertExactResult(result, 'accepted', [], `${type} valid fixture`);
  if (result.status === 'accepted') assert(result.event.type === type, `${type} type drifted`);
}

for (const fixture of invalidScopeFixtures) {
  const result = validateEvent(fixture.event);
  assertExactResult(
    result,
    'rejected',
    [
      {
        code: 'invalid-scope',
        severity: 'error',
        field: 'scope',
        eventType: fixture.type,
      },
    ],
    fixture.name,
  );
  const scope = record(fixture.event.scope, `${fixture.name} scope`);
  assert(!Object.hasOwn(scope, fixture.omittedScope), `${fixture.name} still has omitted scope`);
}

for (const fixture of unknownOptionalFieldFixtures) {
  const result = validateEvent(fixture.event);
  assertExactResult(result, 'accepted', [], fixture.name);
  assert(
    String(fixture.event.version).split('.')[0] === String(supportedMajor),
    `${fixture.name} does not use the supported protocol major`,
  );
  if (result.status !== 'accepted') continue;
  const resultData = record(result.event.data, `${fixture.name} result data`);
  assert(
    Object.hasOwn(result.event, fixture.topLevelField),
    `${fixture.name} lost top-level field`,
  );
  assert(Object.hasOwn(resultData, fixture.dataField), `${fixture.name} lost data field`);
  for (const [key, value] of Object.entries(fixture.expectedKnownData)) {
    assert(stableJson(resultData[key]) === stableJson(value), `${fixture.name} changed ${key}`);
  }
}

for (const fixture of extensionFixtures) {
  const result = validateEvent(fixture.event);
  assertExactResult(result, fixture.expectedStatus, [fixture.expectedDiagnostic], fixture.name);
  if (result.status === 'preserved-extension') {
    assert(result.event.type === fixture.event.type, `${fixture.name} changed its type`);
    assert(
      result.event.extension.fallback === 'preserve-in-journal',
      `${fixture.name} changed its fallback`,
    );
  }
}

for (const fixture of invalidExtensionFixtures) {
  const result = validateEvent(fixture.event);
  assertExactResult(result, fixture.expectedStatus, [fixture.expectedDiagnostic], fixture.name);
}

for (const fixture of incompatibleVersionFixtures) {
  const result = validateEvent(fixture.event);
  assertExactResult(
    result,
    fixture.expectedStatus,
    [
      {
        code: fixture.expectedCode,
        severity: 'error',
        field: 'version',
        protocolMajor: 9,
      },
    ],
    fixture.name,
  );
}

for (const fixture of duplicateFixtures) {
  const original = validateEvent(fixture.original);
  const retry = validateEvent(fixture.retry);
  assertExactResult(original, 'accepted', [], `${fixture.name} original`);
  assertExactResult(retry, 'accepted', [], `${fixture.name} retry`);
  assert(fixture.original.eventId === fixture.retry.eventId, `${fixture.name} event ID drifted`);
  assert(fixture.original.sequence === fixture.retry.sequence, `${fixture.name} sequence drifted`);
  const originalScope = record(fixture.original.scope, `${fixture.name} original scope`);
  assert(
    originalScope.operationId === fixture.expected.operationId,
    `${fixture.name} operation ID drifted`,
  );
  assert(
    new Set([fixture.original.eventId, fixture.retry.eventId]).size === 1,
    `${fixture.name} is not one dedupe key`,
  );
  assert(
    serializeCanonicalEvent(fixture.original) === serializeCanonicalEvent(fixture.retry),
    `${fixture.name} retries are not canonical equivalents`,
  );
  assert(fixture.expected.dedupeKey === 'eventId', `${fixture.name} dedupe key drifted`);
  assert(
    fixture.expected.semanticTransitionCount === 1 &&
      fixture.expected.validatorDeduplicates === false,
    `${fixture.name} dedupe semantics drifted`,
  );
}

for (const fixture of correlationAmbiguityFixtures) {
  const candidateResults = fixture.candidateOperations.map((candidate) => validateEvent(candidate));
  for (let index = 0; index < candidateResults.length; index += 1) {
    assertExactResult(
      candidateResults[index],
      'accepted',
      [],
      `${fixture.name} candidate ${index}`,
    );
  }
  const [first, second] = fixture.candidateOperations;
  const firstData = record(first.data, `${fixture.name} first data`);
  const secondData = record(second.data, `${fixture.name} second data`);
  const firstScope = record(first.scope, `${fixture.name} first scope`);
  const secondScope = record(second.scope, `${fixture.name} second scope`);
  assert(
    firstData.parallelGroupId === fixture.expected.parallelGroupId &&
      secondData.parallelGroupId === fixture.expected.parallelGroupId,
    `${fixture.name} parallel-group modeling drifted`,
  );
  const operationIds = [firstScope.operationId, secondScope.operationId];
  assert(
    stableJson(operationIds) === stableJson(fixture.expected.operationIds) &&
      new Set(operationIds).size === operationIds.length,
    `${fixture.name} operation identity is not unique`,
  );
  const sequences = [first.sequence, second.sequence, fixture.permission.sequence];
  assert(
    stableJson(sequences) === stableJson(fixture.expected.sequences) &&
      sequences[0] < sequences[1] &&
      sequences[1] < sequences[2],
    `${fixture.name} sequence order is not monotonic`,
  );
  const permissionResult = validateEvent(fixture.permission);
  assertExactResult(permissionResult, 'accepted', [], `${fixture.name} permission`);
  const permissionScope = record(fixture.permission.scope, `${fixture.name} permission scope`);
  assert(
    permissionScope.permissionId === fixture.expected.permissionId &&
      !Object.hasOwn(permissionScope, 'operationId') &&
      !Object.hasOwn(fixture.permission, 'links'),
    `${fixture.name} inferred a causal operation link`,
  );
  assert(
    fixture.expected.operationLink === 'absent' &&
      fixture.expected.reason === 'missing-correlation' &&
      fixture.expected.causalLink === 'absent',
    `${fixture.name} ambiguity semantics drifted`,
  );
}

const minimumExtensionFixture = extensionFixtures.find((fixture) => fixture.event.type === 'x.a.b');
const oneComponentExtensionFixture = invalidExtensionFixtures.find(
  (fixture) => fixture.event.type === 'x.example',
);
assert(minimumExtensionFixture !== undefined, 'the minimum x.a.b extension fixture is missing');
assert(oneComponentExtensionFixture !== undefined, 'the rejected x.example fixture is missing');
if (minimumExtensionFixture !== undefined) {
  assertExactResult(
    validateEvent(minimumExtensionFixture.event),
    'preserved-extension',
    [{ code: 'extension-preserved', severity: 'warning', field: 'type' }],
    'minimum x.a.b extension',
  );
}
if (oneComponentExtensionFixture !== undefined) {
  assertExactResult(
    validateEvent(oneComponentExtensionFixture.event),
    'rejected',
    [{ code: 'invalid-extension', severity: 'error', field: 'type' }],
    'one-component x.example extension',
  );
}

const extensionTypePattern = property(extensionProperties, 'type', 'extension type property');
const extensionFallback = property(
  property(extensionMetadataProperties, 'fallback', 'extension fallback property'),
  'const',
  'extension fallback value',
);
const extensionDocumentation = property(
  extensionMetadataProperties,
  'documentation',
  'extension documentation property',
);
const extensionData = property(extensionProperties, 'data', 'extension data property');
const extensionDocumentationMax = property(
  extensionDocumentation,
  'maxLength',
  'extension documentation limit',
);
assert(
  extensionFallback === 'preserve-in-journal',
  'extension fallback metadata is not preserve-in-journal',
);
assert(
  property(extensionTypePattern, 'pattern', 'extension type pattern') !== undefined,
  'extension type pattern is missing',
);
assert(
  property(extensionData, 'type', 'extension data type') === 'object',
  'extension data is not an object schema',
);

const generatedLines = [
  beginMarker,
  '## Executable contract (generated)',
  '',
  `This section is generated from the built \`@codeinvaders/protocol\` runtime and its public conformance fixtures. The repository gate fails if it drifts from the executable schemas, registry, limits, diagnostic registry, or validator outcomes.`,
  '',
  '### Compatibility processing',
  '',
  `- Protocol identifier: ${inline(protocolId)}`,
  `- Current protocol version: ${inline(protocolVersion)}`,
  `- Supported protocol major: ${inline(supportedMajor)}`,
  `- A valid semantic version with the supported major is validated using the known schema semantics; unknown optional fields are ${inline(compatibility.unknownOptionalFields)} and remain available to storage/forwarding consumers without changing known semantics.`,
  `- An unsupported major is quarantined before core reduction or extension preservation and reports ${inline('unsupported-major')}.`,
  `- An unrecognized non-namespaced type reports ${inline('unknown-event')}; a malformed ${inline('x.*')} name reports ${inline('invalid-extension')}; a valid namespaced extension is accepted only when its metadata declares the fallback below.`,
  '',
  '### Extension contract',
  '',
  `- Extension event types match ${inline(property(extensionTypePattern, 'pattern', 'extension type pattern'))}. Namespaces require the ${inline('x.')} prefix followed by at least two lower-case, dot-separated components; ${inline('x.a.b')} is the minimum accepted form and ${inline('x.example')} is rejected.`,
  `- The extension envelope requires ${inline(extensionRequired.join(', '))}; its scope always requires ${inline('workspaceId')} and ${inline('sessionId')}.`,
  `- The \`extension\` metadata object requires ${inline(extensionMetadataRequired.join(', '))}; fallback is exactly ${inline(extensionFallback)}.`,
  `- The required documentation value is a string of 1–${inline(extensionDocumentationMax)} Unicode code points. Additional extension metadata is allowed but must remain bounded by the event limits.`,
  `- Extension data is an object with additional properties allowed, but its serialized validation budget is ${inline(`${MAX_EXTENSION_BYTES} bytes`)}.`,
  `- The complete event is limited to ${inline(`${MAX_EVENT_BYTES} bytes`)} and JSON depth ${inline(MAX_JSON_DEPTH)}.`,
  `- A valid unknown extension makes ${inline('validateEvent')} return ${inline('preserved-extension')} with a warning diagnostic and the ${inline(extensionFallback)} fallback; validation does not persist anything. Future journal consumers must apply that fallback, and the event is not a core semantic event.`,
  '',
  '### Bounded diagnostics',
  '',
  '| Code | Meaning |',
  '| --- | --- |',
  ...protocolDiagnosticCodes.map(
    (code) => `| ${inline(code)} | ${diagnosticDescriptions.get(code)} |`,
  ),
  '',
  '### Core event registry and required scope',
  '',
  '| Event type | Required scope |',
  '| --- | --- |',
  ...registryTypes.map((type) => {
    const schema = coreEventSchemas[type];
    return `| ${inline(type)} | ${requiredScopeFor(schema).map(inline).join(', ')} |`;
  }),
  '',
  '### Conformance fixtures (synthetic only)',
  '',
  'Import these catalogs from `@codeinvaders/protocol/fixtures`; they are intentionally separate from the protocol root export.',
  '',
  '| Fixture catalog | Coverage | Count |',
  '| --- | --- | ---: |',
  `| ${inline('validCoreEventFixtures')} | One valid fixture for each executable core event | ${Object.keys(validCoreEventFixtures).length} |`,
  `| ${inline('invalidScopeFixtures')} | Common and event-specific missing-scope rejection cases | ${invalidScopeFixtures.length} |`,
  `| ${inline('unknownOptionalFieldFixtures')} | Compatible-minor unknown optional fields | ${unknownOptionalFieldFixtures.length} |`,
  `| ${inline('extensionFixtures')} | Valid namespaced extension preservation | ${extensionFixtures.length} |`,
  `| ${inline('invalidExtensionFixtures')} | Invalid namespace, metadata, and size cases | ${invalidExtensionFixtures.length} |`,
  `| ${inline('incompatibleVersionFixtures')} | Unsupported-major quarantine for core and extension events | ${incompatibleVersionFixtures.length} |`,
  `| ${inline('duplicateFixtures')} | Same event ID retry for journal/reducer deduplication | ${duplicateFixtures.length} |`,
  `| ${inline('correlationAmbiguityFixtures')} | Ambiguous permission-to-operation links remain absent | ${correlationAmbiguityFixtures.length} |`,
  '',
  'The validator checks one event at a time and does not deduplicate retries; the duplicate fixture documents the `eventId` key that future journal/reducer consumers must use. All fixture values are synthetic or opaque by design.',
  endMarker,
];
const expectedSection = generatedLines.join('\n');
const existingDocument = readFileSync(documentationPath, 'utf8').replaceAll('\r\n', '\n');
const beginIndex = existingDocument.indexOf(beginMarker);
const endIndex = existingDocument.indexOf(endMarker, beginIndex + beginMarker.length);
assert(
  beginIndex >= 0 && endIndex >= 0,
  'documentation does not contain both generated-contract markers',
);
assert(
  existingDocument.indexOf(beginMarker, beginIndex + beginMarker.length) < 0 &&
    existingDocument.indexOf(endMarker, endIndex + endMarker.length) < 0,
  'documentation contains duplicate generated-contract markers',
);
const actualSection = existingDocument.slice(beginIndex, endIndex + endMarker.length);
if (actualSection !== expectedSection) {
  if (process.argv.includes('--write')) {
    const updated = `${existingDocument.slice(0, beginIndex)}${expectedSection}${existingDocument.slice(endIndex + endMarker.length)}`;
    writeFileSync(documentationPath, updated);
    process.stdout.write(`updated ${path.relative(rootDirectory, documentationPath)}\n`);
  } else {
    throw new Error(
      `protocol compatibility documentation is out of date; run ${inline('pnpm protocol:docs:generate')}`,
    );
  }
}

process.stdout.write(
  `protocol compatibility documentation is in sync (${registryTypes.length} core schemas, ${protocolDiagnosticCodes.length} diagnostics, ${extensionFixtures.length} extension fixture)`,
);
