# Codex adapter

The Codex adapter is an observational, fail-open boundary. `normalizeCodexLifecycle` accepts the pinned fixture schema and constructs allowlisted AAP payloads. Unknown kinds and malformed native objects produce bounded diagnostics; native text, prompts, commands, arguments, output, paths, URLs, errors, and raw identifiers are never copied.

`fixtures/codex/lifecycle.json` (pinned to observed Codex `0.147.0`) covers session start/end, prompt, pre/post tool success and nonzero failure, permission request/resolution, subagent start/checkpoint, stop/quiescence, and compaction. It does not claim every hosted tool emits equivalent hooks.

`detectCodexCapabilities(observedHooks)` reports only active-session evidence and keeps hosted-tool, manual-denial, missing-correlation, and session-configuration gaps explicit. Prompt/pre-tool observations are requested; tool-start and subagent activity are active; stop/checkpoint observations are quiescent; only observed terminal events are confirmed. A stop checkpoint never manufactures success. Pre-tool operations are provisional, post-tool success confirms, and nonzero results classify conservatively as failure.

Permission requests are independently identified; absent an already-opaque operation identity, no operation link is emitted. Plan revisions use stable native identity or exact ordinal continuity only, and removals produce cancellation. Fuzzy similarity never transfers terminal state.

The direct entry is `dist/hook.js` (`codeinvaders-codex-hook`). Plugin/manual definitions call the same observer. Native hook responses are exactly `{}` with no `control`, `decision`, or `context` fields, and never rewrite or block agent behavior.

Tool, permission, turn, task, and subagent signals are provisional unless the host supplies an explicit completion checkpoint. Missing native identifiers are not guessed; parallel or repeated stop/restart observations remain independently observed. Commands, arguments, output, prompts, paths, URLs, and native errors are not copied.
