# Delegation native-session protocol

Status: implemented baseline, 2026-09-21.

## Identity invariants

- An OXESpace execution lease has an owner (`pane` or `thread`), workspace, canonical root, monotonically increasing generation and random token.
- A delegation session binding is the tuple `(taskId, provider, nativeSessionId, canonicalRoot, generation)`.
- Resume is allowed only when the persisted provider, native session ID and canonical root match the destination Thread. There is no “latest session” fallback.
- Restart invalidates process leases. It preserves task, checkout, Thread, native session binding, bundle revisions and operation journal.
- Retry applies only to provisioning when no resumable native session is known. Resume continues the exact persisted provider conversation.

## Provider start and resume

| Provider | New Thread | Resume Thread | Session evidence |
| --- | --- | --- | --- |
| Claude | `--session-id <uuid>` through the streaming adapter | `--resume <exact-id>` | `system/init.session_id` and streamed `session_id` |
| Codex | `thread/start` through app-server | `thread/resume` with `threadId=<exact-id>` | app-server response `thread.id` |

Terminal remains a compatibility host. New application delegations default to Thread because Thread exposes a persistent conversation record and an exact native session boundary. Legacy tasks without a surface remain terminal tasks.

## Crash boundaries

1. Checkout planning has no side effects.
2. Git application is journaled and revalidated under a project+branch lock.
3. A created Thread ID is persisted before sending its bootstrap.
4. The native session binding is persisted after provider start returns a certified ID.
5. A crash between steps 3 and 4 leaves a recoverable Thread without claiming native resume support.
6. A crash after step 4 exposes Resume. OXESpace does not replay the original objective automatically.

## Security boundary

- Provider and API credentials inherited by the parent process are removed.
- The main process injects fresh MCP and execution leases for each Thread generation.
- Leases are revoked when the adapter is disposed.
- Knowledge transfer contains explicit handoff, acceptance criteria, committed selected evidence and bounded optional context. It excludes credentials, implicit transcript copying and uncommitted file contents.
