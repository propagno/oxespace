# Offer audit for 1.4: every menu, palette and settings entry

Rule: every entry the app offers either works and makes sense, or it is gone. Each line is one entry with a
verdict and a one-line reason.

- **KEEP**: works, and its name says what it does.
- **FIX**: changed in this PR so it works or says what it does.
- **DISCARD**: removed in this PR.
- **MOVES**: works today, but belongs to another mode on the roadmap.

Coverage: `e2e/offer-audit.spec.ts` reads the palette and the application menu from their registries, not from a
hand-kept list. It runs each entry and checks for a visible effect and no page error. A new palette command or menu
item with no expected effect in the spec fails CI. Context menus that changed have their own cases.

## Application menu (title bar, Windows and Linux)

| Menu | Entry | Verdict | Reason |
|---|---|---|---|
| File | New workspace… (Code, OxeQuery) | FIX | Same name as the palette entry, which was "Create workspace". |
| File | Add project… (Thread) | KEEP | Opens Add project. |
| File | Settings | KEEP | Opens application Settings (Ctrl+,). |
| File | Workspace settings | FIX | Did nothing visible from Thread or OxeQuery. It now opens Code first. |
| File | Exit | KEEP | Closes the window. |
| Edit | Undo, Redo, Cut, Copy, Paste, Select all | KEEP | Native editing roles (6 entries). |
| View | Command palette… | FIX | Added. The palette was only under Help, as "Search files & commands". |
| View | Code / Thread / OxeQuery | KEEP | Switches the mode and shows a check mark on the current one (3 entries). |
| View | Toggle sidebar | KEEP | Collapses and expands the sidebar. |
| View | Files | KEEP | Opens the Files panel. |
| View | Commit & pull request | KEEP | Opens the source control panel. |
| View | Background activity | KEEP | Opens the background panel. |
| View | Toggle split layout | KEEP | Turns resizable splits on and off. |
| View | Balance panes | FIX | Called "Balance terminal panes" in the palette and "Balance splits" in the pane menu. One name now. |
| View | Appearance › System, Light, Dark | KEEP | App-wide mode, works without a workspace (3 entries). |
| View | Density › Compact, Comfortable | FIX | From another mode it changed a hidden view. It now opens Code first (2 entries). |
| View | Layout › 1…10 panes | FIX | Said "1 panes", and acted on a hidden Code view (6 entries). |
| View | Split pane right / Split pane down | FIX | The palette said "Split active pane (vertical)" and the pane menu said "Split vertical". One name now (2 entries). |
| View | Maximize / restore pane | FIX | The label only said "Maximize", but the item also restores. |
| View | Design system | DISCARD | A developer viewer for tokens. It does not belong in View. The palette entry is a decision, see below. |
| Tools | MCP servers | FIX | Moved here from Help. |
| Tools | Skills | FIX | Moved here from Help. |
| Tools | Usage & limits | FIX | Moved here from Help. |
| Tools | Linear issues | FIX | Moved here from Help. |
| Help | Search files & commands | DISCARD | Opened the palette, which is not help. It is under View as Command palette… now. |
| Help | Keyboard shortcuts | FIX | Added. The shortcut guide had no menu entry. |
| Help | Diagnostics | FIX | Added. It opens Settings › Diagnostics. |
| Help | About OXESpace (vX.Y.Z) | FIX | Was a disabled item that did nothing. It now opens Settings › Updates (version and check for updates). |

## Command palette (src/commands/*, OxeQuery, settings)

