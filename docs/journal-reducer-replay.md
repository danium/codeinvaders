# Journal, reducer, and replay

Core is split into ingress, journal/recovery, reducer, snapshots, replay, and ownership modules. Ingress constructs an allowlisted canonical AAP event and validates it again before persistence. A journal append is serialized per stream, writes one newline-terminated bounded JSON record, calls the durability barrier, then updates the rebuildable manifest. Duplicate event IDs return the original sequence, including after restart.

Recovery scans the manifest and deterministic segment names, preserves valid records before a bad or partial record, and repairs the manifest from journal truth when it is missing, stale, or corrupt. Invalid and duplicate records are quarantined by omission and never become semantic input. Spool recovery calls the same append boundary, so retirement is safe only after its acknowledgement; malformed pending records remain pending.

The reducer is a pure immutable projection. It keeps sources, sessions, turns, agents, real tasks, operations, permissions, gaps, and bounded diagnostics. Requested/active/quiescent/sealed and provisional/confirmed/unknown are distinct; silence, timeout, and unresolved session closure cannot create success. Terminal task outcomes are monotonic unless an explicit correction event is present. Structural roots and the one fallback objective are reducer-owned and never confused with real tasks.

Snapshots are disposable, versioned, canonically sorted, atomically replaced artifacts containing protocol, reducer, schema, stream, and sequence. Incompatible or corrupt snapshots return a safe failure and callers rebuild from journal history. Replay deduplicates and orders canonical events with observed-time, stream, sequence, and event-ID tie-breaks; it supports session/turn/agent/task/operation filters, semantic idle compression, speed, seek, significant-event indexing, and live-edge callers without consulting native transcripts.

Retention verifies owned paths, deletes files only (never follows symlinks), keeps a complete current segment, repairs the manifest, and is the point at which derived snapshot/index artifacts must be invalidated by the runtime.
