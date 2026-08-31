# Security policy

## Supported versions

Security fixes are provided for the latest stable release and, until `v1.0.0`,
the newest release candidate. Older prereleases are unsupported.

## Report a vulnerability privately

Use GitHub's **Report a vulnerability** form in the Security tab of
`danium/codeinvaders`. Do not open a public issue for a suspected
vulnerability.

Please include the affected version, operating system, a minimal reproduction,
and the impact you observed. Do **not** attach event journals, spool records,
snapshots, agent transcripts, prompts, source code, commands, tool output,
credentials, environment variables, repository remotes, or raw configuration.
Use synthetic identifiers and redact local paths and user names.

We aim to acknowledge a report within three business days, provide an initial
assessment within seven business days, and coordinate remediation and
disclosure with the reporter. These are response targets rather than a bounty
or service-level guarantee.

## Security model

CodeInvaders is a local, offline-capable observability tool. The browser service
binds only to loopback, requires a short-lived session exchange, validates
origins, and uses a separate local IPC endpoint for hooks. Adapters are
observational and fail open; they must never approve, deny, rewrite, or steer an
agent operation. Canonical recordings contain allowlisted metadata only.

If you believe a release violates those boundaries, treat it as a security or
privacy vulnerability and report it privately.
