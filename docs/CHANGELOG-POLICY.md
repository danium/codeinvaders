# Changelog policy

`CHANGELOG.md` is the user-facing record of released and unreleased changes.
Maintainers update it as part of the same change that affects users, operators,
integrators, or contributors.

- Group entries under `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, or
  `Security` as appropriate.
- Write concise, user-visible entries and link them to the relevant release or
  pull request when one exists. Do not include private event data, credentials,
  or internal-only implementation noise.
- Keep an `Unreleased` section at the top. Release preparation moves its entries
  into a dated SemVer section and adds comparison links when release automation
  is introduced.
- Use SemVer: breaking public protocol, journal, CLI, adapter, or extension
  changes require a major version; compatible features use a minor version; and
  fixes use a patch version. Security fixes may narrow unsafe behavior and must
  explain that change.
- A release is not complete until its changelog entry, dependency/license
  inventory, and known limitations are reviewed together.
