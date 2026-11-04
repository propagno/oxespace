# Handoff: building the 1.5.0 playground in the app

This is for the FRONTEND team. The playground is the visual reference; the app keeps its own components. This file
says, for each screen:
- what the screen reuses from `src/ui` and 1.4;
- what is new;
- which backlog item gates it.

**Sources:**
- `src/ui` and `src/components` at main 1067d934;
- the design plan `docs/design/plan-1.5-ui.md`;
- the BACKEND sequence `team/plans/1.5.0-backend-sequence.md` (waves A–F);
- `FIDELITY.md` in this folder.

**Rules:**
- Principle 1 (evolve, don't replace): 1.4's hosts and behaviour stay, and the new look goes on top.
- Each screen ships in the earliest wave its backend allows.
- Until then it falls back to today's behaviour, never to an invented one.

## `src/ui` primitives: kept, extended, new

| Primitive | 1.5.0 | Notes |
|---|---|---|
| `Button` | **extended** | Every button with text has a visible shape at rest; `ghost` gets a fill (`fill-hover`). Add `size="sm"` 24 px and a split-button variant (the "+ Terminal ▾" pattern). |
| `Overlay` (Dialog, Popover, Menu) | **extended (U1, U7)** | Dialog: `size` required; focus goes to the first field, else the safe action; the footer is extra · Cancel · primary; Enter in a field submits. Menu: `hint` lines, a `check` column and a `shortcut` column; destructive items last. |
| `ConfirmDialog` | kept (U1) | Cancel focused. Add an optional "I understand…" checkbox that gates the primary (the non-hold approve path). |
| `Field` | kept | Error line under the field (`ferr` in Foundations). |
| `Splitter` | kept | Used for the conversation tool panel (≥ 320 px) and the OxeCode dock. `aria-valuenow`, arrow keys. |
| `ToolPanel` | **extended (U11)** | One header anatomy: icon, title, tabs, maximize, close. Becomes the panel beside the conversation ("+ Tool"). |
| `Toast` / `ToastStack` | **extended** | Actions: Undo (risky, reversible only), Open, and **Allow / Deny** for a request that arrives elsewhere. Never Undo on an irreversible approval. |
| `CommandPalette` | kept | Group names are searchable; new "Open beside" group. |
| `Display`, `TitleTooltips`, `BrandLoader`, `Modal` | kept | `Modal` stays only where `SettingsCenter` needs it until U2 lands. |
| **`Switch`** | **new** | Risky variant (danger fill when on); `role="switch"`. |
| **`SegmentedControl`** | **new** | Theme, density, Plan/Agent, Pretty/Raw, the sidebar grouping. |
| **`SettingRow` / `SettingsSection`** | **new (U2)** | The Settings anatomy in `#settings-*`. |
| **`Callout`** | **new (U6)** | info / warn / danger / ok, with an icon and an optional action. |
| **`CodeEditor` / `CodeBlock`** | **new** | Syntax roles `syn-*`; line numbers; a read-only band; the block is a focusable region. The app may wrap its existing editor instead of the playground's textarea overlay. |
| **`NowLine`** | **new** | One sentence: "Needs you / Working / Paused / Stopped / Ready", plus at most two actions. Derived from status, pendingRequests, backgroundRunning and the last tool item (MOBILE-1-6). |
| **`StatusGlyph`** | **new** | Static ring per status (no infinite spin), plus elapsed time beside it. |

## Screens

**Waves** follow the BACKEND sequence:
- A = on main today;
- B = T76, T73, T78;
- C = T72 PR 1–2 + §6 gaps;
- D = T72 PR 3–4;
- E = U12-be, T64;
- F = T74, T75, T77.

**FE** means work this team already has (U1–U14, T58).

| Screen (hash) | Reuses from 1.4 | New | Gate (wave) |
|---|---|---|---|
| Title bar, menus, status bar | `Navigation/AppMenuBar`, `appMenus.ts`, the mode switch, `Workspace/AppStatusBar`, `UsageStatus` | Mode switch restyle; status bar drift ("· moved") | A; the drift mark in D |
| `#first-run` | `Onboarding` | The three-step checklist with CLI detection and sign-in waiting; "New conversation" disabled until an agent is ready | A (CLI detection exists) |
| `#home-empty`, `#sidebar-rail` | `ThreadSidebar` (unchanged structure) | Status glyph and drift glyph on rows; the project group's line takes the workspace color; a sibling "open beside" button (`thread-row-action`). No regrouping | A; the color with T85 |
| `#chat` (conversation) | `ThreadView`, `ThreadTimeline*`, `ThreadMessageRow`, `ThreadReasoning`, `ThreadPlan`, `ThreadSubagentActivity`, `ThreadRequestCard`, `ThreadHistoricalQuestions`, `ThreadPromptQueue`, `ThreadComposerForm` | Tool groups as one summary line (T58-b), the NowLine, the question pager in the footer (C-02), the command card | A; queued "Steer with this / Send now" B (T76); "Always allow" F (T74); background card F (T77) |
| `#chat-split` | `ThreadGrid` | Fixed cells; both full views; activate on click/focus, never on mousedown; a switcher at 900 px | A |
| `#chat-tools` | `Workbench/panelCatalog.ts`, `WorkbenchPanelMenu`, `Editor/*`, `WebPreview/*`, `GitHub/*`, `Linear/*`, `Scripts/*`, `Search/*`, `Worktree/*`, `Background/*` | "+ Tool" opens `ToolPanel` beside the conversation via `Splitter` (≥ 320 px, maximize) | A |
| `#task-approval` header and panel | `ThreadHeader`, `ThreadSessionPanel` | Header + NowLine + tabs for what was touched; "What it touched" | A; tabs fill in C |
| `#approve-sql`, `#approve-volume`, `#task-push`, `#queue` | `ThreadApprovalDetails`, `ApprovalDialog`, `Approvals/*` | Impact preview layout, hold-to-confirm plus the non-hold path, the queue view, the phone note | A for the layout and the hold; phone `critical` B (T78); the preview sample and Snapshot F (T75) |
| `#task-changes` | `ThreadChangesPanel`, `ThreadHunkReview`, `ThreadTurnReview`, `Review/*`, `ThreadWorktreeFinishDialog` | Grouped by place, each with its base; By turn; Comment on a hunk | Places C (T72 PR 1–2); the drift card and its groups D (T72 PR 3) |
| Path links in text | `ThreadTimelineEntry` pathScope (F33) | One link style; outside files open read-only in Files | D (T72 PR 4 replaces T70) |
| `#task-terminal`, `#task-containers`, `#task-pr` | `ThreadProjectTerminal`, `OxePod/*`, `GitHub/PrStatusBar` | Tabs only when non-empty | C (T72 §6: `thread:panes`, Compose dir, reviewers; T79 optional) |
| `#task-queries` | OxeQuery activity (T63) | — | A |
| `#task-requests`, `#mode-post-activity` | `OxePost/*` | — | E (T64) |
| `#task-details`, `#side-chat` | `ThreadSessionPanel` (T58 §7a), `side/ThreadSideChat` (T60) | — | A |
| `#mode-code` | `Grid/*` (`WorkspaceSplitGrid`, `layouts.ts`, `splitRoom.ts`, `PaneMenu`, `PanePhoneWrite`), `Sidebar/Sidebar` and `WorkspaceGroup` (unchanged structure), `PaneSessionRow`, `AgentSessions/PaneResume`, `PaneBranchBadge`, `Workspace/NewWorkspaceModal` | Focus with tabs; the layout grows with panes (no silent hiding); "+ Terminal ▾"; the new-pane dialog (project + worktree); the dock | A; "changed since" warning B (T73) |
| `#mode-query` (+ activity) | `OxeQuery/*` | Connection picker, query tabs, the colored editor, typed result columns, the agent line | A; the activity line's counts E (U12-be) |
| `#mode-post` | `OxePost/*` | Request bar with method colors and URL variables; Pretty/Raw; status chip | A; the agent line E (T64) |
| `#mode-pod` | `OxePod/*` | Grouped by stack, the Folder column, logs below | A; "This conversation's folder" C (Compose working_dir) |
| `#settings-*` | `SettingsCenter`, `AppearanceSettings`, `KeyboardSettings`, `ToolsSettings`, `DevicesSettings`, `DevicesPairing`, `PolicySettings`, `AgentActivitySettings`, `AutomationsSettings`, `UpdatePreferences`, `ExternalEditorSetting`, `SeenSitesSetting` | U2/U8 rows; apply at once; undo toasts on the risky list | A (U2, U8); `#settings-activity` E (U12-be); collection access E (T64) |
| `#dialogs` | All 1.4 dialogs | U1 contract (U5a/b/c) | A |
| `#foundations` | `DesignSystem` page | The token tables come from the token file | A |
| `#agora` (T82) | `Approvals/*`, `ApprovalDialog`, the S7.1 agents read model | A new top-level view: needs-you cards (D/A on the focused card), then rows grouped by workspace, in the 7 S7.1 states; Steer reuses the composer's queue; Stop reuses the confirm (conversations only) | wave B (S7.1 on main); the activity line needs T90 |
| `#history` (T83) | Checkpoints, `rewind.*`, Fork | The scrubber band over the conversation; Restore = rewind + "Also restore files"; Branch = new worktree from the checkpoint commit | needs BE-2-2's checkpoint per turn + per other checkout (C/D) |
| `#command-bar` (T84) | `CommandPalette` | Prefix parsing (`@`, `/`, `open`, `?`); every result shows its fallback and shortcut | A (no new powers) |
| Identity (T85) | Mandacaru tokens, Lucide | `--ws-1…8` palette and `--ws-N-fg` chip text (AA both themes), `workspaces.color` column via workspace:update-settings, own mode icons, 750 display weight, reduced-motion off switch | C4 token PR; the column is the first 1.5.0 migration |
| `#later-multi`, `#later-watch` | — | Later (full B): needs a Task entity. `#later-watch` is superseded by Agora | not in 1.5.0 |

## Build notes for round 4 (FRONTEND)

- **Agora** mounts only while open. Rows are keyed by agent id and subscribe per agent, so one agent's change repaints
  its row, not the list. Virtualize the per-workspace lists past about 60 agents.
  Finished rows use `seenAt` and `agents:mark-seen`: finished since you last looked stays open, the rest folds
  under "Show N finished" (the playground folds all of them).
- **Scrubber:** move the knob with a CSS variable; compute "files since" and "can't go back" when the knob settles
  (about 150 ms idle) or from a per-checkpoint index; draw the transcript ticks as one gradient; keep elements only
  for checkpoints and events, and never as nested controls inside the slider.
- **Icons** ship one module per icon, so a screen pulls in only what it draws; never one `PATHS` map in the entry.
- **Identity** is CSS on a `data-ws` attribute (`[data-ws="N"]` sets `--wsc` and `--wsc-fg`), not a JS color map.
- **Lazy:** Agora (a route chunk), history (inside the thread chunk, on first open), the command bar's parser,
  sources and results (behind its first open), and the icons.
- **Entry budget:** this round lands at 282–286 kB against the 284 kB target. PRs that touch the entry (title bar,
  sidebar rows, pane headers) go first and are measured on CI; the next lever is the `SlashOverlay` / `CommandMenu`
  preload.

## Token diff: Mandacaru today → 1.5 (contract C4)

The source of truth is `src/design/mandacaru-1.5.css` in this folder; Foundations renders it. MOBILE checks the
Android app in the same PR.

| Role | Today (main) | 1.5 | Why |
|---|---|---|---|
| `accent` (dark) | sertão sun | caatinga `#49a072` (hover `#5eaf82`, soft `#102318`, border `#1e5137`, text `#91d2ac`) | One accent in both modes; the sun is freed to mean "needs you". |
| `attn`, `attn-bg`, `attn-fg`, `attn-border` | — | light `#b87300` / `#fdeddb` / `#845500` / `#ebbb81`; dark `#f5a939` / `#2b1a03` / `#f0b467` / `#613d00` | New: "needs you" only (approvals, questions, stalled agents). Light `attn` reaches ≥ 3:1. |
| `k-file`, `k-db`, `k-box`, `k-net`, `k-shell` (+ `-bg`, `-fg`) | — | info scale; new scales at hues 295, 200 and 345; neutral | New: resource kinds for tabs, chips and activity bars. |
| `fill-selected` (dark) | neutral 5 | caatinga 4 `#122c1e` | U4 / X7: selection is visible in dark. |
| `syn-kw`, `syn-str`, `syn-num`, `syn-fn`, `syn-type`, `syn-key`, `syn-cm`, `syn-pun`, `syn-var` (+ `-bg`) | — | see the token file | New: syntax roles. Light comments `#5a635c` reach ≥ 4.5:1. |
| `term-bg`, `term-fg`, `term-line` | literals in CSS | `#0f1411`, `#d7e3da`, `#26302a` (same in both modes) | Tokenized (FRONTEND-1-13). |
| `z-dock`, `z-overlay`, `z-menu`, `z-toast` | literals | 50, 300, 380, 400 | Tokenized. |
| Motion | three durations | Same durations; only one infinite animation (the "needs you" ring in the title bar) | FRONTEND-1-12. |

**Visual baselines:** every dark-mode baseline is re-shot once, after the accent change lands, as part of the batch on
main (not per PR).

## Things the playground does that the app should not copy

- The textarea-over-highlight editor (use the app's editor).
- The mock simulation clock.
- The `S` store pattern.
- Inline styles.
- The fixed 1440 / 900 frame scaling.
- The CSS is one file for speed. In the app, each component owns its styles, built from tokens.
