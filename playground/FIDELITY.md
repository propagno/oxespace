# Fidelity map: OXESpace 1.4 → 1.5.0 playground

Every capability the app has today, and where it is in the 1.5.0 playground. Built for the review loop
(`.claude/roadmap-1.4/team/estado/redesign-1.5-loop.md`, principle 3: nothing disappears silently).

- **Sources:** `src/components/*` at main 1067d934, `Navigation/appMenus.ts`, `src/keyboard/keybindings.ts`, and the Settings pages.
  The redesign audit shots were not on disk in this worktree, so the audit table in `docs/design/audit-1.5.md` was used instead.
- **Status values:**
  - *kept*: the same thing, restyled;
  - *changed*: the same job, a different form;
  - *moved*: it lives somewhere else now;
  - *new*: not in 1.4;
  - *dropped-ask-user*: proposed for removal, waiting for the user.
- **Where:** the screen's URL hash in the playground, then what to click.

## Shell and navigation

| Capability | 1.4 (where) | 1.5.0 (where) | Status |
|---|---|---|---|
| Five modes, same order, Ctrl+1…5 | Title bar mode switch; `view.code/thread/data/pods/post` | Title bar: OxeCode · OxeChat · OxeQuery · OxePod · OxePost; Ctrl+1…5 (any screen) | kept |
| Menu bar File · Edit · View · Tools · Help | `Navigation/AppMenuBar`, `appMenus.ts` | Title bar, left; every item works or says what it would do | kept |
| Workspace switcher | `Workspace/*`, title bar | Settings › Projects; File › New workspace; OxeCode sidebar header | moved |
| Command palette Ctrl+K / Ctrl+Shift+P, search Ctrl+J | `CommandMenu` | Title bar Search (Ctrl K) → palette with tasks, approvals, queries, requests, modes, settings (`#palette`) | kept |
| Settings Ctrl+, | `SettingsModal` | Title bar gear; full page (`#settings-general`) instead of a modal | changed |
| Sidebar toggle Ctrl+B | `sidebar.toggle` | Ctrl B; collapsed list keeps every item (`#sidebar-rail`) | kept |
| Activity center Ctrl+Shift+A | `Activity/ActivityCenter` | Approvals and activity (`#queue`), Ctrl Shift A; Settings › Agent activity (`#settings-activity`) | changed |
| Team Ctrl+Shift+T | `Teams/TeamDialog` | Tools › Team, Ctrl Shift T (`#dialogs` › Project team) | kept |
| Notifications | `Updates`, OS notifications | Bell in the title bar (`#notifications`) | kept |
| Status bar (branch, project, agents, usage) | `Workspace/AppStatusBar`, `UsageStatus` | Status bar: branch, project, agents working, Claude % and Codex % bars → Usage dialog | kept |
| Usage by provider | `Usage/UsageModal`, `UsagePopover` | Tools › Usage; status bar bars (`#dialogs` › Usage) | kept |
| Keyboard shortcuts `?` | `help.shortcuts` | `?` and Help › Keyboard shortcuts | kept |
| Onboarding / first run | `Onboarding` | `#first-run`: one primary, mode tiles | changed (A1) |
| Updates | `Updates`, `UpdatePreferences` | Settings › General › Updates; Help › Check for updates | moved |
| Close guard (unsaved work) | `CloseGuard` | File › Exit → Unsaved work dialog | kept |
| External links / Open in editor | `ExternalLinks`, `ExternalEditorSetting` | "Open in editor" in Files; Settings › General › External editor | kept |
| Design system page | `DesignSystem` | Foundations (`#foundations`), the playground's reference page | changed |

## OxeChat (conversations)

