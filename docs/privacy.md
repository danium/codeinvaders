# Privacy

CodeInvaders records allowlisted lifecycle metadata locally. Default recordings
must not contain prompts, assistant messages, hidden reasoning, source code,
patches, commands, arguments, tool output, absolute paths, URLs, queries,
credentials, environment variables, transcripts, repository remotes, or user
names.

Adapters create new canonical objects from closed fields. They do not copy a
native object and attempt best-effort redaction. Workspace, repository,
session, turn, agent, task, operation, and permission identities are keyed,
installation-local opaque values. Unknown tool names and optional labels stay
generic by default.

No analytics, cloud collector, event-log upload, remote font, CDN asset, or
runtime network dependency is enabled. The local browser sees only canonical
state through an authenticated loopback service. Diagnostics contain bounded
codes, counts, and durations rather than native text.

Fixtures and release evidence use synthetic labels and canaries. The release
gate scans spool, journals, manifests, snapshots, diagnostics, browser-visible
details, screenshots, and traces. Raw profiles are treated as potentially
sensitive and are not release assets.

Users should still treat the data root as private. A malicious process running
as the same operating-system user may be able to access local files; disk
encryption and operating-system account security remain outside the product.
