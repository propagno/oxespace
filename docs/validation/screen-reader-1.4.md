# Screen-reader script for 1.4 (NVDA on Windows, Orca on Linux)

A manual pass run **before each beta**, on the build being shipped, once with NVDA on Windows and once with
Orca on Linux. axe (`.github/workflows/a11y-axe.yml`) checks names, roles and contrast in the DOM. It cannot
check whether what a person hears makes sense, in the right order, at the right time. This script covers that
part.

Record each run in the table at the end. A step fails if the expected speech is missing, wrong, repeated
endlessly, or needs the mouse. File an issue for each failure and link it in the table.

## Setup

| | Windows | Linux (Ubuntu/Debian, GNOME) |
|---|---|---|
| Screen reader | NVDA 2024.4 or later, default settings, speech viewer on (NVDA menu › Tools › Speech viewer) | Orca 45 or later (`orca --replace`), default settings |
| Build | the beta installer, not `npm run dev` | the beta `.deb` or AppImage |
| Data | a fresh profile: run with `OXESPACE_DB_PATH` pointing to an empty folder, so the first-run guide shows | same |
| Also needed | one Git repository on disk; Docker Desktop with a PostgreSQL container for the OxePod and OxeQuery parts; a local HTTP endpoint for OxePost (for example `npx http-server`) (optional; mark those steps "not run" otherwise) | same, with Docker Engine |

Conventions: **NVDA** is the NVDA modifier (Insert or Caps Lock), **Orca** is the Orca modifier (Insert or
Caps Lock). "Say all" is NVDA+↓ / Orca+;. Leave browse mode off (NVDA+Space, Orca+A): OXESpace is an
application, and every step is done in focus mode. If a step only works in browse mode, mark it a failure.

Mode names: after F12 the Code mode is read as "OxeCode" and the Thread mode as "OxeChat". Until F12 is on
`main`, the old names are expected.

Each step lists what should be **heard**. The wording can differ slightly between readers. What must be the
same is the name, the role and the state.

## 1. Start and first run

1. Start the app. **Heard:** the window title, "OXESpace", then the focused control of the first-run guide.
2. Tab through the first-run guide. **Heard:** each of its three steps as a button or link with its name and
   whether it is done. Nothing unlabelled ("button", "graphic", "clickable") is heard on its own.
3. Ctrl+K. **Heard:** "Command palette" dialog, then the search field. Type "settings". **Heard:** the number
   of results or the first result's name as it is highlighted. ↓/↑ read each result. Escape closes the palette
   and focus goes back where it was, with that control read again.

## 2. Code mode

1. Create a workspace: Tab to "New workspace", Enter. **Heard:** a dialog with its name. The folder field is
   read with its label. Escape closes it and focus is back on "New workspace".
2. Create it for real (type the repository path, Tab to "Launch", Enter). **Heard:** focus lands in the terminal. NVDA
   reads the terminal as an edit area, and Orca as a terminal. Terminal output is not read continuously. That is
   expected: xterm has its own screen-reader mode, which this pass does not cover.
3. Press `/` with focus outside any field (Escape from the terminal first, then F6 or Shift+Tab until focus is
   in the sidebar). **Heard:** "Filter workspaces, search edit". Type a few letters; the list filters.
4. Ctrl+B. The sidebar folds. Ctrl+B again restores it. **Heard:** nothing is lost: focus stays on a visible
   control and is read again.
5. Open panels: Tab to "Open panels", Enter. **Heard:** "Panels" menu with its first item, and each item as a
   check menu item with its state (checked/not checked). Escape closes the menu and focus returns to "Open
   panels".
6. Open "Changes" from that menu. **Heard:** the panel's name. In the file tree, ↓/↑ read each file as a tree
   item with its status. Space marks a file reviewed. **Heard:** its checked state changes.

## 3. Thread mode

1. Switch mode: Tab to the "Application view" navigation, choose "Thread". **Heard:** "Thread, toggle button,
   pressed" (or "selected").
2. In the Thread sidebar, press `/`. **Heard:** "Filter threads, search edit". Tab onward. **Heard:** each
   project as a button with "expanded"/"collapsed", then each conversation row with its title and its state
   (Ready, Working, Needs you).
3. Tab to "Thread sidebar width". **Heard:** "separator" with its value. ←/→ change it, and the new value is
   read.
4. Start a conversation (Enter on "New thread in …", then "Create thread"). Focus lands in the composer.
   **Heard:** "Message, edit, multi line" and its placeholder.
5. Type a line, Shift+Enter, type another. **Heard:** the new line, and nothing is sent. Enter sends. **Heard,
   politely and once:** "The agent is working." and later "The agent finished." (or "The turn failed."). Typing
   is not interrupted by these announcements.
6. While the agent works, the timeline must not read every token. A burst of output must not flood the
   reader. Announcements are throttled to one every 2 s.
7. Approval: ask for something that needs a command approval. **Heard:** "The agent needs your input." The
   request card's buttons (Allow, Deny, and the others) are reached with Tab and read with their names. Answering
   returns focus to the composer.
