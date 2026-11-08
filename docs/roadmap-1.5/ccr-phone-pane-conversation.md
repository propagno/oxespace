# CCR (feasibility): a terminal agent's conversation on the phone (1.5.0, phone phase)

- **Owner:** BACKEND (design). The phone side is MOBILE's (M6 Terminal); the UI is DESIGN's.
- **Asked by:** the user, via TECH LEAD (07/11).
- **Status:** feasibility. **Verdict: feasible with what's on main.** No new reader, no new redaction and no new dependency. One additive C5 field, one new topic for following it live, and one command for older pages. It goes into the phone-phase inputs (`team/checklists/phone-phase-inputs.md`).

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
  /** Bumps when the pane's recorded session changes (a new conversation, e.g. /clear). Never the session id itself. */
  epoch: number
}
```

- **Command:** `'pane.conversation'` is added to `REMOTE_COMMANDS` / `RemoteCommandArgs`, for "Load earlier" (with a `cursor`) and a manual refresh (without one). It counts against the per-device command rate like `thread.history`.

### Following it live (TECH LEAD's decision, 07/11: the user opens the app "para acompanhar")

A new topic, `'paneConversation'`, added to `REMOTE_SUBSCRIPTIONS`, with `target` = the pane id. The phone subscribes while the Conversation view is open.

```ts
/** snapshot.data: the newest page, the same shape as the command's result. */
export type RemotePaneConversationSnapshot = RemotePaneConversationPage
/** event.data: only that something changed; never any content. */
export interface RemotePaneConversationEvent { changed: true }
```

- **Snapshot:** the newest page (the same as `pane.conversation` without a cursor), so opening the view is one subscribe. A subscribe to a pane without a conversation, or one the phone can't see, gets `no-conversation`, the same as the command.
- **Events:** `{ changed: true }` and nothing else, **throttled to at most one per 2 s per pane, with a 2 s max-wait** (HML-658-2). A burst gives one event at the end of its window, and a steady stream of appends gives one every 2 s, never none (a plain trailing debounce would starve while the agent keeps writing).
  - It's sent only to the phones subscribed to that pane's `paneConversation`. A phone on the pane's `terminal` topic alone gets nothing.
  - It fires when the session file grows or is rewritten, and when the pane's recorded session changes (the agent started a new one).
- **On an event,** the phone fetches the newest page (`pane.conversation` without a cursor) and merges by `item.id`. If the session changed, the fetch shows it: a new first page, or `no-conversation`.
- **Watching:** one watcher per pane, whatever the number of phones, started by the first subscriber and closed with the last (and on unsubscribe, disconnect or pane close).
  - It's `fs.watch` on the session file, with a size and mtime check before sending, because `fs.watch` can fire for nothing.
  - The import goes on the fs-allowlist, or uses an allowlisted module.
  - The file's path stays in main.
- **No resume:** `sinceSeq` and `cursor` on this topic are ignored, so a resubscribe gets a fresh snapshot.
- **Same read rule** as the `terminal` topic. An older desktop refuses the unknown topic, and the phone only subscribes when `RemotePane.conversation` is true.
- **Error codes,** as inline literals (the #531 rule):
  - `no-conversation`: the pane has no readable session now (none recorded, the file is gone, or Codex without a rollout);
  - `conversation-changed`: the file was **rewritten or truncated** under the cursor, so start again from the newest page. This is `readNativeHistoryPage`'s "Native history changed" error.
    - It carries an optional `reason?: 'new-session' | 'rewritten'` (MOBILE's M5; inline literals, no enum). `new-session` means the handle belongs to a session the pane no longer has (the agent started a new one); `rewritten` means a rewrite or truncate. An unknown or absent reason reads as `rewritten`.
  - **An append is not a change** (HML-658-1). A working agent appends every few seconds, and "Load earlier" must keep working while the person follows it. `readNativeHistoryPage` already keeps an older cursor valid on an append (checked on main 07/11):
    - the identity is unchanged;
    - the size is ≥ the cursor's;
    - the fingerprint covers the first and last 64 KB of the cursor's own size, which an append doesn't touch;
    - the mtime check applies only when the size is unchanged.
    So the desktop must not add its own stricter check.
  - An unknown pane, or one the phone can't see, gives the same `no-conversation`, so it never tells whether a pane exists.
- **Older desktop:** no `conversation` field means no toggle on the phone. **Older phone:** ignores the field (`ignoreUnknownKeys`).

### The cursor stays on the desktop

`NativeHistoryCursor` holds the file's identity and size, so it never crosses to the phone. The desktop keeps a per-device map from an opaque handle to `{ paneId, sessionId, cursor }`:
- the handle is 32 random base64url characters;
- the map holds at most 8 handles per device, the oldest dropped first;
- each handle lives 10 minutes and is cleared when the device disconnects;
- a handle is bound to its device, pane and session: used for another pane, another session (the agent started a new one), or another device, it gives `conversation-changed`. A handle whose session is no longer the pane's gives `reason: 'new-session'`; a rewrite or truncate under it gives `reason: 'rewritten'`.

### Paging and caps

- **Page size:** 50 items (`REMOTE_TEXT_LIMITS.threadPage`), also fitted to the frame budget by `fitPage`. The reader's page is up to 250 events, so the desktop keeps the remainder under the same handle and serves it before reading further back.
- **Item text:** cut to `itemText` (8 000 characters), with `truncated` set, exactly as in threads.
- **Cost:** a page is at most one reader call (bounded by the reader's own 8 MB I/O and 2 MB payload caps), in the worker, never on the main thread.
- **Live, without streaming content:** the `paneConversation` events carry no text. Content only moves through the page reads above, at most one newest-page fetch per event, so at most one every 2 s per pane.

### What the phone shows (MOBILE; DESIGN decided 07/11, #658 review, ACs M6.11–M6.14)

> **DESIGN's decisions** (review on #658; picture in the phone playground #627, `#phone-terminal`):
> - **The control:** a **segmented control**, *Screen · Conversation* (pt-BR *Tela · Conversa*). It's M3 `SingleChoiceSegmentedButtonRow`, full width, 48 dp, under the app bar, as a radio group named "View".
> - **Default view:** **Conversation** on a pane that has one; Screen is one tap away.
> - **Caption:** "Claude Code's conversation · read only" / "Codex's conversation · read only", plus a **Live** mark while following.
> - **New items while scrolled up:** T100's **Latest** chip with a count of new ids only ("3 new · Latest ↓"). A message growing in place doesn't count. After a gap, the chip shows no count.
> - **Refresh:** pull to refresh, not a header button.
> - **Input:** the key row and input show only on Screen. Conversation shows a tappable "Type on the Screen view" hint on a pane the phone may type in.
> - **The Notice** has the action **Show the screen**.
> - Copy in en and pt-BR is in DESIGN's review.
>
> **Correction for v1:** the reader sends text messages only (user and assistant), so Conversation has **no tool or step items**. M4's "steps" chip doesn't apply here; it shows plain bubbles.
>
> Where the bullets below differ, DESIGN's decisions win.

