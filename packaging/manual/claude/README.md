# CodeInvaders Claude Code hook

This directory is the complete manual-install payload for Claude Code. Copy
the `scripts` directory and `hooks.json` into the private hook installation
directory selected by the host, then register the definitions in
`hooks.json`. The command is deliberately explicit: `node
./scripts/codeinvaders-claude-hook.mjs`.

The packaged script is generated from the checked-in Claude adapter entrypoint
with `node scripts/release/build-hook-bundles.mjs`. It is self-contained and
requires only Node built-ins at runtime. It reads a bounded JSON envelope from
stdin, always returns Claude's required empty response, and sends only
sanitized canonical events to the local runtime or its bounded local spool.
No network endpoint, analytics, shell command, or workspace dependency is
used. `CODEINVADERS_DATA_DIR` may be set to an installation-local data root;
otherwise the documented platform default is used.
