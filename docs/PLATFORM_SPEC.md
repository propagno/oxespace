# OXESpace platform specification

This document describes what OXESpace is, where it runs, what it depends on and
what it does and does not promise. It is written from the code and the release
pipeline, and is updated with each release. Version described: **0.17.x**.

## 1. Product definition

OXESpace is a local desktop application (Electron) that gives people who work
with coding agents one window for:

- running agent CLIs and shells in managed terminals (**Code** mode);
- holding native **Claude Code** and **Codex** conversations with approvals,
  questions, attachments and history (**Thread** mode);
- reviewing what an agent changed, commenting on lines and sending feedback back;
- connecting agents to tools through the Model Context Protocol (MCP);
- keeping optional, local memory and a local semantic index of a project;
- inspecting containers (Docker or Podman) and working with PostgreSQL and
  MongoDB (**OxeQuery** mode).

It does not host models, proxy provider traffic or require an OXESpace account.
Agents are the official CLIs, authenticated by the user.

## 2. Supported platforms and packages

| Platform | Architecture | Package | Auto-update | Notes |
|---|---|---|---|---|
| Windows 10 or later | x64 | NSIS installer, per user, `OXESpace-<version>-x64.exe` | Yes (GitHub Releases) | Installer is **not code-signed** |
| Linux, any glibc distribution | x64 | `OXESpace-<version>-x64.AppImage` | Yes, when launched as an AppImage | |
| Ubuntu / Debian | x64 | `OXESpace-<version>-amd64.deb` | No (install the new `.deb`) | Built and smoke-tested on Ubuntu 22.04 in CI; dependency names cover 22.04 and 24.04 |
| macOS | — | not published | — | |
| Windows / Linux on ARM | — | not published | — | |

Every release carries `SHA256SUMS.txt`, one SPDX SBOM per platform and the
updater manifests (`latest.yml`, `latest-linux.yml`; `beta.yml`/`beta-linux.yml`
for pre-releases).

### Minimum window

960 × 640. The interface is designed and tested at 900, 1280 and 1440 px widths.

## 3. Runtime and technology

| Layer | Technology |
|---|---|
| Shell | Electron 44 (Chromium + Node.js bundled) |
| Renderer | React 19, TypeScript (strict), Zustand, Radix UI, Tailwind CSS 4 |
| Terminal | `node-pty`, xterm.js (WebGL renderer) |
| Editor and diff | Monaco Editor 0.55 (editor, side-by-side diff) |
| Storage | SQLite (`better-sqlite3`), WAL, versioned migrations (latest: 073) |
| Search | ripgrep for text search; `transformers.js` + `web-tree-sitter` + SQLite FTS5 for semantic retrieval |
| Voice | whisper.cpp CLI (bundled for Windows x64 only) |
| Packaging | electron-builder 26, electron-updater 6 |

Process model: a privileged **main** process owns terminals, files, Git/`gh`,
databases and agents; a sandboxed **renderer** talks to it only through a typed
preload IPC surface; a separate **preload** and guest isolation apply to Web
Preview. See [Architecture](ARCHITECTURE.md).

## 4. Capabilities

Maturity labels: **Core** (used in the main flow and covered by end-to-end and
packaged-build tests), **Available** (shipped and tested, with fewer real-world
campaigns behind it), **Beta** (shipped, but its release gates or a real-world
campaign are still open; do not rely on it for work you cannot redo), **Initial**
(works, deliberately narrow).

| Area | What it does | Maturity |
|---|---|---|
| Workspaces and terminals | Projects as workspaces, split grids, persistent PTY sessions, layouts, shell profiles, search in terminal | Core |
| Editor | Monaco editor over the workspace root, dirty state, save, external change detection | Core |
| Find in Files | ripgrep-backed search, scoped to the workspace | Core |
| Thread | Native Claude Code / Codex conversations: history, approvals, questions, attachments, models and effort, access and approvals, usage, checkpoints and undo, transcript views | Available |
| Changes (diff review) | Branch or uncommitted diff against a base, Monaco side-by-side, file tree, viewed marks, line comments, large-diff mode | Available |
| GitHub hub | Status, branches, checkpoints, pull requests, releases, workflow runs through `gh`; PR check status in Thread | Core / Available |
| MCP | Server registry with trust, health, start/stop; 40-entry connector catalog; OAuth sign-in for remote servers via `mcp-remote`; export to CLIs; attachment to Thread | Core |
| Worktrees and delegation | Create worktrees, delegate a task to an isolated persistent conversation, status and results | Available |
| Semantic retrieval | Local multilingual index and hybrid search with a token budget | Available |
| Project memory | Optional local memory across worktrees with capture adapters; opt-in, see [Project memory](PROJECT_MEMORY.md) for its limits | Beta |
| Web Preview and design mode | Embedded browser tabs, interaction tools exposed to agents, element selection | Available |
| Documentation capture | Capture and export of project documentation artifacts | Available |
| OxeQuery | Containers (Docker or Podman), PostgreSQL and MongoDB: query, staged edits with conflict checks, import and export, optional approved MCP tools for agents. See [OxeQuery](OXEQUERY.md) | Beta |
| Agent Work | A Thread conversation splits a job into dependent tasks run by worker conversations with a shared access ceiling and a budget | Beta |
| Teams | Persistent agent teams with durable inbox and authorization | Initial |
| Linear | Issues from Linear in the workspace | Available |
| Voice dictation | Local speech-to-text in the Thread composer and editor | Windows only |
| Diagnostics | Bounded runtime log, redacted support report | Core |

