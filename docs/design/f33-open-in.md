# F33 · "Abrir em…" on file paths (design spec)

Status: draft for review · Owner: DESIGN/PRODUCT · Implements: F33 (FRONTEND), on B18 (BACKEND, `app.openIn`)
· Origin: V16 (Claude Code Desktop roadmap), user decision 31/10 · Date: 2026-10-31 · origin/main 21fc9fab

## 1. Outcome

**One click takes the person from a path the agent mentioned to their own editor, at the right line.** The same menu
appears on every file path in OXESpace (conversation, changes, terminal, search, editor), with the same items in the
same order. It lists only the editors that are installed and never opens anything outside the project.

## 2. What already exists (reused)

| Need | On main | Used for |
|---|---|---|
| Path actions menu | `FileBrowser.tsx` `AnchoredMenu` with "Copiar caminho" / "Copiar caminho relativo" | becomes the shared **path menu** (§4); its two copy items and strings stay |
| Copy with feedback | `copyText(text, label, doneMessage)` (`src/ui/clipboard.ts`) | copy items |
| Open in OXESpace's editor | `editor.store` `openFile` | the default click everywhere, unchanged |
| File rows in OxeChat | `ThreadFileActivity.tsx` (`TurnPath`, `relativeTurnPath`) | gets the menu |
| Terminal links | `terminalLinks.ts` (Ctrl/Cmd+click on URLs, confirmed external path) | the same modifier for file paths (§5.3) |
| Menus | `Menu`, `AnchoredMenu`, `Kbd`, `toast` | everything on screen |

**New, from B18:** `app.openIn` and the list of detected editors (§8). Nothing else is needed.

## 3. Where paths get the menu

