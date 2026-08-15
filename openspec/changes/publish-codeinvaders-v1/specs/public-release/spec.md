## Purpose

Defines the repository, documentation, governance, compatibility, security, and quality conditions required for CodeInvaders to be called a stable public release.

## ADDED Requirements

### Requirement: Canonical public repository
The project SHALL be published at `github.com/danium/codeinvaders` with its complete buildable source, history from project initialization onward, approved open-source license, README, architecture overview, privacy documentation, contribution guide, code of conduct, security policy, and issue templates.

#### Scenario: New contributor clones the release tag
- **WHEN** a contributor clones the canonical repository and checks out the stable tag
- **THEN** the documented supported toolchain can install dependencies, build, test, and run the project without undisclosed private assets or services

### Requirement: Automated quality gates
Every protected change and release candidate SHALL pass formatting, static analysis, type checking, unit tests, adapter conformance, deterministic replay, privacy canary, malicious-input, accessibility, production build, and supported-platform lifecycle checks.

#### Scenario: Privacy canary leaks
- **WHEN** any release test finds a sensitive canary in a default persisted artifact
- **THEN** the release gate fails and no stable artifact is published

#### Scenario: One adapter fails conformance
- **WHEN** either the Codex or Claude Code adapter fails a required golden scenario
- **THEN** the release cannot be labeled stable

### Requirement: Reproducible attributable releases
Public releases SHALL use semantic version tags, generated changelogs, immutable GitHub release artifacts, SHA-256 checksums, dependency and license inventory, and build provenance or signing where supported by the release platform.

#### Scenario: User downloads an artifact
- **WHEN** a user downloads a published release asset
- **THEN** they can verify its checksum and identify the source tag, supported platforms, protocol version, and installation instructions

### Requirement: Stable compatibility policy
Version `1.0.0` SHALL define supported protocol, journal, snapshot, CLI, adapter, and extension compatibility. Breaking public-contract changes SHALL require a new major version and migration guidance; security fixes MAY narrow unsafe behavior with explicit release notes.

#### Scenario: Minor release adds an event type
- **WHEN** a later compatible minor release adds a core or namespaced event
- **THEN** older supported consumers preserve or ignore it according to the documented fallback without corrupting known state

### Requirement: Vulnerability response
The repository SHALL provide a private vulnerability-reporting path, supported-version policy, dependency update process, and documented procedure for issuing patched artifacts and advisories without requesting sensitive event logs by default.

#### Scenario: Security report is submitted
- **WHEN** a reporter follows the security policy
- **THEN** maintainers can acknowledge, assess, remediate, and disclose the issue through the documented private workflow

### Requirement: Evidence-backed final-product verification
Every stable release candidate SHALL be verified as an installed product, not only as isolated packages or fixtures. Verification SHALL exercise the real Codex and Claude Code integrations, operate the production browser UI through Codex's in-app browser tooling, profile runtime and rendering performance, inspect persisted privacy-safe results, and produce a sanitized release-verification report linked to reproducible evidence.

#### Scenario: Clean installed product walkthrough
- **WHEN** the release candidate is installed on a clean supported environment and launched through the documented command
- **THEN** Codex browser automation completes the live view, entity inspection, session selection, replay, settings, reduced-motion, text fallback, restart, and uninstall user journeys without undocumented setup

#### Scenario: Real Codex integration round trip
- **WHEN** the installed Codex integration runs a sanitized session containing turn, tool, permission, plan, subagent, stop, and failure evidence supported by the active environment
- **THEN** the production UI and replay show the expected truthful semantic transitions and the persisted artifacts pass protocol and privacy validation

#### Scenario: Real Claude Code integration round trip
- **WHEN** the installed Claude Code integration runs a sanitized session containing tool, permission, task, subagent, stop, and failure evidence supported by the active environment
- **THEN** the production UI and replay show the expected truthful semantic transitions and advertise every unsupported or partially covered signal

#### Scenario: Performance profile passes
- **WHEN** the production build is profiled with sustained events, 100 semantic entities, 300 pooled effects, replay seeking, and repeated session switching on documented reference hardware
- **THEN** frame rate, event latency, main-thread long tasks, CPU use, heap growth, retained DOM and Three.js resources, and broker memory remain within the published release budgets

#### Scenario: Profiling or walkthrough finds a defect
- **WHEN** final verification exposes a correctness, privacy, accessibility, security, usability, or performance failure
- **THEN** stable publication remains blocked until a targeted fix or refactor is completed and the affected profile plus the complete release regression gate pass again

#### Scenario: Verification evidence is reviewable
- **WHEN** final verification completes
- **THEN** the release-gate report identifies the tested artifact and commit, environments, plugin versions, browser journeys, profiles, measurements, sanitized evidence locations, deviations, and final pass or fail decision

### Requirement: Stable release readiness
The project SHALL NOT publish `v1.0.0` until real sanitized Codex and Claude Code sessions pass the release acceptance suite, no critical security or privacy defects remain open, public documentation matches behavior, supported installations are reversible, and a clean machine can complete the documented first-run experience.

#### Scenario: Stable release candidate passes
- **WHEN** every required quality, compatibility, security, privacy, accessibility, performance, documentation, and platform gate is green
- **THEN** maintainers may publish the `v1.0.0` tag and GitHub release

#### Scenario: A required gate is waived
- **WHEN** any required stable-release gate is incomplete or waived
- **THEN** the build may be published only as a prerelease and not as `v1.0.0`
