# CCR (feasibility): a terminal agent's conversation on the phone (1.5.0, phone phase)

- **Owner:** BACKEND (design). The phone side is MOBILE's (M6 Terminal); the UI is DESIGN's.
- **Asked by:** the user, via TECH LEAD (07/11).
- **Status:** feasibility. **Verdict: feasible with what's on main.** No new reader, no new redaction and no new dependency. One additive C5 field and one new command. It goes into the phone-phase inputs (`team/checklists/phone-phase-inputs.md`).

## Problem

The user opened a pane running Claude Code on the phone. It shows only the current screen, and they can't scroll back; in OxeChat they can page back through the history.
- **Cause:** a full-screen agent CLI runs on the terminal's alternate screen, which has no scrollback, on the desktop too.
- **So the P4 snapshot can only carry the screen.** No terminal fix can bring the history back.
- **The history does exist:** it's the agent's own session file, which OxeChat already pages with `NativeSessionReader`.

## What's on main to reuse

| Need | On main |
|---|---|
| The pane's session | `PaneAgentSessions.current(paneId)` → `{ agent: 'claude' \| 'codex', sessionId, source }` (`agent-state/pane-sessions.ts`, table `pane_agent_sessions`). It's learned from the agent's hooks (SessionStart) or the launch; it's what "restore session" uses. Ids are provider UUIDs only (`NATIVE_SESSION_ID`). |
| The pane's cwd | the start cwd `terminal.service.ts` passes to `planPaneResume` / `nativeSessionExists`; the reader checks the session's own `cwd` against it (`sameRoot`) |
| Reading a page | `NativeSessionReader.read(thread, id, cursor?)` (`conversation/native-session-history.ts`), run in the native-history worker (`NativeHistoryWorkerClient`, at most 16 pending, 30 s timeout). It reads backwards through `readNativeHistoryPage` (at most 8 MB of I/O and 2 MB of payload per page). Its `NativeHistoryCursor` is server-owned: file identity, size, fingerprint. It returns `ThreadEvent`s: user and assistant text messages, plus turn ends for Codex. Tool calls and results are not included. |
| Phone items and redaction | `threadItems(events, roots)` and `fitPage(...)` in `remote/topics.ts`: the same mapping, redaction (`redactCounted`, `scrubPaths` with the workspace roots), `REMOTE_TEXT_LIMITS.itemText` cut and frame budget as conversation threads |
| Paging on the phone | OxeChat's "Load earlier" over `thread.history` (`beforeSeq`, pages of `REMOTE_TEXT_LIMITS.threadPage` = 50) |

## Design

### Which panes have a conversation

