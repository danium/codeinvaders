# Performance profile (sanitized local reference run)

Run date: 2026-08-31. Status: **evidence collected; not a release sign-off**.

The profile used the freshly built workspace artifacts and synthetic, sanitized
events. It contains no host paths, usernames, prompts, commands, source text,
URLs, or credentials.

## Reference environment

| Item            | Value                                                                            |
| --------------- | -------------------------------------------------------------------------------- |
| Platform        | Windows (`win32`), x64                                                           |
| Runtime         | Node.js v24.11.1                                                                 |
| Package manager | pnpm 10.27.0                                                                     |
| Build           | `pnpm build` — passed for protocol, SDK, core, both adapters, local app, and CLI |

The OS edition query was denied by host policy, so no more specific OS claim is
made.

## Measurements

| Profile                                |                                                                                                                                            Measurement |                                         Budget / invariant | Result                   |
| -------------------------------------- | -----------------------------------------------------------------------------------------------------------------------------------------------------: | ---------------------------------------------------------: | ------------------------ |
| Codex hook, spool fallback (20 runs)   |                                                                              p50 130.655 ms; p95 146.119 ms; max 146.832 ms; 20 records / 14,020 bytes |                p95 ≤ 250 ms; spool ≤ 4 MiB / 4,096 records | Pass                     |
| Codex hook, IPC (20 runs)              |                                                                                     p50 119.596 ms; p95 141.287 ms; max 149.159 ms; 20 journal records |                             p95 ≤ 250 ms; no spool records | Pass                     |
| Claude hook, spool fallback (20 runs)  |                                                                              p50 116.287 ms; p95 134.705 ms; max 173.885 ms; 20 records / 14,140 bytes |                p95 ≤ 250 ms; spool ≤ 4 MiB / 4,096 records | Pass                     |
| Claude hook, IPC (20 runs)             |                                                                                     p50 129.578 ms; p95 148.672 ms; max 150.402 ms; 20 journal records |                             p95 ≤ 250 ms; no spool records | Pass                     |
| Adapter ingress (100 runs)             |                                                                   direct 1.570 ms mean; IPC 0.565 ms; broker absence 0.127 ms; spool fallback 3.306 ms |                                mean < 250 ms for each mode | Pass                     |
| Journal/replay overload (200 events)   | 200 accepted; 4 segments; 139,439 journal bytes; append p50 7.362 ms, p95 10.063 ms, max 19.216 ms; projection 3.804 ms; seek 0.528 ms to sequence 100 |                    no semantic drops; bounded replay/spool | Pass                     |
| Spool quota/backpressure (20 attempts) |                                                                                                         16 accepted, 4 full; 16 records / 10,304 bytes |       record limit 16; byte limit 4 MiB; overflow reported | Pass                     |
| Overload memory                        |                                                                                                   heap delta 0 MiB (GC unavailable); 200 replay frames |         configured ≤ 256 MiB; all accepted events replayed | Pass                     |
| Arena supported fixture                |  100 semantic entities; 300 requested effects; 100 retained after deterministic coalescing; 13 ms total; 12 ms event-to-presentation; 0 semantic drops |           entities = 100; effects ≤ 300; no semantic drops | Pass                     |
| Sustained cosmetic storm               |                                                                                                      10,000 cosmetic intents plus 100 semantic intents | ≤ 300 retained intents; all 100 semantic entities retained | Pass (automated fixture) |

Commands:

```text
pnpm build
node scripts/benchmark-hook-lifecycle.mjs --iterations=20 --budget-ms=250
node scripts/benchmark-adapter-ingress.mjs
node scripts/profile-overload.mjs --events=200 --max-heap-delta-mb=256 --spool-attempts=20 --spool-record-limit=16
node --input-type=module -e "import {runArenaLoadProfile} from './apps/local/dist/performance.js'; console.log(JSON.stringify(runArenaLoadProfile(100,300)))"
pnpm test -- tests/performance tests/security tests/conformance apps/local/src/local.test.ts
```

The focused suite passed: **9 test files, 63 tests**. The production source
security audit also passed with zero findings.

## Unmeasured or manual-only gates

Browser FPS/frame pacing, JavaScript heap and retained DOM/Three.js resources,
main-thread long tasks, CPU activity, repeated-session-switch soak behavior,
screen-reader and keyboard/manual accessibility, forced WebGL fallback, and
clean-machine platform lifecycle remain open. They require browser tooling,
manual review, or reference hardware and are not inferred from this local
headless run.

An oversized `profile-overload` run with 1,500 events and 4,100 spool attempts
was stopped after exceeding one minute without output; it is not reported as a
pass. The bounded 200/20 acceptance profile above completed successfully.