| Id | Entry | Verdict | Reason |
|---|---|---|---|
| new-workspace | New workspace… | FIX | Renamed from "Create workspace" to match File. |
| workspace-settings | Workspace settings | FIX | Showed Ctrl+, as its shortcut, but Ctrl+, opens application Settings. Did nothing visible from Thread or OxeQuery. |
| toggle-sidebar | Toggle sidebar | KEEP | Works in every mode. |
| tool-team | Team | KEEP | Opens Team. It is disabled, with a reason, when there is no project. |
| tool-integration | Multi-repo coordination | FIX | From Thread or OxeQuery it toggled a panel in the hidden Code view. It now opens Code and the panel. |
| tool-github | Commit & pull request | FIX | Same issue as tool-integration, same fix. |
| tool-worktrees | Worktrees | FIX | Same issue as tool-integration, same fix. |
| tool-scripts | Scripts | FIX | Same issue as tool-integration, same fix. |
| tool-search | Find in files | FIX | Same issue as tool-integration, same fix. |
| tool-web-preview | Browser | FIX | Same issue as tool-integration, same fix. |
| tool-background | Background activity | FIX | Same issue as tool-integration, same fix. |
| tool-editor | Files | FIX | Same issue as tool-integration. Running it a second time from another mode also closed a panel that was open in Code. |
| tool-review | Changes | FIX | Same issue as tool-integration, same fix. |
| tool-slash | Terminal commands | FIX | Opened without focus, because the closing palette took focus back, and Escape did not close it. |
| tool-mcp | MCP servers | KEEP | A dialog that opens over any mode. |
| tool-skills | Skills | KEEP | A dialog that opens over any mode. |
| tool-semantic | Semantic index log | KEEP | A dialog that opens over any mode. |
| open-linear | Linear issues | FIX | Moved from the "Git & Repo" category, which had no other entry, to Development. Shorter name. |
| find-in-files | Search files & commands | DISCARD | A palette entry that opened the palette. Find in files is tool-search. |
| balance-pane-layout | Balance panes | FIX | Renamed to match the menus. Opens Code first. |
| toggle-split-layout | Toggle split layout | FIX | Opens Code first. |
| open-usage | Usage & limits | FIX | Renamed to match the Tools menu. |
| design-system | Design System: Open Viewer | KEEP | It works. Whether users should see it is a decision, see below. |
| appearance-system / -light / -dark | Appearance: … | KEEP | App-wide (3 entries). |
| density-compact / -comfortable | Density: … | FIX | Open Code first (2 entries). |
| layout-1 … layout-10 | Layout: N pane(s) | FIX | Fixed "1 panes". They open Code first (6 entries). |
| split-vertical / split-horizontal | Split pane right / down | FIX | Named like the shortcut guide and the pane menu (2 entries). |
| maximize-pane | Maximize / restore pane | FIX | Renamed. Opens Code first. |
| toggle-oxevoice | Toggle voice input | FIX | "Toggle OXEVoice for active context" was jargon. "oxevoice" is still a search keyword. |
| restart-terminal | Restart terminal | FIX | Renamed. Opens Code first. |
| stop-terminal | Stop terminal | FIX | Was offered when the terminal was not running, and then did nothing. |
| settings.general … settings.diagnostics | Settings: <page> | KEEP | Each opens its own page (10 entries). |
| help.shortcuts | Show keyboard shortcuts | KEEP | Opens the shortcut guide. |
| thread.new | New conversation | KEEP | Opens New thread, or Add project when there is no project. |
| thread.add-project | Add Thread project… | KEEP | Opens Add project. |
| thread.project.<id> | Switch to project <name> | KEEP | Opens the latest conversation in that project. |
| thread.resume / rename / spending / events / rules | Composer commands | KEEP | Sent to the open conversation. The e2e checks that each one reaches it (5 entries). |
| thread.undo-last-turn | Undo the last turn's file changes | FIX | With no finished turn it did nothing and gave no message. It is now disabled in that case, and says "Nothing to undo" if it runs anyway. |
| thread.accounts | Provider accounts | FIX | With no project it did nothing. It is now disabled, and the sidebar button explains why. |
| oxequery.open | Open OxeQuery | MOVES | Databases stay here. The "Containers" part of its detail moves to OxePod (Q20/P1). |
| oxequery.newConnection | New database connection | KEEP | Opens New connection. |
| oxequery.newQuery | New query tab | FIX | With no connection open it did nothing. It now says what is needed, and it no longer clicks disabled controls. |
| oxequery.runAll | Run all statements | FIX | Same as newQuery. |
| oxequery.searchObjects | Search database objects | FIX | Same as newQuery. |
| oxequery.newTable | New table | FIX | Same as newQuery. |
| oxequery.exportConnections | Export connections | FIX | With nothing to export it said nothing. It now says why. |
| oxequery.importConnections | Import connections | KEEP | Opens the system file dialog. The e2e checks only that the control exists. |
| oxequery.settings | OxeQuery settings | KEEP | Opens OxeQuery settings. |
| oxequery.compose | Containers & Compose projects | MOVES | Opens the Containers tab. Renamed so it can be found. Moves to OxePod (Q20/P1). |
| oxepost.open | Open OxePost | KEEP | Opens the API client (H1). |
| oxepost.newRequest | New API request | KEEP | Starts an empty request; Save writes it to .oxespace/requests. |
| oxepost.filter | Find an API request | KEEP | Focuses the request filter. |
| oxepost.import | Import cURL or OpenAPI | KEEP | Opens the Import requests dialog. |
| oxepost.environments | API environments | KEEP | Opens the Environments dialog. |

