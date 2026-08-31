# Troubleshooting

Run `codeinvaders status` first, then `codeinvaders doctor`. Doctor checks the
owned hook entries and direct files, private storage, local IPC, loopback HTTP,
browser authentication, assets, adapter compatibility, and a synthetic
privacy-safe round trip.

If the browser does not open, copy the start URL from the CLI into a local
browser without sharing it; its fragment contains a one-use launch secret. If a
port is occupied, stop the stale CodeInvaders runtime or choose another local
port. Never expose the service on a LAN address.

If events are missing, keep the coding agent running: hooks fail open by
design. Check whether doctor reports a capability gap, broker outage, spool
overflow, incompatible native version, or malformed owned configuration. A
stop checkpoint may mean quiescent rather than finished. Unsupported hosted
tools or manual permission denials are shown as coverage gaps, not inferred.

If replay refuses a snapshot, the runtime rebuilds it from canonical journals.
Do not edit a journal to repair it. Preserve the data root and open a synthetic
bug report. Never attach journals, spool files, snapshots, transcripts, raw
configuration, or diagnostics that may include local metadata.

Uninstall removes only recognized CodeInvaders entries and preserves
recordings. Use the separately confirmed delete-all operation only when the
resolved target is the expected CodeInvaders data root.
