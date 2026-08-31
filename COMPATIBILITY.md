# Compatibility

The initial release targets Node.js 24 with pnpm 10 for source builds and the
current GitHub-hosted Windows, macOS, and Linux environments. Exact operating
system floors follow the supported Node release and are recorded in each
release's compatibility table.

AAP uses semantic versioning. Consumers reject unsupported major versions,
ignore compatible unknown optional fields, preserve bounded namespaced
extensions in journals, and surface a diagnostic when semantics cannot be
interpreted. Journal, snapshot, CLI, and adapter contracts are frozen at the
release-candidate gate and migration is tested from the supported prerelease.

Codex and Claude Code compatibility is version-pinned to recorded sanitized
fixtures and a real-session release check. Capability profiles are per session:
missing hosted tools, Task tools, permission denials, correlation, or terminal
hooks remain explicit gaps. A detected surface is not the same as confirmed
coverage.

There is no npm publication contract for `v1.0.0`. Canonical source and
checksummed artifacts are distributed through GitHub Releases.
