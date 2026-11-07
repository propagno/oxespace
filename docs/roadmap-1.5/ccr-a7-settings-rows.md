# CCR A7: the Settings pages on SettingRow/Section (1.5.0 F2: U8, plus U9 and U10)

Owner: FRONTEND. Status: design for review (M5: DESIGN, HML, then TECH LEAD puts it in the F2 PLAN.json). No product
code in this PR. The frozen test is `tests/acceptance/f2/a7-settings-rows.test.ts`; it is red today for the reasons in
section 5. Acceptance: SPEC A7, "the Settings pages use SettingRow/Section (U8): they apply at once, with an undo toast
on the risk list and a confirmation on what is irreversible". Design: playground `#settings-*` (approved 04/11),
`playground/src/components/Settings.tsx`, and UA10 in `team/plans/1.5.0-ui-acceptance.md`.

## 1. What main does today

Read on main at 60e310d9.

| Piece | Today |
|---|---|
| U2 primitives (`src/ui/Settings.tsx`, #591) | `SettingsSection` (title, description, actions, children), `SettingRow` (label, description, control, htmlFor, wide), `applyWithUndo({ apply, undo, done })`. |
| Pages on them | **None.** Every page hand-builds its rows (`settings-general` sections, page CSS). |
| Undo on risky changes | 8 places already toast with Undo (section 3, "today ✓"). |
| Confirm on irreversible ones | Unpairing a phone, deleting a custom agent, allowing a tool rule, the firewall rule (P1), memory notes. |
| Gaps | Deleting an automation and removing the search-by-meaning model happen at once, with no confirmation. "Reset all" shortcuts drops every custom chord with no undo. |

## 2. The anatomy (U8)

Every page in scope renders: `<h2>` page title, a short intro, then one `SettingsSection` per group, each holding
`SettingRow`s. A row is label + description on the left, the control on the right (`control`), or a `wide` row for
lists and editors. A section's add or bulk action (U10) sits in the section's `actions` slot, as a secondary `sm`
button that starts with a verb: "Add a profile", "New automation", "Clear history…" (an ellipsis when it asks first).

**Changes apply at once.** No page-level Save. The only Save kept is where the value is typed text that would be
invalid mid-typing: the computer name on Devices (UA10: "computer name with Save and Use default"), and the forms
inside dialogs (custom agent, new automation), which are dialogs, not pages.

**Typed values apply on blur or Enter, and only when valid** (HML-A7-3). A text or number field (font family, font
size, a custom agent's command, a shell path) applies when it loses focus or on Enter, never per keystroke, and only
when its value is valid. An invalid value shows the field's own error and is not applied. Escape puts back the applied
value.

**A change that fails to apply says so in its row** (HML-A7-2). The control goes back to the applied value, and the row
shows an alert, "Couldn't change <setting>: <reason>", with **Try again**. `SettingRow` takes
`error?: { message: string; onRetry?: () => void }` and draws it, so every page fails the same way. The reason is the
main message in the interface language, never a stack trace.

**Loading (U9).** A page that reads from main shows `LoadingState` in the place of its sections. Never a spinner that
moves the layout, and never empty sections that fill in later. An error is `ErrorState` with Try again in that place.

### Pages in scope

| Page (nav id) | File | Sections (playground names) |
|---|---|---|
| General | `SettingsModal.tsx` (`GeneralSettings`), `ExternalEditorSetting.tsx`, `SeenSitesSetting.tsx` | Basics · Privacy · External editor |
| Agents (providers) | `SettingsModal.tsx` (providers, idle, semantic, hooks) | Agent for new tasks · Custom agents · Idle sessions · Search by meaning · Hooks |
| Appearance | `AppearanceSettings.tsx` | Theme · Reading |
| Terminal | `SettingsModal.tsx` (terminal) | Look · Shells and agent commands · Resuming |
| Keyboard | `KeyboardSettings.tsx` | Shortcuts (one row per chord; "Reset all" in the section actions) |
| Notifications | `SettingsModal.tsx` (notifications) | On this computer |
| Updates | `SettingsModal.tsx` (updates), `UpdatePreferences.tsx` | Updates · Bundled tools |
| Tools | `ToolsSettings.tsx` | Modes · Rules · Policy |
| Automations | `AutomationsSettings.tsx` | Automations ("New automation" in actions) |
| Policy (workspace) | `PolicySettings.tsx` | Policy file · Rules |
| Devices | `DevicesSettings.tsx` | Phone connection · Name of this computer · Paired phones · Typing in terminals · What a phone can do |
| Workspace | `WorkspaceSettingsModal.tsx` | Layout · Default shell · Projects |

Out of scope here: Agent activity (A11, its own CCR), Diagnostics (a report, not settings), OxePost collection access
(T64, phase E), network access and access-for-new-tasks (not on main; they arrive with their own items).

## 3. The risk list: apply at once, then an undo toast

A change is on the list when it widens what an agent or a phone may do, or loses data the person can't easily get back.
The toast is `applyWithUndo` (or the same `toast({ action: { label: ui.undo } })`): the change is already applied; Undo
puts the previous value back. Narrowing a permission, or putting a value back, never toasts.

| # | Change | Where | Undo toast says (en) | Today |
|---|---|---|---|---|
| R1 | Resume sessions that skipped prompts the same way: on | Terminal › Resuming | "Resumed sessions no longer ask" | ✓ (#591) |
| R2 | A tool group's mode widened (to Allow) | Tools › Modes | `tools.modeSaved` | ✓ |
| R3 | A tool rule set to Allow (after its confirm) | Tools › Rules | `tools.rules.saved` | ✓ |
| R4 | An MCP server added from the catalog | Tools / MCP | `mcp.catalogAdded` | ✓ |
| R5 | An OxeQuery connection's agent access widened | OxeQuery connection | `form.agentsWidened.*` | ✓ |
| R6 | OxeQuery preferences made riskier | OxeQuery preferences | `preferences.riskySaved` | ✓ |
| R7 | A custom agent's command changed | Agents › Custom agents | `agentConfig.commandChanged` | ✓ |
| R8 | Phone connection turned on | Devices › Phone connection | `devices.gateway.on` | ✓ |
| R9 | Workspace default shell changed | Workspace › Default shell | "Default shell changed" | ✓ (#591) |
| R10 | **Reset all shortcuts** | Keyboard | "Shortcuts reset to the defaults" | **new**: drops every custom chord at once today |

Not on the list: forgetting the sites the browser has seen (General › Privacy) narrows access, since each site asks
again, so it keeps its plain toast.

Thread-level permission changes (`ThreadPermissionsPanel`, auto-approve reads, an allow rule) already toast with Undo
and stay as they are; they are not a Settings page.

## 4. The irreversible list: ask first (`ConfirmDialog`, Cancel focused)

| # | Action | Where | Today |
|---|---|---|---|
| I1 | Unpair a phone | Devices › Paired phones | ✓ |
| I2 | Delete a custom agent | Agents › Custom agents | ✓ |
| I3 | Allow a tool rule (`danger`) | Tools › Rules | ✓ |
| I4 | Add or remove the Windows firewall rule (P1) | Devices › Phone connection | ✓ |
| I5 | Delete or reset a memory note | Workspace › Memory | ✓ |
| I6 | **Delete an automation** | Automations | **new**: deletes at once today |
| I7 | **Remove the search-by-meaning model** | Agents › Search by meaning | **new**: removes the downloaded model at once today; getting it back is a large download |

A confirmation names the thing ("Delete the automation "Nightly deps"?"), says what can't be undone, and its
confirm button repeats the verb ("Delete"). Escape and Cancel change nothing.

## 5. Frozen test (red today, for these reasons)

`tests/acceptance/f2/a7-settings-rows.test.ts` reads the sources, like the F1 frozen tests:

1. Every page file in section 2 imports `SettingsSection` and `SettingRow` from `src/ui`. **Red:** none does today.
2. R1–R10: the file that owns each change shows an Undo for it (`applyWithUndo` or `ui.undo` in the same file, plus
   the change's own key). **Red:** R10 (KeyboardSettings).
3. I1–I7: the file that owns each action renders a `ConfirmDialog`. **Red:** I6 (AutomationsSettings) and I7
   (the search-by-meaning model in SettingsModal).
4. No page-level Save: `common.save` / a `.save` key appears in no page file, except `DevicesSettings` (the computer
   name).

`tests/acceptance/f2/a7-settings-behavior.test.tsx` renders the three NEW items and the failure rule, checking what a
person sees (HML-A7-1):

5. **R10:** Reset all shortcuts empties the overrides, a toast offers Undo, and Undo puts the custom chords back.
6. **I6:** an automation's Delete opens a dialog naming it, with Cancel focused. Escape keeps it; Delete removes it.
7. **I7:** "Remove downloaded model" opens a dialog that says a new download is needed, with Cancel focused. Escape
   keeps the model. `SemanticIndexSetting` moves from `SettingsModal.tsx` to its own module,
   `src/components/Settings/SemanticIndexSetting.tsx`, so it can be rendered alone (it also shrinks SettingsModal,
   which is on the file-size baseline).
8. **HML-A7-2:** `SettingRow` with `error` shows the alert "Couldn't change Font size: <reason>" and a Try again that
   calls `onRetry`.

**Red today:** the whole file, because `SemanticIndexSetting` isn't its own module yet; and each case on its own, as
none of the four behaviours exists.

The rest of the behaviour (R1–R9 toasts, the other confirms, typed fields on blur) is checked by the e2e named in SPEC
A7, `e2e/settings-*.spec.ts`, which the executor writes. The executor must not edit the frozen tests.

## 6. Questions for review

- **DESIGN:** the section names in section 2 come from the playground; confirm them for pages the playground does not
  show (Updates › Bundled tools, Tools › Policy).
- **HML:** R1–R10 and I1–I7 are the black-box list for the settings pass.
