## Purpose

Defines the stable vendor-neutral evidence contract that lets adapters, reducers, renderers, replay tools, and third-party integrations exchange truthful agent activity.

## ADDED Requirements

### Requirement: Versioned event envelope
Every canonical AAP event SHALL declare the protocol identifier and semantic version, a globally unique event identifier, native and observation timestamps, durable adapter and stream identities, an adapter epoch, a stream-local sequence, scoped entity identifiers, fidelity, finality, type, and validated type-specific data.

#### Scenario: Valid canonical event
- **WHEN** a consumer receives an event containing all fields required for its event type and protocol version
- **THEN** the event passes schema validation and can be reduced without consulting a native vendor payload

#### Scenario: Missing required scope
- **WHEN** a task event omits its required session or task identity
- **THEN** validation rejects the event before it reaches canonical state

### Requirement: Evidence and finality remain distinct
AAP SHALL represent how information was obtained separately from whether the represented transition is provisional or confirmed. A provisional observation SHALL NOT be interpreted as a confirmed terminal outcome.

#### Scenario: Completion checkpoint is observed
- **WHEN** an adapter directly observes a native hook that can still block task completion
- **THEN** it emits an observed provisional completion-request event rather than a confirmed task-completed event

#### Scenario: Completion is confirmed
- **WHEN** a later native event proves the task transition committed
- **THEN** the adapter emits a confirmed terminal task event linked to the prior evidence when correlation is available

### Requirement: Ordered idempotent streams
Canonical events SHALL be totally ordered within a durable stream and SHALL be idempotent by event identifier. Ordering across independent streams SHALL be presented as approximate unless explicit causal links exist.

#### Scenario: Duplicate delivery
- **WHEN** an event with an already processed event identifier is delivered again
- **THEN** the consumer produces no duplicate entity, transition, or animation intent

#### Scenario: Independent sources have equal timestamps
- **WHEN** two streams contain events with equal observation timestamps and no causal link
- **THEN** replay uses the documented deterministic display tie-breaker without claiming cross-stream causality

### Requirement: Truthful capability negotiation
Each source SHALL advertise signal availability, evidence quality, coverage, and finality for the active platform version and session configuration. Unsupported and partially covered signals SHALL be distinguishable.

#### Scenario: Hosted tools are not observable
- **WHEN** an adapter cannot observe a class of hosted tool calls
- **THEN** its capability profile identifies the missing or partial coverage and the UI does not imply complete tool telemetry

#### Scenario: Capabilities change during a session
- **WHEN** the adapter discovers a material change in active telemetry coverage
- **THEN** it emits a capability-change event before relying on the changed capability

### Requirement: Protocol compatibility
Consumers SHALL reject unsupported major versions, ignore unknown optional fields, preserve unknown extension events in the journal, and surface a compatibility diagnostic when semantics cannot be safely interpreted. Namespaced extension events SHALL declare a documented fallback.

#### Scenario: New optional field
- **WHEN** a consumer receives a compatible minor-version event with an unknown optional field
- **THEN** it processes the known semantics without failing validation solely because of that field

#### Scenario: Unsupported major version
- **WHEN** a consumer receives an event from an unsupported major protocol version
- **THEN** it quarantines the event from semantic reduction and reports the incompatibility without crashing the runtime

