# CCR (phone phase, 1.5.0): the terminal grid at `cols`, and the CLI conversation

- **Owner:** MOBILE (oxespace-29).
- **Acceptance:** A45 (phone side) and A46 (phone side).
- **Phase:** Fase 10, Celular.
- **Status:** draft. DESIGN reviews the UI, and HML reviews the field question (M10), before any execute.
- **Depends on BACKEND, with each piece's C5 contract plus `android:generate`:**
  - **A45:** the snapshot capability flag in the subscribe. It's specified in #623
    (`docs/roadmap-1.5/ccr-t98-terminal-screen.md`, merged).
  - **A46:** `RemotePane.conversation?`, the `pane.conversation` command, the `paneConversation` topic, `epoch`, and the
    `conversation-changed` `reason`. It's specified in #658 (`docs/roadmap-1.5/ccr-phone-pane-conversation.md`).
- **Also depends on:** CCR phone-screens (#688) for the `termAnsi*` tokens and the components.

## What's on main today

- `protocol/live/VtScreen.kt` (T97) and `TerminalBuffer.kt`, which already read `snapshot` (P4, 1.4.3). The width is
  **unbounded.**
- `ui/live/TerminalScreen.kt`: a LazyColumn of lines, with a horizontal scroll, following the bottom only while at the
  bottom.

## T-P3.1 The grid fixed at `cols` (A45, from #623's phone gap)

- **Files:**
  - `mobile/android/protocol/src/main/kotlin/com/oxespace/mobile/protocol/live/VtScreen.kt`:
    - `reset(cols, rows)`;
    - write wraps at `cols` (autowrap, as xterm does);
    - CUP and CHA clamp to `cols − 1`.
  - `.../protocol/live/TerminalBuffer.kt`: pass `snapshot.cols`.
  - `mobile/android/app/src/main/java/com/oxespace/mobile/ui/live/TerminalScreen.kt`:
    - the grid is exactly `cols` wide and pans sideways;
    - the edge hint "80 cols · swipe to pan" (HML-M1-8);
    - Aa toggles "fit the width";
    - nothing is clipped silently;
    - `termAnsi*` colours, the same in both themes.
- **Without a snapshot** (an older desktop): no `cols` is known, so the width stays unbounded, as in 1.4.3.
- **Frozen tests,** from #623:
  - `.../protocol/live/VtScreenTest.kt`, new cases:
    - no row of `lines()` or `text()` is longer than `cols`, and the grid width is `cols` (trailing blanks trim);
    - the CUP column lands where the desktop put it, with `cols = 120`;
    - a line longer than `cols` wraps at `cols`;
  - `.../protocol/live/TerminalSnapshotTest.kt`, new case: a snapshot with `cols = 80` makes an 80-wide grid; no
    snapshot leaves it unbounded;
  - `ScreensSnapshotTest.terminal`: an 80-column TUI on a narrow phone with the pan hint, plus fit-the-width.

## T-P3.2 The snapshot capability flag (A45, phone side)

- **Files:** `.../protocol/live/SubscriptionHub.kt`, which sends the flag on the `terminal` subscribe using BACKEND's
  generated field.
- **Behaviour:**
  - **With the flag,** the desktop sends `snapshot` with `redacted` and no ring pages. The phone renders the same as
    today.
  - **A desktop that doesn't know the flag** sends the pages, and the phone skips them as today.
  - **A desktop that fails to build the snapshot** falls back to pages with no snapshot, and the phone reads the ring.
    That's #623's frozen desktop fallback.
- **Frozen tests:**
  - `.../protocol/live/SubscriptionHubTest.kt` (new or extended): a `terminal` subscribe carries the flag; other topics
    don't;
  - `TerminalSnapshotTest`: a single snapshot page with `redacted` renders, and the count is kept.

## T-P3.3 The CLI conversation on the phone (A46, phone side, #658)

- **New files:**
  - `.../protocol/live/PaneConversation.kt`: the store, as specified in #658:
    - replace by id;
    - append new ids;
    - page order, never `seq` across pages;
    - a no-overlap reset;
    - `epoch` change → replace, plus the "new conversation" line;
    - `conversation-changed`: `rewritten` reloads once, then the Notice; `new-session` behaves as an epoch change;
    - fetch coalescing: at most one more queued while one is in flight;
    - `follow(atBottom)`.
  - `.../ui/live/PaneConversationView.kt`: text bubbles only in v1, with Load earlier and pull to refresh.
- **The view, as DESIGN pinned it (M6.11–M6.15, #627 @ 41ec3265):**
  - **Caption:** the agent's name and the conversation title, with the **Live** marker while the topic is subscribed.
  - **No input on Conversation.** In its place, the line "Type on the Screen view". Typing stays on the Screen view.
  - **The Latest chip:** "N new · Latest ↓" when the new ids are known. After a gap (a no-overlap reset or a new
    epoch) it reads "Latest ↓" with no count.
  - **A new session** is a marker line across the list ("New conversation"), not a card.
  - **Unavailable:** a Notice "This conversation isn't available any more" with the action **Show the screen**, which
    switches to Screen.
  - **The key row** on Screen keeps Esc · Tab · ↑ · ↓ · Ctrl, with **More keys** for the rest (c116b61c).
  - **A hidden secret** in a message shows the desktop's `[hidden]` with the note "Hidden on the computer", never the
    value.
- **Changed files:**
  - `.../ui/live/TerminalScreen.kt`: a **Screen · Conversation** segmented control, shown only when
    `pane.conversation == true`. Conversation is the default (DESIGN, M6.11–M6.14).
  - `.../session/LiveRepository.kt`: the `paneConversation` stream and the `pane.conversation` command.
  - The strings.
- **Frozen tests,** #658's phone list:
  - **new** `.../protocol/live/PaneConversationTest.kt`:
    1. toggle: `conversation` true shows it, false hides it;
    2. Load earlier walks to `cursor: null` in page order with no duplicate ids;
    3. `rewritten` reloads once, then the Notice; `new-session` or a new `epoch` replaces the items and shows the line;
    4. the field absent (an older desktop) shows no toggle;
    5. a `changed` event makes one newest-page fetch, coalesced, replacing known ids in place and appending new ones;
    6. no overlap replaces the held items and Load earlier walks back from there;
    7. `follow(atBottom)`: not at the bottom means no jump;
  - `ScreensSnapshotTest.terminal`, one snapshot per pinned state, in en/pt-BR × light/dark:
    - Conversation with the caption and Live, bubbles, Load earlier, and "Type on the Screen view" with no input;
    - the Latest chip "3 new · Latest ↓", and "Latest ↓" after a gap;
    - the new-conversation marker line;
    - the unavailable Notice with Show the screen;
    - Screen with the key row and More keys open;
    - a message with `[hidden]` and the "Hidden on the computer" note;
  - **new** `.../ui/live/PaneConversationStringsTest.kt`: every string above exists in en and pt-BR, and the
    unavailable Notice's action switches to Screen;
  - **emulator (API 36):** new `androidTest/.../ui/PaneConversationOnDeviceTest.kt`, against the in-test fake gateway:
    subscribe, snapshot, then `changed`, which makes one fetch and a merged list.

## Field question (M10, HML)

- **The limit, written down:** the CI stand-in phone talks to the gateway's LAN IP on the same runner. That's not
  loopback, but there's no Wi-Fi hop either. Real Wi-Fi loss is checked only on the user's S23, and that check is the
  user's.
- **Busy terminal:** `scripts/remote-subscribe.mts` against a desktop pane running a full-screen TUI at 120 columns.
  - The phone grid is 120 wide and pans.
  - A busy Claude Code session on the desktop shows its conversation on the phone, live.
  - No process is ever started by the phone (#658 test 5).
- **Throughput:** the TUI pane writes about 1 MB/s for 30 s while the stand-in subscribes.
  - The desktop pane stays responsive: keystroke echo under 100 ms.
  - The gateway's memory stays bounded.
  - The phone gets coalesced frames, and its final screen equals the desktop buffer's last `rows` lines.
- **Resize and the grid's edges:**
  - A resize from 120 to 80 cols mid-stream follows on the phone, through the next snapshot's `cols`.
  - An alt-screen enter and exit, and wide characters (CJK and emoji) at the 120-col edge, keep the grid aligned.
  - Frozen as new `VtScreenTest` cases: a wide character at the last column, and an alt-screen exit at `cols`.
- **At most one fetch per 2 s, counted:** the stand-in counts its `pane.conversation` requests over 60 s of a busy
  session.
- **Redaction and paging:** a secret in the conversation reaches the phone as `[hidden]`. A long transcript pages to
  `cursor: null` with no duplicates, as in #658.
- **N1 reconnect:** the stand-in's socket is killed mid-stream and resumed after 5 s. No lost or duplicated lines or
  messages, and the screen shows "reconnecting" and then recovers.
  - Frozen as `PaneConversationTest` test 6 (no overlap replaces the held items), plus the stand-in step
    `terminal-reconnect`.
- **N2 latency:** one stand-in case runs through a test-side proxy adding 300 ms ± 200 ms. The grid and the
  conversation settle, with no timeout a slow Wi-Fi would trip.
- **N3 P1:** on the Windows Public profile the gateway shows the firewall notice, not a silent failure (R143).

## Out of scope

- The xterm.js WebView renderer. It's an option only if the VT model isn't enough after HML's pass.
- Writing to the conversation from the phone; the terminal topic stays read-only.
- A desktop resize event: its own CCR, if the desktop adds one.
