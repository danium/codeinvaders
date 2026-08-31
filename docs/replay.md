# Replay semantics

Replay consumes canonical journal events only. Events within one stream are
ordered by durable sequence; independent streams use observed time, stream ID,
sequence, and event ID as deterministic tie-breakers. This merged ordering is a
display approximation, not a claim of global causality.

The same ordered input and reducer version must produce byte-equivalent
canonical state. The presentation mapper then converts each state transition
to versioned intents with absolute semantic time and deterministic seeds. A
seek reconstructs state from a compatible snapshot plus later journal records,
or from the journal alone. Renderer frame accumulation is never authoritative.

Replay supports speed changes, bounded idle compression, entity/type filters,
significant-event jumps, seek, and return to the current live edge. Filters
change the displayed projection; they do not rewrite the recording. Confirmed
terminal outcomes remain monotonic unless an explicit correction event appears.
