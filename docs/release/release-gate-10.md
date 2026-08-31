# Release-gate report: conformance, security, and release hardening

Status: **evidence collected; not a release sign-off**.

This report records current local evidence for gate 10. It does not claim
stable readiness. Commands use synthetic or sanitized data and do not replace
real versioned-agent sessions, clean-machine testing, or manual accessibility
review.

## Automated evidence

| Gate                            | Current evidence                                                                                                                                                                                                                                                                 | Command or record                                                         | Status                          |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------- |
| 10.4 accessibility and fallback | Runtime security tests cover skip navigation, focus, contrast, reduced motion, and DOM fallback. Browser verification covered keyboard order, high contrast, responsive layout, and an explicit text-only renderer-disposal fallback. Manual screen-reader testing remains open. | `pnpm test`; [browser verification](browser-verification.md)              | Partial                         |
| 10.5 hook/replay budgets        | The Windows reference run passed both direct-hook modes, adapter ingress, bounded journal/replay overload, spool quota, 100 entities, and 300-effect coalescing. Browser FPS/heap/resource and long-soak profiles remain open.                                                   | [performance profile](performance-profile.md)                             | Partial                         |
| 10.6 runtime security           | Automated tests exercise origin/authentication, fragments, parser limits, loopback binding, traversal, symlink escape, and owned-file deletion; the documented threat/security review and production audit are current.                                                          | `pnpm test`; `pnpm offline:audit`                                         | Pass                            |
| 10.7 offline operation          | Source and generated production output are scanned for remote URLs, unreviewed network APIs, and analytics identifiers; the current scan is clean. The browser run observed no remote-origin requests.                                                                           | `pnpm offline:audit`; [browser verification](browser-verification.md)     | Pass for inspected build        |
| 10.8 conformance/release gate   | This report links current protocol, adapter, reducer, replay, privacy, browser, lifecycle, and performance evidence. Candidate sign-off still depends on the explicitly open manual and real-session rows.                                                                       | `pnpm check`; [CLI lifecycle verification](cli-lifecycle-verification.md) | Report current; release pending |

## Browser evidence

[Browser verification](browser-verification.md) records a real Edge/Playwright
run against the rebuilt local runtime and the sanitized screenshot in
`docs/assets/codeinvaders-v0.1.0.png`. It observed authenticated live rendering,
replay seek/live-edge return, keyboard traversal, contrast and in-app reduced
motion controls, responsive layout, WebGL rendering, no page errors, and no
remote-origin requests. It did not include axe/Lighthouse, a screen reader,
OS-level reduced-motion media preferences, forced WebGL failure, or every
terminal outcome.

## Installation lifecycle evidence

[CLI lifecycle verification](cli-lifecycle-verification.md) records the native
Codex plugin probe and a real Claude install, loopback runtime start, status,
doctor, and ownership-aware uninstall. Raw configuration bodies were never
printed. The reference Claude file retained all unrelated JSON values and had
zero owned entries after uninstall; JSON whitespace is not a byte-preservation
contract.

## Remaining release blockers

- Real-session conformance for a supported Codex version and Claude Code
  version remains outstanding; fixture coverage is not host compatibility proof.
- Manual screen-reader, contrast, reduced-motion, WebGL-fallback, and
  supported-platform checks remain outstanding.
- Browser frame pacing, heap/resource retention, and repeated-session soak
  measurements must be recorded against published budgets.
- Clean-clone install/build/run/record/replay/uninstall verification remains
  required before any prerelease claim.
- GitHub publication, protected release configuration, and vulnerability
  reporting setup require repository-owner actions and are not performed here.

Until these items are closed with evidence, CodeInvaders remains an active
`0.1.0` implementation foundation and must not be described as stable `v1.0.0`.
