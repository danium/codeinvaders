# Branch protection and required checks

Verified on 2026-08-31 for the public repository
[`danium/codeinvaders`](https://github.com/danium/codeinvaders). Private
vulnerability reporting is enabled.

The `main` branch is protected with a pull request, one approving review,
CODEOWNERS review, stale-approval dismissal, conversation resolution, linear
history, and strict required-status checks. Administrator enforcement is
enabled. Force pushes and branch deletion are blocked.

Require these matrix checks from `.github/workflows/ci.yml`:

- `Checks (ubuntu-latest)`
- `Checks (macos-latest)`
- `Checks (windows-latest)`

The active repository ruleset `21913918` protects refs matching `refs/tags/v*`
from deletion and non-fast-forward updates. Release tags must match the
repository's protected tag rules and point at the
exact reviewed commit. On tag push, the release workflow checks out that tag
and requires its complete repository gate to pass on all three supported
runners before the artifact build, attestation, or GitHub release job can run.
The release workflow receives only the minimum
`contents: write`, `id-token: write`, and `attestations: write` permissions
needed for artifacts and provenance. npm publication remains disabled.

The repository visibility, vulnerability-reporting setting, branch protection,
required checks, administrator enforcement, and active tag ruleset were
verified with GitHub API responses during the public-repository task.