8. Tab from the composer. **Heard, in order:** "Show thread commands", "Add to prompt", the model and permission
   controls, "Voice input", "Send". Enter on "Add to prompt" opens a menu. ↓ reads its items. Escape returns to
   the button.
9. Ctrl+F in a conversation. **Heard:** the find field, then the match count ("2 of 5") as you type.
10. Ctrl+/ in the composer. **Heard:** "Thread commands" list with the highlighted command. Escape closes it and
    the composer keeps its text.

## 4. OxeQuery mode

Containers moved to OxePod (section 5). OxeQuery holds connections, the schema tree, the editor and the grid.

1. Switch to OxeQuery from "Application view" (Ctrl+3). **Heard:** the mode button pressed, then the
   "Connections" list, or its empty state read as text (never only an icon).
2. Connect to the PostgreSQL container through OxePod (section 5, step 4). In the schema tree, ↓/↑/←/→ move
   through the tree. **Heard:** "tree item", the object name, its level and expanded/collapsed. Enter on a table
   opens it.
3. Result grid: Tab to the grid. **Heard:** "grid" with its name and row and column counts. Arrow keys move the
   active cell. **Heard:** the cell value with its column header, and NULL cells as "NULL". Shift+arrows extend
   the selection. **Heard:** "selected". Escape clears it. Ctrl+Home/Ctrl+End jump to the first and last cell.
   Enter opens "Row details". Its close button is reachable and returns focus to the grid.
4. Open "New connection". **Heard:** dialog name, and every field with its label and "required" where it
   applies. A connection error is read as an alert without moving focus.

## 5. OxePod mode

1. Ctrl+4. **Heard:** "OxePod, toggle button, pressed", then the OxePod sidebar. With Docker off, the explanation
   of what to do is read as text.
2. Tab into the sidebar. **Heard:** "Container engine" radio group with Docker/Podman and which is checked; the
   "Filter containers" search field; each Compose project as a region ("Project shop") and each container as a
   button with its name, state and port. The open container is read as current.
3. In a container, Tab to its tabs (Logs, Stats, Environment, Ports, Terminal, Command). **Heard:** "tab", its
   name and "selected". The live log is not read line by line; "Pause" and "Clear" are reachable.
4. "Connect in OxeQuery" in the "Database detected" card. **Heard:** the button name. Enter moves to OxeQuery with
   the connection open, and focus lands on a named control in OxeQuery, not on the page body.
5. "Remove…" and "Take down…" open a confirmation. **Heard:** the dialog title and what will be lost. Escape
   cancels and focus returns to the button.

## 6. OxePost mode

1. Ctrl+5. **Heard:** "OxePost, toggle button, pressed", then the "OxePost sidebar" with its empty-state text.
2. Tab to the request bar. **Heard:** the method as a combo box ("GET"), the URL field with its label, "Send".
   Ctrl+Enter or Enter on "Send" sends.
3. After the response arrives. **Heard, politely and once:** the "Response summary" status with the code, time
   and size ("200 OK, 25 ms, 26 B"). Focus does not jump. Tab reaches the response tabs (Body, Headers, Cookies),
   read as tabs with their counts.
4. "Environments" opens a dialog. **Heard:** its title, each variable row field as "Name, row 1" / "Value, row 1".
   A production environment asks before sending, and that question is read as a dialog.

## 7. Motion and the boot splash

1. Settings › Appearance › Motion: **Heard:** a group with System / Reduced / Full and which one is selected, then
   its hint. Choosing Reduced changes nothing that is spoken, and focus stays on the choice.
2. Start the app with the reader on. **Heard:** the boot splash is read once as "OXESpace" (status) at most, and is
   never read again after the app replaces it.

## 8. Settings, dialogs and notifications

1. Ctrl+, opens Settings. **Heard:** the settings heading, then "Settings categories" navigation. Each category
   is a button. The current one is read as current or pressed. "Close settings" is reachable with Tab and
   with Escape.
2. Every dialog opened during the run (New workspace, New thread, Delegate work, confirmations): **heard** with
   its title when it opens; Tab never leaves it; Escape closes it; focus returns to the control that opened it.
3. A toast (for example, after a failed optimistic action): **heard** once, politely, without moving focus. Its
   action ("Try again") is reachable with the keyboard.
4. Busy states: wherever a spinner shows, the reader hears a status text ("Loading…", "Refreshing") or nothing.
   It never hears "graphic" or an unlabelled image.

## 9. High contrast (forced colors)

Not a screen-reader step, but done in the same session because it uses the same machine.

- Windows: Settings › Accessibility › Contrast themes › "Night sky" (or "Desert"). Linux: GNOME Settings ›
  Accessibility › High Contrast. Electron follows the OS setting.
- Check: every focused control has a visible ring (Highlight color); the highlighted menu item and the selected
  row are visible; disabled controls are greyed; status dots and the usage ring are visible; dialogs and menus
  have a visible edge. The rules for this live in `src/styles/forced-colors.css`.

## Record

| Date | Build | Reader and OS | Sections run | Failures (issue links) | By |
|---|---|---|---|---|---|
| | | NVDA · Windows 11 | 1–9 | | |
| | | Orca · Ubuntu 24.04 | 1–9 | | |
