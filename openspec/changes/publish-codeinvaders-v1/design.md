## Context

See `proposal.md` for motivation and the seven capability specs for normative behavior. The workspace currently contains a single draft architecture document and OpenSpec planning data; it is not yet a Git repository and has no implementation or existing compatibility surface. The intended canonical destination is `github.com/danium/codeinvaders`.

The primary technical constraint is that native lifecycle hooks are evidence checkpoints, not uniformly committed facts. Pre-tool, task, stop, subagent-stop, and permission hooks can be blocked, rewritten, repeated, omitted, or reported without a stable correlation identifier. CodeInvaders must therefore remain useful while expressing uncertainty and must add negligible risk to the coding agent's critical path.

## Goals / Non-Goals

**Goals:**

- Produce a maintainable TypeScript codebase with explicit protocol, core, adapter, runtime, UI, and CLI boundaries.
- Make canonical semantic state reproducible from privacy-safe local evidence.
- Support real Codex and Claude Code sessions through one reducer and presentation grammar.
- Keep hooks bounded, reversible, non-controlling, and functional when the broker is absent.
- Resolve every predictable credential, account, plugin, browser, trust, and approval dependency before beginning the long-running implementation sequence.
- Ship a secure browser-based local application and verifiable public `v1.0.0` release.
- Leave stable extension seams for future adapters and renderers without prematurely publishing every internal module.

**Non-Goals:**

- Cloud collection, LAN dashboards, team productivity scoring, or remote control.
- Hidden-reasoning inspection, transcript parsing as a stable interface, or inference that activity equals progress.
- A native desktop shell, audio, marketplace, theme SDK, mobile client, or control-plane MCP server in `v1.0.0`.
- Pixel-identical replay across browsers and GPUs; semantic and intent determinism are the guarantees.
- Automatic semantic redaction of arbitrary task titles; labels remain opaque by default.

## Decisions

### 1. CodeInvaders is the product; AAP is its vendor-neutral contract

The public repository, CLI, documentation, and release are named CodeInvaders. The protocol remains the Agent Arcade Protocol because its semantics are intentionally renderer-neutral. Its stable protocol identifier will use the owned GitHub namespace, `io.github.danium.codeinvaders.aap`, rather than implying ownership of an external domain.

Alternative considered: rename every concept to CodeInvaders. Rejected because it would couple the protocol vocabulary to the first arcade theme and weaken the future-renderer boundary.

### 2. Use a pnpm TypeScript monorepo with a small initial package surface

The repository will use the current supported Node.js LTS, pnpm workspaces, TypeScript strict mode, and these initial boundaries:

```text
packages/
  protocol/
  core/
  adapter-sdk/
  adapter-codex/
  adapter-claude/
  cli/
apps/
  local/          # broker, HTTP/WS service, browser UI, Three.js renderer
fixtures/
tests/
docs/
```

The local app may have internal modules for broker, UI, renderer, and theme, but those do not become separately published packages until a second consumer proves the boundary. Protocol and adapter conformance packages remain independently testable.

Alternative considered: the original ten-package structure. Rejected for `v1.0.0` because it creates versioning and build overhead before the extension seams have real consumers.

### 3. AAP records evidence and committed outcomes separately

`fidelity` describes how information was obtained: `observed`, `derived`, or `synthetic`. `finality` describes whether it can be treated as committed: `provisional` or `confirmed`. Event names also reflect lifecycle phase: for example `tool.requested`, `tool.completed`, `task.completion.requested`, and `task.completed`.

Confirmed terminal events are monotonic unless an explicit correction event is received. Derived or provisional closure may be superseded by later observed evidence. Timeouts never produce success.

Alternative considered: retain `tool.started` and map every pre-hook to it. Rejected because other hooks can block or rewrite the operation after CodeInvaders observes the checkpoint.

### 4. Structural presentation entities are reducer-owned

The root carrier is created structurally by `session.started` unless an observed peer-agent model requires explicit roots. The single fallback objective is a deterministic semantic projection when a turn has no confirmed task lifecycle. Neither requires an invented native lifecycle event, and fallback objectives are stored separately from real tasks.

Alternative considered: let each adapter emit synthetic task and root-agent events. Rejected because it duplicates ownership, increases adapter variance, and can produce duplicate fallback entities.

### 5. Identity separates installation, stream, and process epoch

The event envelope carries a durable local `adapterId`, durable native-session `streamId`, restart-specific `epochId`, and sequence assigned monotonically within `streamId`. Native identifiers are namespaced and keyed with an installation-local secret when necessary. Entity keys are globally unique opaque values even when native IDs are only session-scoped.

