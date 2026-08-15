## 0. Execution Readiness Gate

- [x] 0.1 Inventory every required local command, runtime, browser capability, agent installation, external service, credential, account permission, user-level file location, trust review, and approval needed through stable publication.
- [x] 0.2 Verify GitHub CLI authentication resolves to the intended `danium` account and verify write/admin ability for `danium/codeinvaders`; if the target is absent, verify repository-creation authority or reserve it without publishing incomplete work.
- [x] 0.3 Verify Git author identity, noninteractive credential access, network reachability, GitHub release and workflow permissions, private vulnerability-reporting access, and the ability to push the intended default branch.
- [x] 0.4 Verify supported Node.js and pnpm availability plus noninteractive access to every required dependency registry; preapprove or install required toolchains before implementation starts.
- [x] 0.5 Verify the installed Codex desktop/CLI surfaces, lifecycle-hook support, plugin support, Codex in-app browser control, Claude Code installation, Claude hook support, and their active versions.
- [x] 0.6 Identify every Codex and Claude user/project configuration path that integration testing may modify, obtain the required scope authorization, and record a safe backup and restoration strategy before touching it.
- [x] 0.7 Identify native plugin or hook trust prompts and confirm they can be completed without bypassing platform security; mark the run blocked if an irreducible required review cannot be resolved before uninterrupted execution.
- [x] 0.8 Verify release checksum and provenance capabilities and mark npm publication `not-applicable` unless package ownership and credentials are already confirmed.
- [x] 0.9 Produce a sanitized readiness report classifying every item as `ready`, `not-applicable`, or `blocked`, and stop before task 1.1 if any required item is `blocked` or `unknown`.

## 1. Repository and Toolchain Foundation

- [x] 1.1 Initialize the local Git repository with `main` as the default branch and add repository-safe ignore and attributes files.
- [x] 1.2 Create the pnpm workspace, strict TypeScript base configuration, supported Node.js version declaration, and root package scripts.
- [x] 1.3 Scaffold the protocol, core, adapter SDK, Codex adapter, Claude adapter, CLI, and local-app workspaces with dependency boundaries matching `design.md`.
- [x] 1.4 Configure deterministic formatting, linting, type checking, unit testing, production builds, and a single root `check` command.
- [x] 1.5 Add Apache-2.0 licensing, third-party notice generation, dependency update configuration, and an initial changelog policy.
- [x] 1.6 Add baseline GitHub Actions for install, format, lint, type check, test, and build on supported Windows, macOS, and Linux runners.
- [x] 1.7 Add fixture, test, documentation, and release-script directories with ownership notes and no remote runtime assets.

## 2. Agent Arcade Protocol

- [x] 2.1 Define the `io.github.danium.codeinvaders.aap` envelope, durable source identities, scope invariants, fidelity, finality, and core event discriminants in TypeScript.
- [x] 2.2 Define JSON Schemas for every core event, including event-specific required scopes, byte and depth limits, and compatibility metadata.
- [x] 2.3 Implement runtime protocol validation that returns bounded structured diagnostics and quarantines unsupported major versions.
- [x] 2.4 Define requested, quiescent, confirmed, failed, denied, cancelled, abandoned, correction, capability-change, and telemetry-gap semantics.
- [x] 2.5 Define complete revisioned task-plan reconciliation events and prohibit fuzzy identity transfer for terminal task state.
- [x] 2.6 Define the signal capability model covering evidence, coverage, finality, exclusions, and active-session changes.
- [x] 2.7 Implement canonical event and state serialization with stable key and entity ordering.
- [ ] 2.8 Add protocol fixtures for valid events, invalid scopes, unknown optional fields, extensions, incompatible versions, duplicates, and correlation ambiguity.
- [ ] 2.9 Publish protocol compatibility and extension documentation generated or checked against the executable schemas.

## 3. Adapter SDK, Privacy, and Ingress

