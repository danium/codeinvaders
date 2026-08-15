# Release scripts

Ownership: release maintainers.

Purpose: placeholder for version checks, changelog and inventory generation,
production builds, checksums, and provenance helpers described by the release
design.

Sanitization boundary: release artifacts and reports contain only approved,
bounded metadata. Never include native prompts, messages, source, commands,
outputs, paths, URLs, credentials, environment values, transcripts, remotes,
or user names.

Runtime policy: release scripts must preserve offline operation and must never
bundle, fetch, or require remote runtime assets, analytics, or event-log upload.
