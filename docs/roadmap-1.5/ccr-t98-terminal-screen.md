# CCR T98: a screen for the phone's terminal view (1.5.0, phone phase)

- **Owner:** BACKEND (design). The OXE executor builds it from the phone phase's PLAN.json.
- **Status:** accepted by TECH LEAD on 04/11. MOBILE's side is T97 (#622, `VtScreen`).

## Problem

The `terminal` topic sends the pane's ring as raw text, already redacted (`TerminalWindow` in `services/remote/text.ts`, with a held tail so a secret split across two batches is still caught). A phone that opens a pane mid-session has no screen state: cursor moves, clears and TUI redraws land on an empty grid, and the view is garbage. T97 gives the phone a VT model. This CCR gives it a starting screen.

## Protocol (`shared/remote/protocol.ts`): additive, literal types only

```ts
export interface RemoteTerminalData {
  data: string
  truncated: boolean
  redacted?: number
  /** T98: the screen as it is now, on the LAST snapshot page only. Never on events. Absent when over budget. */
  screen?: RemoteTerminalScreen
}
export interface RemoteTerminalScreen {
  cols: number
  rows: number
  /** Zero-based, inside the viewport. */
  cursor: { x: number; y: number }
  /** True when a full-screen app (vim, less, a TUI) holds the alternate screen. */
  alternate: boolean
  /** The viewport, top to bottom, `rows` entries, each the line's text with trailing spaces trimmed. */
  lines: string[]
  /** Plain rows above the viewport (the main screen's, also when `alternate`), oldest first; at most 200. */
  scrollback?: string[]
}
```

- `data` stays exactly as it is, so older phones are unchanged.
- Events stay raw `data`: the phone applies them on top of the seeded screen.
- No enum is added. Kotlin gets plain fields (the #531 rule). Run `npm run android:generate` and commit `RemoteProtocol.kt` only, reverting line-ending churn.
- Colors are out of v1. If added later, they come as per-row runs `runs?: { start: number; end: number; fg: number | null; bold: boolean }[]` (fg 0–15), matching MOBILE's `VtRun`, never as per-cell objects.

## How main builds it, per snapshot only

Snapshots happen on subscribe and on a resubscribe with an unknown cursor. Never per event.

- **Agent panes** have a `PaneScreen` (`agent-state/screen.ts`, `@xterm/headless`, scrollback 200). Read its buffer: `buffer.active` lines, `cursorX`/`cursorY`, and `buffer.active.type === 'alternate'`. There is no extra parsing.
- **Every other pane:** replay the ring into a short-lived `@xterm/headless` Terminal at the pane's cols and rows (scrollback 200), read it the same way, then `dispose()` it. The ring is at most 256 KiB (`DEFAULT_RING_CAPACITY_BYTES`).
  - A wrapped ring can miss earlier mode state, such as an alt-screen enter before the ring's start. That is accepted: the phone corrects itself on the next redraw.
- **Line text:** `line.translateToString(true)`. A wrapped row (`isWrapped`) stays its own row in `lines`.
- `@xterm/headless` is default-imported (see the agent-runtime note).
- **No new dependency:** no `@xterm/addon-serialize` in v1.

## Redaction, two layers (SECURITY review required)

1. **Before the replay:** only text that went through the same `clean()` as `data` (redaction plus path scrub, `REMOTE_TEXT_LIMITS`-free) is written into the replay Terminal. What is on screen never held a secret in clear.
   - `PaneScreen` is fed raw bytes by the agent-state engine, so for agent panes layer 2 is the only layer. The frozen tests must cover that case explicitly.
2. **After:** `scrollback` and `lines` are joined in order, with wrapped rows joined without a newline so a secret broken by the wrap is whole again. The text then goes through `redactCounted` and `scrubPaths`, and is split back into the same rows.
   - A row that changes length stays a row; the phone renders text, not cells.
   - The count is added to the page's `redacted`.

## Caps

| Limit | Value |
|---|---|
| Viewport | at most 200 columns × 80 rows. A larger pane is cut to its last 80 rows and first 200 columns, and `cols` / `rows` report the cut size. |
| `scrollback` | at most 200 rows |
| The whole `screen` | must fit `REMOTE_TEXT_LIMITS.terminalChunk` (32 000 characters) and the frame budget with the page's `data` |

Over the budget, drop in this order:
1. `scrollback`, oldest first;
2. then the whole `screen`.

`data` is never dropped for `screen`.

## Cost

- Agent panes: nothing beyond reading the buffer.
- Other panes: one replay of at most 256 KiB per snapshot, and only for a pane a phone opens. The phone watches one pane at a time.
- No emulator is kept for shells, so N open panes cost nothing until one is watched.

## Tests to freeze (acceptance)

1. **Protocol:**
   - `RemoteTerminalData.screen` is optional;
   - `RemoteTerminalScreen` has exactly the fields above, with literal types;
   - the generated Kotlin has `screen` as a nullable data class, and no new enum.
2. **Seeding:**
   - a ring with `printf 'a\nb'`, a CUP move and a clear gives the expected `lines`, `cursor` and `alternate: false`;
   - `\x1b[?1049h` plus a frame gives `alternate: true`, with the main screen's rows in `scrollback`.
3. **Snapshot only:** `screen` is on the last snapshot page and never on an event frame.
4. **Redaction layer 1:** a key in the ring never appears in `lines` or `scrollback` (shell pane).
5. **Redaction layer 2:**
   - an agent pane whose `PaneScreen` holds a key in clear gets it redacted in `lines`, and the page's `redacted` counts it;
   - a key split across a wrapped row is caught.
6. **Paths:** an absolute path outside the roots on screen is scrubbed, exactly as in `data`.
7. **Caps:**
   - a 300 × 120 pane is cut to 200 × 80;
   - 500 scrollback rows are cut to 200;
   - over the frame budget, scrollback goes first, then `screen`, while `data` is still sent.
8. **Lifetime:** the replay Terminal is disposed after each snapshot (no growth over 50 snapshots), and no emulator exists for an unwatched shell pane.
9. **Older phone:** a snapshot without `screen` (old desktop) and an event are handled as today. This is MOBILE's T97 test; listed here for the plan.

## Out of scope

- Colors / runs (v2).
- Scrollback beyond 200 rows (the phone feeds `data` first for history, then lays `screen` over the viewport).
- Any write path: the terminal topic stays read-only.