## Panel menus and bars

| Surface | Entry | Verdict | Reason |
|---|---|---|---|
| Code top bar | Changes, Files, Browser, … toggles | KEEP | Each toggles its panel and shows its state with aria-pressed. |
| Code top bar | Panels menu (checkable list) | KEEP | Lists the panels that have no button of their own. |
| Code top bar | MCP | KEEP | Opens MCP servers. |
| Code top bar | Background activity (icon "Activity") | KEEP | Toggles the background panel. Its short name will clash with the Activity center in #132; rename it when that lands. |
| Code top bar | Systems ▾ | KEEP | Read-only status for GitHub, MCP, RTK and Caveman. The Semantic row is a toggle. |
| Panel stack | Tabs and More panels | KEEP | Switches between stacked panels. |
| Changes panel | Compare branches / Uncommitted / Compare from | KEEP | Changes what the diff compares. |
| Thread workbench | Panel selector, Maximize, Close | KEEP | Each works. |

## Context menus

| Surface | Entry | Verdict | Reason |
|---|---|---|---|
| Workspace row | Rename | KEEP | Inline rename. |
| Workspace row | Workspace settings | KEEP | Opens Settings for that workspace. |
| Workspace row | Move up / Move down | FIX | They were enabled on the first and last row and did nothing there. Now they are disabled there, and have icons. |
| Workspace row | Remove workspace | KEEP | Asks for confirmation first. |
| Terminal row (sidebar) | Rename, Copy context, Close terminal | KEEP | Each works (3 entries). |
| Terminal row (sidebar) | Stop terminal | KEEP | Shown only while the terminal is running. |
| Pane ⋯ | Details, Clear terminal, New session | KEEP | Each is disabled while it cannot act (3 entries). |
| Pane ⋯ | Split pane right / Split pane down | FIX | Renamed from "Split vertical/horizontal" to match the palette and the shortcut guide (2 entries). |
| Pane ⋯ | Move below / to the right of the previous pane | KEEP | Keyboard alternative to dragging (2 entries). |
| Pane ⋯ | Balance panes | FIX | Renamed from "Balance splits". |
| Pane ⋯ | Close pane | KEEP | Closes the pane. |
| Terminal status bar ⋯ | Restore provider session… | KEEP | Lists the saved sessions in this directory. |
| Terminal status bar ⋯ | RTK / Caveman / Semantic | FIX | Bare jargon toggles. Each now says what it does, and RTK and Caveman say they apply when the terminal next starts (3 entries). |
| Editor tab (right-click) | Pin tab / Close other tabs / Close tab | FIX | Right-click used to close every other tab at once, with no menu, and dropped unsaved edits. It now opens a menu. Close other tabs keeps pinned tabs and tabs with unsaved changes (3 entries). |
| Conversation row ⋯ | Open to the side, Rename…, Pin/Unpin, Mark read/unread, Archive, Delete | KEEP | Each works. Archive and Delete ask for confirmation (6 entries). |
| Thread project ⋯ | Project settings, Open in Code, Remove project… | KEEP | Each works (3 entries). |
| Thread header ⋯ | Delegate work | KEEP | Opens delegation. |
| Thread header ⋯ | Pin / Unpin conversation | FIX | Was "Pin thread", while the list said "Pin conversation". |
| Thread header ⋯ | MCP servers | FIX | Was "MCP connections", while the panel and palette say "MCP servers". |
| Thread header ⋯ | Smaller text, Larger text, Reset text size | KEEP | Changes the Thread text size. Each is disabled at its limit (3 entries). |
| Thread header ⋯ | Panels (radio list) | KEEP | Opens the selected Thread workbench panel. |
| Conversation actions ⋯ | Rename, Find or resume session…, Status, File checkpoints, Export portable copy, Import, Fork (Codex), Archive, Delete | KEEP | Each sends its slash command or does its file operation (9 entries). |
| Composer + | Attach image, Mention a file | KEEP | Each works (2 entries). |
| Composer + | MCP servers | FIX | Renamed from "MCP connections". |
| OxeQuery Ask agent | Explain, Fix this error, Read this plan, Write a query… | KEEP | Each is disabled until it has something to read, and never sends rows (4 entries). |
| OxeQuery table | Export format (CSV, JSON, …) | KEEP | Exports in that format. |
| Integration panel | Status segments, Generate brief, Remove integration | KEEP | Remove asks for a second click (3 entries). |

