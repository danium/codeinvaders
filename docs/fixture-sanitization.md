# Fixture sanitization

Prefer hand-authored synthetic native envelopes. A fixture may retain public
hook names, closed categories, booleans, bounded durations, version numbers,
and generated opaque identifiers. Replace every prompt, message, source,
patch, command, argument, output, path, URL, query, credential, environment
value, transcript field, repository remote, and user name with a unique canary
while testing, then remove the field from the committed sanitized fixture.

Run the adapter and persistence canary suites before commit. Search the staged
fixture and generated snapshots for every canary and for recognizable local
paths or account names. Never sanitize a real transcript in place inside the
repository; work in an isolated private location and commit only the synthetic
result. Screenshots and profiles follow the same rule.
