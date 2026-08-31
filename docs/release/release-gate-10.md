# Release-gate report: conformance, security, and release hardening

Status: **evidence collected; not a release sign-off**.

This report records current local evidence for gate 10. It does not claim
stable readiness. Commands use synthetic or sanitized data and do not replace
real versioned-agent sessions, clean-machine testing, or manual accessibility
review.

## Automated evidence

| Gate                            | Current evidence                                                                                                                                                                                                                                                                                  | Command or record                                                         | Status                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------- |
| 10.2 real-session conformance   | Authenticated Codex CLI 0.147.0 and Claude Code 2.1.227 sessions each produced a correlated, protocol-valid session/turn lifecycle through the installed hook path. Both bounded no-tools profiles document their unexercised signal exclusions; the broader matrices remain tasks 13.3 and 13.4. | [CLI lifecycle verification](cli-lifecycle-verification.md)               | Pass                            |
| 10.4 accessibility and fallback | Runtime security tests cover skip navigation, focus, contrast, reduced motion, and DOM fallback. Browser verification covered keyboard order, high contrast, responsive layout, and an explicit text-only renderer-disposal fallback. Manual screen-reader testing remains open.                  | `pnpm test`; [browser verification](browser-verification.md)              | Partial                         |
| 10.5 hook/replay budgets        | The Windows reference run passed both direct-hook modes, adapter ingress, bounded journal/replay overload, spool quota, 100 entities, and 300-effect coalescing. Browser FPS/heap/resource and long-soak profiles remain open.                                                                    | [performance profile](performance-profile.md)                             | Partial                         |
| 10.6 runtime security           | Automated tests exercise origin/authentication, fragments, parser limits, loopback binding, traversal, symlink escape, and owned-file deletion; the documented threat/security review and production audit are current.                                                                           | `pnpm test`; `pnpm offline:audit`                                         | Pass                            |
| 10.7 offline operation          | Source and generated production output are scanned for remote URLs, unreviewed network APIs, and analytics identifiers; the current scan is clean. The browser run observed no remote-origin requests.                                                                                            | `pnpm offline:audit`; [browser verification](browser-verification.md)     | Pass for inspected build        |
| 10.8 conformance/release gate   | This report links current protocol, adapter, reducer, replay, privacy, browser, lifecycle, and performance evidence. Candidate sign-off still depends on the explicitly open manual and real-session rows.                                                                                        | `pnpm check`; [CLI lifecycle verification](cli-lifecycle-verification.md) | Report current; release pending |

## Browser evidence

[Browser verification](browser-verification.md) records a real Edge/Playwright
run against the rebuilt local runtime and the sanitized screenshot in
`docs/assets/codeinvaders-v0.1.0.png`. It observed authenticated live rendering,
replay seek/live-edge return, keyboard traversal, contrast and in-app reduced
motion controls, responsive layout, WebGL rendering, no page errors, and no
remote-origin requests. A bounded ten-cycle semantic/live-replay/text-only soak
held 184 DOM nodes, one 732×329 canvas, and nine entities before and after with
zero deltas; journey timing was p50 685 ms, p95 695 ms, max 770 ms. It did not
include axe/Lighthouse, a screen reader,
OS-level reduced-motion media preferences, forced WebGL failure, or every
terminal outcome.

## Installation lifecycle evidence

[CLI lifecycle verification](cli-lifecycle-verification.md) records the native
Codex plugin probe, authenticated real Codex and Claude session/turn profiles,
loopback runtime start, spool recovery, doctor, and ownership-aware uninstall.
The complete clean/preconfigured gate passed on Windows, macOS, and Ubuntu for
commit `62da24a`. Raw configuration bodies were never printed. The reference
Claude file retained all unrelated JSON values and had zero owned entries after
uninstall; JSON whitespace is not a byte-preservation contract.

The exact tracked-source clean-clone verifier passed all 16 required steps for
`62da24a`, including install, build, repository checks, production/release
artifacts, runtime start, doctor, replay, uninstall, and recording preservation.

## Remaining release blockers

- The broader final-product Codex and Claude signal matrices remain open: the
  bounded real sessions close the supported-version session/turn baseline but
  do not exercise every tool, permission, plan/task, subagent, parallel, and
  failure scenario required by tasks 13.3 and 13.4.
- Manual screen-reader, contrast, reduced-motion, and WebGL-fallback checks
  remain outstanding.
- Browser frame pacing, heap/resource retention, and repeated-session soak
  measurements must be recorded against published budgets.
- Public GitHub repository, private vulnerability reporting, protected `main`,
  required matrix checks, and the protected `refs/tags/v*` ruleset are verified
  in [branch protection](branch-protection.md); stable publication remains a
  later release task.

Until these items are closed with evidence, CodeInvaders remains an active
`0.1.0` implementation foundation and must not be described as stable `v1.0.0`.
