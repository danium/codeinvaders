## Purpose

Defines transparent, reversible installation and operation across supported Codex and Claude Code environments without overwriting user-owned configuration.

## ADDED Requirements

### Requirement: Transparent environment detection
The CLI SHALL detect supported Codex and Claude Code installations and surfaces, report capabilities and limitations, and show the exact files and hook commands it proposes before changing configuration.

#### Scenario: Codex IDE lacks plugin support
- **WHEN** detection finds a Codex surface that cannot load plugins
- **THEN** the installer offers a supported manual hook path or reports the limitation rather than claiming plugin installation succeeded

#### Scenario: No supported agent is present
- **WHEN** installation detects neither supported agent
- **THEN** it makes no hook changes and provides actionable manual instructions

### Requirement: Configuration composition and ownership
Installation SHALL preserve existing hook configuration, add only entries selected by the user, identify entries owned by CodeInvaders, and avoid silently committing project-scoped configuration.

#### Scenario: Existing hooks are configured
- **WHEN** the target already contains unrelated hook definitions
- **THEN** installation composes CodeInvaders entries without removing, reordering incompatibly, or replacing user-owned entries

#### Scenario: Project-scoped installation is selected
- **WHEN** the user chooses project scope
- **THEN** the CLI identifies repository-visible files before writing and requires explicit confirmation

### Requirement: Operational command lifecycle
The CLI SHALL provide discoverable install, start, doctor, replay, upgrade, status, and uninstall commands with noninteractive behavior suitable for testing and clear exit codes.

#### Scenario: Doctor succeeds
- **WHEN** configured adapters, storage, broker authentication, browser assets, and a synthetic privacy-safe event all function
- **THEN** doctor exits successfully and reports each verified component without exposing secrets

#### Scenario: Doctor detects partial configuration
- **WHEN** one selected agent hook is missing or invalid
- **THEN** doctor exits nonzero, identifies the owned configuration problem, and leaves unrelated configuration unchanged

### Requirement: Ownership-aware uninstall
Uninstall SHALL remove only CodeInvaders-owned hook entries, commands, and generated integration files. It SHALL preserve recordings by default and require a separate explicit choice to remove user data.

#### Scenario: Uninstall after user edits shared config
- **WHEN** a shared hook file contains both CodeInvaders-owned and user-owned changes
- **THEN** uninstall removes the owned entries and preserves valid unrelated content

#### Scenario: Uninstall with data retention
- **WHEN** the user uninstalls without selecting data deletion
- **THEN** recordings remain available for manual backup or later reinstall

### Requirement: Safe compatible upgrade
Upgrade SHALL validate configuration and stored-data compatibility, preserve rollback information for modified configuration, and refuse migrations that would silently discard canonical events.

#### Scenario: Stored protocol requires migration
- **WHEN** an upgrade encounters a supported older journal version
- **THEN** it performs or schedules the documented non-destructive migration and verifies replay before declaring success

#### Scenario: Version is unsupported
- **WHEN** the installed data or hook configuration cannot be safely upgraded
- **THEN** upgrade stops with recovery guidance and does not partially replace the working installation

### Requirement: Supported platform verification
Each stable release SHALL test installation, operation, doctor, replay, upgrade, and uninstall on the documented supported Windows, macOS, and Linux versions.

#### Scenario: Release platform matrix
- **WHEN** a release candidate is evaluated
- **THEN** every supported operating-system job completes the full installation lifecycle successfully

