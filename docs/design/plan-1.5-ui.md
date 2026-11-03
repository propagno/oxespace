# 1.5.0 UI plan

Status: **proposal**. Owner: DESIGN. The TECH LEAD confirms the owners and the order.

This plan breaks the 1.5.0 design work into items one PR each can carry. Its sources:

- the audit, `audit-1.5.md` (ids X1–X10, D-, G-, K-, S-, C-, Q-, P-, H-);
- T58, `t58-oxechat-conversation.md` (§ numbers);
- the decisions the user took on 03/11, recorded in both docs.

Already scheduled elsewhere, so not repeated here:

- T57 (composer chips, 1.4.1);
- T60 (side chat close, 1.4.1);
- T66 (MOBILE, the audit's 1.4.x quick wins);
- T67 (FRONTEND, C-01 approval card, 1.4.1);
- T64 (OxePost agent access, BACKEND).

## Rules for every item

- **One PR per item** from `origin/main`, through the train.
- Visual baselines are refreshed **once per batch on main**, not per PR. A PR that changes a baseline says which
  shots.
- A primitive change ships with its test:
  - a unit test for behavior (focus, footer order);
  - a `design-lint` rule for anything that can drift (uppercase, size, raw px).
- Token value changes are contract **C4**: the Android app reads the token export, so MOBILE checks the app in the
  same PR.
- Done means:
  - light and dark checked;
  - 900×620 checked;
  - keyboard path checked (Tab order, Esc, focus return);
  - axe clean on the touched surfaces.

## Wave 0: unblockers

They come first because the rest builds on them. U1 and U2 can run in parallel.

| Id | Item | Audit / spec | Owner | Depends on | Notes |
|---|---|---|---|---|---|
| U1 | **Dialog contract in `ui/Dialog` and `ui/ConfirmDialog`** | X1, D-01, D-02, D-04 | FRONTEND | — | `size` required (sm/md/lg/xl). Initial focus rule: the first field, else the safe action, never the container. Footer API with slots: `extra` (start), Cancel (always "Cancel", secondary), primary or danger (end). Lint: no `className` restyling the dialog box. Unit tests for focus and order. The primitive only, with no screen migrations. |
| U2 | **`SettingRow`, `SettingsSection` and the Settings shell** | X3, S-01, S-03 | FRONTEND | — | Row anatomy, wide variant, section card, page max 720 px, 14 px body. Apply-at-once for both scopes, with an **undo toast** for the risky changes; the risky list comes from the TECH LEAD. Removes "Save workspace settings". |
| U3 | **`SectionLabel` and the uppercase lint** | X2, D-03 | MOBILE | — | Sentence case, `text-xs` semibold, `text-secondary`. A `design-lint` rule bans `text-transform: uppercase` outside the token export. Replaces the 12 sites in the same PR. |
| U4 | **Selected-state roles** | X7, D-05 | MOBILE | — | `fill-selected` dark → accent 3, with `accent-border` on selected cards and rows. A C4 value change: check Android in the same PR. |

## Wave 1: migrations and primitives that need wave 0

| Id | Item | Audit / spec | Owner | Depends on | Notes |
|---|---|---|---|---|---|
| U5a | Migrate OxeChat dialogs to U1 | D-01/02, G-07 (footer part) | FRONTEND | U1 | `ThreadDialogs`, `ThreadSidebar`, `ThreadProjectSettingsDialog`, `ThreadCommandDialog`, `ProviderAccountsPanel`, `ThreadWorktreeFinishDialog`, `ThreadReviewHost`. Removes the `thread-create-dialog` and `thread-accounts-dialog` overrides. |
| U5b | Migrate OxeQuery, OxePod and OxePost dialogs to U1 | D-02, Q-02, Q-03, H-03 (footer) | MOBILE | U1 | Removes the 20 `oq-scope` dialog rules. New connection: Test stays at the start and "Connect without saving" moves into the primary's menu. Environments and OxeQuery settings say "Cancel". |
| U5c | Migrate the remaining dialogs to U1 | D-01/02 | MOBILE | U1 | About, Shortcuts, Usage, Report a problem, Team, Delegation, Devices, Approvals, Agents, New workspace, Unsaved work, Terminal restore. |
| U6 | **`Callout` primitive and its four uses** | X4, G-07, H-03, C-03, S-06 | MOBILE | — (uses in dialogs after U5) | Info, warning and danger, each with an icon and an optional action. Accounts (danger), Environments secrets (warning), the OxeChat sign-in failure (one danger callout with Reconnect, bottom bar removed), Policy (info with Create/Open file). |
| U7 | **Menu rules in `ui/Menu` and the 15 menus** | X6, G-08, K-02 | MOBILE | — | Width fits content (200–320 px), sentence-case groups, destructive last after a separator, `hint` lines, split over 12 items. Includes the OxePod ⋯ (P-01 menu part). |
| U8 | **Settings pages on U2** | S-02, S-04, S-05, S-06, S-08, G-10 | FRONTEND (Application) + MOBILE (Workspace) | U2, U3 | Each page uses the same row. Keyboard actions on hover/focus (if T66 didn't already). Automations move to Agents. Policy file actions. Workspace pages keep the preview as a right column at ≥ 1200 px. |
| U9 | **Stable loading in dialogs, Team states** | X9, G-02 | FRONTEND | U1 | Dialogs open at their final size with a content skeleton. Teams gets `EmptyState` and `ErrorState` with retry. |
| U10 | **"Add" buttons** | X10 | MOBILE | U3 | MCP, Agents, Automations, Environments: a `Button` with a + icon in the section header. |

## Wave 2: structure

| Id | Item | Audit / spec | Owner | Depends on | Notes |
|---|---|---|---|---|---|
| U11 | **Tool panels: one anatomy, catalogs as dialogs, working panels docked** | X5, G-03, G-04, G-05 | FRONTEND | U1 | MCP and Skills open as `Dialog lg`. Scripts, Background activity, Linear and Semantic dock on the right with one header (icon, title, count, actions, close). Background activity drops to 2 tab levels with a status `Select`. "Skills" everywhere. |
| U12 | **One Agent activity page with sources** | S-07, T64 §6 | FRONTEND (+ BACKEND for the query) | U2 | Settings › Agent activity with sources: Changes (today in Diagnostics), Databases, Containers, and OxePost when T64 lands. Same columns, filters and T63 detail modal. Diagnostics and OxeQuery link to it. BACKEND: one read across the two audit stores, or the page queries both (the TECH LEAD decides). |
| U13 | **Short-window rules** | X8 | FRONTEND | U1, U7, T67 | Docked cards at most 60% of the conversation height (generalizes T67 to the question card). A dialog body of at least 240 px before the footer stops being sticky. Menus split per U7. |
| U14 | **OxeChat header: "View" menu, panels to the rail** | C-04 | FRONTEND | U7, U11 | The right ⋯ becomes "View" (text size, transcript view). Delegate, Side chat, Pin and MCP become header icons with tooltips. Workbench panels move to the rail. |

## T58 (OxeChat), by section

| Id | Item | Spec | Owner | Depends on |
|---|---|---|---|---|
| T58-a | Messages: your bubble, the agent's reply without a bubble, provider avatar, code blocks, hover actions | §2.1, §2.2 | FRONTEND | — |
| T58-b | Tool rows: 3 px bar by kind, grouping, expand in place | §2.3 | FRONTEND | T58-a |
| T58-c | Approval card visuals and turn status | §2.4, §2.5, C-02 | FRONTEND | T67, U13 |
| T58-d | Message box: box, strip, Send, **Stop in danger** (C-07), Steer | §3 | FRONTEND | T57 |
| T58-e | Chips: full access in danger, pending dashed border, "Provider's choice" | §4 | FRONTEND | T57 |
| T58-f | Narrow widths | §5 | FRONTEND | T58-d, T58-e |
| T58-g | Conversation details: summary header, disclosures with summaries, no cards | §7a | MOBILE | U3, T58-e (chips) |
| T58-h | Conversation menu: groups, slash-command column, Delete alone | §7b | MOBILE | U7 |
| T58-i | Side chat visuals: drawer, header, empty state, read-only chip | §7c | FRONTEND | T60, T58-e |
| T58-j | Small OxeChat fixes: suggestions 2 × 2, sticky message background (if T66 didn't) | C-05, C-08 | MOBILE | — |
| T58-k | Visual baselines for §7 | §7 | FRONTEND | the batch on main |

## Area redesigns (1.5.0)

| Id | Item | Audit | Owner | Depends on |
|---|---|---|---|---|
| A1 | First run: one primary, the checklist collapses to its next step, mode tiles | G-01 | FRONTEND | U3 |
| A2 | Pane header and toolbar strip | K-01 | FRONTEND | U7 |
| A3 | OxePod: header actions, Remove and Down… in the ⋯ menu, 28 px buttons, About as a tab under 1100 px | P-01, P-02 | MOBILE | U7 |
| A4 | OxePost: name as the title, request ⅔ while there is no response, sidebar header actions | H-01, H-02 | FRONTEND | coordinate with T64 (same view) |
| A5 | OxeQuery: New connection layout (environment field, Advanced disclosure), settings limits table | Q-02, Q-03 | MOBILE | U5b |
| A6 | Path field primitive for the three folder pickers | D-06 | MOBILE | U1 |
| A7 | Hand-built `role="dialog"` surfaces: move to a primitive or document why not | Appendix A | FRONTEND | U1 |

## Order at a glance

```
Wave 0:  U1 ─┬─ U5a, U5b, U5c ─┬─ U9, U11 ─ U14
             │                 └─ U13 (with T67, U7)
         U2 ─┴─ U8, U12
         U3 ─── U8, U10, A1, T58-g
         U4     (independent; C4 check)
Any time: U6, U7 ─ T58-h, A2, A3; T58-a ─ T58-b; T58-d/e (after T57) ─ T58-f
```

Suggested load: FRONTEND carries U1, U2, U9, U11–U14 and most of T58. MOBILE carries U3–U7, U10, the migrations
U5b/U5c, T58-g/h/j and A3/A5/A6. U1 and U2 should be in review before anything in wave 1 starts.

## Open points for the TECH LEAD

1. The list of **risky settings** that get an undo toast (U2). Proposal: the ones that change what agents may do or
   what is stored, such as policy-affecting toggles, phone connection, the update channel and clearing data.
2. **U12 data:** one backend query across the audit stores, or the page reads both.
3. Whether **U4** (selected-state roles) ships in 1.5.0 or waits for the Android release that reads C4.
