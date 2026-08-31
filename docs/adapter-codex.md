# Codex adapter

The Codex adapter is an observational, fail-open boundary. `normalizeCodexLifecycle` accepts the pinned fixture schema and constructs allowlisted AAP payloads. Unknown kinds and malformed native objects produce bounded diagnostics; native text, prompts, commands, arguments, output, paths, URLs, errors, and raw identifiers are never copied.

`fixtures/codex/lifecycle.json` (pinned to observed Codex `0.147.0`) covers session start/end, prompt, pre/post tool success and nonzero failure, permission request/resolution, subagent start/checkpoint, stop/quiescence, and compaction. The packaged plugin registers only the currently supported hook names: `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `SubagentStart`, `SubagentStop`, `Stop`, `PreCompact`, and `PostCompact`. `PostToolUseFailure`, `PermissionResolved`, `Compact`, and `TaskPlanUpdated` are not available Codex hook names and are not claimed by the plugin. It does not claim every hosted tool emits equivalent hooks.

`detectCodexCapabilities(observedHooks)` reports only active-session evidence and keeps hosted-tool, manual-denial, missing-correlation, and session-configuration gaps explicit. Prompt/pre-tool observations are requested; tool-start and subagent activity are active; stop/checkpoint observations are quiescent; only observed terminal events are confirmed. A stop checkpoint never manufactures success. Pre-tool operations are provisional, post-tool success confirms, and nonzero results classify conservatively as failure.

Permission requests are independently identified; absent an already-opaque operation identity, no operation link is emitted. Plan revisions use stable native identity or exact ordinal continuity only, and removals produce cancellation. Fuzzy similarity never transfers terminal state.

The direct entry is `dist/hook.js` (`codeinvaders-codex-hook`). Plugin/manual definitions call the same observer. Native hook responses are exactly `{}` with no `control`, `decision`, or `context` fields, and never rewrite or block agent behavior.

Codex CLI `0.147.0` on Windows wraps command hooks in an outer `cmd.exe /C` quote pair. The packaged plugin therefore uses a quote-free command that delegates to `scripts/codeinvaders-codex-hook.cmd`; quoted paths stay inside that wrapper. Until the [upstream quoting defect](https://github.com/openai/codex/issues/38168) is fixed, the installed plugin path must not contain spaces. Hook failure remains fail-open.

Tool, permission, turn, task, and subagent signals are provisional unless the host supplies an explicit completion checkpoint. Missing native identifiers are not guessed; parallel or repeated stop/restart observations remain independently observed. Commands, arguments, output, prompts, paths, URLs, and native errors are not copied.
