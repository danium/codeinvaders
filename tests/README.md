# Tests

Ownership: maintainers of the package or application under test.

Purpose: hold repository-wide conformance, privacy, integration, and release
verification tests that do not belong to one package.

Sanitization boundary: tests may assert rejection of sensitive native fields,
but test inputs and snapshots must remain synthetic or sanitized and must not
persist native prompts, source, commands, outputs, paths, URLs, credentials,
environment values, transcripts, remotes, or user names.

Runtime policy: tests must run against local code and checked-in fixtures only;
no remote runtime assets, telemetry, or external service is permitted.
