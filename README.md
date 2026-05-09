# OXESpace

OXESpace is an agentic terminal workspace manager for Windows. It combines Electron, React, SQLite, native PTY terminal panes, a workspace editor, task tracking, workspace themes, layout presets, keyboard shortcuts, and a command palette.

## Download

Windows installer:

[Download OXESpace 0.1.12 for Windows x64](https://github.com/propagno/oxespace/releases/download/v0.1.12/OXESpace-0.1.12-x64.exe)

All releases are available at:

[https://github.com/propagno/oxespace/releases](https://github.com/propagno/oxespace/releases)

## Main Features

- Multiple workspaces, each mapped to a Windows project folder.
- Real PTY-backed terminal panes with split, maximize, stop, and restart controls.
- Workspace-level editor panel with file browser, Monaco editor, dirty state, save with `Ctrl+S`, and external file watching.
- Per-workspace shell profile, theme, UI density, editor state, and layout preset.
- Visual workspace templates for quick workspace creation.
- Layout presets for `1`, `2`, `4`, `6`, `8`, `10`, `12`, `14`, and `16` panes.
- Command palette for common workspace and terminal actions.
- Settings modal for configuring supported agents and shell commands.

## Basic Usage

1. Install OXESpace using the Windows installer linked above.
2. Open the app and create a workspace from a local project folder.
3. Choose a visual template or select the layout, shell, theme, and density manually.
4. Use terminal panes to run agents or shell commands in the workspace folder.
5. Use the top-right workspace toolbar to open the editor, workspace settings, or command palette.
6. Use the editor panel to browse and edit files from the active workspace folder.

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+K` | Open command palette |
| `Ctrl+Shift+P` | Open command palette |
| `Ctrl+,` | Open workspace settings |
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+E` | Toggle editor |
| `Ctrl+Shift+\` | Split active pane vertically |
| `Ctrl+Shift+-` | Split active pane horizontally |
| `Ctrl+Shift+Enter` | Maximize or restore active pane |
| `Ctrl+R` | Restart active terminal |
| `Ctrl+S` | Save active editor file |

## Workspace Customization

Each workspace stores its own:

- Theme: `midnight`, `nord`, `dracula`, `ocean`, `monokai`, or `amber`.
- Density: `compact` or `comfortable`.
- Default shell profile.
- Layout preset.
- Editor visibility, expanded state, and width.

Changing the default shell does not restart running terminals. The workspace settings modal can apply the selected shell to idle panes.

## Development

```powershell
npm ci
npm run rebuild:native
npm run dev
```

## Verification

```powershell
npm run typecheck
npm run test
npm run build
npm run test:e2e
```

The Playwright E2E smoke uses `OXESPACE_E2E_MOCK_NATIVE=1` to exercise Electron, preload, and renderer flows without depending on local native module ABI.

## Build The Installer Locally

```powershell
npm run dist
```

The installer is emitted under `dist/` as:

```text
dist/OXESpace-<version>-x64.exe
```

Native modules are prepared for Electron by `npm run fix:native`, which is included in the `dist` script.

## Publish A GitHub Release

The repository includes a GitHub Actions release workflow. `main` is protected, so release changes should go through a pull request first.

```powershell
git switch -c codex/workspace-customization-release
git push -u origin codex/workspace-customization-release
```

Open a pull request, merge it into `main`, then tag the merged commit:

```powershell
git switch main
git pull origin main
git tag v0.1.12
git push origin v0.1.12
```

When the tag is pushed, GitHub Actions builds the Windows installer and uploads `dist/OXESpace-0.1.12-x64.exe` to the release.

## Tech Stack

- Electron
- React
- TypeScript
- SQLite via `better-sqlite3`
- `node-pty`
- xterm.js
- Monaco Editor
