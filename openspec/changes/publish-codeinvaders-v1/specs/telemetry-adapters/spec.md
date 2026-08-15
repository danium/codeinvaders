## Purpose

Defines how Codex and Claude Code activity is captured, sanitized, normalized, correlated, and degraded without changing or delaying the coding agents' decisions.

## ADDED Requirements

### Requirement: Supported cross-agent ingestion
The release SHALL include Codex and Claude Code adapters that consume documented lifecycle-hook inputs and normalize them into the same AAP semantics without renderer-specific logic.

#### Scenario: Equivalent completed tool calls
- **WHEN** Codex and Claude Code each report a successful tool execution with equivalent normalized scope and category
- **THEN** both adapters emit semantically equivalent confirmed AAP tool-completed events

#### Scenario: Native schema is unknown
- **WHEN** an adapter receives an unsupported or malformed native payload
- **THEN** it rejects or quarantines the payload, records a sanitized diagnostic, and exits without disrupting the agent

### Requirement: Noninterference
Adapters SHALL be observational: they MUST NOT approve or deny permissions, rewrite tool input or output, inject agent context, steer plans, or require an Agent Arcade tool call. Adapter failure SHALL fail open from the coding agent's perspective.

#### Scenario: Broker is unavailable
- **WHEN** a hook runs while the local broker is stopped
- **THEN** the adapter performs a bounded local spool attempt and returns without blocking the coding agent

#### Scenario: Other hooks alter a transition
- **WHEN** another native hook blocks a transition that Agent Arcade observed provisionally
- **THEN** Agent Arcade does not claim that the transition committed

### Requirement: Sanitization precedes persistence
Adapters SHALL allowlist canonical fields and SHALL remove prompt text, assistant text, source code, patches, command text, tool arguments and output, absolute paths, URLs, queries, credentials, environment variables, transcript content, repository remotes, and user names before writing ingress, canonical, or diagnostic data.

#### Scenario: Sensitive canaries in every native field
- **WHEN** a fixture places unique sensitive canary strings in all native text-bearing fields
- **THEN** none of those canaries appears in the default spool, journal, snapshot, manifest, or diagnostic files

#### Scenario: Stable workspace identity
- **WHEN** two events originate from the same canonical workspace path
- **THEN** the adapter produces the same opaque local identifier without persisting the raw path

### Requirement: Conservative correlation
Adapters SHALL use native identifiers when available, SHALL mark derived links as derived, and SHALL leave relationships unlinked when parallel or duplicate inputs make correlation ambiguous. Similarity matching SHALL NOT determine terminal task identity.

#### Scenario: Permission lacks operation identity
- **WHEN** a permission hook has no native tool-use identifier and multiple operations are plausible
- **THEN** the adapter emits an independently identified permission request without guessing an operation link

#### Scenario: Ambiguous plan reconciliation
- **WHEN** two plan items cannot be matched unambiguously across revisions
- **THEN** the adapter cancels and creates identities conservatively or records identity uncertainty instead of transferring terminal status by fuzzy similarity

### Requirement: Durable bounded ingress
An adapter SHALL deliver a sanitized ingress record to the broker or atomically spool it for later ingestion. Logical retries SHALL retain the same event identifier, and all hook work SHALL obey bounded time and size limits.

#### Scenario: Process terminates during spool write
- **WHEN** an adapter process stops before its temporary ingress record is atomically committed
- **THEN** recovery ignores the incomplete file and does not create a corrupt canonical event

#### Scenario: Release latency gate
- **WHEN** adapter latency is measured on each supported release platform with the broker available
- **THEN** added hook wall time, including adapter startup, meets the documented release budget and no test invocation exceeds the hard fail-open timeout

### Requirement: Honest degraded behavior
Adapters SHALL emit only the signals they actually observe or deterministically derive, and SHALL advertise missing task, subagent, permission, timing, or tool coverage per active session.

#### Scenario: Claude session has no Task tools
- **WHEN** Claude Code does not expose task lifecycle signals in a session
- **THEN** the adapter advertises no confirmed task lifecycle and the system uses the explicit fallback-objective presentation

