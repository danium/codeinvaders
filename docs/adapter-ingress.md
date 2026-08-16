# Adapter ingress boundary

Adapter hooks must call `sanitizeIngressRecord` before handing a record to any
IPC client or spool writer. The function returns no record or transport
representation when input validation fails. An accepted result contains a
deeply immutable canonical record, immutable canonical JSON text, and its
validated UTF-8 byte length. It deliberately does not expose a `Uint8Array`:
nonempty JavaScript typed arrays remain mutable even when their containing
objects are frozen.

Use the accepted result's `handoff(writer)` contract to pass the exact
canonical JSON text to a transport writer. A valid writer is called exactly
once per non-reentrant handoff and receives that exact text; it must encode and
write the supplied value rather than reconstructing the event. The handoff
returns the closed result `{ status: 'written' }`, or
`{ status: 'rejected', code: 'writer-invalid' | 'writer-failed' | 'writer-reentrant' }`.
It never exposes native writer errors. The text is immutable, so this preserves
the validated canonical content without a validation-to-write gap. The
representation is bounded by `MAX_INGRESS_RECORD_BYTES` (`32768` bytes) and
the protocol JSON depth limit.

The protocol captures its canonical JSON, object-key, UTF-8, typed-array, and
invocation intrinsics during module evaluation. Its UTF-8 encoder is accepted
only after exact ASCII and multibyte vectors pass, so a structurally plausible
encoder fails closed instead of undercounting bytes. The adapter SDK likewise
captures behaviorally verified binary intrinsics and the installation-local Web
Crypto object with its key-import/sign targets before exposing the deriver.
Later mutation of those global objects or methods cannot substitute accepted
canonical text or opaque IDs; unavailable or uncaptured dependencies fail
closed with bounded diagnostics. Degraded diagnostics and rejection results are
fresh isolated values on every call.

Ingress is allowlist-based. Durable event, source, scope, link, correction,
plan, assignee, parallel-group, and capability/configuration identities must
already be `oid1_...` opaque IDs; invalid identity fields reject the event.
`adapterId` and `agentKind` are separate closed metadata sets, while adapter
and agent versions must be bounded numeric SemVer strings (without prerelease
or build payloads). The envelope version is the closed protocol version. It copies protocol envelope
metadata, safe categories, statuses, durations, capabilities, and closed enum
values. Optional labels, descriptions, objective text, native tokens,
native events, and unknown fields are omitted. Native prompts, messages,
source, commands, arguments, outputs, paths, URLs, credentials, environment
values, transcripts, remotes, and user names must never be supplied to a
transport writer.

Retries must reuse one logical event identifier. Derive it once with
`deriveStableRetryEventId` from a bounded logical key that includes the event
kind and the native checkpoint identity. The key is used only as input to the
installation-local keyed deriver; the returned opaque identifier is the only
value placed in `eventId`. A retry must not generate a fresh random ID.

Task 3.4 stops at this validated handoff. IPC delivery and atomic spool
behavior are implemented by the subsequent transport tasks.
