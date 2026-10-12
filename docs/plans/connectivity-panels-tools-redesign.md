# Connectivity, panels and Tools redesign

## Objective

Make Code and Thread feel like one desktop product: clear connection management, compact navigation, resizable work areas and a truthful activity view. The visual reference is the connector directory, file-tree splitter and background-task dock in the six photos supplied in `C:\Users\dudu-\Downloads\bugprojetos` on 2026-09-30. Use their interaction patterns, not a literal copy of Claude's branding or service catalog.

## Verified baseline (2026-10-01)

- `McpPanel.tsx` already manages OXESpace's built-in MCP and user-added **stdio** servers, with trust, start/stop, tools and errors. It is a modal reached from Tools or the palette. It does not implement remote connector OAuth or the cloud services shown in the reference. Its `.mcp.json` sync is workspace-oriented.
- `EditorPane.tsx` + `FileBrowser.tsx` lazy-load directories, but the tree width was fixed at 240 px. The workspace side panel already has its own outer splitter in `WorkspaceSurface.tsx`; the missing control was the inner tree/editor splitter.
- `BackgroundManager` persists command job metadata and streams a bounded in-memory output ring. `BackgroundJobsPanel` lists only these OXESpace jobs. Agent command events remain in Thread, and delegated tasks have another model. This explains why an agent action can appear in the conversation while this panel is empty. It does not establish that an actual background process has failed.
- `WorkspaceSurface.tsx` preserves terminal DOM while switching side panels, but prefetches all common panel bundles after first paint. Measure startup and first-open cost before changing prefetch strategy.
- Both navigation modes share `NavigationFooter` and a 280 px default width, with persisted resizing. Code adds workspace and terminal rows; Thread adds project, thread and status rows. Branch labels also appeared in Code sidebar/footer and Thread sidebar, despite already being present in top context.
- `ToolsModal.tsx` is a searchable catalog of 16 destinations in four broad groups. Frequently used views are buried alongside configuration and diagnostics.

## Information architecture

```text
Code top right
  Connections   Activity   Review   Files   More…

Sidebar footer (compact icon rail)
  Tools          Settings   Collapse

Tools (rare/administrative destinations only)
  Project       Worktrees · Multi-repo coordination · Workspace settings
  Agents        Agent settings · Skills · MCP server details
  Diagnostics   Semantic activity · Command palette

Thread top right
  Connections   Activity   Review   Delegated work   More…
```

`More…` holds infrequent view switches such as Scripts, Search and Web Preview when the window is narrow. Its entries must reflect the current mode and actual availability. Keep keyboard shortcuts and the command palette as alternate routes; no dead buttons.

| Current Tools destination | Primary destination after redesign |
| --- | --- |
| MCP Servers | Connections, top right |
| Background Jobs | Activity, top right; `Local jobs` tab |
| Review | Review, top right |
| Editor | Files, top right |
| GitHub | Source control in the Code repository panel; top overflow at narrow width |
| Find in Files | Existing `Ctrl+Shift+F` and top overflow |
| Web Preview | Top overflow |
| Scripts | Top overflow |
| Worktrees | Project section in Tools, with a contextual route from branch/worktree controls |
| Multi-repo coordination | Project section in Tools |
| Terminal Commands | Active terminal's own command affordance and `Ctrl+/` |
| Skills | Agents section in Tools |
| Semantic Activity | Diagnostics section in Tools |
| Agent settings | Settings > Agents, searchable from Tools |
| Workspace Settings | Settings, scoped to the current workspace |
| Command Palette | `Ctrl+K`, available from Tools search |

## Delivery sequence

### 1. Connections as a first-class surface

Use the existing MCP manager as source of truth. Add a top-level `Connections` route in Code and Thread, with search, status, scope (`Global`/`Project`), transport, trust, last error and exposed tool count. Keep built-in OXESpace separate from user servers. Add/stop/remove actions should provide in-place success or errors and state which native agent sessions must restart. Keep `/mcp` as an optional shortcut that opens the same surface. Do not display Gmail, Slack or other services as connectable until a real remote MCP + OAuth backend and permission model exists. A future `Discover` tab should list only supported installable templates and link to their source.

**Acceptance:** add a local server, verify its tools, stop/restart it, switch projects, and confirm the right scope and error state after app restart. No status may imply OAuth connectivity that is not implemented.

### 2. Resizable, efficient editor

Inner tree/editor splitter: 180–520 px with drag, arrow-key steps, Home/End and reset. Persist the preference. When the host panel narrows, leave at least 240 px for editor content. Keep directory loading on expansion and avoid remounting Monaco on width changes; use its existing `ResizeObserver` path.

