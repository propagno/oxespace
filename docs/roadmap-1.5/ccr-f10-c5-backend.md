# CCR: F10 backend: the three C5 tasks the phone phase depends on (1.5.0)

Owner: BACKEND. Status: frozen tests for review (M5: MOBILE, HML; SECURITY: TECH LEAD).

**Tasks:** `.claude/roadmap-1.4/team/plans/f10-tasks-BACKEND.json`. Their ids are the ones MOBILE's `f10-tasks-MOBILE.json` depends on: **BE-A45-flag**, **BE-A46-c5** and **BE-A67-c5**.

**Frozen tests:** `tests/acceptance/f10/`, plus MOBILE's two A67 tests in #699.

**Rules:**
- No live provider, no user home: every test uses temp dirs, fixture JSONL and the in-test gateway harness.
- Each protocol change is additive and uses literal types, with no new enum (#531).
- Each one runs `npm run android:generate`, commits the Kotlin and reverts line-ending churn.

## BE-A45-flag: only the snapshot page for a phone that reads it

This is the "Phone phase" item 2 of `ccr-t98-terminal-screen.md`.

**The flag:** `RemoteSubscribeFrame.snapshotOnly?: boolean`.
- It is accepted on every topic, and only `terminal` reads it.
- Today the gateway refuses the unknown field, which is why the frozen tests are red now.

**With the flag:**
- The terminal snapshot is one page: `{ data: '', truncated: false, redacted, snapshot }`, with no ring pages.
- That page's `redacted` equals what the ring pages would have counted.

**Fallback:** when the screen can't be built (the builder throws, returns null, or doesn't fit), the ring pages go as today, so a flagged phone never gets an empty terminal.

**Otherwise as today:**
- Events, a resume by cursor, and a new process work as now; the new process gets a one-page snapshot.
- Without the flag, nothing changes.

**Frozen in:**
- `a45-snapshot-flag.native.test.ts`, through the real gateway. The fallback uses `vi.mock` on `terminal-snapshot.ts`, the real module unless a test sets a fault.
- `c5-generated-kotlin.test.ts` (BE-A45).

## BE-A46-c5: a terminal agent's conversation for the phone

