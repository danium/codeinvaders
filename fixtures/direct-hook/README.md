# Direct-hook fixtures

These inputs are intentionally sanitized native-hook examples for child-process
delivery tests. They contain only lifecycle metadata; text-bearing native
fields belong in tests as canaries and must never be persisted.

The expected response from both direct entries is exactly `{}`. The resulting
`.ingress` record contains only a validated AAP event and its source stream
identity.
