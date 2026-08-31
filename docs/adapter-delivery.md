# Adapter delivery boundary

The adapter SDK accepts native hook input only through `sanitizeIngressRecord`.
Only its immutable canonical JSON may cross IPC or enter the spool. Local
endpoints are installation-scoped Unix sockets or named pipes; TCP endpoints
are not accepted.

IPC uses one length-prefixed UTF-8 frame (`CIIP/1 <bytes>:<body>\n`) and a
closed `ACK` response, with a single 250 ms fail-open deadline. The length is
the UTF-8 byte length of the JSON body, excluding the terminating newline. When IPC is unavailable, `spoolCanonical`
writes a private temporary file and renames it atomically. Recovery reads only
committed, bounded `.ingress` files; incomplete files are ignored. The spool is
bounded to 4096 records and 4 MiB by default and reports `full` explicitly.

## Installed direct-hook contract

The CLI and direct entries use the same application-data contract. Set
`CODEINVADERS_DATA_DIR` to override the root; otherwise the root is
`%LOCALAPPDATA%/CodeInvaders` on Windows and `$XDG_DATA_HOME/codeinvaders` (or
`$HOME/.local/share/codeinvaders`) elsewhere. The installation-local key is
`<root>/local.salt` as a JSON string containing 32-byte base64url data, and the
stable direct-hook epoch is `<root>/hook-epoch`. The
spool is `<root>/spool`, diagnostics are bounded code-only records in
`<root>/diagnostics`, and the IPC endpoint is `<root>/CodeInvaders.sock` on
Unix or the derived `\\.\pipe\CodeInvaders-<root-hash>` named pipe on Windows.
The runtime writes `runtime.json` (the shared SDK `DIRECT_HOOK_RUNTIME_FILE`
contract) with a fresh `startedAt` value at each runtime start; direct hooks use
`runtime:<startedAt>` as their epoch, falling back to the local-runtime
`config.json` compatibility name and then the no-clobber `<root>/hook-epoch`
value before the runtime has started. The event's
`source.streamId` is carried in every `.ingress` record, allowing
the broker to route a record to its per-stream journal; no raw hook input is
stored. Retries reuse event IDs and deterministic timestamps so an identical
record is idempotent. Direct entries always emit the exact native response `{}`.

Unsupported or malformed input creates at most 256 atomic `.diagnostic` records
containing only `{adapterId,code,count}`. This is best-effort and bounded by the
same fail-open deadline; it never contains native fields or text.

The SDK emits the body immediately after the frame colon. A broker parser that
expects a newline between the colon and body is incompatible with `CIIP/1` and
must be corrected or adapted at the broker boundary; hooks fail open and spool
when such an endpoint rejects the frame.

No native text, paths, URLs, credentials, arguments, or outputs are accepted
by the canonical ingress allowlist, and transport failures expose only closed
status values.
