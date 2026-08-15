# Fixtures

Ownership: adapter and protocol maintainers.

Purpose: store small, versioned inputs and expected sanitized records for
conformance, replay, and privacy tests.

Sanitization boundary: fixtures contain synthetic or explicitly sanitized
native-shaped data only. Do not commit prompts, messages, source, commands,
arguments, outputs, absolute paths, URLs, credentials, environment values,
transcripts, repository remotes, or user names.

Runtime policy: fixtures are local test data. They must not reference, fetch,
or require remote runtime assets or services.
