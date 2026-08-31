# Design decisions

- AAP remains renderer-neutral while CodeInvaders is the product name.
- Evidence fidelity and finality are separate; quiet or timed-out work never
  becomes success.
- Journals are authoritative and append-only; manifests and snapshots are
  disposable.
- Structural root agents and fallback objectives belong to the reducer, not an
  adapter.
- Hook ingress uses local IPC with an atomic sanitized spool fallback.
- The browser service is authenticated loopback HTTP/WebSocket and never the
  hook endpoint.
- Privacy is enforced through construction allowlists and keyed opaque IDs,
  not heuristic redaction.
- Plan reconciliation uses stable identity or conservative exact matching,
  never fuzzy terminal transfer.
- Installation composes owned entries transactionally and uninstall preserves
  unrelated configuration and recordings.
- Stable publication is gated by installed-product verification, security,
  accessibility, privacy, and measured performance.

Material changes to these decisions require an OpenSpec change with migration,
compatibility, and release-gate consequences documented before implementation.
