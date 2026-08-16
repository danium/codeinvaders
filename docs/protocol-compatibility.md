# Agent Arcade Protocol compatibility and extensions

This page is the implementation-facing compatibility contract for the Agent
Arcade Protocol (AAP). Consumers should validate events at their trust
boundary, preserve the distinction between provisional evidence and confirmed
outcomes, and never treat unknown activity as proof of progress.

The generated section below is checked against the executable schemas and
validator outcomes by the repository gate. To refresh it after an intentional
protocol change, run `pnpm protocol:docs:generate` and review the resulting
diff together with the protocol tests.

## Consumer rules

- A consumer supports the protocol major advertised by its implementation. A
  compatible minor or patch may add optional fields; consumers ignore fields
  they do not understand while continuing to process known semantics.
- An unsupported major is not best-effort parsed. The event is quarantined
  before semantic reduction and produces a bounded compatibility diagnostic.
- A namespaced extension must carry its own metadata and an explicit fallback.
  The declared fallback contract for future journal consumers is to preserve
  the event in journal storage without pretending that an unknown extension is
  a known semantic transition. `validateEvent` returns `preserved-extension`
  for a valid extension; validation does not persist anything itself.
- A non-namespaced unknown type reports `unknown-event`; a malformed `x.*`
  name reports `invalid-extension`.
- Extension payloads are untrusted and bounded. Extensions must not be used
  to smuggle prompts, source, commands, outputs, paths, URLs, credentials,
  environment values, transcripts, remotes, or user names into canonical
  data.
- The exported `x-codeinvaders-limits` values are schema annotations for the
  boundary budget. JSON Schema/AJV does not calculate serialized UTF-8 size or
  recursive depth from those annotations; use `validateEvent` (or an
  equivalent boundary check) before IPC, spool, journal, or other storage
  handoff. The runtime validator enforces the documented byte and depth limits.

## Authoring guidance

Third-party producers should use a stable namespace they control, document the
meaning and lifecycle of every extension type, and provide a fallback that a
consumer can apply without understanding the extension. Prefer an existing
core event when its semantics fit. Do not reuse a core type for new semantics,
and do not transfer terminal task identity through similarity or ordinal-only
matching.

For conformance examples, import the public fixture subpath:

```ts
import {
  extensionFixtures,
  incompatibleVersionFixtures,
  unknownOptionalFieldFixtures,
} from '@codeinvaders/protocol/fixtures';
```

These examples are synthetic and opaque. The fixture subpath is intentionally
separate from the protocol root export so production consumers do not receive
test catalogs by accident.

<!-- prettier-ignore-start -->
<!-- BEGIN GENERATED PROTOCOL CONTRACT -->
## Executable contract (generated)

This section is generated from the built `@codeinvaders/protocol` runtime and its public conformance fixtures. The repository gate fails if it drifts from the executable schemas, registry, limits, diagnostic registry, or validator outcomes.

### Compatibility processing

- Protocol identifier: `io.github.danium.codeinvaders.aap`
- Current protocol version: `1.0.0`
- Supported protocol major: `1`
- A valid semantic version with the supported major is validated using the known schema semantics; unknown optional fields are `ignore` and remain available to storage/forwarding consumers without changing known semantics.
- An unsupported major is quarantined before core reduction or extension preservation and reports `unsupported-major`.
- An unrecognized non-namespaced type reports `unknown-event`; a malformed `x.*` name reports `invalid-extension`; a valid namespaced extension is accepted only when its metadata declares the fallback below.

### Extension contract

- Extension event types match `^x\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$`. Namespaces require the `x.` prefix followed by at least two lower-case, dot-separated components; `x.a.b` is the minimum accepted form and `x.example` is rejected.
- The extension envelope requires `spec, version, eventId, type, occurredAt, observedAt, sequence, source, scope, fidelity, finality, extension, data`; its scope always requires `workspaceId` and `sessionId`.
- The `extension` metadata object requires `fallback, documentation`; fallback is exactly `preserve-in-journal`.
- The required documentation value is a string of 1–`512` Unicode code points. Additional extension metadata is allowed but must remain bounded by the event limits.
- Extension data is an object with additional properties allowed, but its serialized validation budget is `4096 bytes`.
- The complete event is limited to `32768 bytes` and JSON depth `12`.
- A valid unknown extension makes `validateEvent` return `preserved-extension` with a warning diagnostic and the `preserve-in-journal` fallback; validation does not persist anything. Future journal consumers must apply that fallback, and the event is not a core semantic event.

