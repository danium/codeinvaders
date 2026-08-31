# Visualization contract

The local presentation has a pure, versioned mapper (`MAPPER_VERSION = 1`). It consumes the previous semantic state, canonical event, and next state and returns semantic-time intents. It never infers progress from cosmetic wear. Seeds derive from event identity, so replay and seek use absolute semantic time without accumulated frame state.

The arena grammar is structural: one session root is a carrier, observed child agents are child ships, tasks are enemies, and tools are effects attached to the owning ship. Tools from one agent never increase fleet size. Tools-only turns receive one clearly identified fallback objective. Permission locks, telemetry gaps, capability degradation, quiescence, and resumed activity are semantic intents.

Only confirmed completion creates `success-impact`. Requested completion remains reversible. Failure, denial, abandonment, cancellation, and correction use distinct intent kinds. Under load, semantic intents are retained while cosmetic effects are coalesced and reduced to the bounded effect budget.

`ArenaModel` is renderer-neutral and deliberately owns no canonical state. The local build includes a Three.js `InstancedMesh` renderer with pooled entity/effect capacity, explicit geometry/material disposal, absolute semantic-time rendering, and a deterministic DOM/text fallback with no remote assets. It always exposes the same event information through the text activity feed and inspector.

Acceptance fixtures cover parallel tools from one ship, child-agent hierarchy, task outcomes, permission locks, gaps, degraded sessions, deterministic mapper output, 100 entities, 300 effects, and sustained event storms. Browser performance evidence must be recorded against a production build; unit fixtures alone do not prove a release budget.