- [ ] 3.1 Implement keyed opaque ID derivation for installations, workspaces, repositories, streams, turns, agents, tasks, operations, and permissions without persisting raw identifiers.
- [ ] 3.2 Implement allowlist-only canonical payload builders and safe built-in tool categorization with generic defaults for unknown and MCP tools.
- [ ] 3.3 Implement structured privacy-safe diagnostics with bounded codes, counts, durations, and no copied native text.
- [ ] 3.4 Implement sanitized ingress records, stable retry event identifiers, per-record size limits, and validation before IPC or spool writes.
- [ ] 3.5 Implement local IPC delivery over Unix-domain sockets and Windows named pipes with bounded acknowledgement time.
- [ ] 3.6 Implement temporary-write plus atomic-rename spool fallback and recovery-safe ownership and permission handling.
- [ ] 3.7 Implement total spool limits and explicit telemetry-gap behavior for overflow without delaying the coding agent.
- [ ] 3.8 Build privacy-canary tests that scan spool, journal, snapshot, manifest, and diagnostics for every prohibited native field class.
- [ ] 3.9 Build hook-latency benchmarks that include direct Node entry startup, IPC success, broker absence, and spool fallback.

## 4. Codex Adapter

- [ ] 4.1 Capture and document sanitized Codex fixtures for session, prompt, pre/post tool, permission, subagent, stop, compaction, and session-end hooks.
- [ ] 4.2 Implement Codex native-schema validation and active capability detection, including missing hosted-tool coverage.
- [ ] 4.3 Map prompt and stop checkpoints to requested, active, and quiescent turn evidence without manufacturing successful completion.
- [ ] 4.4 Map pre-tool evidence to provisional operations and post-tool evidence to confirmed completion or conservative failure classification using native tool-use identifiers.
- [ ] 4.5 Map permission evidence to independently identified requests and leave operation links absent when native correlation is ambiguous.
- [ ] 4.6 Map subagent lifecycle evidence, parent relationships, attributed tool calls, and foreground completion without treating a stoppable checkpoint as irrevocable finish.
- [ ] 4.7 Reconcile confirmed `update_plan` revisions using stable native identity or conservative exact matching and emit cancellation rather than false completion for removals.
- [ ] 4.8 Add Codex conformance tests for blocking hooks, rewritten tools, nonzero shell results, parallel calls, repeated stop, missing terminal events, and adapter restart.
- [ ] 4.9 Produce a prebuilt direct Codex hook entry and transparent plugin/manual hook definitions that return no decision or context payload.

## 5. Claude Code Adapter

- [ ] 5.1 Capture and document sanitized Claude Code fixtures for session, prompt, tool success/failure, permission, denial, task, subagent, stop, stop-failure, and session-end hooks.
- [ ] 5.2 Implement Claude native-schema validation and per-session capability detection, including sessions without Task tools and partial permission-denial coverage.
- [ ] 5.3 Map prompt, stop, and stop-failure evidence to requested, quiescent, confirmed-failure, and session-sealing semantics.
- [ ] 5.4 Map `PreToolUse`, `PostToolUse`, and `PostToolUseFailure` to provisional and confirmed operation events while excluding validation and permission denials from execution failure.
- [ ] 5.5 Map `PermissionRequest` and supported `PermissionDenied` evidence without claiming coverage for manual denials, deny rules, or unrelated hook blocks.
- [ ] 5.6 Map `TaskCreated` and `TaskCompleted` to provisional requests and confirm committed task changes from successful task-tool evidence.
- [ ] 5.7 Map subagent identity, nesting, tool attribution, foreground/background lifecycle, and resumable subagent-stop checkpoints.
- [ ] 5.8 Add Claude conformance tests for blocked task creation/completion, auto and manual denial gaps, background agents, parallel tools, API stop failure, and missing Task tools.
- [ ] 5.9 Produce a prebuilt direct Claude hook entry and transparent plugin/manual hook definitions that return no decision or context payload.

## 6. Canonical Journal and Semantic Core

