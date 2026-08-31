# Local runtime

The local app is a loopback-only browser service. Hooks deliver sanitized canonical events over a separate local IPC endpoint; the browser port is never used for hook ingress.

## Trust boundary

`LocalBroker` refuses non-loopback hosts. Each process generates a one-use launch secret. The start URL carries that secret only in a fragment. The page exchanges it for an in-memory bearer session, and the launch secret is invalidated immediately. Session tokens expire, rotate on restart, and are accepted only with the exact runtime origin. WebSocket clients use the authenticated token as a subprotocol rather than a query parameter.

The service validates JSON depth, object keys, array length, body bytes, and request rate. Accepted semantic events are journaled before being broadcast. A bounded client queue may shed cosmetic delivery under load; canonical events remain in the journal.

## Storage lifecycle

Data defaults to the platform application-data directory (`%LOCALAPPDATA%/CodeInvaders` on Windows and `$XDG_DATA_HOME/codeinvaders` elsewhere). Journals, spool files, snapshots, runtime metadata (`runtime.json`), diagnostics, and the installation-local salt are separate owned paths. Runtime metadata writes are temporary-file plus rename operations, publish a fresh start identity, and contain no launch secret. Retention and delete-all resolve and verify owned paths and refuse symlink escapes. Delete-all requires explicit confirmation and does not remove installation configuration.

No network, analytics, remote fonts, remote assets, dynamic evaluation, audio, prompts, commands, paths, or raw adapter payloads are required for operation.

## Browser policy

Immutable local assets are served with a restrictive CSP (`default-src 'self'`, no object sources, no frames, no remote connections, and no `unsafe-eval`). The semantic activity feed and inspector are authoritative accessible equivalents when WebGL is unavailable. Keyboard focus is visible, statuses do not depend on color, and reduced motion removes travel and impact effects while preserving outcome text.