Permissions receive their own `permissionId`; an `operationId` link is optional and declares observed or derived link fidelity. Ambiguous relationships remain unlinked.

Alternative considered: a single `instanceId`. Rejected because short-lived hook processes cannot provide a durable sequence namespace.

### 6. Hook ingress uses local IPC with an atomic spool fallback

Installed hooks invoke a prebuilt Node entry file directly, never `npx` or package resolution. The hook validates and sanitizes native input, creates a stable event identifier, and attempts a short local IPC delivery over a Unix-domain socket or Windows named pipe. The persistent broker acknowledges only after canonical append. If IPC is unavailable or exceeds its budget, the hook atomically renames one sanitized ingress file into the application spool and exits successfully.

The broker deduplicates ingress by event identifier, assigns stream sequence, appends the canonical journal, and retires the spool record only after durability. No raw native payload is spooled.

Alternative considered: every hook appends directly to one JSONL file. Rejected because cross-platform locking, concurrent hooks, crash recovery, and monotonic sequencing would all sit on the agent's critical path. A compiled native hook helper is deferred because it adds platform build and signing complexity; release latency tests will determine whether direct Node startup is adequate.

### 7. Journals are authoritative; manifests and snapshots are disposable

Canonical history is segmented JSONL per durable stream. Each record has a bounded size and newline termination. A small rebuildable manifest indexes sessions and segment ranges for discovery; SQLite is not required for `v1.0.0`. Snapshots contain canonical sorted state plus protocol, reducer, snapshot-schema, stream, and through-sequence versions.

Partial records, corrupt segments, incompatible snapshots, and abandoned spool temporaries are quarantined or ignored without losing preceding valid history. Rotation and retention operate only on verified owned paths and complete segments.

Alternative considered: SQLite as the canonical store. Rejected because append-only inspectable history and simple recovery are more valuable initially; an index can be added later without changing the protocol.

### 8. Reduction, presentation mapping, and rendering are separate pure boundaries

The core reducer is a pure function over canonical semantic events. A versioned presentation mapper consumes previous state, event, and next state to produce semantic-time animation intents. The Three.js renderer consumes state and intents but cannot reinterpret raw events.

Replay determinism has three levels:

1. Same ordered events and reducer version yield byte-equivalent canonical state.
2. Same transitions, mapper version, and seed yield equivalent animation intents.
3. Frames are visually equivalent but not promised pixel-identical across hardware.

Seek-safe animation uses absolute semantic time and deterministic seeds rather than accumulated frame deltas. A fixed simulation step may serve cosmetic motion, but current semantic state always wins.

Alternative considered: let Three.js objects be the application state. Rejected because replay, testing, WebGL fallback, and multiple presentations would become nondeterministic and inseparable.

### 9. Task reconciliation uses full revisions and conservative identity

Native lifecycle facts produce explicit task events. Snapshot-style plans produce a complete ordered `task.plan.reconciled` revision containing safe task identities, status, ordinal, and optional enabled label. Matching order is stable native ID, exact normalized identity with duplicate occurrence, then unambiguous ordinal continuity. Similarity scoring never transfers terminal state.

Alternative considered: patch-shaped `task.updated` plus fuzzy matching. Rejected because omitted fields are ambiguous and a wrong fuzzy match can falsely destroy the wrong task.

### 10. The local browser service uses HTTP plus WebSocket

HTTP serves immutable local assets, authenticated session and replay queries, and health information. One authenticated WebSocket carries live events and live-edge state. SSE is deferred because it duplicates transport surface without a current consumer. Hook ingress never uses the browser port; it uses local IPC.

The service binds loopback only, generates a new secret and eligible origin at every start, places no secret in query strings, and applies strict origin checks and CSP. The launch command transfers the secret through a URL fragment or equivalent non-referrer channel and the UI exchanges it for an in-memory session.

Alternative considered: unauthenticated localhost. Rejected because arbitrary local pages and processes could read sensitive session metadata through cross-origin or WebSocket attacks.

### 11. Privacy uses allowlists, not best-effort redaction

Adapters construct new canonical payloads from allowed scalar fields; they do not remove sensitive keys from a copied native object. Built-in safe tool names may be retained, but unknown and MCP tools default to a generic category unless the user enables names. Repository and task labels are opaque by default. Optional titles are an explicit per-installation or per-repository choice, length-limited and escaped, with documentation that heuristic sanitization cannot guarantee secrecy.

Diagnostics use structured codes and safe metadata. Any future raw diagnostic capture is outside `v1.0.0` unless separately specified.