A pane has one when all of these hold:
- `PaneAgentSessions.current(paneId)` returns a Claude or Codex session;
- the session's file exists for the pane's cwd (`nativeSessionExists`);
- the phone can already see the pane (it's in the `workspaces` topic). This is the terminal topic's read rule. `phoneWrite` gates writes only, and this is a read.

**Codex without a rollout file:** OxeChat then spawns `codex app-server` to ask for `thread/read`. **A phone request never spawns a process on the desktop**, so for the phone that pane has no conversation.

### C5 protocol (additive; `npm run android:generate`, Kotlin committed, no new enum)

```ts
export interface RemotePane {
  // …as today
  /** The pane runs Claude Code or Codex with a session the desktop can read: the phone may offer "Conversation". */
  conversation?: boolean
}

/** Read-only, paged: the agent's own conversation in a pane, newest page first. `ack.result` is a RemotePaneConversationPage. */
export interface RemotePaneConversationArgs { paneId: string; cursor?: string }
export interface RemotePaneConversationPage {
  agent: 'claude' | 'codex'
  title?: string
  /** Oldest to newest within the page. `seq` is page-local; dedupe by `item.id` (`native:<uuid>`), which is stable. */
  items: { seq: number; item: RemoteThreadItem }[]
  /** Opaque, for "Load earlier"; null when this is the oldest page. */
  cursor: string | null
}
```

- **Command:** `'pane.conversation'` is added to `REMOTE_COMMANDS` / `RemoteCommandArgs`. It counts against the per-device command rate like `thread.history`.
- **Error codes,** as inline literals (the #531 rule):
  - `no-conversation`: the pane has no readable session now (none recorded, the file is gone, or Codex without a rollout);
  - `conversation-changed`: the file changed under the cursor, so start again from the newest page. This is `readNativeHistoryPage`'s "Native history changed" error.
  - An unknown pane, or one the phone can't see, gives the same `no-conversation`, so it never tells whether a pane exists.
- **Older desktop:** no `conversation` field means no toggle on the phone. **Older phone:** ignores the field (`ignoreUnknownKeys`).

### The cursor stays on the desktop

`NativeHistoryCursor` holds the file's identity and size, so it never crosses to the phone. The desktop keeps a per-device map from an opaque handle to `{ paneId, sessionId, cursor }`:
- the handle is 32 random base64url characters;
- the map holds at most 8 handles per device, the oldest dropped first;
- each handle lives 10 minutes and is cleared when the device disconnects;
- a handle is bound to its device, pane and session: used for another pane, another session (the agent started a new one), or another device, it gives `conversation-changed`.

### Paging and caps

- **Page size:** 50 items (`REMOTE_TEXT_LIMITS.threadPage`), also fitted to the frame budget by `fitPage`. The reader's page is up to 250 events, so the desktop keeps the remainder under the same handle and serves it before reading further back.
- **Item text:** cut to `itemText` (8 000 characters), with `truncated` set, exactly as in threads.
- **Cost:** a page is at most one reader call (bounded by the reader's own 8 MB I/O and 2 MB payload caps), in the worker, never on the main thread.
- **No live stream in v1:** the terminal screen is the live view. "Conversation" is opened, refreshed (a page with no cursor), and paged back.

### What the phone shows (MOBILE, DESIGN to confirm)

- **M6 Terminal,** on a pane with `conversation: true`: a **Screen · Conversation** toggle above the view.
  - Conversation opens on the newest page and offers "Load earlier" at the top, as in OxeChat. It's read-only; there's no composer, since typing still goes to the terminal through `terminal.write` when allowed.
  - Messages render like OxeChat's user and assistant bubbles. A cut message (`truncated`) says so, as in threads.
  - The header says "From Claude Code's own session" / "From Codex's own session". A refresh control reloads the newest page.
- **No conversation:** on a pane without `conversation`, there's no toggle; the screen stays as today.
  - If the field disappears while open (the agent exited, or a new session started), Conversation shows a Notice: "This terminal's conversation isn't available any more. The screen is still live."
  - `no-conversation` gives the same Notice.
  - `conversation-changed` reloads from the newest page once, then shows the Notice if it fails again.

### Redaction and privacy

- **Same as threads:** `threadItems` with the workspace roots, a second pass of `redactCounted`, and paths outside the roots scrubbed. No new rule is needed.
- **Text messages only:** tool calls, tool results, sidechains and meta records are already left out by the reader. That's less than the terminal screen can show.
- **Nothing is written,** and nothing is spawned.
- **Never a path:** the session's file path, the cwd and the cursor stay on the desktop.

## Tests to freeze (phone phase)

**Desktop** (unit and integration; **temp dirs only**: a fake `claudeHome` / `codexHome` with fixture JSONL, never the user's `~/.claude` or `~/.codex`):
1. **The flag:** `conversation` is true only for a pane with a recorded Claude/Codex session whose file exists for its cwd. It's absent for a shell, an unknown agent, a missing file, and Codex without a rollout.
2. **Pages:**
   - the newest page, then "Load earlier" until `cursor: null`, gives every message once, oldest to newest within a page;
   - pages fit 50 items and the frame budget;
   - a long message is cut with `truncated`.
3. **Redaction:** a key in a message is redacted, and a path outside the roots is scrubbed, exactly as `threadItems` does for a thread.
4. **Cursor:**
   - the handle is opaque and carries no path or size;
   - one from another device or pane gives `conversation-changed`;
   - an appended or rewritten file under the cursor gives `conversation-changed`;
   - a handle expires after 10 minutes;
   - there are at most 8 per device.
5. **No spawn:** for Codex without a rollout, no process is started (a spy on the transport), and the result is `no-conversation`.
6. **Hidden panes:** a pane id not in the phone's workspaces, and an unknown id, both give `no-conversation`.
7. **Protocol:** `RemotePane.conversation` is optional, the command and both error codes are literal types, and the generated Kotlin has no new enum.

**Phone** (MOBILE's JVM tests):
1. the toggle shows only with `conversation: true`;
2. "Load earlier" walks pages to `cursor: null` with no duplicate ids;
3. `conversation-changed` reloads once, then shows the Notice;
4. a desktop without the field shows no toggle.

## Open questions

- **For DESIGN:** a toggle or a tab? The wording of the header and the Notice.
- **For MOBILE:** keep the scroll position when switching back to Screen?
- **For TECH LEAD:** whether a later version adds a live tail. That would be an event on the `terminal` topic when the session file grows, debounced; it's left out of v1 on purpose.