| Capability | 1.4 (where) | 1.5.0 (where) | Status |
|---|---|---|---|
| Conversation list by project | `ThreadSidebar` | Sidebar "Conversations" exactly as 1.4: Add project, filter (/), Pinned, Projects → project groups with sections, "New conversation in <project>", the project menu, Archived. Status shows only as the row glyph (round 4: the "group by status" default is reverted) | kept |
| New conversation Ctrl+Alt+N | `thread.new`, `ThreadDialogs` | Ctrl Alt N, File › New conversation, + in the sidebar (`#new-task`) | kept |
| Next / previous conversation | `thread.next/previous` | Not wired in the playground | kept (not shown) |
| Two conversations side by side | `ThreadGrid` (primary + secondary) | `#chat-split`: open beside from a row's hover button; click a side to focus it | kept |
| Task framing of a conversation | — | Header, the now line, tabs for what it touched, the impact panel (`#task-approval`) | new (lite B) |
| Message rows, markdown, code | `ThreadMessageRow`, `ThreadMarkdown`, `ThreadRichText` | Your bubble, the agent's reply without one, colored code blocks (`#chat`) | changed (T58) |
| Reasoning | `ThreadReasoning` | "Thought for 14 s", folded (`#chat`) | kept |
| Plan | `ThreadPlan`, `ThreadDockPlan` | Plan card with Approve / Keep planning (`#chat`) | kept |
| Todos | Live activity | Todos card with progress (`#chat`) | changed |
| Subagents | `ThreadSubagentActivity` | Explore agent card, folds its tools (`#chat`) | kept |
| Tool activity, groups | `ThreadActivityGroup`, `ThreadLiveActivity`, `ThreadTurnFold` | One summary line per group, expand to rows with a bar per kind | changed |
| File activity, open file | `ThreadFileActivity` | Edit rows expand to the real diff + "Written in" + Open file | changed |
| Inline paths in text (F33) | `ThreadTimelineEntry` pathScope | Path chips that open from where the file is, and say where they looked (`#chat`) | changed (T70) |
| Approvals | `ThreadRequestCard`, `ThreadApprovalDetails`, `ThreadDockRequests` | Now line + impact preview; command card Deny / Allow once / Always allow; hold for irreversible | changed (T67) |
| Questions | `ThreadHistoricalQuestions`, AskUserQuestion | Question card, one per page, pager in the footer (`#chat`) | changed (C-02) |
| Failure card, retry | `ThreadFailureCard`, `threadError` | Now line "Stopped with an error" + Retry; API retry note | changed |
| Prompt queue | `ThreadPromptQueue` | Queued message above the composer: Send now / remove | kept |
| Prompt navigator | `ThreadPromptNavigator` | Not shown | kept (not shown) |
| Find in conversation Ctrl+F | `ThreadFindBar` | Edit › Find in conversation (says what it does) | kept |
| Composer, chips, Plan/Agent | `ThreadComposerForm`, `ThreadConfigurationBar`, `ThreadModelPicker` | Composer with model, effort, permissions chips (T57/T58); Ctrl Shift I/E/M not wired | kept |
| Slash commands | `SlashOverlay`, `ThreadCommandDialog` | / menu; Run a command dialog | kept |
| Attachments, images | Composer | Image chip in your message; + attaches (says what it does) | kept |
| Context ring, usage panel | `ThreadUsageRing`, `ThreadUsagePanel` | Ring in the composer; Details › Context | kept |
| Conversation details | `ThreadSessionPanel`, `ThreadSessionSections` | Panel › Details (`#task-details`) | changed (T58 §7a) |
| Conversation actions menu | `ThreadConversationActions` | ⋯: rename, pin, delegate, MCP, view options, fork, export, archive, delete | changed (T58 §7b, U14) |
| Side chat | `side/ThreadSideChat` | `#side-chat` | changed (T58 §7c) |
| Rewind / checkpoints | `ThreadRewindControl`, `ThreadDockRewind`, `thread-checkpoints` | Checkpoints in the panel: view, restore files, branch (`#task-running`) | changed |
| Turn review, hunk review | `ThreadTurnReview`, `ThreadHunkReview`, `ThreadReviewHost` | Changes tab: per-file Keep / Revert; Ask for a review | changed |
| Changes panel | `ThreadChangesPanel`, `ThreadDockChanges` | Changes tab grouped by place, against the task's base, branch drift (`#task-changes`, `#chat` › Changes) | changed (T71) |
| Worktree finish | `ThreadWorktreeFinishDialog` | Changes › Finish the worktree… | kept |
| Workbench panels (files, browser, git, scripts, search, worktrees, background, terminal) | `Workbench/panelCatalog.ts`, `WorkbenchPanelMenu` | "+ Tool" in the tabs; Ctrl E Files (`#chat-tools`) | kept |
| Project terminal | `ThreadProjectTerminal` | Terminal tab | kept |
| Project settings | `ThreadProjectSettingsDialog` | Settings › Projects | moved |
| MCP health and list | `ThreadMcpHealth`, `ThreadMcpServerList`, `ThreadMcpDiagnose` | ⋯ › MCP servers; Settings › Tools (out of the composer, user decision) | moved |
| Provider accounts | `ProviderAccountsPanel` | Settings › Agents › Manage | moved |
| Delegation | `Delegation/*` | ⋯ › Delegate; Tools › Delegated work; Background › Delegated work | kept |
| Announcer (screen reader) | `ThreadAnnouncer` | role=status on the now line and toasts | kept |
| Events panel | `ThreadEventsPanel` | Settings › Agent activity (one list, U12) | moved |

