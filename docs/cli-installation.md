# CodeInvaders CLI and installation lifecycle

The CLI is intentionally local-only and fail-open at agent hook boundaries. It
does not upload events, inspect prompts or commands, or control an agent. The
default application-data root is `%LOCALAPPDATA%/CodeInvaders` on Windows and
`$XDG_DATA_HOME/codeinvaders` (or `~/.local/share/codeinvaders`) on macOS and
Linux. Set `CODEINVADERS_DATA_DIR` for an isolated test or recovery root.

## Commands

```text
codeinvaders install [--agent codex|claude|all] [--scope user|project]
codeinvaders start [--port 43177] [--no-browser]
codeinvaders status
codeinvaders doctor
codeinvaders replay --file <canonical-journal.jsonl>
codeinvaders upgrade
codeinvaders uninstall [--delete-data]
```

Every command accepts `--json` and `--non-interactive`. `--yes` confirms a
project-scope installation or data deletion. User scope is the default.

Exit code `0` is success, `2` is usage, `3` means no supported agent was
detected, `4` is an operational failure, `5` is a configuration conflict, `6`
is an unsupported compatibility state, and `7` is a cancelled confirmation.

## Configuration ownership

Codex uses its verified native plugin marketplace flow; the CLI does not invent
unsupported TOML hook keys. Claude configuration is composed in
`.claude/settings.json`. CodeInvaders entries contain the marker
`codeinvaders-owned:v1`, and unrelated hook values remain semantically intact.
The generated command invokes the prebuilt adapter directly and sets
`CODEINVADERS_DATA_DIR` to the selected application-data root. It never uses
`npx` or runtime package resolution. `install --dry-run` makes no writes and
prints only a structural summary (path, format, and entry counts); raw
configuration bodies are intentionally omitted from both human and JSON output.

Writes use a temporary file, a durability barrier, and atomic rename. Existing
files receive a portable `.codeinvaders-recovery.bak` copy before replacement.
The post-write parser validates the result; a failed validation restores the
previous content. Successful transactions remove their recovery copy; failed
transactions retain it for manual recovery. Claude JSON may be normalized to
two-space formatting, so uninstall guarantees semantic preservation of
unrelated values rather than byte-for-byte whitespace preservation. Recovery
copies are local recovery material and must not be committed.

Project scope writes repository-visible files and therefore requires explicit
`--yes` in noninteractive use. If no Codex or Claude surface is detected, the
CLI reports manual installation guidance and does not create hook files.

## Runtime and privacy

`start` records only a PID, loopback port, and start timestamp in
`runtime.json`. The browser secret is generated per process and passed through
the child environment; it is never persisted in configuration or a URL query.
The runtime must bind to `127.0.0.1` or `::1`.

`doctor` checks selected hooks, generated direct entries, private storage,
loopback policy, the local IPC path, browser assets, adapter surfaces, and a
synthetic `session.started` event round trip. Its output contains paths and
bounded status only; it never prints secrets or native payloads.

`replay` reads canonical journal records only. It does not invoke Codex,
Claude, a shell command, or a native transcript. `uninstall` removes only
recognized CodeInvaders entries and generated direct entries. Recordings remain
unless `--delete-data` is separately confirmed.

## Surface limitations

Codex plugin discovery varies by host surface, so the CLI always exposes a
manual direct hook fallback and does not claim plugin installation when it
cannot verify plugin support. Claude task-plan and manual permission-denial
coverage depends on signals emitted by the installed Claude Code version.
These limitations are reported by `status`, `install`, and `doctor`.
