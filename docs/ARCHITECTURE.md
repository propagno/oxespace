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

## Data and state

SQLite is initialized by `electron/main/db` and passed explicitly to services. Schema migrations are ordered and append-only. UI-only transient state belongs in React/Zustand; durable state belongs in SQLite. Workspace files remain the source of truth for project content.

Long-running or native resources must expose cleanup and be released during app shutdown. IPC listeners should be registered once and return cleanup callbacks where appropriate.

## Quality gates

The supported delivery sequence is typecheck, lint, coverage tests, renderer/main build with bundle budgets, Electron-native verification, and E2E. The Windows CI workflow runs these gates in that order and produces release artifacts only from the verified commit.
