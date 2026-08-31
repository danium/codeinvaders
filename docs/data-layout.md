# Local data layout

The CLI resolves one platform-appropriate user data root and passes it
explicitly to the runtime and direct hook entries. A typical installation owns:

```text
<data-root>/
  config.json                 # bounded local settings, no agent content
  identity.key                # private installation key
  runtime.json                # current process/endpoint metadata
  spool/                      # sanitized committed ingress records
  journals/<stream-id>/       # segmented canonical JSONL + manifest
  snapshots/                  # disposable canonical state snapshots
  diagnostics/                # bounded structured codes only
```

Exact names are part of the CLI/runtime compatibility contract. Files and
directories are private to the current user where the platform supports modes
or ACLs. Temporary writes use owned siblings followed by atomic rename. A
journal record is retired from the spool only after durable append
acknowledgement.

Journals are authoritative. Manifests, snapshots, indexes, and browser state
may be deleted and rebuilt. Retention removes only verified regular files under
owned roots, invalidates derived artifacts, and refuses symlinks, junction
escapes, absolute targets, and traversal. Uninstall preserves recordings unless
the user separately confirms delete-all.
