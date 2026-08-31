# Testing

`pnpm check` runs notice consistency, formatting, lint, type checking, the root
test suite, production builds, and protocol-document compatibility. CI repeats
the gate on Windows, macOS, and Linux.

Unit tests live beside their package boundary. Repository tests cover adapter
conformance, privacy persistence, installation composition, local-runtime
security, accessibility, and release behavior. Golden fixtures are versioned
and sanitized. Property-style tests use deterministic seeds so failures are
reproducible.

Tests that touch configuration or recordings use isolated temporary roots and
verify resolved targets before cleanup. Clean-machine lifecycle tests preserve
hashable recovery copies and restore unrelated configuration exactly. Real
agent and browser verification is required for a stable release; fixture-only
tests cannot substitute for it.