## 5. External requirements

| Requirement | Needed for | Notes |
|---|---|---|
| Claude Code CLI and/or Codex CLI | Thread, agent panes | User-installed and signed in; OXESpace never stores subscription passwords |
| GitHub CLI (`gh`), authenticated | GitHub hub, PR status, releases | `gh auth login` |
| Git | Everything repository-related | Must be on `PATH` |
| Node.js 22+ and `npx` | Most connectors | Remote connectors use `mcp-remote` through `npx` |
| `uv` / `uvx` | A few Python-based connectors | Catalog marks these with *Needs uv* |
| Linux desktop libraries | Linux | `libnotify`, GTK 3, NSS, GBM, ALSA and related; the `.deb` declares them |

## 6. Data and storage

- Application data lives in Electron's per-user `userData` directory for
  OXESpace: the SQLite database, pre-migration backups (`db-backups`, the five
  most recent are kept), memory data, Thread attachments, the internal MCP bridge
  and the bounded diagnostics log (three files of 512 KiB, seven-day retention).
- Project files are never copied; workspaces reference folders on disk.
- The semantic model ships inside the application and runs offline.
- MCP server secrets are stored with the server definition; for Thread launches
  they are passed to the agent process through its environment, not through
  command-line arguments (the one documented exception is a Codex server whose
  variable name is reserved or would collide).
- **Downgrades are not supported.** Database migrations only move forward; the
  upgrade stops if a verified backup cannot be created.

## 7. Security properties

- Renderer: context isolation on, Node integration off, sandbox on.
- File system access is bound to an authorised workspace root and checked after
  canonicalisation (`realpath`), without case folding.
- IPC inputs are validated in the main process; Thread, Team and Delegation
  handlers also verify the sender frame.
- Only MCP servers that are enabled **and** explicitly trusted are exported to
  agent configurations.
- Diagnostics redact local paths and credential-shaped values.
- Production and build-tool dependency audits are blocking CI gates; the
  Electron runtime must be inside its support window (`scripts/check-runtime-support.mjs`).
- Release payloads are verified (checksums, manifest hashes, required assets)
  before a release is made public.

See [Security model](SECURITY_MODEL.md) for boundaries and reporting.

## 8. Updates and channels

| Channel | Version form | Feed | Who receives it |
|---|---|---|---|
| Stable | `X.Y.Z` | `latest.yml` / `latest-linux.yml` | Everyone on a stable build |
| Beta | `X.Y.Z-beta.N` | `beta.yml` / `beta-linux.yml` | Users already on a beta build |

A beta install moves to the next stable release automatically: the updater
falls back to `latest.yml` when a stable release has no beta manifest, and a
stable install never receives pre-releases. Packaged builds check on start and
periodically, download in the background and install on quit. Development builds
report updates as unavailable.

## 9. Quality gates

Every commit that is released has passed, on Windows and Linux: dependency
audits, runtime support window, typecheck, lint, unit and integration tests with
coverage floors, production build with bundle budgets, native-module
verification, end-to-end tests, a UI performance gate and a smoke test of the
packaged application. See [Release pipeline](RELEASE_PIPELINE.md).

## 10. Known limitations

- The Windows installer and executables are **unsigned**; SmartScreen may warn.
- No macOS or ARM packages.
- Thread's contracts are covered by fixtures, transport tests and the packaged
  smoke test; campaigns with authenticated providers across CLI versions and
  multi-hour sessions are still being widened. Provider-side behaviour (rate
  limits, tool rules, authentication refresh) is outside OXESpace's control.
- The `.deb` does not update itself.
- Voice dictation is available on Windows only.
- Teams is a first, narrow version of agent coordination.
- OxeQuery has had little real-world use: Podman is covered by fewer tests than
  Docker, a multi-statement script shows only its last result set, and the data
  grid has no "load more".
- Project memory and Agent Work are Beta. Agent Work has no worktree per task.
- In Thread, a running Claude turn cannot be steered (only queued), and drafts
  are not kept across an application restart.
- Linux has CI and packaged-build verification but less field time than Windows
  across desktop environments, drivers and kernels.
- Review comments on diff lines are stored locally and delivered by pasting
  into the agent (terminal) or the composer (Thread); there is no server-side
  pull-request review integration.

## 11. Versioning

Semantic versioning. While the major version is `0`, minor releases may change
behaviour and storage; every release that changes the database says so in its
notes, and a verified backup is taken before any migration. Release notes live
in [`docs/releases`](releases/) and are used as the GitHub Release body.

What changes at `1.0` (compatibility of the database, the MCP tool surface and
permission rules, support windows and supported agent CLI versions) is drafted in
[Compatibility](COMPATIBILITY.md).