## OxeCode

| Capability | 1.4 (where) | 1.5.0 (where) | Status |
|---|---|---|---|
| Workspace / project / pane sidebar | `Sidebar/Sidebar`, `WorkspaceGroup`, `PaneSessionRow` | OxeCode sidebar exactly as 1.4: Workspaces header with New workspace, Delegated work and Files & commands; Filter workspaces (/); one card per workspace (a repository or one of its worktrees) with grip, activity dot, terminals chevron and options gear; the card's terminals under it; Toggle all; Open panels. The grid shows the active workspace's panes (`#mode-code`) | kept |
| Sessions to resume | `AgentSessions/PaneResume` | OxeCode › the history button beside Agent (it was a sidebar list in round 3; the sidebar is 1.4's again) | kept |
| Layouts 1×1 … 4×4 | `Grid/layouts.ts` | Layout menu with the same presets, plus Focus with tabs | kept + new |
| Resizable splits | `WorkspaceSplitGrid` | Drag or arrow-key the gutters | kept |
| Pane maximize Ctrl+Shift+Enter | `pane.maximize` | Pane header button and Ctrl Shift Enter | kept |
| Pane menu (RTK, Caveman, Semantic, restart, close) | `Grid/PaneMenu`, `TerminalFocusMenuItems` | ⋯ on every pane, with hint lines (K-02) | kept |
| Phone writes to a pane | `PanePhoneWrite` | Pane ⋯ › Allow typing from the phone (toggle, badge) | kept |
| Branch per pane | `PaneBranchBadge` | Badge in the pane header and sidebar; "moved" warning when a terminal switched it | changed |
| Restart terminal Ctrl+R | `terminal.restart` | Pane ⋯ › Restart | kept |
| Files Ctrl+E, Changes Ctrl+Shift+D, Browser Ctrl+Shift+B | `code.files/changes/browser` | Dock buttons in the OxeCode header; Ctrl E | kept |
| Search Ctrl+Shift+F | `Search/SearchPanel`, `Semantic` | Search tool: Text / By meaning | kept |
| Editor and file tree | `Editor/EditorPane`, `FileBrowser`, `EditorTabs` | Files tool: tree, tabs, colored editor | kept |
| Web preview, design grab | `WebPreview/*` | Browser tool with Grab for the agent | kept |
| Scripts | `Scripts/ScriptsPanel` | Scripts tool; Tools › Scripts | kept |
| Git, GitHub, Linear | `GitHub/*`, `Linear/LinearPanel` | Git and pull request tool | kept |
| Worktrees | `Worktree/*` | Worktrees tool (remove merged, open a terminal) | kept |
| Background jobs | `Background/BackgroundJobsPanel` | Background tool; Local jobs / Delegated work | kept |
| Status explain | `Grid/StatusExplainDialog` | Not shown | kept (not shown) |

## OxeQuery, OxePod, OxePost

| Capability | 1.4 (where) | 1.5.0 (where) | Status |
|---|---|---|---|
| Connections, new connection, settings | `OxeQuery/*` | Connection picker, New connection, limits table (`#mode-query`) | changed (A5, Q-02, Q-03) |
| Editor, run, results, export | `OxeQuery` | Query tabs, colored editor, typed results, Copy and Export | kept |
| Agent activity + row detail (T63) | OxeQuery activity | One line at the top → list → detail dialog (`#mode-query-activity`) | changed |
| Containers, logs, actions, remove, down | `OxePod/*` | Grouped by stack with who started each; Stop, Restart, Terminal; Remove and Stop the stack in ⋯ (`#mode-pod`) | changed (A3, P-01) |
| Filter `/` | `oxepod.filter`, `oxepost.filter` | Not wired | kept (not shown) |
| Collections, environments, import | `OxePost/*` | Sidebar with Import, Environments, New request (`#mode-post`) | changed (H-02, H-03) |
| Send Ctrl+Enter, response | `oxepost.send` | Send button; Pretty / Raw; status chip | kept |
| New request (T62) | OxePost | + makes a request and selects its name | kept |
| Agent activity (T64) | — | One line at the top → list → detail (`#mode-post-activity`) | new |

## Settings

| Page | 1.4 | 1.5.0 | Status |
|---|---|---|---|
| General, updates, external editor | `SettingsCenter` general, `UpdatePreferences`, `ExternalEditorSetting` | `#settings-general` | kept |
| Appearance | `AppearanceSettings` | `#settings-appearance` | kept |
| Providers / agents, automations | providers, `AutomationsSettings` | `#settings-agents` (automations moved here, S-05) | moved |
| Approvals and policy for agents | permissions in several places | `#settings-approvals` (per-connection and per-collection access) | changed |
| Notifications | notifications | `#settings-notifications` | kept |
| Keyboard | `KeyboardSettings` | `#settings-keyboard` | kept |
| Terminal, shells, profiles | terminal, `DefaultShellSettings` | `#settings-terminal` | kept |
| Tools: MCP, skills, seen sites | `ToolsSettings`, `SeenSitesSetting` | `#settings-tools` | kept |
| Devices | `DevicesSettings`, `DevicesPairing` | `#settings-devices` (pair with code, unpair confirms) | kept |
| Memory (beta) | memory | `#settings-memory` | kept |
| Data and retention | retention settings | `#settings-data` | kept |
| Agent activity | `AgentActivitySettings` | `#settings-activity` (one list, U12) | changed |
| Diagnostics | diagnostics | `#settings-diagnostics` | kept |
| Policy | `PolicySettings` | `#settings-ws-policy` (S-06) | kept |
| Workspace pages | `WorkspaceSettingsModal` | `#settings-ws-projects`, `#settings-ws-policy` (apply at once, U2) | changed |

## Dropped (ask the user)

None. Nothing that exists in 1.4 is removed. Two screens are tagged *later (full B)* because they need the Task entity: a task with two agents, and the board of running tasks.

## Round 1 additions

| Capability | 1.4 (where) | 1.5.0 (where) | Status |
|---|---|---|---|
| Phone connection switch (off: no port open), computer name | `DevicesSettings` | `#settings-devices` | kept |
| Paired phones N of max, connected / last seen, Rename, Unpair | `DevicesList` | `#settings-devices` ("Unpair" on both devices) | kept |
| Typing in terminals, "Stop typing from the phone everywhere" | `DevicesSettings`, `PanePhoneWrite` | `#settings-devices`; pane ⋯ › Allow typing from the phone (toggle, badge) | kept |
| What a phone can do | `DevicesSettings` | `#settings-devices` | kept |
| Pair flow: code, expiry, fingerprint, "Pair <device>?" | `DevicesPairing` | Dialogs › Pair a phone | kept |
| Split tree: row/column dividers, divider menu, drag to move, room rules, 2×5 / 2×7 | `WorkspaceSplitGrid`, `splitRoom.ts`, `splitRefusal.ts` | `#mode-code` | kept |
| Hunk undo, comment on a hunk, review by turn | `ThreadHunkReview`, `ThreadTurnReview` | Changes tab | kept |
| New terminal / agent pane asks project and worktree | Pane creation | `#mode-code` › Terminal / Agent | changed |

**Dependencies (principle 5):**
- Agent activity in Requests and OxePost needs **T64**.
- Changes by place, branch drift and path resolution need **T71/T72**; outside files open read-only only through T72's places.
- The pane branch "changed since" needs **T73**.
- Always allow as the provider's rule is **T74**.
- Steer with this / Send now is **T76**.
- Background state is **T77**.
- The irreversible → phone `critical` mapping is **T78**.
- PR notifications need PR polling (S–M).
- The terminal "agent" tag comes from the agent_action_audit actor.
- No task keys: lite B has no task entity, so conversations are named by title.

**Visual baselines:** the dark accent change (sun → caatinga) means every dark-mode visual baseline is re-shot in 1.5.0 (FRONTEND, once per batch on main).

## Round 4: the user's radical decisions (04/11)

The user asked for radical decisions with one fixed constraint: "the way to add a workspace in OxeCode and OxeChat
must not change; I work by worktree and need the workspace in the same structure". They chose all four options.
The TECH LEAD's guardrails are T82–T85.

**Fixed: the sidebars are 1.4's.** Both rows above are back to *kept*. The New workspace dialog is 1.4's
`NewWorkspaceModal` ("Create new workspace": folder, layout, agents with slots, default shells). Remove workspace and
Remove project use 1.4's wording. What 1.5.0 adds sits on top of that structure: status glyphs on rows, the drift
glyph, and the workspace color.

| Capability | 1.4 (where) | 1.5.0 (where) | Status | Guardrail |
|---|---|---|---|---|
| Agora: every agent in every workspace and mode, needs-you first, then by workspace; steer, approve, stop in place | Notifications, the approval queue, each pane | `#agora`, title bar › Agora, Ctrl 0, `/agora` | new (T82) | Data is the S7.1 agents read model (#514/#531): id, provider, model, surface, workspace, title, tone, started, last activity, pending request. No invented fields. Deny is focused first; irreversible goes through the impact preview and hold; Stop asks first. Rendered only while open. 20+ agents stay readable: one 34 px row each, groups fold, finished ones fold. |
| Time travel per conversation | File checkpoints, Rewind to here, Fork | `#history`, the History button in the header, Ctrl H, `/history` | new (T83) | Files exist only at checkpoints (one per user turn plus one per other checkout); the knob snaps files to them and shows "transcript only" in between. Restore is today's rewind (set aside, Redo until the next message, "Also restore files"). Branch makes a new worktree from the checkpoint's commit. The note lists what can't go back every time. |
| One command bar | Command palette (Ctrl K) | Title bar › "Ask, run or go to…", Ctrl K; `#command-bar` | changed (T84) | A front for existing actions: `@Claude`/`@Codex` = new conversation or delegate; `/approve` opens the same impact preview and hold, from the window only (never MCP); `/deny`, `/steer`, `/stop` (asks), `/new`, `/history`, `/agora`, `/terminal`, `/theme`; `open <name>` for connections, workspaces, conversations, containers. Each result names its button fallback ("Also: …") and shortcut; `?` lists them all. Plain search works as before. |
| Workspace color | — | Workspace options (gear) › Color; carried to the card, its pane headers, the conversation header, Agora and the status bar | new (T85) | Stored in the workspace's settings; the user picks it; default from a fixed palette of 8 (`--ws-1…8`) that reaches AA text contrast on the surface in both themes (lowest 5.12:1 light, 6.59:1 dark). |
| Our own icons for the modes, Agora and time travel | Lucide | Title bar mode switch, Agora, History | new (T85) | Drawn on the same 24 px grid and stroke; not copied from a set. |
| Bolder display type | Bricolage Grotesque 600–700 | Bricolage Grotesque 750 for titles and the sidebar headers | changed (T85) | OFL. |
| Motion only on state changes | Three durations | A status glyph scales in when it changes to "needs you"; nothing loops except the title-bar ring | changed (T85) | All animation and transition is off under `prefers-reduced-motion`. |
| Watch running tasks (later, full B) | — | Superseded by Agora | changed | Agora needs no Task entity. |

**Dark accent (C4):** keep caatinga `#49a072` as the one accent in dark, as in rounds 1–3. The workspace colors take
over the job the old sun accent did for telling places apart, and the sun stays free to mean "needs you". This goes
into the C4 token PR with the `--ws-*` palette, so the dark-mode baselines are re-shot once for both.

**Fixes found while building round 4:**
- The title-bar pill's `.needs` rule leaked onto the status glyph and stretched it into an oval.
- Closing a dialog and pressing Ctrl K at once could pull focus out of the new overlay; focus now returns only when nothing else opened.

**Checked:** the full sweep (53 screens, light and dark, 1440 and 900, every gallery dialog: no overflow, no console
errors) and 43 scripted checks (the 17 HML scenario checks plus 26 for round 4), all passing.