- **M6 Terminal,** on a pane with `conversation: true`: a **Screen · Conversation** toggle above the view.
  - Conversation subscribes to `paneConversation` (the snapshot is the newest page) and follows it. It offers "Load earlier" at the top, as in OxeChat.
  - **On each `changed` event** it fetches the newest page and merges it (MOBILE's M5):
    - an item whose id it already holds **replaces** the held one in place, because a live agent message grows under the same `native:<uuid>`, exactly as thread items do;
    - new ids append;
    - **no overlap:** if the newest page shares no id with what's held (more than a page of new items, for example after a reconnect), the held items are replaced by that page and "Load earlier" walks back from there, so there's no silent hole.
  - **Coalescing:** while a fetch is in flight, further `changed` events queue at most one more fetch. Each fetch is a `pane.conversation` command against the per-device command rate.
  - **Order** is the page order, never `seq` across pages (`seq` is page-local).
  - **Scroll:** a pure `follow(atBottom)` decision, as in T100: at the bottom it follows new items, otherwise it never jumps. The scrolling itself is UI.
  - **Switching views** (MOBILE): each view keeps its own position while that terminal is open. Conversation keeps its scroll and loaded pages; Screen keeps its follow-the-bottom state (T97). Leaving the terminal resets both.
  - Messages render like OxeChat's user and assistant bubbles. A cut message (`truncated`) says so, as in threads.
  - The caption under the control says "Claude Code's conversation · read only" / "Codex's conversation · read only", with a **Live** mark while following. **Pull to refresh** reloads the newest page.
- **No conversation:** on a pane without `conversation`, there's no toggle; the screen stays as today.
  - If the field disappears while open (the agent exited and no session is readable), Conversation shows a Notice: "This terminal's conversation isn't available any more. The screen is still live."
  - **A new session is not "unavailable"** (HML-658-4). When a page's `epoch` differs from the held one (the agent started a new conversation, e.g. `/clear`), the held items are replaced by the new page and an **inline marker line** (not a Notice card; DESIGN, AC M6.15) says "The agent started a new conversation" (pt-BR "O agente começou uma nova conversa"; DESIGN may adjust). The view already shows the new conversation, so there's no button.
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
   - a rewritten file under the cursor gives `conversation-changed`;
4b. **Append keeps the cursor** (HML-658-1): take page 1, append 20 messages, then "Load earlier" to `cursor: null`. Every original message comes back once, with no repeated or skipped id, and no `conversation-changed`.
4c. **Truncate:** a file truncated below the cursor's size gives `conversation-changed` with `reason: 'rewritten'`.
4d. **New session:** after the pane's recorded session changes, "Load earlier" with an old handle gives `conversation-changed` with `reason: 'new-session'`, and the next newest page has a higher `epoch`.
   - a handle expires after 10 minutes;
   - there are at most 8 per device.
5. **No spawn:** for Codex without a rollout, no process is started (a spy on the transport), and the result is `no-conversation`.
6. **Hidden panes:** a pane id not in the phone's workspaces, and an unknown id, both give `no-conversation`.
7. **Protocol:** `RemotePane.conversation` is optional; the command, the topic and both error codes are literal types; the generated Kotlin has no new enum.
8. **Live, events:**
   - with a phone subscribed to `paneConversation`, one append gives exactly one `{ changed: true }` within 2 s, and a burst still gives one per window;
   - **no starvation:** appends every 200 ms for 30 s (fake timers) give 14–16 events, never 0.
9. **Live, only subscribers:** a phone subscribed to the pane's `terminal` topic only, or to another pane's conversation, gets nothing.
10. **Live, no content:** the event's data is exactly `{ changed: true }`, with no text, path or session id.
11. **Live, lifetime:** one watcher per pane for two phones; it's closed when the last one unsubscribes or disconnects; a pane's new session sends one `changed`, and the next page has a higher `epoch`.

**Phone** (MOBILE's JVM tests):
1. `conversation: true` → the toggle shows; `conversation: false` → none;
2. "Load earlier" walks pages to `cursor: null` with no duplicate ids, and the held list is in the asserted order (page order, oldest first), never sorted by `seq` across pages;
3. `conversation-changed`:
   - `reason: 'new-session'`, or a page whose `epoch` differs from the held one: load the newest page, replace the held items, and show the inline marker line "The agent started a new conversation", never the unavailable Notice;
   - `reason: 'rewritten'` (or no or unknown reason): reload once, then show the unavailable Notice if it fails again;
4. the field absent (an older desktop) → no toggle;
5. a `changed` event fetches the newest page:
   - items with a known id replace the held ones in place, and new ids append, with no duplicates;
   - while a fetch is in flight, further `changed` events queue at most one more fetch;
6. **no overlap:** a newest page that shares no id with the held items replaces them, and "Load earlier" then walks back from that page;
7. `follow(atBottom)`: not at the bottom → no jump; at the bottom → follow.

## Done includes a real-app run (HML-658-3, M10)

The fakes prove the contract, not the wire. "Done" includes HML's CI acceptance spec on windows-2022, on the real app with R143's stand-in phone (`scripts/remote-subscribe.mts`):
- the flag and the snapshot;
- busy appends give one `changed` per window, merged by id;
- "Load earlier" works while the agent is busy;
- a planted secret is redacted, and no path appears in any frame;
- a phone on the terminal topic only gets nothing.

**How the pane gets a recorded session with no paid agent:** BACKEND's recommendation is the hook path, as the S7.1 acceptance spec (#441) does:
- launch the app with a temp `CLAUDE_CONFIG_DIR`;
- write a fixture `projects/<encoded cwd>/<uuid>.jsonl` there;
- from inside the pane's own terminal, post a Claude SessionStart with that `session_id` to the real hook server, with the pane's execution credentials.

That records the session exactly as Claude Code would. The appends are then plain writes to the fixture file. No `claude` binary is needed.

## Open questions

- **Answered (DESIGN, 07/11):** a segmented control, not tabs, with the copy in DESIGN's review on #658 (ACs M6.11–M6.15).
- **Answered (MOBILE, 07/11):** switching views keeps each view's own position while the terminal is open (§ What the phone shows).
- **Decided (TECH LEAD, 07/11):** the live tail is in v1, minimal and content-free (§ Following it live).
