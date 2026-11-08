# CCR: F9 backend — the Containers panel, provider parity and main's copy (1.5.0)

Owner: BACKEND. Status: frozen tests; TECH LEAD (with the reach condition) and DESIGN approved; HML 721-1..4 in.

**Criteria:**
- **With backend work:** A34 (the Containers panel), A64 (provider parity) and A69 (main's copy).
- **The window's alone, on what is already on main:** A32 (sidebars and New workspace as 1.4.1), A33 (the OxeCode grid and dock; the layouts, 2 × 5 and 2 × 7 included, are already valid values), A61 (collapsing per mode) and A1's first run (the existing agent readiness).

**Contract:** DESIGN's `1.5.0-f9-design.md` "Data each screen needs", with FRONTEND's names as agreed on 08/11.

**Frozen tests:** `tests/acceptance/f9/`: 15 tests in 4 files.

| File | Tests | Runs on |
|---|---|---|
| `a34-containers-panel.native.test.ts` | 8 | Electron's Node: the real OxePodService and AgentGateway over a fake engine host, and a migrated DB |
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
- null, for unknown: "Outside OXESpace" (DESIGN). It never reads "You".

**Docker's clock decides (HML 721-3/4).** A source counts for a container only when the container's own `StartedAt` falls inside that source's window, from 5 s before it began to 60 s after it ended (or now, while it runs). Among the matches, the latest wins.
- If nothing matches, the answer is null. That covers a restart from Docker Desktop or another shell, and a start before OXESpace.
- A foreground `compose up` that never ends, or ends with 130 or 143, still started its containers.
- A command that failed before the start falls outside its own window.

**The sources:**
1. **The person,** who started, restarted, or ran compose up/start/restart through OXESpace. It's recorded in `container_starts` (migration 100, main's highest + 1 at execute), without content.
2. **The agents' container audit:** `oxespace_container_action` rows for start or restart, with outcome ok.
3. **A conversation's own commands,** after an optional `sudo` or env prefix (HML 721-2):
   - compose: `docker compose`, `docker-compose`, `podman compose` or `podman-compose`, with up, start or restart;
   - run: `docker|podman run` or `container run`, with `--name x` or `--name=x`;
   - start: `docker|podman start` or `restart <name>`.

**A stack is matched by its own labels, never by guessing its name (HML 721-1).**
- The command's resolved folder is the conversation's root, then each `cd` in the line, then `--project-directory`, else the folder of the first `-f` file.
- It must equal the container's `com.docker.compose.project.working_dir` (or a `config_files` folder), compared as paths.
- `-p`, when given, must also equal the project label.

This handles `-f infra/…`, a `name:` key, a `.env` project name, a `cd`, and a same-named folder elsewhere.

**Reach (SECURITY, TECH LEAD).** The rows carry other conversations' titles, so `containers.panel` is the window's only:
- it isn't in `TOOL_REGISTRY` or the agents' seam;
- it's forbidden in `MCP_COVERAGE` (`oxePod.containers.panel`);
- it's not in `REMOTE_COMMANDS`;
- the agents' `oxespace_containers_list` and `containers.list` never carry `startedBy` or a title.

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
