## Purpose

Defines durable event storage, recovery, deterministic semantic reduction, versioned snapshots, live delivery, and replay behavior for trustworthy observability.

## ADDED Requirements

### Requirement: Canonical append-only journal
The runtime SHALL store one complete validated AAP event per canonical journal record, assign a monotonic sequence within each durable stream, deduplicate by event identifier, and preserve journal data as the authority over indexes and snapshots.

#### Scenario: Spool recovery after broker restart
- **WHEN** the broker restarts with pending sanitized ingress records
- **THEN** it ingests each logical event once, assigns stream order, durably appends it, and only then retires the pending record

#### Scenario: Partial trailing record
- **WHEN** recovery encounters a partial final journal record
- **THEN** it quarantines or ignores that record and successfully replays all preceding complete records

### Requirement: Deterministic semantic reducer
For a fixed protocol version, reducer version, canonical ordered stream, and initial state, reduction SHALL produce byte-equivalent canonically serialized semantic state. The reducer SHALL contain no rendering objects, wall-clock reads, random values, or side effects.

#### Scenario: Live and replay equivalence
- **WHEN** the same canonical events are processed live and later replayed with the same reducer version
- **THEN** their canonical terminal semantic states are byte-equivalent

#### Scenario: Event arrives twice
- **WHEN** replay contains a duplicate event identifier
- **THEN** the terminal semantic state is identical to a replay containing the event once

### Requirement: Provisional state can resume
The reducer SHALL model requested, active, quiescent, sealed, provisional, confirmed, and unknown states without converting silence or timeout into success.

#### Scenario: Work continues after stop checkpoint
- **WHEN** a turn receives a stop checkpoint and later receives tool activity
- **THEN** the turn returns from quiescent to active without fabricating a second turn

#### Scenario: Session ends with unresolved operation
- **WHEN** the session ends before an operation receives a terminal signal
- **THEN** the reducer closes it as abandoned or unknown rather than completed or failed

### Requirement: Versioned rebuildable snapshots
Snapshots SHALL identify their protocol, reducer, and snapshot-schema versions, stream position, and canonical state. Incompatible or corrupt snapshots SHALL be discarded and rebuilt from the journal.

#### Scenario: Compatible seek snapshot
- **WHEN** replay seeks beyond a compatible snapshot position
- **THEN** it loads the snapshot and reduces only subsequent canonical events

#### Scenario: Reducer version changed
- **WHEN** a snapshot was created by an incompatible reducer version
- **THEN** replay rebuilds state from the journal rather than trusting the snapshot

### Requirement: Reproducible replay controls
Users SHALL be able to play, pause, change speed, compress idle time, seek, inspect sanitized events, filter by available scopes, jump to significant semantic events, and return to the live edge. Replay SHALL never consult native transcripts or invoke an agent.

#### Scenario: Seek to task completion
- **WHEN** the user jumps to a confirmed task completion
- **THEN** the replay reconstructs the correct state immediately before the event and presents its deterministic semantic transition

### Requirement: Bounded retention preserves consistency
Retention SHALL remove complete eligible journal segments and derived artifacts according to configured age or size limits without leaving snapshots or manifests that claim deleted history remains available.

#### Scenario: Retention deletes an old segment
- **WHEN** an old journal segment exceeds configured retention and is not protected by an active replay
- **THEN** the system safely removes it and invalidates or updates affected derived indexes and snapshots