- [ ] 6.1 Implement the broker ingress canonicalizer with event-ID deduplication, durable stream sequence assignment, append acknowledgement, and sanitized rejection paths.
- [ ] 6.2 Implement segmented per-stream JSONL journals with complete-record writes, rotation, bounded records, and user-only storage permissions where supported.
- [ ] 6.3 Implement startup recovery for pending spool records, partial final journal records, corrupt records, duplicates, and interrupted segment rotation.
- [ ] 6.4 Implement the rebuildable session manifest and consistency repair after retention or manual file loss.
- [ ] 6.5 Define canonical semantic state and pure reducers for sources, sessions, turns, agents, tasks, operations, permissions, gaps, and diagnostics.
- [ ] 6.6 Implement requested-active-quiescent-sealed turn transitions and starting-working-quiescent-finished agent transitions with resumable provisional state.
- [ ] 6.7 Implement operation and task terminal monotonicity, explicit correction handling, conservative unknown closure, and no timeout-to-success path.
- [ ] 6.8 Implement reducer-owned structural root agents and exactly one turn-scoped fallback objective outside the real task collection.
- [ ] 6.9 Implement versioned canonical snapshots with sorted state, stream positions, compatibility checks, atomic writes, and journal rebuild fallback.
- [ ] 6.10 Implement deterministic replay, idle compression, speed control, seek, semantic-event indexing, filters, and live-edge return over canonical events only.
- [ ] 6.11 Add golden tests for live/replay byte equivalence, duplicates, gaps, conflicting terminals, cross-stream tie-breaking, restart recovery, and incompatible snapshots.
- [ ] 6.12 Implement verified-path journal retention and derived-artifact invalidation with tests for symlink and path-escape attempts.

## 7. Secure Local Runtime

- [ ] 7.1 Implement broker startup on loopback-only HTTP and a separate local hook IPC endpoint, with refusal of non-loopback browser binds.
- [ ] 7.2 Implement per-process browser secrets, fragment-or-equivalent secure launch transfer, in-memory session exchange, rotation, expiry, and restart invalidation.
- [ ] 7.3 Implement exact origin validation, authenticated HTTP replay/session APIs, authenticated WebSocket live delivery, and bounded client queues.
- [ ] 7.4 Add a restrictive Content Security Policy, immutable local asset serving, no dynamic evaluation, and no runtime remote asset dependency.
- [ ] 7.5 Validate all ingress, journal, snapshot, API, and WebSocket data at trust boundaries with size, depth, count, and rate limits.
- [ ] 7.6 Implement application-data discovery, secure directory creation, config and local-salt management, safe rotation, and crash-consistent writes on all supported platforms.
- [ ] 7.7 Implement status, retention, and explicit delete-all runtime operations with verified owned targets and symlink-safe behavior.
- [ ] 7.8 Add malicious-input tests for oversized payloads, malformed JSON, unsupported versions, markup labels, origin attacks, stale secrets, slow clients, and corrupted local files.

## 8. Browser UI and Three.js Presentation

- [ ] 8.1 Build the browser shell with repository/session selection, telemetry badge, live status, inspector, settings, replay controls, and text activity feed.
- [ ] 8.2 Implement a versioned pure presentation mapper from semantic transitions to semantic-time animation intents.
- [ ] 8.3 Implement the original retro-futurist arena, structural carrier, child ships, nested hierarchy, real task enemies, and distinct fallback objective using original assets.
- [ ] 8.4 Implement provisional tool charge, permission lock, confirmed success impact, failure, denial, abandonment, and unattributed-operation treatments.
- [ ] 8.5 Implement task creation, reorder, assignment, provisional completion, confirmed explosion, failure, cancellation retreat, and explicit correction treatments.
- [ ] 8.6 Implement turn quiescence, resumed activity, level outcome, session ending, capability degradation, and telemetry-gap presentations without invented progress.
- [ ] 8.7 Implement seek-safe replay rendering from absolute semantic time and deterministic mapper seeds.
- [ ] 8.8 Add instanced repeated geometry, bounded object pools, effect coalescing, density reduction, fixed cosmetic simulation, and explicit resource disposal.
- [ ] 8.9 Implement complete keyboard navigation, logical focus, color-independent status shapes, high contrast, reduced motion, and rate-limited live-region announcements.
- [ ] 8.10 Implement WebGL initialization failure handling and semantic parity through the text feed and DOM inspector.
- [ ] 8.11 Add visual-state fixtures and automated tests for parallel tools from one ship, multiple subagents, all task terminals, permissions, gaps, degraded modes, and replay seeks.
- [ ] 8.12 Add performance instrumentation and acceptance fixtures for 100 semantic entities, 300 pooled effects, sustained event storms, memory stability, and live latency.

## 9. CLI and Installation Lifecycle

