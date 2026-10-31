# Visual polish audit, 1.4 (from the committed baselines)

Status: draft · Owner: DESIGN/PRODUCT · For: FRONTEND, picked up per area · Date: 2026-10-31
Source: `e2e/visual/__screenshots__/win32/` (Linux has the same set) on origin/main 21fc9fab: anchor surfaces
(light/dark, compact/comfortable, pt-BR, forced colours), Code, Thread, Settings, OxeQuery/OxePod, the design-system
page and the splash. No heavy run was needed.

**Caveat: the baselines are older than F12 (#188) and F6 (#197).** They still say "Code"/"Thread" and show English
in pt-BR. Items marked *(verify)* may already be fixed on main; FRONTEND checks them in the next baseline batch
(once per batch on main, as agreed) before working on them. Everything else is layout and visual, and it is still
in the current code.

Severity: **H** looks broken or hides meaning · **M** below product grade, noticeable · **L** polish.

## 1. App shell (all modes)

| # | Sev | Finding | Fix |
|---|---|---|---|
| V1 | **H** | **Forced colours: pane status dots disappear.** In `workspace-light-desktop-forced-colors`, the four panes' footer dots are gone, so the running/idle state has no sign at all. The sidebar dot survives. | `StatusDot` with a system-colour border and `forced-color-adjust` on the dot (catalog audit #323 §2), and a test in the forced-colours e2e |
| V2 | M | **The status bar uses the monospace font** for its whole text ("4 panes · terminal", "Nenhum projeto selecionado"), unlike the rest of the chrome. | UI font; monospace only for values (paths, branch) if anywhere |
| V3 | M | **The bottom-left sidebar icon changes meaning by mode**: a layout icon in Code, a person icon in Thread, a disk icon in OxePod, beside the same theme/settings/collapse trio. | One footer: mode-specific actions in the sidebar header; the footer keeps only the shared trio |
| V4 | M | **The mode switch's count badge is clipped**: the "1" on Thread (`thread-approval`) sits on the pill's top edge and is cut. | Badge inside the pill's padding, or an offset with `overflow: visible` on the switch |
| V5 | L | The trailing title-bar items sit tight against the bell (F35 removes Team; re-check spacing after). | `--space-2` between trailing items |
| V6 | L | Focus accent is green in light and ochre in dark (intended by the tokens). Fine, but the **focused pane border** in dark (ochre, 1 px) is the only cue of focus among 4 panes and is faint. | 2 px focused-pane border, or a header tint, in both modes |

## 2. OxeCode: workspace, panes, panels

| # | Sev | Finding | Fix |
|---|---|---|---|
| V7 | **H** | **Shell panes have no title.** In the 4-terminal layout each pane header shows only the terminal icon and a large empty bar, while the sidebar names them "terminal 1…4". | Header title = the sidebar's name (`paneDisplay.title`), always |
| V8 | M | **Two "⋯" per pane** (header and footer), with no visible difference. The footer is otherwise a dot and empty space. | One overflow menu, in the header. The footer shows status words ("Running") or is removed when empty (it already shows "Running" in single-pane shots) |
| V9 | M | **A whole toolbar row for five icons** (changes, preview, layout, MCP, activity) above the grid, with nothing else in it: about 40 px of height lost on every screen. | Move them into the workspace header line or the sidebar header; keep labels in tooltips |
| V10 | M | **"Workspaces" twice**: the panel title and the section label right under it. | Drop the section label when there is one section |
| V11 | M | **Sidebar tree weight and alignment.** Every terminal row is bold; the workspace's status dot sits above the text baseline (top-left of "demo-repo"); the indent guide is drawn as broken segments. | Regular weight for children and bold only for the selected one; dot centred on the first line; one continuous guide |
| V12 | M | **"Branch unavailable" truncated three times on one screen** (pane header "Branch unavaila…", panel chip "Branch unava…", GitHub chip "Branch un…"), each in a different style. | Short state words ("Sem branch" / "No branch") in one chip style; show it once (the pane header) |
| V13 | M | **Changes panel: four chip styles in three rows** (Branch ⌄ pill, main ⌄ pill, HEAD ⌄ white pill, "Classic" grey, TS/MD file badges). | `Badge`/`Select` primitives only (#323 §3 `Chip`); one compare row |
| V14 | M | **GitHub panel: icon-only tabs and three control rows** before the content (two unlabelled tabs, a branch chip with 4 icon buttons, then "Local Git · any remote"). | Labelled tabs ("Mudanças", "GitHub"); one header row |
| V15 | L | The diff's "mark viewed" control is an empty circle with no label. | `Checkbox` with "Visto" / "Viewed", like the "0/2 viewed" counter it updates |
| V16 | L | Command palette: group headers are UPPERCASE with letter-spacing, while every other section label in the app is sentence case; "Terminal 1" here vs "terminal 1" in the sidebar. | Sentence-case group headers; one capitalisation for default pane names |

## 3. OxeChat (Thread)

| # | Sev | Finding | Fix |
|---|---|---|---|
| V17 | **H** *(verify)* | **The approval card shows an empty grey bar** (the "readable preview" squashed to a line, P1-8). #243 fixes it. | Re-check in the batch after #243 |
| V18 | M | **"Approve command" twice**: the dock label above the card and the card's own header. | Keep the card header; the dock row keeps only Expand/Hide |
| V19 | M | **State words differ from the shared vocabulary**: the sidebar's "Needs Input" (Title Case, English) next to a dot; the glossary says "Precisa de você" / "Needs you". | `agents.state.*` (S7 #313, glossary §5) |
| V20 | M | **Sidebar rows change height**: a long title wraps to two lines because the state badge takes the width ("Update the Thread / guide"). | Title one line with ellipsis; the badge shrinks to a dot + tooltip below 260 px |
| V21 | M | **File changes listed twice** in a finished turn: the "Edited src/App.tsx / Added …" rows, then the "Edited 2 files" card with the same files. | One list: the card, with the rows' expand action inside it |
| V22 | M | **Unlabelled icon buttons**: the quote button beside "Copy" on the final response; in the composer, the slash, gauge and eye controls. | Label or tooltip with `withShortcut`; the quote gets the text "Citar" / "Quote" |
| V23 | L | "Projects" with a ≡ icon whose meaning (sort? sections?) isn't clear. | Use the sections menu icon with a tooltip, or a "Seções" label |
| V24 | L *(verify)* | The composer's voice button (F34 removes it) and "New thread" title (F12: "Nova conversa"). | Batch re-check |

## 4. Settings

| # | Sev | Finding | Fix |
|---|---|---|---|
| V25 | M | **Appearance mode cards are misaligned**: the "Dark" card's title sits about 9 px higher than "System" and "Light", because its preview is shorter. | Same preview height on all three cards; titles on one baseline |
| V26 | M | **The breadcrumb says "Settings › Application" on the Appearance page.** | The breadcrumb ends with the page: "Configurações › Aplicativo › Aparência" |
| V27 | L | "Application" twice in the sidebar (the "Settings for" picker and the group label), and a single-option picker that looks like a selected list item. | Hide the picker when there's one scope; the group label is enough |
| V28 | L *(verify)* | "Voice" in the settings nav (F34 removes it). | — |

## 5. OxeQuery and OxePod

| # | Sev | Finding | Fix |
|---|---|---|---|
| V29 | M | **The SQL editor's toolbar wraps into three uneven rows** at 718 px: Run/Run all/Explain/Analyze/Format, then Limit + "60 s", then Begin transaction/Library/Ask agent alone on the right; then two more rows above the grid (pagination, Import/Copy as…, Structure/Filter/DDL/Edit rows). That makes **five control rows** before the first data row. | Primary row: Run, Run all, Limit, ⋯ (Explain, Analyze, Format, Library); transaction and Ask agent in the editor header; grid actions in one row |
| V30 | M | **Column type hints are cut** ("int4…", "tex…") at default widths. | Type under the name in a second line, or in the header tooltip |
| V31 | M | **Tree rows show their actions all the time** ("users Query Structure 📌"). | Actions on hover/focus only, as in the other trees |
| V32 | M | **OxePod: destructive actions are bare red text** ("Remove…", "Down…") next to framed buttons (Stop, Restart, Logs). | `Button variant="danger"` (framed) or move them into ⋯ |
| V33 | L | OxePod: the "About" card sits alone under a two-column row, leaving an empty right column. | Single column below 1100 px, or About spans both columns |
| V34 | L | The "local" and "read-write" connection chips use two unrelated colours; "read-write" orange reads like a warning. | `Badge` intents: neutral for local, warning only for production or write access to production |

## 6. Design-system page and states

| # | Sev | Finding | Fix |
|---|---|---|---|
| V35 | M | **Empty/success state actions look under 24 px tall** ("Start one", "Open it") at the catalog's scale. | Check the `EmptyState`/`SuccessState` action size against `--target-min`; the target-size lint covers 12 targets but not these |
| V36 | L | The page's lead is English only and the page has no language toggle (catalog audit #323 §5). | As #323 |
| V37 | L | Loose spinners next to the "Saving" chip with no caption look like a rendering glitch. | Caption each specimen ("Spinner sm / md") |

## 7. What's good (keep)

- The empty OxeChat conversation (starters, folder and access chips) and the onboarding hero read as a product.
- Error states, in both modes: words first, Details closed, one "Try again".
- Light/dark parity of the state primitives; the ochre accent in dark is warm and readable.

## 8. Order for FRONTEND

1. **H:** V1 (forced colours dots), V7 (pane titles); V17 after #243.
2. **M, one PR per area:** shell (V2, V3, V4), Code (V8 to V14), Thread (V18 to V22), Settings (V25, V26),
   OxeQuery/OxePod (V29 to V32), states (V35).
3. **L** with the area PRs, or with the matching primitive work from #323.
4. Then regenerate the baselines once, on main, in the batch.
