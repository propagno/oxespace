# OXESpace

OXESpace is a Windows desktop workspace for agentic development. It combines terminal panes, project tools, a file editor, GitHub workflows, background jobs, MCP servers, scripts, web preview, tasks, and review utilities in one Electron app.

## Download

Current Windows release:

[Download OXESpace 0.1.28 for Windows x64](https://github.com/propagno/oxespace/releases/download/v0.1.28/OXESpace-0.1.28-x64.exe)

Release page:

[OXESpace v0.1.28](https://github.com/propagno/oxespace/releases/tag/v0.1.28)

All releases:

[https://github.com/propagno/oxespace/releases](https://github.com/propagno/oxespace/releases)

## What It Does

OXESpace maps each workspace to one Windows project folder. The terminal grid stays available as the main work surface, while tools open as workspace-level side panels that can be expanded, collapsed, or combined with terminals.

Core capabilities:

- Multi-pane PTY terminals for Claude, Copilot, shells, and custom commands.
- Workspace-level Tools menu for development utilities.
- Monaco-based editor with file browser, language detection, save, dirty state, and external change detection.
- GitHub Hub for local Git status, branches, commits, checkpoints, PRs, releases, and GitHub Actions.
- Scripts panel for discovering and running `.ps1` and `.sh` automation scripts from the active workspace.
- Web Preview panel with browser-style address bar, navigation, reload, zoom, and external-open controls.
- Background Jobs panel for long-running commands without occupying terminal panes.
- MCP panel for trusted stdio MCP servers and exposed tools.
- Agent Skills browser for installed user/workspace skills.
- Review panel for diffs and code review workflow.
- Task board with dependencies, drag/drop ordering, and terminal execution entry points.
- Per-workspace theme, density, shell profile, layout, side panel state, and versioned SQLite migrations.

## Tools Menu

The top workspace toolbar centralizes OXESpace functionality under Tools.

Available tool areas:

- Terminal: keep terminal panes visible and interactive.
- Editor: browse and edit files in the workspace folder.
- GitHub: operate local Git and GitHub CLI backed features.
- Scripts: run project automation scripts as background jobs.
- Web Preview: preview local web apps and proposed UI changes.
- Background Jobs: inspect, stop, and review command output.
- MCP: configure trusted Model Context Protocol stdio servers.
- Skills: inspect available agent skills.
- Review: inspect diffs and review changes.
- History: resume supported agent sessions.
- Workspace Settings: configure layout, shell, agents, theme, and density.

## GitHub Hub

The GitHub Hub is designed to work partially without `gh` and fully with GitHub CLI installed.

Local Git features:

- Status cards for last commit, last push, staged, modified, untracked, ahead, and behind.
- Stage all, commit, push, and commit-and-push actions.
- Local and remote branch views.
- Commit list and commit detail view.
- Local checkpoints backed by Git patches.
- Repository detection from the active workspace folder.

GitHub CLI features:

- Pull request list and creation.
- Release list and creation.
- GitHub Actions workflows and runs.
- Auth and setup diagnostics.

Install GitHub CLI from:

[https://cli.github.com](https://cli.github.com)

Then authenticate:

```powershell
gh auth login
gh auth status
```

OXESpace does not store GitHub tokens. Authentication remains delegated to `gh`.

## Scripts

The Scripts panel recursively discovers `.ps1` and `.sh` files in the current workspace, while skipping heavy folders such as `node_modules`, `.git`, `dist`, `out`, `build`, `coverage`, `.next`, and `test-results`.

Supported behavior:

- Search scripts by name or path.
- Run PowerShell scripts with `powershell.exe -NoProfile -ExecutionPolicy Bypass`.
- Run shell scripts through Git Bash on Windows when available.
- Execute scripts as background jobs so terminal panes remain free.

Example test scripts are included:

```text
scripts/oxespace-smoke.ps1
scripts/oxespace-smoke.sh
```

## Web Preview

Web Preview provides a compact browser-like surface inside the workspace.

It includes:

- Back, forward, and reload.
- URL input and Go button.
- Zoom controls.
- Favorite/menu/monitor/capture/open-external controls prepared for iterative UI work.
- Dark empty state when no page is loaded.

Typical use:

1. Start a local dev server in a terminal or background job.
2. Open Web Preview from Tools.
3. Enter a URL such as `http://localhost:3000`.
4. Use the visual preview while agents or terminals continue working.

## MCP

OXESpace supports stdio MCP servers. Servers must be marked trusted before start.

The MCP panel:

- Adds workspace or global MCP servers.
- Resolves common Windows executable paths such as `npx.cmd`.
- Starts and stops trusted servers.
- Lists exposed tools.
- Keeps sensitive environment keys blocked unless the server is explicitly trusted.

For Playwright MCP, use the bundled template or configure:

```text
command: npx
args: -y @playwright/mcp@latest
```

## Background Jobs

Background Jobs are for commands that should run without occupying a terminal pane, such as builds, test runs, watchers, and scripts.

Features:

- Start jobs from slash commands or tool panels.
- Track running, exited, failed, and killed jobs.
- Stop running jobs.
- Open a job to inspect formatted output.
- Preserve job records through SQLite.

Example slash command:

```text
/bg npm run build
```

## Editor

The editor is separate from terminal panes. It opens as a workspace-level panel and uses the active workspace root as the file browser root.

Features:

- Monaco editor.
- File tree with lazy directory loading.
- Language detection by file extension.
- `Ctrl+S` save.
- Dirty indicator.
- Confirmation before closing dirty files.
- External file watching.

## Workspace Customization

Each workspace can store:

- Theme.
- UI density.
- Default shell profile.
- Layout preset.
- Editor panel state.
- GitHub panel state.
- Scripts panel state.
- Web Preview panel state.
- Background Jobs panel state.

Changing the default shell profile does not restart running terminals.

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

## Requirements

Runtime:

- Windows x64.
- Git for Git-backed features.
- GitHub CLI for PRs, releases, Actions, and authenticated GitHub operations.
- Git Bash for `.sh` script execution on Windows.

Development:

- Node.js 22.
- npm.
- Windows build tooling capable of rebuilding Electron native modules.

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

Useful focused checks:

```powershell
npm test -- WorkspaceSurface TasksPane KanbanBoard
npm test -- fs-allowlist external-url ipc-contracts preload-api
```

## Build Installer Locally

```powershell
npm run dist
```

The installer is emitted under:

```text
dist/OXESpace-<version>-x64.exe
```

Native modules are prepared by `npm run fix:native`, which is included in `npm run dist`.

If Windows reports `EPERM` while replacing `better_sqlite3.node`, close running OXESpace/Electron processes or restart Windows, then run `npm run dist` again.

## Publish A Release

The repository includes a GitHub Actions release workflow at `.github/workflows/release.yml`.

Release flow:

```powershell
git switch main
git pull origin main
git tag v0.1.28
git push origin v0.1.28
```

When the tag is pushed, GitHub Actions:

1. Installs dependencies.
2. Rebuilds native modules.
3. Runs typecheck, tests, build, and E2E.
4. Builds the Windows NSIS installer.
5. Uploads `dist/OXESpace-*.exe` to the GitHub release.

## Tech Stack

- Electron
- Electron Vite
- React
- TypeScript
- SQLite via `better-sqlite3`
- `node-pty`
- xterm.js
- Monaco Editor
- Zustand
- GitHub CLI integration

## Version

Current release: `0.1.28`

Highlights since `0.1.25`:

- **Live context-window % chip** in the terminal status bar for Claude, Codex and Copilot — the `/context` meter, so you can see how full the current conversation is and know when to `/compact` or `/clear`. Shows `ctx XX%` (yellow at 70%, red at 85%) and updates ~every 5s, with a tooltip of used/limit tokens.
- All local, no network: **Claude/Codex** reuse the transcript token counts (last-turn fill ÷ the model's context window); **Copilot** reads the `Utilization X% (used/limit tokens)` line its CLI logs each turn (real 128k window + auto-compact threshold). Antigravity/Cursor expose no tokens, so the chip hides there.

Installer asset:

[OXESpace-0.1.28-x64.exe](https://github.com/propagno/oxespace/releases/download/v0.1.28/OXESpace-0.1.28-x64.exe)