Alternative considered: automatically redact arbitrary prompts, paths, commands, and titles. Rejected because false negatives would violate the privacy contract.

### 12. Installation is ownership-aware and transaction-like

The CLI discovers supported agent installations, presents a dry-run diff, writes uniquely marked CodeInvaders hook entries, validates the resulting configuration, and retains a recovery copy until doctor succeeds. User scope is the default. Project scope requires explicit confirmation because files may be committed.

Uninstall parses current configuration and removes only still-recognizable owned entries; it does not restore an old whole-file backup over later user edits. Recordings are preserved unless separately deleted. Upgrade runs compatibility checks before replacing hooks or assets.

Alternative considered: overwrite hook files from templates. Rejected because it can destroy user and enterprise configuration.

### 13. Browser-first release with accessible text parity

The local app uses DOM controls and inspector content around a Three.js world. Every protected semantic transition is also present in the text activity feed. Reduced motion replaces travel, shake, and explosions with state changes. Audio and remote assets are absent from `v1.0.0`.

The renderer uses instancing and pools for repeated cosmetic objects, bounded intent queues, explicit Three.js disposal, and density reduction. Cosmetic effects may be coalesced; semantic events cannot be dropped.

Alternative considered: ship a desktop shell for the first stable version. Rejected because it multiplies packaging, signing, autostart, and security work without changing the observability contract.

### 14. GitHub releases are canonical and `v1.0.0` is gate-driven

The local workspace will be initialized as a Git repository and published to `github.com/danium/codeinvaders`. Apache-2.0 will be the default license because its explicit patent grant supports third-party adapters and integrations. GitHub Actions will run the quality and supported-platform matrices, create checksummed release artifacts, generate provenance where available, and block stable publication unless all specified gates pass.

Development proceeds through prerelease milestones (`0.x` and release candidates). The protocol becomes `1.0.0` only with the product release. GitHub source and release assets are canonical; optional npm publication can be added only after package-name ownership and provenance configuration are verified.

Alternative considered: publish `1.0.0` as soon as the renderer works. Rejected because the public stability promise includes adapters, privacy, recovery, installation, documentation, and compatibility.

### 15. Execution is gated by autonomy preflight and instrumented final verification

Before implementation task 1 begins, an execution-readiness preflight records and verifies every predictable dependency that could otherwise require human intervention mid-run. The preflight covers local toolchain versions, package-registry access, Git identity, GitHub CLI authentication, ownership and write/admin access for `danium/codeinvaders`, ability to create or connect the target repository, Codex and Claude Code installations, their supported plugin or hook surfaces, Codex in-app browser availability, permitted user-level configuration locations, network access required for dependencies and publication, and any release credential or signing choice. Optional npm publication is disabled unless its credentials and package ownership are already verified.

The preflight distinguishes three outcomes:

- `ready`: every required dependency and approval is verified;
- `not-applicable`: an optional path such as npm publication is removed from the execution path;
- `blocked`: a required login, permission, trust review, external account decision, or unavailable tool remains.

Implementation does not begin while any required item is `blocked` or `unknown`. The readiness report lists the exact commands and checks performed but redacts tokens and secrets. Textual authorization does not bypass native plugin trust or security prompts; if a platform requires an irreducible review that cannot safely be completed during preflight, the run remains blocked instead of weakening that control. Unexpected later prompts pause at a safe checkpoint and never trigger bypass behavior.

After a release candidate is built, verification uses the exact packaged artifact and production configuration. The real Codex and Claude Code integrations are installed through the documented flow, run against sanitized verification sessions, and then removed or restored through the ownership-aware uninstall path. Codex's in-app browser tooling drives the live arena, inspector, session selector, settings, replay, reduced-motion, text fallback, restart, and uninstall journeys. Fixture-only results cannot satisfy the stable-release gate.

Profiling covers three layers with one reproducible harness:

1. Adapter full wall time for IPC success and spool fallback.
2. Broker ingestion throughput, reducer latency, spool/journal behavior, replay seek time, and process memory.
3. Browser frame pacing, FPS, main-thread long tasks, CPU activity, event-to-presentation latency, JavaScript heap growth, retained DOM nodes, Three.js object/resource counts, and repeated-session-switch behavior.

Profiles include baseline, specified stress load, replay seeking, and a soak run. Raw profiles and screenshots are treated as potentially sensitive, stored outside canonical recordings, sanitized before sharing, and summarized in a committed release-verification report tied to the exact commit and artifact checksum.

