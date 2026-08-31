# CLI lifecycle verification (sanitized local reference run)

Run date: 2026-08-31. Status: **supported-platform lifecycle pass for commit
`62da24a`; real Codex and Claude session/turn lifecycle passes on the subsequent
release-fix working tree**.

This record contains only versions, bounded counts, paths with placeholders,
and pass/fail results. No configuration body, prompt, command, transcript,
browser secret, or credential was printed or retained in this document.

## Environment

| Item        | Value                                              |
| ----------- | -------------------------------------------------- |
| Platform    | Windows (`win32`), x64                             |
| Node.js     | v24.11.1                                           |
| Codex CLI   | 0.147.0                                            |
| Claude Code | 2.1.227                                            |
| Candidate   | CodeInvaders 0.1.0 working tree based on `62da24a` |

## Codex native plugin

- The CLI probed `codex plugin --help` instead of inferring support from an
  executable name.
- The local marketplace and exact selector
  `codeinvaders@codeinvaders-local` were verified from Codex's human-readable
  list output.
- A Codex-only install against an isolated CodeInvaders data root returned
  success without creating a duplicate plugin entry.
- `doctor --agent codex` returned success and verified the exact selector.

## Real Codex session conformance

Codex CLI `0.147.0` loaded the installed `codeinvaders@codeinvaders-local`
plugin from an isolated `CODEX_HOME`, presented the native 11-hook review, and
continued only after the hooks were trusted through the normal TUI flow. A
network-blocked TUI probe proved `SessionStart`, `UserPromptSubmit`, and
`SessionEnd` execution without spending a model call. One final authenticated
GPT-5.6 Luna invocation then returned exactly `OK`, used no tools, and reported
14,863 input tokens and 5 output tokens.

The installed Windows hook produced one correlated, protocol-valid lifecycle:
`session.started`, `turn.started`, `turn.quiescent`, and `session.ended`. The
turn records shared one opaque turn identity and quiescence retained its
required non-terminal semantics. Eight records from the bounded native probes
were recovered after the production runtime restarted; the spool drained to
zero and the follow-up Codex doctor passed all nine checks, including the exact
plugin selector, IPC, browser authentication boundaries, immutable assets, and
the synthetic round trip. A bounded scan of the isolated product data found
zero raw prompt, native session ID, workspace path, or smoke-test markers.

Codex `0.147.0` has a Windows outer-quote defect for command hooks. The
candidate works around it with a quote-free `commandWindows` entry and a small
batch wrapper; the installed plugin path used for this run contained no spaces.
Optional app, remote-plugin, recommended-plugin, skill-search, multi-agent,
browser-use, computer-use, and in-app-browser surfaces were disabled. Codex
still emitted its generic shortened-skill-description notice; there is no
supported switch that removes mandatory system skills while retaining plugin
loading.

This bounded no-tools session directly observed session and turn coverage. It
did not exercise tools, permissions, plans, parallel calls, subagents, or
failure evidence, so the broader Codex matrix remains an explicit final-product
verification gate.

## Claude hook lifecycle

The run used the real user-scope Claude settings location and an isolated
CodeInvaders data root. The command sequence was:

```text
codeinvaders install --agent claude --dry-run --non-interactive
codeinvaders install --agent claude --yes --non-interactive
codeinvaders start --agent claude --no-browser
codeinvaders status --agent claude
codeinvaders doctor --agent claude --non-interactive
codeinvaders uninstall --agent claude --yes --non-interactive
```

Observed results:

- Dry-run output contained only a structural summary; raw `before` and `after`
  configuration text was absent in both human and JSON rendering tests.
- Install added 14 ownership-marked Claude lifecycle hooks.
- The production runtime started on loopback, status reported the expected PID
  and port, and unauthenticated browser state returned HTTP 401.
- Doctor passed configuration ownership, direct-entry presence, private
  storage, loopback policy, IPC, immutable browser assets, authentication, and
  a privacy-safe synthetic event round trip.
- Uninstall removed all 14 owned hooks and preserved recordings.
- A structure-only comparison proved all unrelated JSON values were preserved;
  the resulting configuration contained zero CodeInvaders ownership markers.

Claude JSON is normalized during composition, so byte-for-byte whitespace is
not claimed. The candidate now removes its transaction recovery copy after a
successful uninstall and retains it only when rollback may be needed; automated
coverage verifies both ownership preservation and successful-backup cleanup.

## Real Claude session conformance

Claude Code `2.1.227` completed one authenticated, no-tools, single-turn session
in plan mode with session persistence disabled. The final verification command
was capped at USD 0.10 and reported USD 0.0194995. The event stream observed
`SessionStart`, `UserPromptSubmit`, and `Stop`; it contained one assistant
message, one rate-limit status event, seven system events, and one successful
result with no unparsable output.

The installed Windows hook produced one correlated, protocol-valid lifecycle:
`session.started`, `turn.started`, `turn.quiescent`, and `session.ended`. The
turn records shared one opaque turn identity, quiescence carried its required
non-terminal semantic metadata, and all four records recovered durably from
the bounded local spool after runtime restart. The follow-up doctor passed all
ten checks. A bounded scan of the isolated configuration and data roots checked
39 files and found zero prompt, credential, authorization, token, or account
markers. Hook state retained no entries after `SessionEnd`.

This bounded no-tools session directly observed session and turn coverage. It
did not exercise tools, permissions, tasks, plans, or subagents, so those
capabilities remain explicit exclusions for the real-session evidence. The
run exposed and fixed four release-path defects: Claude's POSIX hook shell on
Windows, missing native turn IDs, required turn/task semantics, and cross-session
retry-identity collisions. The existing hook-bundle verifier now checks two
sessions, correlated turns, canonical plan/permission values, terminal task
semantics, privacy-safe opaque identities, protocol acceptance, and fail-closed
handling of a tool hook without an operation ID.

## Supported-platform result

The repository gate runs `pnpm release:lifecycle:test` after the build. That
bounded harness executes the complete Claude lifecycle in two isolated
scenarios on the host runner: clean and preconfigured. Each scenario covers
install, start/status, doctor (including its synthetic recording round trip),
canonical replay, successful upgrade, and ownership-aware uninstall. The
preconfigured scenario asserts the unrelated `keep-me` hook survives. The CI
workflow run [33374632284](https://github.com/danium/codeinvaders/actions/runs/33374632284)
passed the complete gate on Windows, macOS, and Ubuntu for exact commit
`62da24a`, closing OpenSpec task 9.10.

The tracked-source clean-clone verifier also passed all 16 required steps for
`62da24a`, including frozen install, repository check, production/release
builds, isolated hook execution, install/start/status/doctor/replay/uninstall,
and recording preservation. Broader Codex and Claude signal exercise, manual
accessibility, browser performance/soak profiling, and exact-candidate
publication remain separate release gates.
