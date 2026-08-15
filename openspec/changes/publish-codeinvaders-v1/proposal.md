## Why

CodeInvaders currently exists only as a draft concept and has no repository, implementation, conformance contract, or release process. This change turns the concept into a stable, privacy-preserving public `v1.0.0` release at `github.com/danium/codeinvaders` that can truthfully visualize both Codex and Claude Code without depending on private reasoning or vendor-specific renderer behavior.

## What Changes

- Establish CodeInvaders as the public project and repository for the Agent Arcade product concept.
- Define a stable Agent Arcade Protocol (AAP) that distinguishes observed evidence, derived interpretation, synthetic presentation state, provisional transitions, and confirmed outcomes.
- Add privacy-safe Codex and Claude Code adapters with capability negotiation, bounded hook latency, durable offline spooling, and no control over agent decisions.
- Add a canonical append-only journal, deterministic reducer, versioned snapshots, live delivery, and reproducible replay.
- Add an accessible Three.js arcade visualization in which agents are ships, tools are weapon activity, and confirmed tasks are enemies, while preserving truthful degraded modes.
- Add a loopback-only local runtime with authenticated browser access, bounded retention, safe deletion, event validation, and text-only fallback.
- Add reversible installation, diagnostics, start, replay, and uninstall workflows for supported Windows, macOS, and Linux environments.
- Create the public GitHub project with an open-source license, contributor and security documentation, continuous integration, release automation, checksummed artifacts, protocol conformance fixtures, and a documented compatibility policy.
- Add a mandatory execution-readiness gate that verifies GitHub access, agent/plugin availability, browser tooling, credentials, and required approvals before implementation begins so known human-interaction blockers are resolved up front.
- Add evidence-backed final-product verification using the real Codex and Claude Code plugins, Codex browser walkthroughs, performance and memory profiling, targeted refactoring when measured gates fail, and complete regression reruns after those changes.
- Stabilize the public contract at `v1.0.0` only after both real Codex and Claude Code sessions pass conformance, privacy, recovery, accessibility, and performance acceptance gates.

## Capabilities

### New Capabilities

- `agent-arcade-protocol`: Versioned evidence and lifecycle events, identities, ordering metadata, finality, capability negotiation, validation, compatibility, and extension behavior.
- `telemetry-adapters`: Safe ingestion and normalization of Codex and Claude Code hooks, operation correlation, degraded coverage, offline spooling, and noninterference guarantees.
- `event-journal-replay`: Canonical per-stream ordering, deduplication, deterministic reduction, snapshots, recovery, live delivery, and replay semantics.
- `arcade-visualization`: Semantic Three.js and text presentations for sessions, agents, tasks, tools, permissions, uncertainty, replay, accessibility, and load shedding.
- `local-runtime-security`: Local broker trust boundary, client authentication, origin policy, input validation, private storage, retention, diagnostics, and safe deletion.
- `installation-lifecycle`: Detection, transparent hook composition, start, doctor, replay, upgrade, and ownership-aware uninstall across supported platforms.
- `public-release`: GitHub publication, documentation, licensing, CI quality gates, signed or checksummed releases, compatibility policy, vulnerability reporting, and `v1.0.0` readiness.

### Modified Capabilities

None. This is a new project with no existing capability specifications.

## Impact

- Creates a TypeScript-based local application, protocol library, reducer, adapters, browser UI, Three.js renderer, CLI, fixtures, tests, documentation, and release configuration.
- Integrates with documented Codex and Claude Code lifecycle-hook configuration while treating native payloads as untrusted and changeable.
- Introduces local application-data storage, a loopback broker, browser WebSocket and HTTP interfaces, and privacy-sensitive installation behavior.
- Establishes `github.com/danium/codeinvaders` as the canonical source, issue tracker, documentation location, and release channel.
- Requires implementation to pause before task execution when a known external credential, trust prompt, account permission, or user-level configuration approval has not been resolved during preflight.
- Commits the project to public API compatibility, secure defaults, deterministic conformance, cross-platform support, and maintained third-party adapter guidance after `v1.0.0`.
