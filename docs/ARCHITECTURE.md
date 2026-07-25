# OXESpace architecture

OXESpace is an Electron desktop application with a React renderer and a SQLite-backed main process. The main process owns every privileged capability; the renderer receives a typed, narrow API through the preload bridge.

## Runtime boundaries

```text
React renderer
  -> window.oxeApi (typed preload bridge)
    -> named Electron IPC channels
      -> IPC adapters (validation and orchestration)
        -> services / managers
          -> SQLite, filesystem, PTY, GitHub CLI, MCP and OS APIs
```

- `src/` contains UI, local view models and Zustand state. It must not import Node or Electron privileged APIs.
- `electron/preload/api.ts` is the only renderer bridge. New methods must also be declared in `shared/types/ipc.ts`.
- `electron/main/ipc/` converts IPC inputs into service calls. Keep business and security rules in services so they are testable without Electron.
- `electron/main/services/` owns application behavior and resource access.
- `electron/main/runtime/` is the out-of-process door: a local RPC bus (named pipe / unix socket) whose methods delegate to the same services the IPC adapters use, plus the `ExecutionHost` seam that every command execution and host file access goes through so a remote host can replace the local one without changing callers.
- `electron/preload/design-guest.ts` is a second, separate preload injected into Web Preview `<webview>` guests. It is not the renderer bridge and must never gain privileged APIs.
- `shared/types/` contains contracts that cross the process boundary. Domain contracts such as diagnostics and filesystem live in their own files and are re-exported by the main IPC contract.
- `tests/integration/` covers services, contracts and selected React behavior; `e2e/` exercises the packaged runtime boundary with Playwright.

## Main subsystems

| Subsystem | Responsibility | Important boundary |
| --- | --- | --- |
| Workspaces | Project roots, panes and settings | A workspace ID resolves to one authoritative root |
| Terminal | PTY lifecycle and agent sessions | Main process owns native PTYs |
| Files/editor | Tree, read, write and watch | Canonical paths must remain inside the resolved workspace root |
| MCP | Server registry, health and client sync | Only enabled and explicitly trusted servers are exported |
| Semantic/CodeGraph | Local indexing and retrieval | Worker performs parsing; SQLite persists searchable state |
| GitHub | Repository, PR, release and checkpoint flows | Main process invokes Git/`gh`; renderer consumes typed results |
| Diagnostics | Runtime health and support report | Reports redact local paths and credential-shaped values |

### Terminal sessions: PTY lifetime is owned by main

A PTY belongs to its *pane* and is managed by `TerminalManager`; the xterm
instance in the renderer is a disposable **view** that attaches to and detaches
from it. Unmounting a pane — which happens whenever a workspace falls out of the
mounted MRU — no longer stops the shell.

This exists because the previous model killed a workspace's PTYs on eviction, so
returning paid a PowerShell spawn plus a full `$PROFILE` load and came back to an
empty terminal. Returning to an evicted workspace now measures ~112 ms warm
(p95 127 ms) against ~94 ms for one that stayed mounted — the gap is gone.

- `PtyRingBuffer` retains recent output per session (256 KB default). It is
  **not** a scrollback replacement: replaying the 50k-line scrollback would cost
  hundreds of ms and reintroduce the latency this removes. Full scrollback
  survives only while the pane stays mounted.
- `PtyModeTracker` records DEC private modes so a re-attached view lands in the
  right screen. On the **alternate screen** the replay is skipped entirely and
  main bounces the PTY size instead — every TUI repaints on resize, which yields
  a correct frame rather than one reconstructed from possibly-truncated bytes.
- Output for a session with no attached view **does not cross the IPC boundary**;
  only a throttled `terminal:activity` heartbeat does, so background agents stay
  visible to the sidebar and notifications without shipping bytes nobody renders.
- `attach` must stay synchronous inside its IPC handler: it flushes, snapshots
  and flips the attached flag in one tick, so no chunk is duplicated or lost.
  The renderer subscribes *before* calling it and queues what arrives meanwhile.
- Remaining kill paths: explicit stop, workspace/pane close, agent change,
  `MAX_LIVE_PTYS` reclaim (detached and idle ≥30 s only) and quit.
- How many workspaces stay *rendered* is budgeted by **pane count** against the
  WebGL context limit (`webglBudget.ts`), not by workspace count.

## Data and state

SQLite is initialized by `electron/main/db` and passed explicitly to services. Schema migrations are ordered and append-only. UI-only transient state belongs in React/Zustand; durable state belongs in SQLite. Workspace files remain the source of truth for project content.

Long-running or native resources must expose cleanup and be released during app shutdown. IPC listeners should be registered once and return cleanup callbacks where appropriate.

## Quality gates

The supported delivery sequence is typecheck, lint, coverage tests, renderer/main build with bundle budgets, Electron-native verification, and E2E. The Windows CI workflow runs these gates in that order and produces release artifacts only from the verified commit.