**Acceptance:** long filenames can be inspected without opening them; dragging does not restart the editor or lose dirty content; width survives reopening; tree navigation stays usable at 900 px and 1440 px.

### 3. Background activity with truthful provenance

Create a read model with three explicitly named sources: `Local jobs` (BackgroundManager), `Delegated work` (delegation state), and `Agent activity` (native Thread command/tool events). A unified Activity button may aggregate counts, but cards must retain their source and their own actions. Only local jobs get `Stop job`; delegated tasks get their existing task controls; native command events link back to the conversation. Never infer that a completed `Ran Command` is a still-running process. Add status/time, bounded output or transcript links, empty/error/loading states, and reconciliation after app restart. Investigate durable output only if users need previous-run logs; current metadata is persistent but output is not.

**Acceptance:** run `/bg`, delegate a task, and run a Thread command; each appears under the correct source, updates without manual refresh, and has a valid destination after restart. A failed job shows its exit code and captured error.

### 4. Panel opening and performance

Retain the mounted-terminal invariant in `WorkspaceSurface`. Benchmark cold launch, first open, repeated open, width drag and project switch on Windows/Linux before choosing a prefetch policy. Prefer intent prefetch for heavy Monaco and on-demand import for rare views; keep frequently used small panels warm only if measured first-open latency justifies it. Persist side-panel width and selected tab, cap min/max sizes, and make narrow-window mode collapse labels before shrinking content below usable limits.

**Acceptance:** no terminal remount or scrollback loss when opening/closing/maximizing a side panel; all splitters work with pointer and keyboard; no interaction produces sustained renderer jank. Record baseline and after metrics in the PR.

### 5. Compact Code and Thread sidebars

Keep project/workspace title and one activity cue. Put secondary metadata in tooltip or a details popover, remove per-project thread count rows and repeated branch rows, and use a single-line icon footer. Preserve search, project add, terminal/thread selection, unread state, resize and keyboard focus. Use the same spacing, selected background and icon sizes in both modes.

**Acceptance:** 4 Code workspaces or 4 Thread projects show more selectable rows above the fold than before at 900 px height, with no loss of accessible names or discoverability.

### 6. Branch as one location-aware label

Show branch in the active pane/conversation **top context**. A workspace can contain panes rooted in different worktrees, so the label must follow the active root path; one global workspace branch would be misleading. Remove branch text from navigation rows and bottom status bar. Keep worktree identity in detailed dialogs and Git operations where it is needed to prevent acting on the wrong checkout.

**Acceptance:** switch between two panes or threads on different worktrees and verify the top branch changes while sidebar/footer remain branch-free.

### 7. Tools redesign

Replace the current 16-card catalog with a compact, searchable command hub. Move the high-frequency `Connections`, `Activity`, `Review` and `Files` affordances to Code's top right, aligned with Thread actions. Keep `Tools` for configuration, agents and diagnostics; do not duplicate a destination as two equal-weight cards. Group by user intent rather than implementation package. Show status only when meaningful (running job count, connection error) and preserve `Ctrl+K` discovery. On narrow widths, collapse text labels into an overflow menu with the same actions. Use one action registry so toolbar, overflow, Tools and palette dispatch identically.

**Acceptance:** every current Tools action remains reachable by click and keyboard; a user can reach MCP, Review, Files and Background Activity with one click from Code; no command silently opens an unrelated panel; 900/1440 px and collapsed-sidebar layouts are visually reviewed in Playwright.

## Current increment

The checkout now contains the inner editor splitter, compact footer and workspace rows, removal of repeated branch labels, a direct Code `Connections` action, and search in the existing MCP panel. The side-panel stack now fills its allocated width, so expanding a panel also expands its content. Background command output now reassembles process chunks into lines and flushes the final line; a stopped/failed job retains its terminal status when the child process closes. Background Activity has separate `Local jobs` and `Delegated work` sources, reachable from the Code topbar and Thread header; Thread does not require a Code workspace to open this panel. Native provider command events still live in the conversation timeline. The full cross-source Activity action model, remote connectors and Tools action-registry redesign remain separate implementation tasks with the acceptance criteria above. Do not describe them as complete until runtime and Playwright checks pass.

## Reference

Anthropic documents `Customize > Connectors` as a place to search, connect, manage and inspect services, including custom remote MCP connectors: https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities . That model informs the navigation and status hierarchy here. OXESpace's current backend only supports local stdio MCP servers, so remote authorization is an explicit later phase.