This is the contract of `ccr-phone-pane-conversation.md` (#658, approved by TECH LEAD, DESIGN, HML and MOBILE at 5ce83b7f). Its desktop tests 1–11 are frozen as follows.

**Protocol:**
- `RemotePane.conversation?: boolean`;
- `RemotePaneConversationArgs { paneId; cursor? }`;
- `RemotePaneConversationPage { agent; title?; items: { seq; item }[]; cursor: string | null; epoch }`;
- `RemotePaneConversationEvent { changed: true }`;
- `'pane.conversation'` in `REMOTE_COMMANDS`, and `'paneConversation'` in `REMOTE_SUBSCRIPTIONS`;
- `'no-conversation'` and `'conversation-changed'` in `REMOTE_ERROR_CODES`;
- `RemoteErrorFrame.reason` gains `'new-session' | 'rewritten'`.

**`PaneConversations`** (`electron/main/services/remote/pane-conversation.ts`), built from `PaneAgentSessions`, the pane cwd, the roots, `claudeHome` and `codexHome`, with `transport`, `watch` and `now` as seams:

| Method | Does |
|---|---|
| `has(paneId)` | The flag: a recorded Claude/Codex session whose file exists for the cwd. Codex counts only with a rollout, and nothing is ever spawned. |
| `page(deviceId, { paneId, cursor? })` | Newest page first, 50 items, through `NativeSessionReader` and `threadItems`/`fitPage` (redaction, path scrub, `itemText` cut). |
| `subscribe(paneId, listener)` | One watcher per pane. At most one signal per 2 s, with a 2 s max-wait. A fire with no size or mtime change sends nothing. |
| `sessionChanged(paneId)` | Signals, and bumps `epoch` on the next page. |
| `forgetDevice(deviceId)` | Drops that device's handles. |

**Handles (`PANE_CONVERSATION_LIMITS`):**
- 32 base64url characters, at most 8 per device, and a 10-minute life;
- bound to the device, pane and session;
- an append keeps the handle; a rewrite or truncate gives `conversation-changed { reason: 'rewritten' }`, and another session gives `{ reason: 'new-session' }`.

**Gateway (`RemoteGatewayDeps.paneConversations`):**
- The workspaces topic precomputes the flag.
- The command counts against the device's rate.
- The topic's snapshot is the newest page. Its events are exactly `{ changed: true }`, sent only to that topic's subscribers. `sinceSeq` and `cursor` are ignored.
- An unknown pane, or one without a session, gives `no-conversation`, never `not-found`.
- `forgetDevice` runs on disconnect.

**`index.ts`** wires it, and calls `sessionChanged` when a hook records a new session.

**Frozen in:**
- `a46-pane-conversation.native.test.ts`: the real reader over fixture JSONL, an injected watcher, fake timers for the throttle;
- `a46-pane-conversation-gateway.native.test.ts`;
- `c5-generated-kotlin.test.ts`.

**Not frozen:** a pane hidden from the phone. On main the phone sees every pane its workspaces topic lists, so there is no hidden pane to build; HML's M10 run covers the real app.

## BE-A67-c5: the workspace colour on the phone (T-A67.1)

This is `ccr-a67-workspace-color.md` (#693).
- `desktop.ts` selects `color`.
- `toWorkspace` sends `color = workspaceColorIndex({ id, color })`, always between 1 and 8.
- `protocol.ts` gets `RemoteWorkspace.color?: number`.
- The proof is MOBILE's frozen tests in #699: `a67-workspace-color-mapper.test.ts` and `a67-workspace-color-gateway.native.test.ts`.

## Generated Kotlin

**`c5-generated-kotlin.test.ts`** (a marked source assertion) checks:
- the two optional fields;
- the page and args data classes;
- `reason` stays a `String?`;
- the enum count stays at 9.

**`tests/android-generated.test.ts`** (in every task's verify) checks that the committed file is current.

## Order

The three tasks are independent of each other and of F4, so they can run in parallel. MOBILE-A45, MOBILE-A46 and MOBILE-A67 each wait for theirs.

## M5 changes (08/11)

**MOBILE F1, approved by TECH LEAD.**
- The desktop's hello, sent from the server to the phone, gains `features?: string[]` with `"terminal.snapshotOnly"` and `"pane.conversation"`. The client hello stays strict.
- The phone sends `snapshotOnly`, and subscribes to `paneConversation`, only when the hello listed the feature. A 1.4.x desktop refuses any unknown subscribe key with `malformed`, so the phone must check first.
- Frozen in a45.

**HML-706-1.** A last line without its newline (a writer mid-append) is left out, with no error. Once it is complete it appears exactly once, and Load earlier never repeats it.

**HML-706-2.** On a 50 MB session, the newest page and each Load earlier read at most 9 MiB, the reader's 8 MB cap plus slack. This is counted by a pass-through spy on file reads.

**HML-706-3 (a pane kept off the phone)** becomes BE-CR34 below.

## BE-CR34: Show on phone, per pane (TECH LEAD on HML-F10-1)

**The setting**
- `RemoteGateway.setPhoneHidden({ paneId, hidden })` returns `RemoteGatewayStatus`, which gains `phoneHiddenPanes: string[]`.
- Every pane is shown by default.
- It is stored in migration 096 (`remote_hidden_panes`; re-check the number before execute) and lasts across restarts.

**Hiding a pane**
- It also turns typing from the phone off. Typing can't be turned on for a hidden pane.
- The pane leaves the workspaces topic.
- A terminal subscribe gets the same error an unknown pane gets.
- `pane.conversation` and the `paneConversation` topic answer `no-conversation`.
- An open stream ends with `{ type: 'error', code: 'not-found', subscription, reason: 'pane-hidden' }`. These two additive fields on `RemoteErrorFrame` let the phone show DESIGN's Notice.

**Guards**
- Audit action `phone-hidden`, with outcome `on` or `off`, written only when the setting changes.
- IPC `remote:set-phone-hidden`, under `remote.gateway_admin`, which is forbidden in MCP. It is never a phone command.

**Frozen in** `cr34-pane-hidden.native.test.ts` (through the gateway) and `cr34-agents-topic.test.ts`. The second uses `createTopics` with a fake desktop: a hidden pane's agent row never reaches the phone, in the snapshot or in an event, and comes back when shown.
