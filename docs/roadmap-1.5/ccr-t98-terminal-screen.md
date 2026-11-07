# CCR T98: a screen for the phone's terminal view (record, plus the phone-phase delta)

- **Owner:** BACKEND (design).
- **Status (07/11): shipped in v1.4.3**, as 1.4.3 P4, on both sides:
  - **desktop:** `121d9212` "the terminal's screen on subscribe", and `255f3970`, TECH LEAD's must-fix from #634;
  - **phone:** `a8b13b2b` "P4 a terminal opens on the desktop's own screen" (MOBILE's #639, landed via #644). It's in the protocol module, `mobile/android/protocol/src/main/kotlin/com/oxespace/mobile/protocol/live/TerminalBuffer.kt`.
- **This revision** replaces the first draft's `screen: { cols, rows, cursor, alternate, lines, scrollback }` with the shipped shape, `{ ansi, cols, rows }`. It records what exists and keeps only the two items that are not done (§ Phone phase).
- **Correction:** an earlier revision of this PR said the phone doesn't read `snapshot`. That search covered only `app/src/main`, so it was wrong; MOBILE and TECH LEAD pointed this out, with evidence.

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

- **Additive:** an older phone ignores the field (`ignoreUnknownKeys = true`). There's no enum in Kotlin.
- **Colours:** `ansi` keeps SGR.

## Desktop (on main, `electron/main/services/remote/terminal-snapshot.ts`)

- **Once per subscription** (subscribe, or a resubscribe with an unknown cursor), never per event.
  - The ring text the topic already releases (redacted, paths scrubbed, `escapeSafeCut`, `TerminalWindow.takeAll`, after `flushMs`) is replayed into a short-lived `@xterm/headless` Terminal at the pane's size.
  - `@xterm/addon-serialize` 0.13.0 serializes it, and the Terminal is disposed.
- **Sizes:** clamped to 500 × 200. Scrollback steps 200 → 50 → 0 to fit the frame budget. The field is left out only when the screen alone doesn't fit.
- **Second redaction layer:** the rendered text is redacted again (a two-colour secret, or one split by the wrap). If that finds anything, it falls back to the plain redacted rows, with the cursor kept.
- **Tests:** `tests/unit/remote-terminal-snapshot.test.ts` (12 cases) and `tests/integration/remote-subscribe-script.native.test.ts` (end to end over `scripts/remote-subscribe.mts`).

## Phone (on main, protocol module)

- **`TerminalBuffer.onSnapshot`:**
  - the first page's `snapshot` gives `screen.reset(snapshot.rows)` and then `screen.feed(snapshot.ansi)`;
  - that snapshot's `data` pages are skipped, while their `redacted` is still counted;
  - without `snapshot`, it reads the ring as before.
- **`VtScreen.reset(rows)`:** the screen is the last `rows` lines, so a CUP lands on the screen.
- **Tests:** `mobile/android/protocol/src/test/kotlin/com/oxespace/mobile/protocol/live/TerminalSnapshotTest.kt` covers scrollback plus the cursor, the alternate screen, and no snapshot.

## Phone phase: what is NOT done

1. **The grid's width.**
   - Today `VtScreen` is unbounded in width and ignores `cols`, so a full-screen TUI drawn for 120 columns wraps or overflows differently on the phone.
   - The phone phase fixes the grid to `cols` (wrapping at `cols`, as xterm did on the desktop) and gives the view a horizontal pan instead of reflowing.
   - **Frozen tests (MOBILE, JVM):**
     - for a `cols` = 120 snapshot of a TUI frame, no row of `lines()` / `text()` is longer than `cols`, the grid's width is `cols`, and the CUP column lands where the desktop put it. `VtScreen` trims trailing blanks, so a row's text may be shorter than `cols` (MOBILE's M5 wording);
     - a line longer than `cols` wraps at `cols`.
   - **Not frozen here:** a resize on a later event. No event carries a size today, so nothing could drive such a test. It comes with its own CCR if the desktop ever adds a resize field.
2. **Not sending the replay pages a phone will skip.**
   - Today the desktop sends the snapshot's `data` pages next to `snapshot` (the whole ring, up to about 345 KB a subscribe), and a phone that read `snapshot` throws them away.
   - **Proposed:** a capability flag in the subscribe (the phone says it reads `snapshot`). The desktop then sends only the `snapshot` page, with no ring pages. That page carries the snapshot's `redacted` count; the phone already sums `redacted` over a snapshot's pages, so one page works unchanged.
   - **Fallback:** when the flag is set but the snapshot can't be built (the headless build throws, returns null, or doesn't fit even with no scrollback), the desktop sends the ring pages as today. A flagged phone never gets an empty terminal.
   - The older phone keeps getting the pages.
   - This is a C5 protocol change: an additive optional field, with a literal type and no new enum (the #531 rule), plus `npm run android:generate`.
   - **Frozen tests:**
     - desktop: with the flag, no `data` page follows `snapshot`, and that page's `redacted` equals the ring's count; without it, it's as today;
     - desktop fallback: with the flag set and the build failing (a throwing serializer, a null result, or over the budget), the ring pages are sent as today, with no `snapshot`;
     - phone: it sends the flag, and it renders the same from `snapshot` alone.

## Out of scope

- Any write path: the terminal topic stays read-only.
- Scrollback beyond what `ansi` carries (200 rows at most).