## Title bar and sidebars

| Surface | Entry | Verdict | Reason |
|---|---|---|---|
| Title bar | Application menu (☰) | KEEP | See the application menu above. Hidden on macOS, which has a native menu. |
| Title bar | Code / Thread / OxeQuery | KEEP | Switches the mode. |
| Title bar | Team | KEEP | Disabled, with a reason, when there is no project. |
| Title bar | Update banner / indicator | KEEP | Shown only when there is an update. |
| Code sidebar | New workspace, Delegated work, Files & commands, Filter workspaces | KEEP | Each works (4 entries). |
| Code sidebar | Toggle all workspace terminals | KEEP | Expands or collapses every workspace group. |
| Sidebar footer | Panels, Light/dark, Settings, Collapse | KEEP | The same actions as the collapsed rail (4 entries). |
| Thread sidebar | Add project, Filter, Compact list, New thread in project | KEEP | Each works (4 entries). |
| Thread sidebar | Accounts | FIX | With no project it did nothing. It now explains that accounts are checked inside a project. |

## Settings (application)

| Page | Control | Verdict | Reason |
|---|---|---|---|
| General | Recently visited workspaces kept ready | KEEP | The only place for this value now. |
| Notifications | Performance › Keep recent workspaces mounted | DISCARD | A second control for the General value above, with a different name, on a page about alerts. |
| Agents | Health check, provider rows, New custom agent | KEEP | Each works (3 entries). |
| Agents | Idle conversations, Semantic index (download, import, remove) | KEEP | Each works (2 groups). |
| Appearance | System / Light / Dark | KEEP | App-wide. |
| Terminal | Family, Size (+ reset), Line height, Letter spacing | KEEP | The preview and the terminals follow them (4 entries). |
| Terminal | Cursor style, Blinking cursor, Resume agent sessions, Scrollback, Background opacity | KEEP | Each is read by the terminal (5 entries). |
| Keyboard | Shortcut list, rebind, Reset all | KEEP | Each works. |
| Voice | Language (disabled field "Portuguese (Brazil)") | DISCARD | A control that can never change. The callout on the same page already says it transcribes Brazilian Portuguese. |
| Voice | Model, Push-to-talk shortcut + Capture, Download model | KEEP | The App hotkey handler reads the shortcut (3 entries). |
| Notifications | Notify when an agent needs you, Send test notification | KEEP | Each works (2 entries). |
| Notifications | Agent status hooks (Claude Code, Codex) | KEEP | Installs and removes the hooks (2 entries). |
| Notifications | Scheduled automations | KEEP | Create and turn off work. |
| Updates | Check for updates, Automatic / Notify / Off, Stay on version, Beta versions | KEEP | Each works in packaged builds (4 entries). See Findings for dev and E2E builds. |
| Updates | RTK: Check, Update; Included tools | KEEP | Each works (2 entries). |
| Policy | Layers, Reload policy | KEEP | Read-only rules and a reload. |
| Diagnostics | Refresh, Export report, Agent activity refresh / export | KEEP | Each works (4 entries). |
| (all pages) | Filter categories, Application / Current workspace scope, Back to work | KEEP | Navigation (3 entries). |

