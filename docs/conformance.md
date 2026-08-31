# Conformance evidence

The repository-wide conformance suite is at `tests/conformance`. It uses one
shared runner (`runner.ts`) and the same sanitized golden catalog for both
public adapter surfaces. The runner only consumes the adapters' documented
normalization, capability, and fail-open hook APIs; it never imports native
agent internals or asserts over raw payloads.

## Golden coverage

`fixtures/conformance/golden-scenarios.json` contains versioned native-shaped
inputs for:

- no task lifecycle and the explicit fallback capability;
- plan evidence, repeated stop/cancellation checkpoints, and conservative
  failure classification;
- parallel tool calls and native correlation;
- nested and background agent evidence;
- permission requests, ambiguity, and denial;
- execution and validation failures;
- repeated session-start delivery (restart/duplicate input);
- sensitive canaries in every text-bearing native field; and
- unsupported future hook rejection.

Each scenario runs through both Codex and Claude Code. The shared projection
compares only AAP-level signal, finality, correlation, status, and bounded
failure metadata. The test also calls each adapter's direct hook entry for
every input and verifies it returns the empty observational response.

## Property and recovery checks

`properties.test.ts` provides deterministic, property-style coverage for:

- total, repeatable protocol validation over malformed and mutated envelopes;
- reducer determinism and duplicate-safe semantic state;
- canonical key ordering, entity ordering, and `-0` normalization;
- journal recovery after a partial or corrupt suffix, including duplicate
  acknowledgement after restart; and
- versioned snapshot serialization and incompatible stream rejection; and
- JSON/TOML configuration composition, idempotence, malformed-input rejection,
  ownership markers, and preservation of unrelated hooks through the CLI's
  public `parseConfig`, `compose*Config`, and `removeOwnedConfig` APIs.

The sensitive-canary test writes only normalized adapter output to isolated
temporary files named as spool, journal, snapshot, manifest, and diagnostics
artifacts, scans all of them through the SDK's `scanPrivacyCanaries` API, and
also proves the scanner fails when a canary is deliberately injected.

The mutation stream uses a fixed seed so failures are reproducible. Journal
tests use temporary directories and only synthetic `validEventFixture` events.

## Running

```text
node_modules/.bin/vitest.cmd run --config vitest.config.mjs tests/conformance
```

The root Vitest include list explicitly includes `tests/**/*.test.ts` so these
tests execute against the TypeScript source APIs in a clean checkout. They are
offline and require only checked-in fixtures and local workspace packages.
