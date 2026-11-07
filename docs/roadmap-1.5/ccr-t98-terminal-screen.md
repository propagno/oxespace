# CCR T98: a screen for the phone's terminal view (1.5.0, phone phase)

- **Owner:** BACKEND (design).
- **Status (07/11):**
  - **the desktop side is on main:** 1.4.3 P4, commits `121d9212` ("the terminal's screen on subscribe") and `255f3970` (TECH LEAD's must-fix from #634);
  - **what's left is the phone consumer** (MOBILE). MOBILE's VT model, T97, is also on main (#637, the release twin of #622).
- **This revision** replaces the first draft's `screen: { cols, rows, cursor, alternate, lines, scrollback }`. TECH LEAD asked for the P4 shape, `{ ansi, cols, rows }`. Nothing new is designed here; this CCR states the contract the phone phase builds against.

## Problem

A phone that opens a pane mid-session has no screen state. Cursor moves, clears and TUI redraws land on an empty grid. T97 gave the phone a VT model, and P4 gave the desktop a starting screen. The phone still ignores it (on origin/main, `mobile/android/app/src/main` doesn't read `snapshot`).

## Protocol (on main, `shared/remote/protocol.ts`)

```ts
export interface RemoteTerminalData {
  data: string
  truncated: boolean
  redacted?: number
  /** 1.4.3 P4: on the FIRST page of a snapshot only (a page of its own: its `data` is empty), never on an event. */
  snapshot?: RemoteTerminalSnapshot
}
/** xterm's own serialization: up to 200 rows of scrollback, then the screen, the modes (alternate screen) and the cursor. */
export interface RemoteTerminalSnapshot { ansi: string; cols: number; rows: number }
```

- **Additive:** an older phone ignores the field (`ignoreUnknownKeys = true`) and reads `data` as before. Kotlin already has it in `RemoteProtocol.kt`, with no enum.
- **Colours are in:** `ansi` keeps SGR. The first draft's "colours out of v1" no longer applies.

## How main builds it (on main, `electron/main/services/remote/terminal-snapshot.ts`)

- **Once per subscription** (subscribe, or a resubscribe with an unknown cursor), never per event.
  - The ring text the topic already releases (redacted, paths scrubbed, `escapeSafeCut`, `TerminalWindow.takeAll`, after `flushMs`) is replayed into a short-lived `@xterm/headless` Terminal at the pane's size.
  - Then `@xterm/addon-serialize` 0.13.0 serializes it, and the Terminal is disposed.
- **Sizes:** clamped to 500 × 200. Scrollback steps 200 → 50 → 0 to fit the frame budget. When even the screen alone doesn't fit, the field is left out.
- **Second redaction layer:** the rendered text is redacted again (a secret printed in two colours, or split by the wrap). If that finds anything, the snapshot falls back to the plain redacted rows, losing colours, with the cursor kept.

## The phone's side (MOBILE, phone phase)

On a terminal snapshot whose first page has `snapshot`:
1. Reset the `VtScreen` to `cols` × `rows`.
2. Feed `ansi` once.
3. Skip that snapshot's remaining `data` pages; they're the same ring.
4. Apply events as today.

Without `snapshot` (an older desktop, or over the budget), behave as today.

Resizing the phone's view reflows nothing on the desktop; the view scales or scrolls the grid.

## Tests

**On main already (desktop):** `tests/unit/remote-terminal-snapshot.test.ts` covers:
- the escape-safe cut;
- the split OSC;
- the replay and serialize;
- the alternate screen;
- the 200-row cap and size clamps;
- a two-colour secret and a wrap-split secret;
- dispose, including on failure;
- the page of its own;
- the 200/50/0 step-down;
- the plain fallback.

`tests/integration/remote-subscribe-script.native.test.ts` covers it end to end over `scripts/remote-subscribe.mts`.

**To freeze for the phone phase (MOBILE's JVM tests):**
1. A first snapshot page with `snapshot` resets the grid to its size, and the `ansi` from a TUI fixture (alternate screen, cursor, colours) renders the expected rows.
2. The snapshot's `data` pages are skipped after `snapshot`, so there's no double content. The next event applies on top.
3. Without `snapshot`, the view is exactly as today (T97's tests unchanged).
4. An unknown future field next to `snapshot` is ignored.

## Out of scope

- Any write path: the terminal topic stays read-only.
- Scrollback beyond what `ansi` carries (200 rows at most).
