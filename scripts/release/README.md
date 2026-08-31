# Release scripts

Ownership: release maintainers.

`pnpm release:test` runs deterministic unit checks for changelog extraction,
license inventory sanitization, and SHA-256 generation. `pnpm
release:verify` checks workspace version consistency. `pnpm release:prepare --
--version=<version>` runs the complete repository gate, invokes the production
build explicitly, builds a source-and-built-output archive, extracts release
notes, generates a sorted path-free dependency/license inventory, and writes
SHA-256 checksums under `dist/release/`.

The tag-triggered release workflow runs the self-test through the repository
gate, uploads the same files, requests GitHub artifact provenance for the
archive, and creates a prerelease for `0.x`/release-candidate tags. Only the
exact `v1.0.0` tag is treated as stable. npm publication is disabled.

Release preparation must run from a clean, checked-out tag or commit. The
archive is an offline source distribution: it includes checked-in source,
fixtures, tests, documentation, governance/compatibility policy, GitHub
metadata, marketplace packaging, package manifests, and built output, but
never `node_modules`, local application data, or `dist/release` itself.
`RELEASE_METADATA.json` records the source tag, protocol version, supported
platforms/toolchain, and installation entry point. `SHA256SUMS` covers the
archive, release notes, release metadata, and dependency inventory. Provenance
is platform/workflow evidence and is not silently claimed on local dry runs.

The release version check also requires the Codex marketplace manifest at
`packaging/marketplace/plugins/codeinvaders/.codex-plugin/plugin.json` and the
Claude manual manifest at `packaging/manual/claude/manifest.json` to match the
workspace version. Clean-clone verification validates both hook definitions,
resolves each packaged script, installs the marketplace payload into an
isolated `CODEX_HOME` and the manual payload into an isolated Claude config,
then executes both hooks. Missing bundles, external runtime imports, stale
versions, or failed isolated installation are hard failures.

`node scripts/release/verify-clean-clone.mjs` performs the 11.7 clean-clone
gate. It archives `HEAD` with `git ls-files` semantics (tracked files only),
installs with the frozen lockfile, runs check/build/release preparation, and
then drives the built CLI through install, start, status, doctor, replay, and
uninstall using temporary synthetic home, agent-config, and data roots. It
writes `dist/release/clean-clone-verification.json` and `.md`, emits only
relative report paths and bounded status metadata, and exits nonzero for any
required failure. Use `--timeout-ms=<milliseconds>` only for a bounded local
diagnostic run; the default is five minutes per subprocess. A missing release
fixture or a runtime that exits after `start` is a blocker, not a pass.

Sanitization boundary: release artifacts and reports contain only approved,
bounded metadata. Never include native prompts, messages, source, commands,
outputs, paths, URLs, credentials, environment values, transcripts, remotes,
or user names.

Runtime policy: release scripts must preserve offline operation and must never
bundle, fetch, or require remote runtime assets, analytics, or event-log upload.
