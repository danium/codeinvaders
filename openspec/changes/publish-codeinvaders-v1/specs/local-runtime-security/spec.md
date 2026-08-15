## Purpose

Defines the local runtime trust boundary and privacy controls that prevent agent telemetry, stored history, and browser access from becoming a surveillance or execution surface.

## ADDED Requirements

### Requirement: Loopback-only authenticated service
The runtime SHALL bind only to loopback addresses by default, authenticate every browser and live-stream client with an ephemeral local secret, enforce strict allowed origins, and keep LAN exposure disabled unless a future explicit feature specifies it.

#### Scenario: Unauthenticated local request
- **WHEN** a process connects to a protected broker endpoint without the active secret
- **THEN** the broker rejects the request without exposing session metadata

#### Scenario: Non-loopback bind is requested
- **WHEN** default configuration attempts to bind a non-loopback interface
- **THEN** startup refuses the configuration and explains that public or LAN service is unsupported

### Requirement: Untrusted event validation
The broker and UI SHALL treat adapter, spool, journal, snapshot, and browser input as untrusted; enforce schema, type, count, depth, and byte limits; and render all labels as text rather than executable markup.

#### Scenario: Oversized event payload
- **WHEN** an ingress record exceeds the configured maximum size
- **THEN** it is rejected or quarantined with a bounded sanitized diagnostic and is not broadcast to clients

#### Scenario: Label contains markup
- **WHEN** a sanitized optional label contains HTML-like text
- **THEN** the UI displays it as inert text and executes no markup or script

### Requirement: Private data minimization
Default canonical storage SHALL contain only allowlisted protocol metadata, opaque local identifiers, safe categories, statuses, durations, capabilities, and explicitly enabled sanitized labels. It SHALL contain no prompts, messages, reasoning traces, source content, commands, arguments, outputs, raw paths, URLs, queries, credentials, or environment values.

#### Scenario: Default installation records a session
- **WHEN** a user runs CodeInvaders without enabling optional labels or diagnostics
- **THEN** persisted data contains opaque task and repository labels and no source-derived free text

### Requirement: Safe local storage lifecycle
Runtime data SHALL use the platform application-data location with user-only permissions where supported. Rotation, retention, uninstall, and delete-all operations SHALL verify resolved targets remain inside the owned data directory and SHALL not follow unverified symlinks.

#### Scenario: Data directory contains a symlink escape
- **WHEN** deletion encounters a link resolving outside the owned data root
- **THEN** the external target remains untouched and the operation reports a safe failure

#### Scenario: User deletes all recordings
- **WHEN** the user confirms the delete-all action
- **THEN** journals, spools, snapshots, manifests, and associated diagnostic history owned by CodeInvaders are removed without altering installation configuration unless requested

### Requirement: No default external telemetry
The stable release SHALL require no cloud service, remote asset, product analytics, crash upload, or automatic event-log transmission to operate. Any future external reporting SHALL be separately opt-in and documented field by field.

#### Scenario: Network is unavailable
- **WHEN** the host has no external network access after installation
- **THEN** live monitoring, local history, replay, and deletion continue to function

### Requirement: Safe browser policy
The browser application SHALL use a restrictive Content Security Policy, prohibit dynamic code evaluation and unexpected remote resources, protect authentication secrets from URL query and referrer leakage, and close stale client credentials when the runtime restarts.

#### Scenario: Runtime restarts
- **WHEN** a browser retains a secret from an earlier broker process
- **THEN** the new broker rejects it and the UI requires a newly authenticated local launch

