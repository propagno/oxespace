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
| Conversation list by project | `ThreadSidebar` | Sidebar "Conversations"; filter icon → By status (default, new) or By project (1.4) | changed |
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
| Workspace / project / pane sidebar | `Sidebar/WorkspaceGroup`, `PaneSessionRow` | OxeCode sidebar: projects → panes with provider, status and branch badge (`#mode-code`) | kept |
| Sessions to resume | `AgentSessions/PaneResume` | Sidebar › Sessions you can resume | kept |
| Layouts 1×1 … 4×4 | `Grid/layouts.ts` | Layout menu with the same presets, plus Focus with tabs | kept + new |
| Resizable splits | `WorkspaceSplitGrid` | Drag or arrow-key the gutters | kept |
| Pane maximize Ctrl+Shift+Enter | `pane.maximize` | Pane header button and Ctrl Shift Enter | kept |
| Pane menu (RTK, Caveman, Semantic, restart, close) | `Grid/PaneMenu`, `TerminalFocusMenuItems` | ⋯ on every pane, with hint lines (K-02) | kept |
| Phone writes to a pane | `PanePhoneWrite` | Pane ⋯ › Let my phone write here | kept |
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
