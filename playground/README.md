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

## Start here: the 1.5.0 story in 10 stops

Open each link after `http://localhost:5199/`. It takes about 15 minutes. The panel on the right of each screen says
what to try; Reset in the top bar puts the mock data back.

1. **`#mode-code`: your terminals, as today.**
   - The sidebar is 1.4's: one card per workspace (a repository or one of its worktrees), New workspace, Delegated
     work, Files & commands, and each card's terminals under it. Open **cajui-api · t143**: its pane shows `mig-prd`
     as moved because a terminal switched that worktree.
   - Each workspace has a color (its gear › Color). It follows the workspace into pane headers, the conversation
     header, Agora and the status bar.
   - **+ Terminal** opens at once where the focused pane is; its chevron asks for another project or worktree.
   - Drag a divider, right-click it for the divider menu, or drag a pane header to move the pane.
2. **`#chat`: one OxeChat conversation, end to end.** Claude has two questions for you. Answer them (the pager is in
   the footer). Then it asks to run `npm test`: Deny, Allow once, or Always allow with Claude's own rule. After the
   tests it asks to `git push`, and Always allow isn't offered for that. Expand "Thought for 14 s" and the Explore
   agent along the way.
3. **`#chat-split`: two conversations side by side.** Click or Tab into either side; nothing reorders. Close one with
   its ✕.
4. **`#chat-tools`: tools beside the conversation.** Files, Browser, and Git with GitHub and Linear open in a panel you
   can drag wider or maximize. The conversation never goes away.
5. **`#task-approval` › Changes tab: when a terminal moved your branch.**
   - The now line says "moved to mig-prd".
   - The Changes tab shows what the conversation changed, against where it started.
   - Switch back is refused because the worktree is dirty. Dismiss splits "changed by the task" from "changed by the
     branch switch".
6. **`#approve-sql`: approving with the impact in front of you.**
   - Rows before → after, where it runs, and whether it can be undone.
   - Snapshot, then approve: OXESpace keeps the copy.
   - Hold Approve for 1.2 s, or use Approve without holding… and its checkbox. Deny is the default.
7. **`#queue`: everything waiting, in one place.** The first request is focused: press D or A. The questions from
   stop 2 appear here too.
8. **`#mode-query`, then `#mode-post` and `#mode-pod`: the other modes, each a familiar tool.** The one line at the
   top says what agents did there; "See what agents did" opens the detail.
9. **`#settings-approvals`, then `#settings-devices`: what agents and phones may do.** Risky changes apply at once
   with an undo. The phone page says exactly what a phone can and can't approve.
10. **`#foundations`: the reference.** Every Mandacaru 1.5 token in light and dark, type, space, motion, icons, and
    the primitives in their states.

Switch **Frame** to 900 × 620 and **Theme** to Dark at any stop; every screen works in all four combinations.
`#first-run` shows the app with nothing set up.

## Round 4: four radical decisions

The user chose all four; the workspace structure stayed 1.4's (see FIDELITY.md › Round 4).

- **`#agora`: every agent, right now** (T82). Needs-you first, then every workspace in its color. Deny, See impact,
  Steer and Stop work in place; on a focused card, D denies and A allows (or opens the impact preview). Ctrl Shift G
  from anywhere.
- **`#history`: time travel in a conversation** (T83). Scrub the transcript; files snap to checkpoints; restore or
  branch into a new worktree. What can't go back is always listed.
- **`#command-bar`: one bar** (T84). `@Codex …`, `/approve`, `open billing-staging`, `?` for every command.
- **Identity** (T85). Workspace colors, our own mode icons, bolder titles, motion only when state changes.

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
| Shell | First run · Workspace with no tasks · Task list collapsed (T61) · The command bar (T84) · Notifications · New task |
| OxeChat thread | Time travel in a conversation (T83) · T-147, every part of a Claude Code session: image attachment, thinking, todos, an explore subagent, web and MCP calls, an approved plan, command and edit approvals, a background shell, a retried API error, compaction, a queued message, and interactive questions. Answer them, then approve the command it asks for. |
| Task view | Waiting for an approval · Running (Stop, steer) · Reversible approval · Stopped with an error · Terminal · Queries · Requests · Containers · Changes (grouped by place) · Pull request · Conversation details · Side chat |
| Approvals | Agora: every agent, right now (T82) · Impact preview for a database write · for deleting a volume · Approval queue |
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
