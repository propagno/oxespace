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

| Group | Screens |
|---|---|
| Shell | First run · Workspace with no tasks · Task list collapsed (T61) · Command palette · Notifications · New task |
| Task view | Waiting for an approval · Running (Stop, steer) · Reversible approval · Stopped with an error · Terminal · Queries · Requests · Containers · Changes · Pull request · Conversation details (T58 §7a) · Side chat (T58 §7c, T60) |
| Approvals | Impact preview for a database write · Impact preview for deleting a volume · Approval queue |
| Modes | OxeCode · OxeQuery · OxeQuery agent activity (T63) · OxePost (T62) · OxePost agent activity · OxePod · Quick chat |
| Settings | Every page, with apply at once, undo toasts and confirm dialogs (U2, U8) |
| Dialogs | The #569 audit's dialogs on the U1 contract |
| Foundations | Tokens, type, spacing, icons and primitives with their states |
| Later (full B) | Task with two agents · Watch running tasks |

The PR lands in stages. The first push has the shell, the task view, the conversation and approvals. Screens tagged
"next push" in the picker say so when opened.

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
