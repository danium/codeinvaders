# Branch protection and required checks

Protect `main` after the repository becomes public. Require a pull request, one
approving review from a code owner, dismissal of stale approvals, conversation
resolution, linear history, and the branch to be current before merge. Block
force pushes and deletion. Administrators should follow the same rules except
during a documented security recovery.

Require these matrix checks from `.github/workflows/ci.yml`:

- `Checks (ubuntu-latest)`
- `Checks (macos-latest)`
- `Checks (windows-latest)`

Release tags must match the repository's protected tag rules and point at the
exact reviewed commit. On tag push, the release workflow checks out that tag
and requires its complete repository gate to pass on all three supported
runners before the artifact build, attestation, or GitHub release job can run.
The release workflow receives only the minimum
`contents: write`, `id-token: write`, and `attestations: write` permissions
needed for artifacts and provenance. npm publication remains disabled.

Repository configuration is verified with `gh api` during the public-repository
task; this document is not evidence that the remote settings are already
enabled.
