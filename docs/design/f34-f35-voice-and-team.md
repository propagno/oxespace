# F34 · OXEVoice removal and F35 · Team off the title bar (design spec)

Status: draft for review · Owner: DESIGN/PRODUCT · Implements: F34 (FRONTEND, screen), B21 (BACKEND, main and
package), F35 (FRONTEND) · Date: 2026-10-31 · Decided by the user on 31/10 (plan.md "Decisions taken")

Goal of both: **remove without leaving anything orphaned**. No gap where a button was, no shortcut that does nothing,
no settings page that links to nothing, no file left on disk without the person knowing, no feature that silently
became harder to reach.

## F34 · Remove OXEVoice from the interface

Outcome: no microphone in OXESpace in 1.4. The only voice input is the operating system's own dictation, which already
types into any text field. Native cross-platform voice returns in 1.5 (plan.md).

### Inventory: every place voice shows today (origin/main 21fc9fab)

| Where | What the person sees | After F34 |
|---|---|---|
| Terminal pane (`TerminalPane.tsx`) | mic toggle in the pane, `VoiceHud` overlay while listening or transcribing | removed; the header keeps its order with no gap (see "Layout" below) |
| Editor pane (`EditorPane.tsx`) | `Mic`/`MicOff` button in the editor header | removed |
| OxeChat composer (`ThreadComposerForm.tsx`, `ThreadView.tsx`) | mic button in the composer toolbar, `VoiceHud` above the draft | removed; the composer toolbar closes up |
| Command palette (`code.commands.ts`, `settings.commands.ts`) | "Toggle voice input" (`toggle-oxevoice`) and the Settings page entry "Voice" | removed; searching "voz", "voice" or "microfone" finds no command (no dead entry) |
| Keyboard (`keybindings.ts`) | `voice.toggle` `Mod+Shift+V`; push-to-talk `Ctrl+Shift+Space` (`voice.store`) | both removed from the catalog and the keyboard guide; see "Freed shortcuts" |
| Settings (`SettingsCenter.tsx`, `SettingsModal.tsx`) | "Voz" section: model size (tiny/base/small), download, hotkey | section removed from the nav; see "Settings link" |
| Keyboard settings | the voice hotkey row | removed |
| Thread shortcuts (`useThreadShortcuts.ts`) | global voice events | removed |
| Renderer storage | `oxe-voice-prefs` | deleted once on first start after the update |
| Bundle | `VoiceHud`, `VoiceHudSlot` (#302), `useOxeVoice`, audio worklet/VAD/WAV | removed; the bundle gets smaller (F34 acceptance) |

The `Mod+Shift+V` binding and the voice rows are also listed by the live catalog and the keyboard guide; both are
generated, so removing the catalog entries is enough. HOMOLOGATION checks the guide.

### Layout after removal (no gaps)

- **Terminal and editor headers:** the remaining actions keep their order and spacing tokens (`--space-1` between
  icon buttons). Nothing replaces the mic button and no placeholder is reserved. At the 240 px minimum pane width
  (#310) the header gains about 28 px, which goes to the title.
- **OxeChat composer footer:** today it is "+" menu (attach, commands, mentions) · configuration bar · steer (while
  running) · **voice (`AudioLines`, `.thread-voice`)** · send. The voice button sits right before send; removing it
  leaves send at the end with steer next to it. No re-ordering, so muscle memory for send holds; the `.thread-voice`
  styles go with it.
- Visual baselines for these three surfaces change; they are regenerated in the batch on main
  (feedback: baselines once per batch), not in the F34 PR.

### Freed shortcuts

- `Mod+Shift+V` and `Ctrl+Shift+Space` are **not reassigned in 1.4**. They come back for native voice in 1.5, and
  reusing them now would teach a meaning that changes in one release. In a terminal they go to the shell again.
- If the person rebound the voice hotkey, the custom binding is dropped with the rest of `oxe-voice-prefs`.

### Settings link (nothing points to nothing)

- `SettingsPageId` loses `voice` (`ui.store.ts`). Any deep link to `settings:voice` (palette, old activity entries, docs) opens **Settings' first page** instead of an
  empty panel, with no error.
- There is no "Voice" stub page saying "removed". A missing section is clearer than a dead one (VS Code removes a
  settings category when its extension is gone).

### What the person is told (once)

People who used OXEVoice would otherwise just find the mic gone. On the **first start after the update, only when
`oxe-voice-prefs` exists or a voice model is on disk**, show one `toast` (info, no auto-dismiss on the first start;
dismissed with ×):

| | en | pt-BR |
|---|---|---|
| title | Voice input was removed | O OXEVoice foi removido |
| body (model on disk) | OXESpace no longer records speech. Your operating system's dictation still types into any field. The downloaded voice model ({{size}}) was deleted. | O OXESpace não grava mais voz. O ditado do seu sistema continua digitando em qualquer campo. O modelo de voz baixado ({{size}}) foi apagado. |
| body (no model) | OXESpace no longer records speech. Your operating system's dictation still types into any field. | O OXESpace não grava mais voz. O ditado do seu sistema continua digitando em qualquer campo. |
| action | How to dictate | Como ditar |

- "How to dictate" opens the system's help page through the existing external-link opener (Windows: `Win+H`; Linux:
  the desktop's own; the link is chosen by platform). It never opens a settings page of ours.
- Nobody who never used voice sees anything.
- **B21 contract need:** main deletes the downloaded model on first start after the update and reports its size once
  (a C3 message or a field of the app-info read), so the toast can say what was freed. Nothing on disk is left behind
  without the person being told. If deleting fails, the body says "The voice model in {{folder}} can be deleted by
  hand." / "O modelo de voz em {{folder}} pode ser apagado à mão." with the folder relative to the app data folder.

### Acceptance (adds to the F34 row)

- No voice control, palette command, shortcut or settings section (offer-audit green; keyboard guide checked).
- `settings:voice` lands on Settings' first page.
- The one-time toast shows only for former voice users, in en and pt-BR, and never again.
- Headers and composer have no gap at 240 px and at 1440 px; light and dark.
- The renderer entry and installer are smaller (numbers in the PR body).

## F35 · Team button off the title bar

Outcome: a clean title bar (mode switch, activity bell, update chips). The project Team stays one shortcut, one menu
item and one palette command away, from both OxeCode and OxeChat. Decided by the user; the activity bell stays.

### Where Team lives after F35

| Entry | en | pt-BR | Notes |
|---|---|---|---|
| Palette | "Open project team" | "Abrir a equipe do projeto" | already a tool (`toolCatalog` `team`); keywords add "team", "equipe", "time", "roles", "papéis" |
| Menu | Tools › Project team… | Ferramentas › Equipe do projeto… | next to MCP servers and Skills; the ellipsis because it opens a dialog |
| Shortcut | `Mod+Shift+T` (proposal; FRONTEND checks the catalog) | | `reservedInTerminal`; shown in the menu and the palette |
| Agents central | ⋯ › Project team… | ⋯ › Equipe do projeto… | S7 #313 §6 |
| OxeChat project header menu | Project team… | Equipe do projeto… | the project is already the Team's scope there |

- **Disabled states keep their reason.** Today the button says why it is disabled ("Open a workspace…", "Select an
  OxeChat project…", "Team is available in OxeCode and OxeChat"). The menu item and palette command show the same
  reason as their description when disabled; the shortcut shows it as a `toast` (info). Never a silent no-op.
- The strings come from #197's translated `TeamButton` texts (merge order decided: #197 first, F35 deletes the
  title-bar usage and moves the strings to these entries).

### Title bar after F35

`[menu] … [OxeCode OxeChat OxeQuery OxePod OxePost] … [update chips] [bell]`

- Trailing group: update chips (only when present, #302) then the bell, last, at the window edge it always had.
- No new button takes the Team's place (S7 central has no title-bar button either, #313 §11.1).
- Spacing: the trailing group keeps `--space-1` between items; the drag region grows by the button's width.

### Team messages that need the person

Today a new Team message has no badge on the button, so removing the button loses no signal. The gap exists anyway:
a message addressed to the person is only seen when the dialog is opened. **IDEA (S7.5, not F35):** messages that
address the person become activity-center entries (new F30 source `team`, a CCR) and show as a role badge on the
agent's row in the S7 central. Cost M.

### Discoverability

- No coachmark or tour. The palette finds Team by both languages' words, and the menu entry carries the shortcut.
- The 1.4 release notes say where Team moved, in one line.
- HOMOLOGATION checks a person can find Team in under 10 s from both modes with the palette, the menu and the keyboard.

### Acceptance (adds to the F35 row)

- The title bar has no Team button in any mode; light/dark; 960 px to 4K.
- Team opens from the palette, Tools menu and `Mod+Shift+T` in OxeCode and OxeChat; each disabled case says why.
- en and pt-BR strings from #197; keyboard and screen-reader names match the visible label.

## Glossary entries these items fix

Added to `docs/design/glossary.md` (in progress): Team → **Equipe** (pt-BR), "Project team" → "Equipe do projeto";
OXEVoice is no longer a product term in 1.4; "ditado do sistema" for OS dictation.
