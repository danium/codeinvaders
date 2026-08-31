# Contributing

Use Node.js 24 and pnpm 10.27. Install with `pnpm install --frozen-lockfile`
and run `pnpm check` before opening a pull request. Package-level tests are
useful during development, but the root gate is authoritative.

Changes must preserve the architecture and privacy boundaries documented under
`docs/`. Add deterministic tests at the owning boundary and shared conformance
coverage when behavior crosses packages. Protocol changes require compatible
schemas, fixtures, canonicalization tests, documentation, and an explicit
migration decision. Do not relax correctness, security, accessibility, or
performance budgets to make a test pass.

All examples, fixtures, screenshots, logs, and traces must be synthetic and
privacy-scanned. Never commit prompts, messages, source, patches, commands,
arguments, output, paths, URLs, credentials, environment values, transcripts,
repository remotes, user names, local data roots, or agent configuration.

Use focused commits and describe verification in the pull request template.
Security issues belong in private vulnerability reporting, not a public issue.
