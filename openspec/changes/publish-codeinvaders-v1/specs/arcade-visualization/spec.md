## Purpose

Defines the truthful, accessible arcade presentation that makes agent activity and uncertainty understandable while remaining usable under degraded telemetry and heavy load.

## ADDED Requirements

### Requirement: Stable semantic visual grammar
The presentation SHALL represent root agents as carriers, observed child agents as separate ships, tasks as enemies, tool operations as weapon activity, permissions as blocking indicators, and uncertainty as an explicit signal-loss treatment. Parallel tools from one agent SHALL NOT create extra ships.

#### Scenario: One agent runs parallel tools
- **WHEN** one agent has three concurrent tool operations
- **THEN** one ship presents three operation effects and fleet size remains unchanged

#### Scenario: Two subagents are active
- **WHEN** two child-agent spawn events are observed
- **THEN** two distinct child ships appear with their parent relationships preserved

### Requirement: Outcome animations respect finality
Provisional activity SHALL use reversible or nonterminal visuals. Only confirmed task completion SHALL produce the success-destruction treatment; failure and cancellation SHALL remain visually distinct.

#### Scenario: Completion is requested but rejected
- **WHEN** a task receives a provisional completion request followed by continued work
- **THEN** the enemy remains present and no success explosion occurs

#### Scenario: Task is cancelled by replanning
- **WHEN** a confirmed task cancellation is reduced
- **THEN** the enemy retreats or dissolves without the completion effect

### Requirement: Truthful degraded modes
The UI SHALL expose current telemetry quality and SHALL use exactly one explicit fallback objective when confirmed task lifecycle is unavailable. Decorative wear from tool activity SHALL NOT be presented as measured progress.

#### Scenario: Tools-only session
- **WHEN** the source exposes tools but no tasks or subagents
- **THEN** one structural root ship attacks one clearly identified fallback objective and the UI reports activity-only coverage

#### Scenario: Temporary telemetry gap
- **WHEN** a gap is recorded
- **THEN** existing semantic entities remain, a signal-loss indicator appears, and the renderer invents no missing action

### Requirement: Accessible equivalent presentation
All significant semantic information and controls SHALL be available without relying on color, motion, audio, pointer input, or WebGL. The release SHALL provide keyboard operation, reduced motion, high contrast, color-safe status encoding, rate-limited screen-reader announcements, and a text activity feed.

#### Scenario: WebGL is unavailable
- **WHEN** the browser cannot initialize the Three.js world
- **THEN** the user can still inspect live and replayed semantic activity through the text interface

#### Scenario: Reduced motion is enabled
- **WHEN** the user or operating system requests reduced motion
- **THEN** travel, shake, and explosions are replaced by fades and status changes without losing outcome distinctions

### Requirement: Load shedding preserves semantics
The reducer SHALL process every accepted semantic event while the visual layer MAY coalesce or discard cosmetic effects under load. Task terminals, agent lifecycle, permissions, failures, and telemetry gaps SHALL remain visible.

#### Scenario: Sustained event storm
- **WHEN** tool activity exceeds the configured cosmetic effect budget
- **THEN** effects are coalesced or dropped while the latest semantic state and protected transitions remain correct and inspectable

### Requirement: Release performance budget
On documented reference hardware, the focused live arena SHALL remain usable with at least 100 visible semantic entities and 300 pooled cosmetic effects, shall degrade gracefully on integrated graphics, and SHALL NOT retain unbounded Three.js resources, DOM nodes, event listeners, or animation records.

#### Scenario: Performance acceptance run
- **WHEN** the release performance fixture runs at the supported entity and effect limits
- **THEN** frame rate, memory, and event-to-presentation latency meet the published release thresholds without semantic drops