- [ ] 9.1 Implement CLI argument parsing, configuration discovery, stable exit codes, noninteractive operation, and help for install, start, status, doctor, replay, upgrade, and uninstall.
- [ ] 9.2 Implement Codex and Claude Code environment and surface detection with documented capability and plugin/manual-install limitations.
- [ ] 9.3 Implement dry-run configuration diffs and parsers that compose uniquely owned CodeInvaders entries without replacing unrelated hooks.
- [ ] 9.4 Implement user-scope installation by default and explicit confirmation plus repository-visible file reporting for project scope.
- [ ] 9.5 Implement atomic configuration writes, recovery copies, post-write validation, and rollback when doctor fails.
- [ ] 9.6 Implement `start` process lifecycle, browser launch, stale runtime detection, clean shutdown, and actionable port or data-directory errors.
- [ ] 9.7 Implement `doctor` checks for hooks, direct entry files, permissions, storage, IPC, browser authentication, assets, adapters, and a privacy-safe synthetic event round trip.
- [ ] 9.8 Implement compatibility-aware upgrade with configuration rollback and refusal of destructive journal migrations.
- [ ] 9.9 Implement ownership-aware uninstall that preserves recordings by default and removes only recognized CodeInvaders entries and files.
- [ ] 9.10 Add full install-start-doctor-replay-upgrade-uninstall tests on clean and preconfigured Windows, macOS, and Linux environments.

## 10. Conformance, Security, and Release Hardening

- [ ] 10.1 Build the shared adapter conformance runner and golden scenarios for fallback, plans, cancellation, parallel tools, nested agents, permissions, failure, duplicates, gaps, restart, and sensitive canaries.
- [ ] 10.2 Run recorded real-session conformance for one supported Codex version and one supported Claude Code version and document the observed capability profiles.
- [ ] 10.3 Add fuzz and property tests for schema validation, reducer determinism, canonical serialization, journal recovery, and configuration composition.
- [ ] 10.4 Add accessibility automation plus manual keyboard, screen-reader, contrast, reduced-motion, and WebGL-fallback release checks.
- [ ] 10.5 Establish and measure release budgets for full hook latency, event-to-presentation latency, frame rate, memory, spool growth, and replay seek time on reference systems.
- [ ] 10.6 Perform the loopback authentication, origin, CSP, path traversal, symlink deletion, secret handling, dependency, and malicious-journal security review.
- [ ] 10.7 Verify default offline operation with network access disabled and scan production assets and code for unexpected remote endpoints or analytics.
- [ ] 10.8 Produce a release-gate report linking every capability scenario to automated or documented manual evidence.

## 11. Documentation and Public Repository

- [ ] 11.1 Write the public README with honest product claims, screenshots or recordings from sanitized fixtures, quick start, privacy defaults, limitations, and supported environments.
- [ ] 11.2 Write protocol, adapter-authoring, architecture, replay, data-layout, privacy, threat-model, accessibility, and troubleshooting documentation.
- [ ] 11.3 Write contributor setup, testing, fixture sanitization, design-decision, code-of-conduct, governance, and compatibility documentation.
- [ ] 11.4 Add `SECURITY.md` with private reporting, supported versions, response expectations, and guidance not to attach event logs by default.
- [ ] 11.5 Add GitHub issue and pull-request templates, ownership metadata, branch protection documentation, and required-check configuration.
- [ ] 11.6 Create release scripts for version consistency, changelog generation, production builds, dependency and license inventory, SHA-256 checksums, and provenance where supported.
- [ ] 11.7 Verify a clean clone of the release candidate can install, build, test, run, record, replay, and uninstall using only public source and documented dependencies.
- [ ] 11.8 Synchronize the complete history to the preflight-verified `github.com/danium/codeinvaders` repository, enable private vulnerability reporting, and configure protected release workflows.

## 12. Prerelease and Release Candidate

