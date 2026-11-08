# CCR: F6 backend — the conversation (B light): activity, tabs, tool rows, steer a queued message, background shells, N2 (1.5.0)

Owner: BACKEND. Status: frozen tests for review (M5: HML tests, DESIGN shapes, FE renderer).

**Criteria:** A19, A20, A21, A22, A23 and A53, per the SPEC's F6 acceptance (TECH LEAD 08/11).
- A23 (tools beside the conversation, and split) is renderer-only, so it has no backend task.
- The side chat is removed (A19).

**Contract:** DESIGN's `.claude/roadmap-1.4/team/plans/1.5.0-f6-design.md`, section "Data each screen needs".

**Frozen tests:** `tests/acceptance/f6/`: 47 tests in 8 files.

**Tasks:** `.claude/roadmap-1.4/team/plans/f6-tasks-BACKEND.json`: 7 tasks with the IMPLEMENTATION-PACK fields.

**Rigor:** fake adapters, fixture JSONL and temp git repos only, with no live provider. Every test exercises real code: the read model on a migrated database, the real ThreadManager, and the real IPC adapter over fake-ipc-main.

## A19 · The header as a task

**`activity` (T90)**
- `threadActivity(input)` returns `{ kind, at, text?, verb?, since?, count?, requestId?, reason? }`. `kind` is one of `needs-you`, `question`, `working`, `paused`, `error`, `ready` or `done`, in that priority.
- The text is redacted and relative to the project. It is never an app sentence: the window words each kind from DESIGN's NowLine table (C3).
- `AgentRow.activity` is set only on conversation rows of the S7.1 read model.

**Tabs**
- `threadToolTabs(...)` gives Conversation, then Terminal, Queries, Network, Containers, Changes and Pull request.
- A tab appears only when its count is above 0. A failed source adds no tab.
- Served by `thread:tool-tabs`, with the push `thread:tool-tabs-changed`.

## A20 · Tool calls fold

**`toolRow(event, root)`** (in `shared/thread-tool-rows.ts`, used by main and the window) returns `{ kind, verb, target, meta, at, failed, running, truncated? }`.
- The kinds are read, edit, run, query, http, container and other, covering both Claude's and Codex's tool names.
- `truncated` comes from a new optional `outputTruncated` field on the tool event.

**`foldSummary(rows)`** counts:
- steps, plus reads, distinct files edited, runs, queries, HTTP calls, containers and other;
- failed and fixed: a failure later succeeding on the same step counts as fixed;
- running.

## A21 · The composer (T76)

**`steerQueued(id, itemId)`** sends a queued message as a steer when a turn is running and the provider can steer. It then leaves the queue and is recorded once.

**Otherwise** it gives `thread.steer.unavailable`, and the message stays queued.

**Unchanged:** Send now is the existing `sendQueuedNow`. The placeholders and buttons for each `canSteer` × status combination are the window's.

## A22 · The background shell (T77)

`backgroundShells(...)` merges two sources:
- the agent's background commands, the provider's `subagent` "Background command" events;
- OXESpace's own background jobs.

Each shell is `{ id, command, startedBy, state: running | stopped | unknown, exitCode?, since, tail[≤5], canStop }`.

**States**
- A running shell becomes unknown when the session is gone (an app restart) or no signal came within `BACKGROUND_SIGNAL_TIMEOUT_MS`, so nothing shows as running forever.
- `canStop` is true only for OXESpace jobs that are still running.

**Served by** `thread:background`, with the push `thread:background-changed`.

## A53 · A terminal agent's conversation on the desktop (N2)

**`registerPaneConversationIpc`** puts F10's `PaneConversations` (#658's reader) behind `pane-conversation:{has, page, watch, unwatch, changed}`.
- It is read only.
- The window counts as its own device.
- The push carries only `{ paneId }`.
- Inputs are checked before the reader runs.
- It is excluded from MCP.

**Dependency:** this needs F10's BE-A46-c5. A file precondition on `electron/main/services/remote/pane-conversation.ts` holds it until that module is on the base.

## Contract

**Channels:** `thread:queue-steer`, `thread:tool-tabs` (and changed), `thread:background` (and changed), and `pane-conversation:*`. All go through the preload's `IPC_CHANNELS`.

**MCP coverage**
- `thread.steerQueued` is in the same write capability as `thread.steer`.
- The tool tabs, the background list and the pane conversation are excluded.

**C3 code:** `thread.steer.unavailable`.

**Phone:** no protocol change. A53 reuses F10's contract.

## Not in F6 (TECH LEAD / DESIGN)

- History, Restore and Branch, and the command bar: F8 (A29–A31).
- N10: F9 (A64).
- Impact preview: F7.
- The side chat: removed.
