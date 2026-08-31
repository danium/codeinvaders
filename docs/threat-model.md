# Threat model

## Protected assets

CodeInvaders protects the local identity key, browser session tokens,
configuration ownership markers, canonical recordings, and the integrity of
agent configuration. Native prompts, source, commands, output, credentials,
and paths are protected primarily by never accepting them into persistence.

## Trust boundaries

- Native hook input is hostile until bounded, allowlisted, and canonicalized.
- Local IPC is separate from HTTP and accepts only framed canonical records.
- HTTP and WebSocket clients require exact origin and in-memory authentication.
- Journal, manifest, snapshot, and spool files are hostile when read after a
  crash or manual modification.
- Agent configuration may contain unrelated user and third-party entries that
  CodeInvaders does not own.

## Defenses

The runtime binds loopback only, transfers no secret in a query string, rotates
process secrets, uses a restrictive CSP, serves checked-in immutable assets,
and bounds bodies, depth, counts, rates, and client queues. Hooks have a single
monotonic deadline and fail open. Storage uses complete-record writes, private
permissions, atomic rename, canonical validation, deduplication, and verified
owned paths. Installation is transaction-like with dry runs, recovery copies,
post-write validation, rollback, and ownership-aware removal.

## Out of scope

CodeInvaders does not defend against an administrator, a compromised kernel,
or arbitrary code already executing as the same user. It does not provide LAN
or cloud access, multi-user authorization, agent control, content inspection,
or semantic redaction of user-enabled arbitrary labels.
