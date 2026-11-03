# Design audit 1.5 (T65)

Status: **draft for decisions**. Owner: DESIGN. Input for T58 (`t58-oxechat-conversation.md`) and the 1.5.0 design
work. Docs only.

## How this was done

- **Inventory first.** `src/` has 129 files that open an overlay: 49 `Dialog`, 43 `ConfirmDialog`, 9 `Popover`,
  15 `Menu`, 6 `ToolPanel`, 70 toast calls and 20 hand-built `role="dialog"` surfaces (appendix A).
- **Screenshots of main at 68100918** (v1.4.0 plus #533), from the e2e mock, in light and dark, at 1440×900 and
  900×620: 55 surfaces × 4 = 220 shots in [`audit-1.5/`](audit-1.5/). They were taken in CI ("Visual baselines" run
  41701172204, Linux), never from a real profile. Each folder has `facts.json` with measured contrast, targets under
  24 px, overflow, dialog size and where focus landed.
- Each screen was judged against Mandacaru (`src/design/tokens`, `src/ui`): hierarchy, density, alignment, type,
  color and contrast, consistency between equivalent surfaces, button copy and order, states, focus, Esc and narrow
  windows.
- Shots are named `<theme>-<size>/<id>.png`, for example `light-1440x900/021-workspace-settings.png`. A finding
  cites the id. Unless it names a size, it holds at both.
- **What measured well:** text contrast passes AA everywhere it was measured. The only misses are disabled menu
  items (exempt) and one 11 px badge "1" at 3.56:1 (C-12). No surface scrolls sideways at 900 px. The problems are
  structure and consistency, not color math.
- **Not reached** (appendix B): the title-bar menus on Linux, the Workspace settings scope from the Settings
  dialog, rename/delete dialogs from the conversation menu, the Conversation details panel, the OxeChat sidebar
  context menu, and OxeQuery's import. Those are covered by code reading only.

Impact: **high** means it misleads, hides something needed to decide, or breaks keyboard use. **Medium** means
inconsistent or noisy enough that people notice. **Low** is polish.

## Top 15 problems

| # | Problem | Where | Impact |
|---|---|---|---|
| 1 | At 900×620 the approval card shows about 100 px of the request inside its own scroll: you approve a command you cannot fully see. The title is also said twice. | C-01 | high |
| 2 | Settings has two save models in one dialog: Application pages apply at once, Workspace pages need Save/Discard. | S-01 | high |
| 3 | Every Settings page lays out its rows differently. Content is a ~470 px column in a 1000 px page. | S-02, S-03 | high |
| 4 | Errors that are not drawn as errors. "Could not verify the connection" is body text, "Secrets cannot be stored here" is red text in the form, and sign-in failure is said three times. | G-07, H-03, C-03 | high |
| 5 | The Usage dialog labels Codex's quota "Claude account" (any account sign-in source gets that label). | G-06 | high (wrong information) |
| 6 | Dialogs open with focus in four different places: the dialog container (9 dialogs), the first field, Close, or a list button. | D-01 | high (keyboard) |
| 7 | The OxeChat header has two ⋯ buttons. The right one is a 20-item menu mixing actions, text size, panels and the transcript view; at 900×620 it is taller than the window. | C-04 | medium |
| 8 | Dialog footers disagree: Cancel vs Close vs a ghost button, danger before or after primary, and 4-button footers. Report a problem has no primary at all. | D-02 | medium |
| 9 | Uppercase micro-labels (FOLDER, LAYOUT, PROJECT, ACCESS, TEXT SIZE, CONNECTIONS, REFRESH…) appear in 12 places, sometimes next to sentence-case labels in the same dialog. | D-03 | medium |
| 10 | The same action has two names: "Add connection" vs "New connection", "Skills" vs "Agent skills". | Q-01, G-04 | medium |
| 11 | The four tool panels (MCP, Skills, Scripts, Background activity) have four header layouts and three placements. Background activity stacks 4 levels of tabs. | G-03, G-05 | medium |
| 12 | Selection is weak: selected cards and rows use a neutral fill in dark mode (palette, Settings mode cards), and the light-mode mode card is gray. | D-05 | medium |
| 13 | OxePod puts "Remove…" (danger) in the same row as Stop/Restart/Terminal, and "Down…" is a red text link. | P-01 | medium |
| 14 | The terminal pane's ⋯ menu lists "RTK", "Caveman" and "Semantic" with no explanation. | K-02 | medium |
| 15 | The Project team dialog opens at 760 px wide around one "Loading team…" line, then jumps. Teams has no empty or error state. | G-02 | medium |

## Systemic fixes, ranked by screens fixed

These go in `src/ui` or the tokens, so one change fixes many screens. Counts are screens in this audit, plus the
code inventory where it is wider.

| # | Fix | Screens | What changes |
|---|---|---|---|
| X1 | **Dialog contract in `ui/Dialog`** | 92 dialogs in code; 24 audited | `size` becomes required (19 have none). Initial focus by rule: the first field; otherwise the safe action; never the container. Footer by rule: extra actions start-aligned, then **Cancel** (secondary, always "Cancel") and the primary at the end; danger replaces the primary and is never next to another filled button. The 24 files that restyle dialogs with their own classes (`oq-scope` 20 rules, `thread-create-dialog` 15, `team-dialog` 5…) are folded back into the primitive. |
| X2 | **`SectionLabel` replaces uppercase micro-labels** | 12 screens | Sentence case, `text-xs` semibold, `text-secondary`. A design-lint rule bans `text-transform: uppercase` outside the token export. |
| X3 | **`SettingRow` and `SettingsSection` primitives** | 15 Settings pages | A row has label and description on the left and the control on the right. A wide variant puts sliders and editors under the label. A section is one card with a rule between rows. Pages get a max width of 720 px. One save model (S-01). |
| X4 | **`Callout` (intent) for inline messages** | 7 screens | Info, warning and danger callouts with an icon and an optional action, for problems that are not a whole-screen `ErrorState` (accounts, secrets, policy, sign-in). |
| X5 | **One tool-panel anatomy** | 6 panels | Header: icon, title, count, actions, close, always in that order. Catalogs (MCP, Skills) open as `Dialog size="lg"`; working panels (Scripts, Background activity, Linear, Semantic) dock on the right. At most two levels of tabs. |
| X6 | **Menu rules in `ui/Menu`** | 15 menus | Width fits content (200–320 px). Group labels in sentence case. A destructive item is last, after a separator. Over 12 items, split into a submenu or a second menu. Items that need explaining get the `hint` line the primitive already has. |
| X7 | **Selected-state roles** | 6 screens | Selected cards and rows use `fill-selected` plus `accent-border` in both modes. The dark `fill-selected` moves from neutral 5 to accent 3, so selection reads as selection rather than as hover. |
| X8 | **Short-window rules** | 5 screens at 900×620 | A docked card (approval, question) is at most 60% of the conversation height and grows by pushing the timeline, never with a scroll inside. A dialog body is at least 240 px tall before the footer stops being sticky. A menu taller than the window splits (X6). |
| X9 | **Stable loading in dialogs** | 3 dialogs | A dialog opens at its final size, with a skeleton of its content, not a spinner line (motion.md rule 3 applies inside dialogs). |
| X10 | **"Add" buttons** | 4 screens | Full-width bordered rows that look like empty list items ("Add MCP server", "New custom agent", "New automation", "New environment") become a normal `Button` with a + icon in the section header. |

## Findings by area

Fix: **P** = primitive or token (an X above), **L** = local to the screen.

### Dialogs (all modes)

| Id | Shot | Problem | Impact | Proposal | Fix |
|---|---|---|---|---|---|
| D-01 | 016, 017, 018, 019, 020, 052, 053, 062, 081 | Focus lands on the dialog container. In 025 it lands on Close, in 001 on the first field, and in Settings on the filter. A keyboard user has to Tab to reach anything, and the starting point differs from dialog to dialog. | high | X1 initial-focus rule. | P |
| D-02 | 017, 020, 061, 062, 081 + code | Footers: Cancel is `ghost` in 5 dialogs and `secondary` in others. OxeQuery settings and Environments say "Close". `SettingsCenter` puts danger first, `ThreadWorktreeFinishDialog` puts primary before danger, and `UnsavedWorkDialog` uses secondary>danger>primary. Report a problem has two secondary buttons and no primary. New connection has 4 buttons. | medium | X1 footer rule. New connection: "Test connection" stays at the start and "Connect without saving" moves into a menu on the primary. | P |
| D-03 | 001, 018, 021, 022, 031-diagnostics, 041, 046, 053, 060 | Uppercase micro-labels, mixed with sentence case in the same dialog (053 "PROJECT" above "Agent"). | medium | X2. | P |
| D-04 | 016, 025 | A 760 px dialog around a single line (loading, or an empty history). | low | X1 sizes: `sm` until there is content; empty states use `EmptyState` with an icon and a line saying why. | P |
| D-05 | 012 dark, 002/030 light, 031-appearance | Selected rows and cards don't read as selected: the dark palette's selected row is close to hover, and the light Mode card is gray. | medium | X7. | P |
| D-06 | 001, 047, OxeQuery import | Three folder pickers. New workspace wraps the field in a nested card with the label inside; Add project puts the label above with the hint below. | low | One `PathField` (label, field, Browse, hint) in `ui/Field`. | P |

### Global chrome and tools (OxeCode, rail, sidebar, panels)

| Id | Shot | Problem | Impact | Proposal | Fix |
|---|---|---|---|---|---|
| G-01 | 000 | First run: two "New workspace" buttons (sidebar and hero). The 4-step checklist is taller than the hero, and the other modes are a row of low-contrast links. | medium | One primary in the hero, and the sidebar's empty state becomes text only. The checklist collapses to its next step plus "3 more", and the modes become 4 tiles with an icon each. | L |
| G-02 | 016 | Project team: a 760 px dialog with a spinner line, which jumps when it loads. There are no `EmptyState`/`ErrorState` in `Teams/` (0 and 0 in the code). | medium | X9, plus an empty state ("No roles yet" and how to add one) and an error state with retry. | L |
| G-03 | 022, 023, 024, 026 | Tool panels: MCP is centered at 940 px, Skills is docked top-right with a scrim, Scripts and Activity are right panels with a centered pill title. Headers differ in order and content. | medium | X5. | P |
| G-04 | 023 | The palette says "Skills", the panel says "Agent skills". | low | "Skills" everywhere. | L |
| G-05 | 026 | Background activity: icon tabs, a title pill, Local jobs / Delegated work, then 5 status chips (4 levels). "Stopped" is clipped with no count. | medium | Remove the icon tabs (the rail already switches). Title, then a segmented Local / Delegated, then a status filter `Select` instead of the chips. | L |
| G-06 | 019 | Usage: the Codex card says "Claude account · checked". `UsageModal.tsx:44` maps every `oauth` source to `usage.source.oauth` = "Claude account". The cards are identical, with lots of empty space. | high | "{{provider}} account", one key with the provider name. Make the cards compact (one row per limit). | L |
| G-07 | 052 | Agent accounts: "Could not verify the connection…" is plain text inside each card, two primary "Connect" buttons sit in one dialog, and the footnote is a bordered box. | high | X4 danger callout in the card. Connect is secondary until it is the only next step. The footnote becomes plain `text-muted`. | P+L |
| G-08 | 014 | Workspace context menu: 320 px wide for 5 short items, and "Remove workspace" has no separator. | low | X6. | P |
| G-09 | 020 | Report a problem has no primary. | low | "Open on GitHub" is primary, "Copy text" secondary. | L |
| G-10 | 021 | Workspace settings pages use a different card design (gray section cards, uppercase labels, preview column) from Application pages. | medium | X3. Keep the preview, as a right column on ≥ 1200 px. | P |

### Code (OxeCode)

| Id | Shot | Problem | Impact | Proposal | Fix |
|---|---|---|---|---|---|
| K-01 | 010 | Pane header: provider, branch ("Branch unavaila…" truncated) and shell, plus 3 icons, repeated on 4 panes. The bottom bar says "Running" on each. The top-right strip has 6 icons with no labels. | medium | Branch only when it is known. Collapse to provider + title, with the rest in the tooltip. The toolbar strip shows labels at ≥ 1280 px or groups into "Tools ▾". | L |
| K-02 | 015 | Pane ⋯ menu: "RTK", "Caveman", "Semantic" with no explanation. | medium | Use the `hint` line: "RTK: compress command output", etc., with an icon per item (X6). | L |

### Settings

| Id | Shot | Problem | Impact | Proposal | Fix |
|---|---|---|---|---|---|
| S-01 | 021 vs 031-* | Application pages apply at once, Workspace pages need "Save workspace settings". People can't tell which kind of page they are on. | high | **Decision for the user:** apply at once in both scopes (recommended, with undo in a toast for the risky ones), or Save in both. | L |
| S-02 | 031-general, 031-terminal, 031-appearance, 031-devices | Four row layouts: General is cards with the control on the right; Terminal is grouped cards with full-width sliders; Appearance has no cards; Devices has card headers with a rule. | high | X3. | P |
| S-03 | all 031 at 1440 | Content is a 470–520 px column in a ~1000 px page, leaving a wide empty right side, and text is 12–13 px. | medium | X3 max width 720 px, body text 13 → 14 px in Settings. | P |
| S-04 | 031-keyboard | 40 rows, each showing "Change · Reset · Turn off". Reset shows even when nothing changed. | low | Show actions on row hover and focus. Reset only when the binding differs from the default. | L |
| S-05 | 031-notifications | "Scheduled automations" lives under Notifications. "Send test notification" floats centered between cards. | medium | Move automations to Agents (or their own page). The test button moves into the notifications card. | L |
| S-06 | 031-policy | A near-empty page: "No file." and only "Reload policy". | low | Show the file's path with "Open in editor" and "Create file" when it is missing. | L |
| S-07 | 031-diagnostics | "REFRESH" is the only uppercase button. Agent activity here says database and container requests "are listed in OxeQuery", so agent activity is split in two. | medium | Normal button. **Decision:** one Agent activity page with sources (Changes, Databases, Containers, and OxePost from T64). | L |
| S-08 | 002 at 900×620 | The Settings dialog fills the window, and the nav list scrolls (Devices and Diagnostics hidden). | low | Under 720 px tall, tighten the nav rows to 28 px and drop the descriptions. | L |

### OxeChat (what T58 does not already cover)

T58 covers the conversation, the composer and chips, the conversation menu (§7b), Conversation details (§7a) and
the side chat (§7c). They are referenced here, not repeated.

| Id | Shot | Problem | Impact | Proposal | Fix |
|---|---|---|---|---|---|
| C-01 | 055-approval at 900×620 | The approval card body is ~100 px with its own scroll: "Copy exact text" and most of a long command are hidden. "Approve command" appears as both the eyebrow and the card title. | high | X8: the card grows up to 60% of the conversation height and the timeline scrolls instead. One title. Expand/Hide become icon buttons with tooltips. | P+L |
| C-02 | 055-question | The pager (Previous · 1 of 2 · Next) sits on top, the eyebrow repeats "Claude needs your input", and "Answer" is disabled with no hint why. | low | Pager in the footer next to Answer. A disabled Answer gets the hint "Answer 2 more questions". | L |
| C-03 | 055-auth-failure | Sign-in failure said 3 times: the card "Sign-in required", the red "Failed", and the bottom bar "Sign in to Claude Code" with Reconnect/Retry. | high | One X4 danger callout in the timeline with Reconnect as its action. The bottom bar goes away. | P+L |
| C-04 | 041 (+ 900×620) | Two ⋯ buttons in one header. The right one has 20 items, and at 900×620 it is taller than the window ("Verbose" cut off). | medium | The right ⋯ becomes "View" (text size and transcript view). Panels go to the rail. Delegate, Side chat, Pin and MCP become header icons with tooltips. It complements T58 §7b. | L |
| C-05 | 055-empty | 4 suggestion cards wrap 3 + 1. | low | 2 × 2 grid at every width ≥ 560 px. | L |
| C-06 | 050 | Opening the side chat squeezes the conversation, so code blocks get a horizontal scrollbar. | low | T58 §7c overlay under 720 px; code blocks wrap at that width. | L |
| C-07 | 055-approval, 055-question | Stop is a filled accent square beside the accent Send. | medium | T58 §3: Stop in `intent-danger-solid`. | ref T58 |
| C-08 | 040 at 900×620 | The sticky first message overlaps the first activity row ("Read file README.md"). | low | Give the sticky message an opaque `surface-base` background and reserve its height. | L |
| C-12 | 055-approval | The sidebar badge "1" (11 px) is 3.56:1. | low | `intent-warning-fg` on `intent-warning-bg`, ≥ 4.5:1. | L |

### OxeQuery

| Id | Shot | Problem | Impact | Proposal | Fix |
|---|---|---|---|---|---|
| Q-01 | 060 | The sidebar says "Add connection", the main area says "New connection" (same action). The sidebar's empty text repeats the main empty state. | medium | "New connection" everywhere. The sidebar's empty state becomes one line. | L |
| Q-02 | 061 (+ 900×620) | New connection: 4-button footer; TLS and SSH below the fold; the environment control sits inside a gray inset panel. At 900×620 the body shows ~280 px. | medium | X1 footer. Environment as a plain segmented field. Advanced (TLS, SSH) as a disclosure with a summary ("TLS when offered · no tunnel"). | P+L |
| Q-03 | 062 | OxeQuery settings: "Close" + "Save"; a long scroll of selects; "Rows / Statement time" repeated 3 times. | low | X1 footer. The limits become a 3 × 2 table (environment × limit). | L |

### OxePod

| Id | Shot | Problem | Impact | Proposal | Fix |
|---|---|---|---|---|---|
| P-01 | 070 | "Remove…" (danger) in the header beside Stop/Restart/Terminal. Compose "Down…" is a red text link. Header buttons are ~22 px tall. | medium | Stop · Restart · Terminal stay. Remove moves into a ⋯ menu, last and after a separator (X6). Compose actions become buttons, with Down… in that menu too. Header buttons 28 px. | L |
| P-02 | 070 at 900×620 | Three columns fold into stacked cards under the logs; About is cut off at the bottom. | low | Under 1100 px, About becomes a tab next to Logs. | L |

### OxePost

| Id | Shot | Problem | Impact | Proposal | Fix |
|---|---|---|---|---|---|
| H-01 | 080, 083 | The empty response area takes half the height. The request name is an input under the URL bar and reads as a second URL field. | medium | The name becomes the editable title above the URL bar (like a document title). With no response yet, the request area takes ⅔. | L |
| H-02 | 080 | Import and Environments are plain links at the bottom of the sidebar. | low | Icon buttons in the sidebar header, next to New request. | L |
| H-03 | 081 | Environments: "Secrets cannot be stored here" is red text inside the form. The left column is empty except "+ New environment". Footer says "Close". | high | X4 warning callout at the top of the secrets section. With no environments, an empty state in the left column. X1 footer. | P+L |

## Split: 1.4.x quick wins and 1.5.0

**1.4.x** (small, local, low risk; each one is a FRONTEND PR with no new primitive):

- G-06 Usage provider label (bug).
- Q-01 "New connection" everywhere; G-04 "Skills" everywhere.
- G-09 Report a problem primary; S-07 "REFRESH" → normal button.
- D-02 partial: "Close" → "Cancel" in OxeQuery settings and Environments.
- G-08 and P-01 partial: separator before destructive items in existing menus.
- K-02 hints on the pane ⋯ menu.
- S-04 Keyboard actions on hover/focus.
- C-08 sticky message background; C-12 badge contrast.
- D-01 as a default in `ui/Dialog` only: focus the first focusable field, else the first footer button. Small, and it fixes 9 dialogs.

**1.5.0** (primitives and redesigns; these need the decisions below):

- X1 to X10.
- S-01 to S-03 Settings redesign; S-05 automations; S-07 one Agent activity page.
- C-01, C-03, C-04 (with T58).
- G-01 first run; G-02 Team states; G-03, G-05 tool panels.
- Q-02, P-01, H-01, H-03.

## Decisions for the user

1. **Settings save model** (S-01): apply at once in both scopes (recommended), or Save in both.
2. **One Agent activity page** with sources (S-07), instead of one in Diagnostics and one in OxeQuery/OxePod.
   Recommended: yes, since T64 adds a third source.
3. **The OxeChat header** (C-04): the right ⋯ becomes "View", and the panels move to the rail. Recommended: yes.
4. **Catalogs as dialogs, working panels docked** (X5). Recommended: yes.

## Appendix A: inventory

From `git grep` on `src/` at 68100918 (counts of opening tags):

- **Primitives:** `ui/Overlay` (Dialog, Popover, Menu), `ui/ConfirmDialog`, `ui/ToolPanel`, `ui/Modal` (used only by
  `SettingsCenter` and `WorkspaceSettingsModal`), `ui/CommandPalette`, `ui/Toast`.
- **Dialogs without `size`:** 19, among them `ThreadDialogs` (×2), `ThreadSidebar`, `ThreadProjectSettingsDialog`,
  `ThreadReviewHost` (×5), `ThreadCommandDialog`, `ProviderAccountsPanel`, `TerminalPane`.
- **Dialogs restyled by their own classes:** 24 files. The largest are `oq-scope` (OxeQuery, 20 rules),
  `thread-create-dialog` (15), `team-dialog` (5), `thread-accounts-dialog` (4) and `thread-command-dialog` (4).
- **Hand-built `role="dialog"` outside `src/ui`:** `SlashOverlay`, `DesignGrabSheet`, `NativePreviewHost`,
  `TerminalFocusHost`, `ApprovalDialog` (×3), `DesignSystemPage`. They should move to a primitive or explain why
  not.
- **States per area** (`EmptyState` / loading / `ErrorState`): Threads 34/34/33, OxeQuery 10/9/25, OxePod 8/5/9,
  OxePost 2/3/6, **Teams 0/1/0**, Settings 6/3/16, Grid 1/0/0, Sidebar 3/0/0.
- **Hard-coded values in CSS:** `OxeQuery.css` has 23 `font-size` and 8 `border-radius` in px; `ThreadView.css` has
  7 radii in px; 5 hex colors exist outside the token file.

## Appendix B: gaps

| Surface | Why not captured | Covered by |
|---|---|---|
| Title-bar menus (File, Edit, View, Tools, Help) | On Linux the menu bar is not a DOM button in the mock | code (`Navigation/AppMenuBar.tsx`) |
| Workspace scope from the Settings dialog | The scope button did not respond in time | 021 (same pages, opened by command) |
| Rename and delete from the conversation menu | The dialog did not open after the menu item in the capture | code; T58 §7b |
| Conversation details panel | The menu item was not found | T58 §7a |
| OxeChat sidebar context menu, usage ring popover | Selectors did not match | code |
| OxeQuery import | Opens a native file dialog | code |
| Toasts (70 call sites) | None fired in the scripted path | `design-system-states` baseline; a toast pass is a follow-up |

The capture spec (`e2e/visual/audit-1.5.spec.ts`) is audit-only and must be removed before this PR leaves draft.