## Settings (workspace)

| Page | Control | Verdict | Reason |
|---|---|---|---|
| Appearance | Mode (System / Light / Dark) | KEEP | App-wide, and the page says so. Whether it belongs here is a decision, see below. |
| Appearance | Density, Layout preset, Preview | KEEP | Saved for the workspace (3 entries). |
| Terminal | Customize terminal, Font, Size, Line height, Cursor | KEEP | Per-workspace override over the global values (5 entries). |
| Terminal | Default shell, Also update idle panes | KEEP | Applied when you save (2 entries). |
| Project memory | Memory settings | KEEP | Shown only when shared memory is on. |
| Agent delegation | Delegation settings | KEEP | Applies immediately. |
| Footer | Discard changes, Save workspace settings | KEEP | Leaving with unsaved changes asks Stay, Discard or Save (2 entries). |

## Thread slash commands (shared/threadDesktopCommands.ts)

| Command | Verdict | Reason |
|---|---|---|
| /model, /effort, /permissions (/approvals, /allowed-tools), /plan | KEEP | Open a picker, or apply the argument. |
| /status, /capabilities, /instructions, /pwd (/cwd) | KEEP | Information panels. |
| /new (/clear, /reset), /resume, /rename (/name), /archive, /delete | KEEP | Archive and delete ask for confirmation. |
| /copy, /export, /diff, /review, /compact, /checkpoint | KEEP | Each works. |
| /rules, /spending, /events, /work, /delegations (/delegation) | KEEP | OXESpace panels. |
| /help, /skills, /accounts (/login), /logout, /settings (/config), /stop, /quit (/exit) | KEEP | Each works. |
| /usage (Claude Code) | FIX | Was offered, then failed with "This provider does not expose the requested operation". It is now Codex-only. Claude usage is under Tools › Usage & limits. |
| /usage, /mcp, /apps, /plugins, /fork, /rewind, /hooks, /experimental, /debug-config, /ps, /goal, /memories (Codex) | KEEP | Answered by the Codex app-server. |
| Other native CLI commands | KEEP | Listed as unavailable with a reason, never as runnable. |

## Totals

| Verdict | Entries |
|---|---|
| KEEP | 184 |
| FIX | 74 |
| DISCARD | 5 |
| MOVES | 2 |

A row marked "(N entries)" counts as N. Any other row counts as one, including the slash-command rows, where one row
covers a command family and its aliases.

## Findings outside the menus

- In dev and E2E builds, Settings › Updates and Diagnostics show the Electron version (v44.9.3) as the OXESpace
  version. Help › About shows the package version. Packaged builds are not affected.
- The app uses both "thread" and "conversation" for the same thing. For example, the palette says "New
  conversation" and the dialog says "New thread". This PR changes only the labels that disagreed inside a single menu.
  Choosing one word is a decision, see below.
