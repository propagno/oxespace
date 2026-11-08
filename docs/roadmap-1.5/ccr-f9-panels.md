# CCR: F9 backend — the Containers panel, provider parity and main's copy (1.5.0)

Owner: BACKEND. Status: frozen tests for review (M5: HML, DESIGN, FE; TECH LEAD).

**Criteria:**
- **With backend work:** A34 (the Containers panel), A64 (provider parity) and A69 (main's copy).
- **The window's alone, on what is already on main:** A32 (sidebars and New workspace as 1.4.1), A33 (the OxeCode grid and dock; the layouts, 2 × 5 and 2 × 7 included, are already valid values), A61 (collapsing per mode) and A1's first run (the existing agent readiness).

**Contract:** DESIGN's `1.5.0-f9-design.md` "Data each screen needs", with FRONTEND's names as agreed on 08/11.

**Frozen tests:** `tests/acceptance/f9/`: 11 tests in 4 files.

| File | Tests | Runs on |
|---|---|---|
| `a34-containers-panel.native.test.ts` | 4 | Electron's Node: the real OxePodService over a fake engine host, and a migrated DB |
| `a64-provider-parity.test.ts` | 3 | Node |
| `a69-main-copy.test.ts` | 2 | Node: the locale data files |
| `f9-contract.test.ts` | 2 | Node: the real oxePod IPC and service |

**Tasks:** `.claude/roadmap-1.4/team/plans/f9-tasks-BACKEND.json`: 4 tasks with the pack fields (F9-PANEL, F9-ORIGIN, F9-PARITY, F9-COPY).

## A34 · The Containers panel

**A new op:** `oxePod.call('containers.panel', { engine? })` returns `{ engine: { state, engine? }, rows }`.
- It's not `containers.list`, because agents reach `list` in process, and the rows carry other conversations' titles.
- A daemon that's down, a missing binary or a denied engine gives `{ state, rows: [] }`, not an error. That's DESIGN's "Docker isn't answering".

**A row:** `{ id, name, image, status, ports, stack, upSince, isDatabase, startedBy }`.
- `stack` is the compose project label, or null.
- `upSince` is when a running container started, from one batched inspect.
- `isDatabase` is true exactly when `containers.suggestConnection` gives a suggestion, so Connect in OxeQuery shows only then. A password never leaves main.

**`startedBy`** is one of:
- `{ kind: conversation, conversationId, title, provider }`;
- `{ kind: person }`, which shows as "You";
- null, for unknown (started outside OXESpace).

The latest start wins. The sources are:
1. **The person,** who started, restarted, or ran compose up/start/restart through OXESpace. It's recorded in `container_starts` (migration 100, main's highest + 1 at execute), without content.
2. **The agents' container audit:** `oxespace_container_action` rows for start or restart, with outcome ok.
3. **A conversation's own successful commands:**
   - `docker compose up/start/restart` matches the stack. The project is `-p`, else `COMPOSE_PROJECT_NAME`, else the conversation's folder name, normalised the way compose does it.
   - `docker run --name` matches that container.

**Unchanged:**
- the actions: start/stop/restart, remove, and stop the stack;
- Remove and compose down still need the person's confirmation in main;
- the shell, logs and Connect;
- Stop's undo, which is the window calling start.

## A64 · Provider parity

**`shared/provider-parity.ts`:**
- `PARITY_FEATURES` = fork, branch, alwaysAllowBeyondSession, paneConversation, effort.
- `parityFor(provider, feature)` → `{ available: true }` or `{ available: false, refusal: { code: parity.notAvailable, params: { provider } } }`.

**Per provider:**
- **Claude** has all five.
- **Codex** lacks two:
  - branch: no fork or rollback to branch from (F8);
  - alwaysAllowBeyondSession: a Codex rule lasts the session (F7).

  Fork, effort and the pane conversation are available. A pane without a rollout file is F10's per-pane refusal.

**One source:** `ThreadCapabilityManifest.features` gains the five, taken from the same table (`enabled`, plus the refusal as `messageCode`). The window reads the conversation's manifest and never decides from the provider name.

## A69 · Main's copy

Every message in `shared/locales/{en,pt-BR}/main.json` is at most 20 words, with placeholders counting one each, because the cockpit shows them.
- Today, 23 en and 30 pt-BR messages are over (`.claude/roadmap-1.4/team/plans/1.5.0-f9-main-copy-request.md`).
- DESIGN writes the shorter texts, keeping keys and placeholders, in `1.5.0-f9-main-copy.md`. F9-COPY applies them.
- It runs last, so every phase's new messages are counted.

FE and HML own the screen walk.

## Contract

**OxePod:** `OXEPOD_OPS` gains `containers.panel` on the existing `oxePod:call`. It isn't in the agents' seam or any MCP tool.

**Types:** `ContainerPanel`, `ContainerPanelRow` and `ContainerStartedBy` in `shared/types/oxepod.ts`. `ThreadCapabilityManifest.features` gains the five parity keys.

**C3 code:** `parity.notAvailable { provider }`.

## Out of F9

A container editor, Kubernetes, and grouping by status.
