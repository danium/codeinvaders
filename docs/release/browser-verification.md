# Local runtime browser verification

This is a real-browser smoke record for the sanitized visual fixtures. It is
evidence for the behaviors exercised here, not a screen-reader or release
sign-off record.

## Environment

- Runtime: rebuilt `apps/local/dist/runtime.js`, bound to `127.0.0.1:43180` with an
  isolated `CODEINVADERS_DATA_DIR`.
- Browser: Microsoft Edge `152.0.4191.53` (headless Chromium).
- Automation: Playwright `1.57.0`, loaded from the installed Codex CUA Node
  runtime; no repository dependency or lockfile change was made.
- Input: seven sanitized protocol fixtures delivered through the local runtime
  IPC path (session start, child agent, task creation, tool completion,
  permission request, signal gap, and task failure). Every frame received an
  `ACK`.

## Observed behavior

- Fragment exchange succeeded with HTTP 200, the URL fragment was removed
  with `history.replaceState`, and a second exchange of the same secret
  returned HTTP 401 `invalid-session`.
- Authenticated live state rendered `Telemetry: degraded`, `Live`, four
  entities, sequence 7, and semantic rows for Carrier, Child ship, Task,
  Permission, and Signal gap. The activity feed rendered all seven sanitized
  events and the task failure outcome.
- WebGL initialized in the browser: a 732×329 canvas was present in the arena,
  the visible fallback message was absent, and no page errors were logged.
- Replay seek to sequence 0 changed the semantic mode to `Replay` and showed
  `Sequence 0 of 7`; Play advanced to sequence 1 and Return to live restored
  the live edge (`100`).
- Keyboard tabbing reached skip link, repository/session selectors, refresh,
  settings, arena, play, and speed controls in order. High contrast toggled
  the document class, and the in-app reduced-motion setting was enabled.
- At a 390px viewport the layout collapsed to one grid column without
  horizontal overflow (`scrollWidth === clientWidth === 375`).
- No page exceptions or console errors were observed. No remote-origin requests
  were observed. CSP and loopback-only runtime behavior remained in force.
- The screenshot at
  [`docs/assets/codeinvaders-v0.1.0.png`](../assets/codeinvaders-v0.1.0.png)
  is a real sanitized browser capture. A binary/text scan of the screenshot,
  its adjacent assets, and the isolated runtime artifacts found no `CANARY`,
  direct-hook canary, or browser secret markers.

## Accessibility audit status and remaining gates

No axe-core, `@axe-core/playwright`, Lighthouse, or equivalent automated audit
package was installed in the repository or the available browser runtime, so
no automated violation count is claimed. Keyboard and DOM-semantic checks are
not a substitute for manual screen-reader testing. The application-level
reduced-motion control was exercised, but an OS-level reduced-motion
media-preference run was not performed.

## Final semantic and fallback pass (2026-08-31)

The current production source was rebuilt and run again in an isolated data
root. Twenty-eight validated protocol events were delivered through CIIP; each
received `ACK`. The real browser showed nine semantic entities and explicit DOM
rows for the finished carrier, child agent, completed/failed/cancelled/abandoned
tasks, activity-only fallback objective, denied permission, partial capability,
and signal gap. The activity feed also exposed assignment, provisional
completion, tool success/denial/cancellation, quiescence/resume, and session-end
evidence. This pass corrected a test-only capability-shape assumption before
the final result; the verified fixture uses the protocol's real revisioned
`capabilities.signals` structure.

The Text-only mode setting was enabled in the real browser. It disposed the
visual renderer, hid the canvas, displayed the explicit fallback message, and
retained the same nine-entity count and all semantic inspector rows. Disabling
it restored the visual arena. Replay play advanced to sequence 2 of 28 and
Return to live restored both Live mode and the live-edge label. The final
browser console had no errors or warnings.

The in-app evaluation surface did not expose browser performance/heap entries,
so this pass does not claim FPS, JavaScript-heap, or long-soak measurements.
Those profiles and a manual screen-reader walkthrough remain release gates.

## Bounded semantic/live-replay/text-only soak (2026-08-31)

Ten bounded cycles alternated live rendering, replay, and text-only mode in the
same isolated browser session. At the visual/live checkpoints before and after
the cycles there were 184 DOM nodes, one 732×329 canvas, and nine semantic
entities; the session remained `Live` at the live edge. Text-only mode hid the
canvas while retaining the semantic state. All recorded deltas were zero.
Journey timing was p50 685 ms, p95 695 ms, and max 770 ms.

This bounded semantic soak does not claim FPS, heap, CPU, or main-thread
long-task results, and does not close the separate performance or full soak
release tasks.
