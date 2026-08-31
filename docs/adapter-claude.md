# Claude Code adapter (pinned contract)

The Claude adapter is observational and fail-open. It records only bounded,
canonical categories, lifecycle status, duration, opaque correlation inputs,
and capability coverage. Prompts, commands, arguments, outputs, paths, URLs,
native errors, and transcript content are never returned or persisted.

The fixture contract is version-pinned to adapter `0.1.0` (the recorded native
fixture is Claude Code `2.1.227`). `fixtures/claude/sanitized-hooks.json`
covers session start/end, prompt, all three tool hooks, permission request and
denial, task, foreground/background subagents, stop, and stop-failure.

`normalizeClaudeLifecycle` accepts only the exact hook names in `CLAUDE_HOOKS`.
`PreToolUse`, `PermissionRequest`, and `TaskCreated` are provisional; successful
`PostToolUse` and supported successful Task-tool evidence are confirmed; `Stop`
and `SubagentStop` are quiescent checkpoints; `StopFailure` and real
`PostToolUseFailure` are failures. Validation failures and permission denials
are explicitly excluded from execution-failure classification.

Task hooks alone request/observe work but do not confirm a committed task.
Confirmation requires successful `Task` tool evidence. Sessions with no Task
hooks advertise unsupported task lifecycle and must render the fallback
objective. Permission coverage is partial: manual denials, deny rules, and
unrelated hook blocks are not claimed. Parallel or missing native identifiers
remain unlinked rather than guessed.

`claudeHook`, `directHook`, `pluginDefinition`, and `manualHookDefinition` are
transparent, observational entrypoints. They always return the empty native
response (`control`, `decision`, and `context` are `none`) and fail open. No
prompt, command, argument, output, path, URL, error text, username, or raw
identifier is returned or persisted; callers must derive opaque IDs before
building protocol records.
