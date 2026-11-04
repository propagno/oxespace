# OXESpace 1.5.0 playground

The visual reference for 1.5.0 (Direction B, lite) and for later UI work. It is a separate Vite + React + TypeScript
app with mock data for one fictional company, Cajuí Pagamentos. It is not part of the OXESpace build: nothing here is
imported by the app, and the root `npm run lint`, `typecheck` and `test` don't look inside this folder.

## Run it

```bash
cd playground
npm install
npm run dev        # http://localhost:5199 (fixed port, so it never clashes with the app's dev server)
npm run build      # typecheck, then a static build in dist/
npm run preview    # serves dist/ on http://localhost:5198
```

Nothing talks to a model, a database or the network. The only external load is the Google Fonts stylesheet; without
it the fonts fall back to Segoe UI and Consolas.

## Using it

- The bar on top picks the **screen**, the **frame** (1440 × 900 or 900 × 620), the **theme** and the **state** (live,
  loading, empty, error). Pause stops the simulated clock; Reset puts every mock record back.
- The panel on the right says what the screen shows, which plan items it implements (`docs/design/plan-1.5-ui.md`),
  what to try, and the keyboard.
- Every screen has its own URL hash (`#task-approval`, `#queue`…), so a link opens it directly.
- The app inside the frame is clickable: the screens are a starting point, not the only states.

## 1.5.0 or later

**1.5.0 is lite B.** One task is one conversation. Its tabs (Terminal, Queries, Requests, Containers, Changes, Pull
request) come from that conversation's agent activity: the U12 read model, T63 and T64. There is no new Task entity
and no Android protocol change.

Screens tagged **later (full B)** need a Task entity that owns several conversations and resources: a task with two
agents, and the board that watches every running task. They are here to compare, not to build in 1.5.0.

What lite B needs that isn't in the plan yet:

- **Terminal tab:** a terminal belongs to a task when its working directory is the task's worktree. No new link
  table is needed.
- **Containers tab:** the U12 `containers` source must carry the thread id of the agent call that started or touched
  the container.
- **Pull request tab:** the worktree finish flow (`ThreadWorktreeFinishDialog`) plus a read of the PR's checks and
  reviewers.

## Screen map

Pick screens from the bar on top or the list on the right; every one has its own URL hash.

| Group | Screens |
|---|---|
| Shell | First run · Workspace with no tasks · Task list collapsed (T61) · Command palette · Notifications · New task |
| OxeChat thread | T-147, every part of a Claude Code session: image attachment, thinking, todos, an explore subagent, web and MCP calls, an approved plan, command and edit approvals, a background shell, a retried API error, compaction, a queued message, and interactive questions. Answer them, then approve the command it asks for. |
| Task view | Waiting for an approval · Running (Stop, steer) · Reversible approval · Stopped with an error · Terminal · Queries · Requests · Containers · Changes (grouped by place) · Pull request · Conversation details · Side chat |
| Approvals | Impact preview for a database write · for deleting a volume · Approval queue |
| Modes | OxeCode (grid, columns, focus with tabs) · OxeQuery and what agents ran (T63) · OxePost (T62) and what agents sent · OxePod |
| Settings | General · Appearance · Agents · Approvals and safety · Notifications · Keyboard · Terminal · Tools and skills · Phone and devices · Data and privacy · Agent activity (U12) · Diagnostics · About · Projects · Policy |
| Dialogs | Every dialog from the #569 audit on the U1 contract, opened from a gallery |
| Foundations | Mandacaru 1.5 read from the token file: colors in light and dark, syntax roles, type, space, motion, icons, components and their states |
| Later (full B) | Task with two agents · Watch running tasks |

## Rules this playground sets

- **What it is doing comes first.** A task shows one line under its title that says what the agent is doing and
  whether you must act. Tool calls fold into one summary line per group; times show on hover.
- **Only what exists.** Tabs appear for the tools a task used; panels list only what was touched.
- **Every text button looks like a button at rest** (a fill or a border). Only toolbar icon buttons may be bare,
  and they always have a tooltip and an aria label.
- **Code is colored** with the `syn-*` roles in editors, code blocks, approvals and diffs.
- **Deny is the default; irreversible approvals need a 1.2 s hold.**

## Worktree-aware Changes: what the backend needs

The Changes tab and file links here assume that one task can write in several places: its own worktree, another
checkout a terminal switched, and folders outside any repository. Today (main at the time of writing) the app tracks one place
per thread, so people who work with many worktrees and terminals see missing or wrong files:

- `thread-orchestrator.ts` `projectDiff` diffs one root (`observedLocation.checkoutRoot` when it is the same
  repository, else `thread.rootPath`) against its current `HEAD`. A terminal that switches that checkout's branch
  moves the base, and folders outside the repository fall back to the project root.
- `ThreadTimelineEntry.tsx` (F33) opens paths named in the agent's text from `thread.rootPath`, so a file in the
  worktree or in an outside folder reports "does not exist".

To match the design:

1. **Places per task.** Record every checkout root and outside folder the agent wrote to, from the absolute paths
   in tool events, not only the last reported `cwd`.
2. **A base per place.** Capture the commit each checkout was on when the task first touched it (the checkpoint
   store already keeps `baseCommit`) and diff against it, not against `HEAD`.
3. **Branch drift.** When a checkout's branch changes outside the task, emit an event (old and new branch, by which
   terminal or pane) so the UI can warn and offer Switch back or Follow the new branch.
4. **Outside folders.** List files written outside any repository as written, with no diff base.
5. **Path resolution.** Resolve a path from the agent's text in order: absolute path, the agent's `cwd` at that
   turn, its checkout root, the task's worktree, the project root, then other worktrees of the same repository.
   With several matches, ask; with none, say where it looked.

## Mandacaru 1.5

`src/design/mandacaru-1.5.css` is a self-contained copy of the Mandacaru roles with the 1.5 changes. The app adopts
it later through the token export (contract C4):

- **Dark accent:** moves from the sertão sun to caatinga green, so green means the app in both modes.
- **`attn` roles:** the sun now means "needs you" (approvals, questions, stalled agents) in both modes.
- **Resource kinds:** `k-file`, `k-db`, `k-box`, `k-net` and `k-shell` color tabs, chips and activity bars.
- **`fill-selected` in dark:** caatinga 4 (U4), so a selection is visible.
- **Hold-to-confirm:** an irreversible approval needs a 1.2 s hold. Deny is always the default focus.

## Layout

```
src/
  mock/        data.ts (the company, tasks, conversations, queries, requests, containers), types.ts
  design/      mandacaru-1.5.css (tokens, light and dark)
  styles/      playground chrome, shared atoms, Direction B
  state/       store.ts: one state object, actions and the simulated clock
  components/  Shell, Task, Tools, Overlays, Dialogs, Later, ui primitives, icons
  screens/     registry.ts: every screen, its tag and plan items
```