When verification identifies a failure, refactoring is evidence-led: isolate the measured bottleneck or defect, make the smallest design-compatible change, add a regression test, rerun the identical profile for comparison, and then rerun the complete release gate. Budgets are not relaxed to make a failing build pass. If passing requires a protocol, security, privacy, or scope change, implementation stops and the OpenSpec change is revised before proceeding.

Alternative considered: begin implementation and request credentials or approvals only when commands fail, then perform an informal manual smoke test before release. Rejected because it strands long autonomous runs at predictable external blockers and provides no reproducible evidence that the installed product meets correctness or performance claims.

## Risks / Trade-offs

- [Native hook schemas or semantics change] → Pin documented fixture versions, advertise runtime coverage, validate inputs, and fail into degraded modes rather than guessing.
- [Hook checkpoints never provide definitive turn or background-agent completion] → Model quiescence explicitly, confirm from stronger later evidence, and close unresolved state as unknown.
- [Node startup misses the hook latency budget] → Use prebuilt direct entry files and broker IPC first; benchmark early and replace only the hook shim with a native helper if the release gate fails.
- [Spool files accumulate while the broker is absent] → Apply strict per-record and total-spool limits, preserve newest lifecycle-critical evidence where safe, and report a telemetry gap rather than blocking the agent.
- [Per-stream order cannot prove global causality] → Keep reducers partitioned by stream and label merged timelines approximate unless explicit links exist.
- [Optional labels leak sensitive data] → Default to opaque labels, make opt-in scope visible, and exercise privacy canaries through every persistence layer.
- [A broad stable-release goal delays visual feedback] → Deliver fixture, headless, and vertical-slice milestones before hardening; keep each milestone runnable and reviewable.
- [Cross-platform hook composition corrupts configuration] → Use parsers, dry-run diffs, atomic writes, recovery copies, doctor verification, and ownership-aware uninstall tests on every platform.
- [Three.js effects obscure operational meaning] → Protect semantic transitions, enforce density budgets, provide inspector and text parity, and test reduced-motion behavior.
- [Public API surface becomes too large before use] → Publish only protocol, CLI, and documented adapter interfaces required by real consumers; keep internal renderer/theme seams private until proven.
- [A required external login or trust prompt appears after autonomous work begins] → Run the readiness gate first, remove unavailable optional paths, and do not start while any required dependency is unknown or blocked.
- [Native plugin trust cannot be safely completed before its final hook command exists] → Treat the integration as a planned checkpoint, prepare and disclose the exact command early, and never bypass or weaken native trust review; if it cannot be pre-authorized, report the run as blocked before committing to uninterrupted execution.
- [Profiling artifacts contain sensitive local information] → Use sanitized fixture labels, isolate raw traces from release assets, scan them for canaries, and publish only bounded summaries and approved evidence.
- [Performance refactoring changes semantics] → Require a regression test, identical before/after workload, protocol conformance, privacy scan, and full release-gate rerun after each accepted refactor.

## Migration Plan

There is no installed predecessor to migrate. Delivery proceeds through reversible maturity gates:

1. Run the execution-readiness preflight and resolve, remove, or explicitly block every known HITL dependency before implementation begins.
2. Initialize the repository, toolchain, license, security policy, CI, and documentation skeleton.
3. Implement and validate AAP schemas, canonical serialization, golden evidence fixtures, and the signal-certainty matrix.
4. Implement headless adapter normalization, privacy tests, spool ingestion, journal recovery, reducer, and text replay.
5. Integrate one real Codex and one real Claude Code session behind manual hook configuration; keep all releases prerelease.
6. Add the browser runtime, accessible Three.js vertical slice, inspector, live delivery, and replay controls.
7. Add transactional install, doctor, upgrade, uninstall, supported-platform packaging, and malicious-input hardening.
8. Build a release candidate and run clean-install real-plugin verification, Codex browser journeys, security and privacy inspection, profiling, soak testing, and ownership-aware cleanup.
9. Perform only evidence-backed fixes or refactors, compare profiles, and rerun the complete release gate until every requirement passes.
10. Create the public repository and prereleases as soon as the project is useful; publish `v1.0.0` only after the final verification report passes every stable gate.

Rollback during prerelease removes only CodeInvaders-owned hooks and binaries while retaining journals by default. A failed upgrade restores the immediately previous owned configuration and executable set. Canonical journals are never silently downgraded or deleted.

## Open Questions

- Whether the unscoped `codeinvaders` npm package name is available and appropriate. This does not block the canonical GitHub source and release-asset distribution; npm publication remains optional until ownership is verified.
- Exact supported operating-system version floors will follow the chosen Node.js LTS support table and clean-machine CI availability, without changing the cross-platform lifecycle requirements.
