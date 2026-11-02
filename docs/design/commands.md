# Command palette labels

Every command in the palette (Ctrl+K / Ctrl+J) reads **`<Category>: <Action>`**, in English and in Brazilian
Portuguese:

| en | pt-BR |
| --- | --- |
| Activity: Mark all as read | Atividade: Marcar tudo como lido |
| Terminal: Restart | Terminal: Reiniciar |
| Help: Show keyboard shortcuts | Ajuda: Mostrar os atalhos de teclado |

- **Category** is one of the set below. The palette groups commands under it, so the heading and the prefix agree.
- **Action** starts with a capitalized verb in the infinitive ("Open", "Show", "Toggle"; "Abrir", "Mostrar",
  "Alternar"). An action that opens a dialog asking for more ends with "…".
- The only action that is not a verb is **Help: About OXESpace** ("Ajuda: Sobre o OXESpace"), the conventional name.

## Categories

The code names a category in English (`COMMAND_CATEGORIES` in `src/commands/commandText.ts`); the screen shows
`commands.category.*` of the `common` catalog. Product names are the same in every language.

| Code | en | pt-BR | What goes there |
| --- | --- | --- | --- |
| `Go to` | Go to | Ir para | Workspaces and the panes (terminals, agents) of the active workspace |
| `View` | View | Exibir | Sidebar, side panels (files, changes, browser, scripts, search, background), design system viewer |
| `Layout` | Layout | Layout | Pane presets, balance, split layout |
| `Appearance` | Appearance | Aparência | Theme and workspace density |
| `Workspace` | Workspace | Workspace | New workspace, workspace settings, multi-repo coordination, Linear |
| `Terminal` | Terminal | Terminal | The active pane: split, maximize, voice, restart, stop, agent commands |
| `Git` | Git | Git | Commit & pull request, worktrees |
| `Agents` | Agents | Agentes | Team, MCP servers, skills, semantic index, usage and limits |
| `Activity` | Activity | Atividade | Activity center |
| `OxeChat` | OxeChat | OxeChat | Conversations and their projects |
| `OxeQuery` | OxeQuery | OxeQuery | Databases |
| `OxePod` | OxePod | OxePod | Containers |
| `OxePost` | OxePost | OxePost | API requests |
| `Settings` | Settings | Configurações | Settings pages |
| `Help` | Help | Ajuda | Shortcuts, report a problem, about |

## Where the text lives

- `commands.action.<command id>` is the action. The palette shows `<category>: <action>`; the application menus
  (`src/components/Navigation/appMenus.ts`) show the action alone, because the menu already groups by category. Both
  read the same key, so the menu and the palette never say different things. The version belongs in the About
  dialog, never in a menu item.
- `commands.formerly.<command id>` keeps the names a command had before, separated by ` | `. They become search
  words in the language on screen and in English, so "Keyboard shortcuts" still finds "Help: Show keyboard shortcuts".
- Commands built from state use the same keys with values: `thread.project` ("Switch to project {{project}}"),
  `layout` (plural, "Use {{count}} panes").
- **Go to** rows (`src/commands/goTo.ts`) are `Go to: <name>`: the workspace name (or its folder) and, beside it, the
  last two folders of its path. The full path is the row's tooltip and stays searchable; it is never the label.

Command ids and shortcuts never change with a label: `tests/fixtures/palette-commands.base.json` holds them.

## Tests

`tests/palette-labels.test.tsx` checks, in both languages, every static and state-built label against the pattern,
the category set and a list of verbs; that a pt-BR label equals its English one only when every word is on an
explicit list of names (OxeCode, OxeChat, OxeQuery, OxePod, OxePost, OXESpace, Terminal, Git, Docker, MCP, SQL);
that the menus say the palette's action; that old names find the new command; and the Go to group.
`e2e/palette-labels.spec.ts` checks the same in the app.