### Bounded diagnostics

| Code | Meaning |
| --- | --- |
| `invalid-envelope` | The envelope shape or a common envelope field is invalid. |
| `invalid-scope` | A required scope field is missing or invalid. |
| `invalid-data` | The event data, semantic metadata, or executable semantic rule is invalid. |
| `event-too-large` | The event or bounded structure exceeds an executable size/count limit. |
| `event-too-deep` | The event exceeds the executable JSON depth limit. |
| `unsupported-major` | The protocol major is not supported; the event is quarantined. |
| `invalid-version` | The protocol version is not valid semantic-version text. |
| `unknown-event` | A non-namespaced unknown type is not a registered core event. |
| `invalid-extension` | A malformed x.* extension namespace, metadata, or payload envelope is invalid. |
| `extension-preserved` | validateEvent returned preserved-extension; future journal consumers must preserve the valid unknown extension. |

### Core event registry and required scope

| Event type | Required scope |
| --- | --- |
| `source.connected` | `workspaceId`, `sessionId` |
| `source.capability.changed` | `workspaceId`, `sessionId` |
| `source.heartbeat` | `workspaceId`, `sessionId` |
| `source.disconnected` | `workspaceId`, `sessionId` |
| `telemetry.gap` | `workspaceId`, `sessionId` |
| `workspace.discovered` | `workspaceId`, `sessionId` |
| `session.started` | `workspaceId`, `sessionId` |
| `session.ended` | `workspaceId`, `sessionId` |
| `turn.started` | `workspaceId`, `sessionId`, `turnId` |
| `turn.finished` | `workspaceId`, `sessionId`, `turnId` |
| `turn.quiescent` | `workspaceId`, `sessionId`, `turnId` |
| `agent.spawned` | `workspaceId`, `sessionId`, `agentId` |
| `agent.state.changed` | `workspaceId`, `sessionId`, `agentId` |
| `agent.finished` | `workspaceId`, `sessionId`, `agentId` |
| `task.created` | `workspaceId`, `sessionId`, `taskId` |
| `task.updated` | `workspaceId`, `sessionId`, `taskId` |
| `task.assigned` | `workspaceId`, `sessionId`, `taskId` |
| `task.completion.requested` | `workspaceId`, `sessionId`, `taskId` |
| `task.completed` | `workspaceId`, `sessionId`, `taskId` |
| `task.failed` | `workspaceId`, `sessionId`, `taskId` |
| `task.denied` | `workspaceId`, `sessionId`, `taskId` |
| `task.cancelled` | `workspaceId`, `sessionId`, `taskId` |
| `task.abandoned` | `workspaceId`, `sessionId`, `taskId` |
| `task.corrected` | `workspaceId`, `sessionId`, `taskId` |
| `task.plan.reconciled` | `workspaceId`, `sessionId`, `turnId` |
| `tool.requested` | `workspaceId`, `sessionId`, `operationId` |
| `tool.started` | `workspaceId`, `sessionId`, `operationId` |
| `tool.completed` | `workspaceId`, `sessionId`, `operationId` |
| `tool.failed` | `workspaceId`, `sessionId`, `operationId` |
| `permission.requested` | `workspaceId`, `sessionId`, `permissionId` |
| `permission.resolved` | `workspaceId`, `sessionId`, `permissionId` |

### Conformance fixtures (synthetic only)

Import these catalogs from `@codeinvaders/protocol/fixtures`; they are intentionally separate from the protocol root export.

| Fixture catalog | Coverage | Count |
| --- | --- | ---: |
| `validCoreEventFixtures` | One valid fixture for each executable core event | 31 |
| `invalidScopeFixtures` | Common and event-specific missing-scope rejection cases | 26 |
| `unknownOptionalFieldFixtures` | Compatible-minor unknown optional fields | 2 |
| `extensionFixtures` | Valid namespaced extension preservation | 2 |
| `invalidExtensionFixtures` | Invalid namespace, metadata, and size cases | 8 |
| `incompatibleVersionFixtures` | Unsupported-major quarantine for core and extension events | 2 |
| `duplicateFixtures` | Same event ID retry for journal/reducer deduplication | 1 |
| `correlationAmbiguityFixtures` | Ambiguous permission-to-operation links remain absent | 1 |

The validator checks one event at a time and does not deduplicate retries; the duplicate fixture documents the `eventId` key that future journal/reducer consumers must use. All fixture values are synthetic or opaque by design.
<!-- END GENERATED PROTOCOL CONTRACT -->
<!-- prettier-ignore-end -->