- [ ] 12.1 Publish an initial `0.x` GitHub prerelease after the headless protocol, adapters, journal, reducer, and text replay pass conformance.
- [ ] 12.2 Publish a visual prerelease after the secure local runtime, Three.js vertical slice, text parity, and manual Codex and Claude integrations pass acceptance.
- [ ] 12.3 Publish a release candidate after the full installation lifecycle and supported-platform matrix pass on clean machines.
- [ ] 12.4 Freeze the release-candidate AAP, journal, snapshot, CLI, and adapter compatibility contracts and verify migration behavior from the supported prerelease baseline.
- [ ] 12.5 Build the exact candidate artifacts for final verification and record their commit, versions, SHA-256 checksums, dependency inventory, provenance status, configuration, and known limitations.

## 13. Final Installed-Product Verification and Profiling

- [ ] 13.1 Prepare a clean supported verification environment and isolated CodeInvaders data root while preserving restorable backups of any existing Codex and Claude configuration.
- [ ] 13.2 Install the exact release-candidate artifact through the documented user flow, enable both integrations through their supported plugin or hook paths, start the production runtime, and require `doctor` to pass.
- [ ] 13.3 Run a sanitized real Codex session that exercises supported turn, tool, permission, plan, parallel call, subagent, stop, restart, and failure evidence and record the expected capability profile.
- [ ] 13.4 Run a sanitized real Claude Code session that exercises supported tool, permission, task, parallel call, foreground/background subagent, stop, stop-failure, and degraded-task evidence and record the expected capability profile.
- [ ] 13.5 Use Codex in-app browser control against the production build to complete live view, entity inspection, repository/session selection, settings, replay speed, seek, filtering, significant-event jumps, live-edge return, restart, and uninstall journeys.
- [ ] 13.6 Use Codex browser to verify keyboard-only operation, focus order, high contrast, color-independent state, reduced motion, rate-limited announcements, responsive layout, and WebGL-disabled text parity.
- [ ] 13.7 Verify live and replay semantic equivalence for both real plugin sessions and scan spool, journal, snapshots, manifests, diagnostics, browser-visible details, screenshots, and traces for privacy canaries.
- [ ] 13.8 Exercise broker absence and recovery, offline operation, duplicate and out-of-order evidence, permission ambiguity, event storms, session switching, retention, delete-all, ownership-aware uninstall, and exact restoration of unrelated agent configuration.
- [ ] 13.9 Run the browser performance-profiling workflow on the production build and capture frame pacing, FPS, main-thread long tasks, CPU activity, event-to-presentation latency, JavaScript heap, retained DOM nodes, Three.js objects/resources, and session-switch behavior.
- [ ] 13.10 Profile adapter full wall time, broker ingestion throughput and memory, reducer latency, spool fallback, journal rotation, replay seek time, 100 semantic entities, 300 pooled effects, and the sustained-load fixture.
- [ ] 13.11 Run a documented soak profile with repeated live/replay transitions and compare heap, listeners, DOM nodes, Three.js resources, broker memory, journal growth, and frame stability from baseline to completion.
- [ ] 13.12 Analyze browser, adapter, broker, reducer, and soak profiles against published budgets and create a severity-ranked finding for every correctness, privacy, accessibility, security, usability, or performance failure.
- [ ] 13.13 For each failing finding, make the smallest evidence-backed design-compatible fix or refactor, add a regression test, rerun the identical failing journey or profile, and record the before/after result without relaxing the budget.
- [ ] 13.14 After any verification-driven change, rebuild a new candidate and rerun the complete automated release gate plus tasks 13.2 through 13.13 until the exact candidate passes without unresolved required findings.
- [ ] 13.15 Produce a sanitized final-verification report identifying the exact commit and checksums, environments, agent and plugin versions, browser journeys, profiles, measurements, evidence locations, refactors, deviations, cleanup result, and final pass or fail decision.

## 14. Stable Publication

- [ ] 14.1 Confirm the final candidate has no unresolved release blocker or critical security or privacy issue and that every required automated and manual gate is green.
- [ ] 14.2 Generate and review final release assets, checksums, inventories, provenance, changelog, compatibility table, known limitations, and the passing final-verification report.
- [ ] 14.3 Tag and publish `v1.0.0` on `github.com/danium/codeinvaders` from the exact verified commit and immutable candidate artifacts.
- [ ] 14.4 Verify published checksums, provenance, downloads, documentation links, and a clean-machine first-run workflow using only public assets.
- [ ] 14.5 Announce the stable release with direct links to installation, privacy, security, compatibility, known limitations, and support documentation.