| Surface | Path today | Click (unchanged) | Menu opens with |
|---|---|---|---|
| OxeChat: file activity rows, turn changes | `TurnPath` button | opens the diff or the file in OXESpace | right click, `Shift+F10`, or the row's ⋯ on hover/focus |
| OxeChat: agent text, inline `code` that is a **project path**, with optional `:line[:col]` | plain code | none today | it becomes a link-styled code span: click opens in OXESpace's editor at the line; menu as above |
| Changes / Review panels: file headers | header text | opens the diff | right click, `Shift+F10`, ⋯ |
| Editor: tabs and file tree | tab / node | opens the file | right click (tree already has a menu; tabs get it) |
| Search results | result row | opens at the match | right click, `Shift+F10` |
| Terminal output | not detected | — | `Ctrl/Cmd+click` opens in OXESpace's editor; `Ctrl/Cmd+Shift+click` opens in the preferred external editor; right click on a detected path shows the menu |
| S7 agents central | — | — | out of scope (rows aren't files) |

Path detection is shared by all surfaces: one helper (`src/lib/projectPath.ts`) recognises `rel/path.ext`,
`./rel`, absolute paths **inside** the project root, and `:line` / `:line:col` / `(line,col)`. A path that resolves
outside the root is not a link. The helper is for display only; main decides (§8).

## 4. The path menu (same everywhere)

Order is fixed. Editors that aren't installed are left out entirely.

```
Abrir no editor do OXESpace          (when the surface isn't the editor itself)
──────────
Abrir no VS Code · linha 42          ⇧Ctrl+clique   ← the preferred editor first, with the shortcut hint
Abrir no Cursor · linha 42
Abrir no Zed · linha 42
──────────
Mostrar no Explorador de Arquivos    (Windows) · "Abrir a pasta" (Linux)
──────────
Copiar caminho relativo
Copiar caminho completo
```

- "· linha 42" appears only when the path has a line; with a column the line is enough on the label (the column is
  still sent).
- Menu label (accessible name): "Ações de src/app.ts" / "Actions for src/app.ts".
- **Path outside the project** (in agent text, the terminal): no link and no menu. If the person selects it, the
  normal text context menu offers copy.
- **No external editor installed:** the editor group is absent; the menu still has OXESpace's editor, reveal and copy.
  No disabled placeholder (acceptance: "editor ausente não listado").
- **Preferred editor**: Settings › Geral › "Editor externo": Automático (first detected: VS Code, Cursor, Zed) or one
  of the detected ones. It goes first in the group and is what `Ctrl/Cmd+Shift+click` opens.

## 5. Interaction

### 5.1 Feedback

- The menu closes at once. A polite live region says "Abrindo no VS Code" / "Opening in VS Code".
- If the editor window hasn't appeared after 2 s there's no extra UI: the app can't know. Failures come back from
  main and show as a toast (§6).
- Copy: the existing `copyText` toast ("Caminho copiado").

### 5.2 Keyboard and screen reader

- Every path link and row is focusable; `Shift+F10` or the context-menu key opens the menu; `Enter` = the click.
- Link names include the line: "src/app.ts, linha 42" / "src/app.ts, line 42".
- In the terminal, paths aren't reachable by keyboard (an xterm limit). The same file is reachable from the OxeChat
  row or search, so this is noted, not designed around.

### 5.3 Modifiers (consistent with URLs)

- `Ctrl+click` (Cmd on macOS) on a terminal path, like URLs today: OXESpace's editor at the line.
- `Ctrl+Shift+click`: the preferred external editor at the line. The hover hint says both: "Ctrl+clique abre no
  editor do OXESpace · Ctrl+Shift+clique abre no VS Code".
- In OxeChat and panels a plain click keeps its meaning (OXESpace); the menu is the way out.

## 6. States and copy

| Case | Shown as | en | pt-BR |
|---|---|---|---|
| Opening | live region (polite) | Opening in {{editor}} | Abrindo no {{editor}} |
| Outside the project (main refuses `outsideRoot`) | toast warning | This file is outside the project, so it can't be opened from here. | Este arquivo está fora do projeto e não pode ser aberto daqui. |
| File no longer exists (`notFound`) | toast warning + action "Copiar caminho" | {{path}} no longer exists. | {{path}} não existe mais. |
| Editor gone since detection (`editorMissing`) | toast warning; the list is re-read | {{editor}} wasn't found. Choose another editor. | O {{editor}} não foi encontrado. Escolha outro editor. |
| Launch failed (`launchFailed`) | toast danger + action "Copiar caminho" | Couldn't open in {{editor}}. | Não foi possível abrir no {{editor}}. |
| Reveal failed | toast danger | Couldn't show the file in the folder. | Não foi possível mostrar o arquivo na pasta. |
| Menu items | — | Open in OXESpace's editor · Open in {{editor}} · line {{line}} · Reveal in File Explorer (Win) / Open containing folder (Linux) · Copy relative path · Copy full path | Abrir no editor do OXESpace · Abrir no {{editor}} · linha {{line}} · Mostrar no Explorador de Arquivos / Abrir a pasta · Copiar caminho relativo · Copiar caminho completo |
| Setting | — | External editor · Automatic | Editor externo · Automático |

- The existing "Copiar caminho" key becomes "Copiar caminho completo" (clearer next to "relativo"); same key name,
  value changed in both languages.
- Words follow the glossary (#322): "Não foi possível …", "Abrir", "Copiar". Editor names are product names.
- Paths in messages are project-relative (#305 rule): an absolute path never shows.

## 7. Accessibility and platforms

- Link-styled code: underline on hover and focus, not colour alone; `--focus-ring`; forced colours keep the
  underline.
- Windows and Linux names differ for reveal (§6); macOS ("Mostrar no Finder") is ready in the copy table for later.
- Editors detected per platform by main; the renderer never guesses executables.

## 8. Contract needs (for B18)

- `app.openIn({ scope: {kind: 'workspace'|'project', id}, path, line?, column?, target })`, with `target` =
  `oxespace | vscode | cursor | zed | reveal`. Copy stays in the renderer (no IPC needed).
- `app.openInTargets()` → `[{ id, name }]` of the editors detected, re-read when the window regains focus (an editor
  installed meanwhile appears without restart).
- Main resolves the path against the scope's root: relative, absolute, `..` and symlinks; anything outside →
  C3 `outsideRoot`. Other C3 codes: `notFound`, `editorMissing`, `launchFailed`. argv built in main, never a shell
  (`--goto file:line:col` for VS Code and Cursor, `file:line:col` for Zed).
- Forbidden for agents over MCP in 1.4 (as the B18 row says).
- The preferred editor is a main-side setting, not renderer storage.

## 9. Acceptance (adds to the F33 row)

- A path with a line opens the editor at that line; with no line, at the top.
- A path outside the project is not a link; forced through IPC it is refused with `outsideRoot` and the toast.
- An editor that isn't installed isn't listed; installing one shows it after the window regains focus.
- The menu has the same items and order on all five surfaces of §3.
- Keyboard (`Shift+F10`, `Enter`) and screen-reader names with the line; en and pt-BR; light/dark.
- e2e with a fake editor (main's double records argv); unit tests for the path helper (Windows, POSIX, `:line:col`,
  `(line,col)`, `..`, outside root).

## 10. References

- **VS Code**: "Reveal in File Explorer", "Copy Path" / "Copy Relative Path" on every file; `code --goto file:line:col`.
- **JetBrains**: "Open In" submenu (Explorer, Terminal, other apps), same on tree, tabs and search.
- **GitHub Desktop**: "Open in Visual Studio Code" with the preferred editor chosen in settings, absent editors hidden.
- **Warp / iTerm2 / Windows Terminal**: modifier+click on file paths in output opens the editor at the line.
- **Claude Code Desktop (V16)**: "Open in…" on paths the agent mentions; the origin of this item.

## 11. IDEA (not a blocker)

- **"Abrir todos no editor"** on a turn's changes header: open every changed file of the turn in the preferred editor
  (VS Code accepts several files). Cost S once `app.openIn` exists; one IPC call per file or a list variant.
