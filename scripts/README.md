# Scripts

Ownership: release maintainers.

Purpose: contain deterministic repository automation with explicit ownership
and review before execution.

Sanitization boundary: scripts must consume and emit bounded, sanitized
metadata; never copy native agent text, source, commands, outputs, paths, URLs,
credentials, environment values, transcripts, remotes, or user names into
artifacts.

Runtime policy: scripts must not download or require remote runtime assets or
send telemetry; release inputs come from the local checkout and pinned tools.
