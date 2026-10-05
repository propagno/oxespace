# Thread resume: latency and false failures

## Verified causes

- Codex's local history importer streamed the entire rollout before `/resume` could navigate, even though it retained at most 1,000 public messages. A local rollout of about 709 MB took 13,814 ms to import.
- The beta.4 adapter failed and disposed an accepted turn after 120 seconds without scoped native events. Silence alone does not establish process death or a conflicting CLI writer. The supplied diagnostic timestamps match this timeout (120,298 ms).
- Local events, including a locally generated failure, refreshed the connection heartbeat. Adapter disposal did not publish connection closure, leaving failed turns marked connected.

## Changes

- Verify large Codex rollouts against their header, then read an initial window of at most 8 MiB from the end. Skip an incomplete first record and preserve the existing message/count limits and truncation notice. Small rollouts retain their existing import behavior.
- Remove the silence watchdog. The existing stale-activity warning and user stop action remain; actual process exit and protocol failures still fail the turn.
- Publish adapter closure separately from turn completion. Local timeline events no longer manufacture provider heartbeats.

## Measurements and validation

- Read-only import of the affected local rollout: 186 ms, seven public messages, 4,595 retained bytes, explicitly truncated. This measures initial history import, not full session hydration or model response time.
- Real Codex app-server, isolated temporary project, GPT-6-Astra with low effort and read-only access: new connection 681 ms, send accepted 736 ms, completed 17,111 ms. After closing that process and resuming the created session: connection 418 ms, send accepted 476 ms, completed 17,698 ms. No source files were changed by these turns.
- Regression coverage includes silence followed by successful completion, actual transport exit, connection closure in persisted diagnostics, bounded large-rollout reading, and rejection of a different project directory.

## Limits

- The initial window is deliberately partial. This change does not add native-history pagination or background indexing; full native history remains in the provider's original file.
- The isolated native probe validates a new session and its resume. It does not establish that a model turn in the original large session completes, or that an installed release contains these changes.
- Do not infer a concurrent writer conflict from silence. Such a diagnosis requires the provider's explicit error or independent ownership evidence.
