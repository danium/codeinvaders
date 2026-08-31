# Execution readiness report

Date: 2026-08-15
Change: `publish-codeinvaders-v1`
Scope: readiness through stable GitHub publication

This report contains no tokens, credential values, configuration contents, or raw agent telemetry.

## Decision

`ready` — every required pre-implementation dependency and approval was
resolved; implementation task 1.1 began. The publication-state verification
below supersedes the preflight repository-visibility notes where they differ.

## Publication-state verification (2026-08-31)

The canonical repository [`danium/codeinvaders`](https://github.com/danium/codeinvaders)
is public, private vulnerability reporting is enabled, and the protected
release configuration is active. `main` has administrator enforcement, one
approving review, CODEOWNERS review, stale-approval dismissal, conversation
resolution, linear history, strict required checks (`Checks (ubuntu-latest)`,
`Checks (macos-latest)`, and `Checks (windows-latest)`), and no force pushes or
deletions. Active ruleset `21913918` protects `refs/tags/v*` from deletion and
non-fast-forward updates. These facts were verified through GitHub API
responses; they do not imply that a stable release has been published.

## Readiness classification

| Task                                         | Status  | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Required action                                                                                                                        |
| -------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 Dependency and approval inventory        | `ready` | Required local commands, runtimes, browsers, agent installations, external services, credentials, permissions, configuration locations, trust reviews, platform checks, and publication operations are inventoried below.                                                                                                                                                                                                                                        | None.                                                                                                                                  |
| 0.2 GitHub identity and repository authority | `ready` | GitHub CLI is authenticated as `danium` through the keyring. The canonical target is reserved as an empty private repository at `github.com/danium/codeinvaders`; the viewer has `ADMIN`, `admin`, and `push` permission.                                                                                                                                                                                                                                        | Keep the repository private until the planned public-repository task so incomplete work is not published.                              |
| 0.3 Git and GitHub publication access        | `ready` | Git author name and email are configured, Git Credential Manager and HTTPS Git operations are available, the token has `repo` and `workflow` scopes, GitHub network access succeeds, repository admin/push permission is confirmed, and Actions are enabled. Private vulnerability reporting is an admin-controlled public-repository feature and will be enabled when the repository becomes public.                                                            | Recheck the same permissions immediately before publication and enable private vulnerability reporting after public visibility is set. |
| 0.4 Node, pnpm, and registry access          | `ready` | Node.js 24.11.1, npm 11.6.2, Corepack 0.34.2, and pnpm 10.27.0 are installed. `npm ping` to `https://registry.npmjs.org/` returned `PONG`. Project tools may be installed as pinned workspace dependencies.                                                                                                                                                                                                                                                      | None.                                                                                                                                  |
| 0.5 Agent and browser surfaces               | `ready` | Codex CLI 0.147.0, Codex desktop, plugin commands, in-app browser capability, Claude Code 2.1.227, Chrome, Edge, and Playwright browser assets are present. Both agent installations expose the required integration surfaces; final capability claims still require real-session conformance.                                                                                                                                                                   | None before implementation. Do not treat installed surfaces as release-conformance evidence.                                           |
| 0.6 Configuration scope and restoration      | `ready` | On 2026-08-15 the user authorized backup, modification, validation, and restoration of the exact Codex and Claude user/project paths listed below.                                                                                                                                                                                                                                                                                                               | All writes must use recovery copies, post-write validation, ownership markers, and exact restoration of unrelated content.             |
| 0.7 Native trust review                      | `ready` | On 2026-08-15 the user confirmed native trust review for the exact generated CodeInvaders plugin/hook definitions. Bypass flags remain prohibited.                                                                                                                                                                                                                                                                                                               | Stop and present any irreducible native prompt for genuine review; use a supported manual hook path if required.                       |
| 0.8 Checksums, provenance, and npm           | `ready` | SHA-256 (`Get-FileHash`, `certutil`), archives (`tar`, PowerShell archive commands), `gh attestation`, GitHub Actions, repository admin permission, and `workflow` token scope are available. GitHub documents artifact attestations for public repositories on the current plan; the reserved repository will remain private until its planned public-release transition. npm publication is `not-applicable` because ownership and credentials are unverified. | Keep npm publication disabled. Generate and verify attestations only from the public release workflow.                                 |
| 0.9 Readiness report and stop gate           | `ready` | This report classifies every readiness item; no required item is `blocked` or `unknown`.                                                                                                                                                                                                                                                                                                                                                                         | Proceed to task 1.1.                                                                                                                   |

## Inventory

### Local commands and runtimes

- Required and present: `git`, `gh`, `node`, `npm`, `corepack`, `pnpm`, `openspec`, `codex`, `claude`, PowerShell 7, `Get-FileHash`, `certutil`, and `tar`.
- Browser capability present: Codex in-app browser surface, Chrome, Edge, and cached Playwright Chromium assets.
- Project-local dependencies to pin after the gate: TypeScript, formatter, linter, test runner, bundler, Three.js, schema validation, WebSocket/HTTP runtime libraries, Playwright, accessibility tooling, property/fuzz testing, and license/provenance tooling.
- Current host verifies Windows behavior only. GitHub Actions and clean environments must supply supported Windows, macOS, and Linux lifecycle evidence.

### External services and credentials

- npm registry: `ready` for dependency retrieval.
- GitHub API, the reserved private repository, Actions, releases, and push/admin access: `ready`.
- Private vulnerability reporting and free-plan artifact attestations: `ready` for the planned public-repository state; they are intentionally unavailable while the empty reservation remains private.
- npm publication: `not-applicable`; no npm ownership or credential is assumed.
- Default external runtime telemetry or remote assets: prohibited and therefore `not-applicable`.

### Configuration paths requiring explicit scope

- `C:\Users\danii\.codex\config.toml`
- `C:\Users\danii\.codex\plugins\`
- `C:\Users\danii\.claude.json`
- `C:\Users\danii\.claude\settings.json`
- `C:\Users\danii\.claude\settings.local.json`
- `C:\Dev\CodeInvaders\.codex\` if a project-scoped Codex path is explicitly selected
- `C:\Dev\CodeInvaders\.claude\` if a project-scoped Claude path is explicitly selected

The integration test procedure must snapshot only existing targeted files, hash the snapshots, compose uniquely owned CodeInvaders entries, validate after each write, and restore or uninstall owned entries without overwriting unrelated concurrent edits. Raw backups and traces are local-only and must not be committed.

### Trust and approval boundaries

- Never use `--dangerously-bypass-hook-trust`, `--dangerously-bypass-approvals-and-sandbox`, Claude permission-bypass flags, or equivalent security weakening for product verification.
- Native plugin and hook trust prompts require genuine review of the exact generated command and source.
- Repository creation, pushes, repository setting changes, releases, tags, and announcements are external writes. They occur only at their corresponding OpenSpec tasks after all prerequisite gates pass.
- Delete-all and uninstall tests operate only on isolated CodeInvaders-owned verification data and recognized owned configuration entries.

## Sanitized commands used

```text
openspec status --change publish-codeinvaders-v1 --json
openspec instructions apply --change publish-codeinvaders-v1 --json
openspec validate publish-codeinvaders-v1 --type change --json --no-interactive
git config --get user.name
git config --get user.email
git config --get credential.helper
gh --version
gh auth status --hostname github.com
node --version
npm --version
corepack --version
pnpm --version
npm ping --registry=https://registry.npmjs.org/ --fetch-timeout=10000 --fetch-retries=0
codex --version
codex plugin --help
claude --version
Get-FileHash <non-sensitive-file> -Algorithm SHA256
tar --version
```

## Authorization resolution

On 2026-08-15 the user authorized backup, modification, validation, and restoration for the listed Codex and Claude configuration paths and confirmed native plugin/hook trust review without bypass flags. The readiness probes were refreshed and no required item remains `blocked` or `unknown`.

GitHub feature references:

- https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository
- https://docs.github.com/en/code-security/getting-started/github-security-features
