# CLI lifecycle verification (sanitized local reference run)

Run date: 2026-08-31. Status: **local lifecycle pass; not a supported-platform or real-session sign-off**.

This record contains only versions, bounded counts, paths with placeholders,
and pass/fail results. No configuration body, prompt, command, transcript,
browser secret, or credential was printed or retained in this document.

## Environment

| Item        | Value                        |
| ----------- | ---------------------------- |
| Platform    | Windows (`win32`), x64       |
| Node.js     | v24.11.1                     |
| Codex CLI   | 0.147.0                      |
| Claude Code | 2.1.227                      |
| Candidate   | CodeInvaders 0.1.0 workspace |

## Codex native plugin

- The CLI probed `codex plugin --help` instead of inferring support from an
  executable name.
- The local marketplace and exact selector
  `codeinvaders@codeinvaders-local` were verified from Codex's human-readable
  list output.
- A Codex-only install against an isolated CodeInvaders data root returned
  success without creating a duplicate plugin entry.
- `doctor --agent codex` returned success and verified the exact selector.

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

## Remaining scope

The repository gate now runs `pnpm release:lifecycle:test` after the build. That
bounded harness executes the complete Claude lifecycle in two isolated
scenarios on the host runner: clean and preconfigured. Each scenario covers
install, start/status, doctor (including its synthetic recording round trip),
canonical replay, successful upgrade, and ownership-aware uninstall. The
preconfigured scenario asserts the unrelated `keep-me` hook survives. The CI
workflow runs the gate on Windows, macOS, and Ubuntu; the resulting matrix
check results will be the supported-platform evidence for OpenSpec task 9.10
once the hosted matrix has passed.

This evidence closes the local implementation lifecycle only. Clean-clone
verification, the Windows/macOS/Linux CI matrix, real Codex and Claude session
conformance, manual accessibility, browser performance/soak profiling, and
exact-candidate publication remain separate release gates.
