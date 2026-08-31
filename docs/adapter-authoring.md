# Adapter authoring

An adapter is an observational translator from a documented native lifecycle
surface to AAP. It must not approve or deny permissions, modify tool input or
output, inject context, steer a plan, or require an agent to call a tool.

Start with sanitized, version-pinned native fixtures. Define an exact hook-name
allowlist and bounded parser before mapping fields. Construct a new canonical
payload from closed enums and safe numbers; never clone and redact a native
object. Unknown tools use the generic category. Native identifiers are input to
the installation-keyed opaque ID derivation and are never returned or stored.

Every emitted relationship needs a basis:

- use a native identity when it is present and unambiguous;
- label deterministic derivations as derived;
- omit a relationship when parallel or repeated evidence makes it ambiguous;
- never use fuzzy text similarity to transfer terminal task state.

The direct hook entry must be prebuilt, consume bounded stdin, write exactly the
native empty response, and complete within the hook budget. Only an accepted
sanitized ingress handoff may reach IPC or spool APIs. Logical retries retain
the same event ID.

Adapter tests must cover every pinned hook, malformed and hostile values,
multibyte byte limits, missing terminal events, restart, concurrency,
capability gaps, noninterference, broker absence, and privacy canaries. Add the
adapter to the shared conformance runner before making compatibility claims.
