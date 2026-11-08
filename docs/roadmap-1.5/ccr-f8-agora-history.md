# CCR: F8 backend — Agora, time travel (timeline, Branch) and the command bar (1.5.0)

Owner: BACKEND. Status: frozen tests for review (M5: HML, DESIGN, FE; light SECURITY: TECH LEAD).

**Criteria:** A29, A30 and A31.

**Contract:** DESIGN's `1.5.0-f8-design.md` "Data each screen needs".

**Frozen tests:** `tests/acceptance/f8/`: 18 tests in 3 files.
- `a30-time-travel.native.test.ts` (7, Electron's Node, a real ThreadManager on a temp git repo).
- `a31-command-bar.test.ts` (7).
- `f8-contract.test.ts` (4).

**Tasks:** `.claude/roadmap-1.4/team/plans/f8-tasks-BACKEND.json`: 4 tasks with the pack fields (F8-TIMELINE, F8-BRANCH, F8-BAR, F8-IPC).

**Rigor:**
- real code only: the ThreadManager with an in-memory DB, a fake adapter, an injected fork and a temp git repo; the real `createOxeApi`, `IPC_CHANNELS`, `MCP_COVERAGE` and `MESSAGE_CODES`;
- no source-text matches;
- every refusal test first proves the success path works on the same fixture, then checks that nothing was created (no branch, no worktree folder, no workspace row, no conversation).

## A29 · Agora (no backend task)

Agora is the window's. It reads what is already on main:
- the S7.1 overview and its changes (`AGENTS_CHANNELS`: overview, markSeen, onChanged);
- F6-T90's `activity`;
- the actions over existing IPC: `thread.respond` (deny, allow), `thread.interrupt` (stop), `agents.markSeen`.

FE-A29 owns its tests.

## A30 · Time travel

**`thread:history` is unchanged.** It already means the message history pages. Time travel is the new `thread:timeline`.

**`ThreadOrchestrator.timeline(id)`** returns:
- `checkpoints: [{ id, n, at, label, files, checkout, failed? }]`:
  - one per user turn (plus one per other checkout touched), `n` 1-based per conversation;
  - `label` is the turn's first user message, cut;
  - `files` are paths relative to their checkout, from ThreadCheckpointService;
  - `failed: true` when the files were not saved (over 32 MiB): transcript only.
- `cantGoBack: { dbWrites, pushes, containers }`, from the audits, never the transcript, for actor `thread:<id>` only:
  - `dbWrites`: `oxequery_audit` rows of a write tool (`oxespace_db_execute`, `oxespace_mongo_write`) with outcome ok;
  - `containers`: `oxespace_container_action` rows with outcome ok;
  - `pushes`: the conversation's completed command tool events that are a push (F7-IMPACT's push kind: git push in any form, npm publish, docker push, gh pr merge) with exit 0.

**Restore** is today's rewind, unchanged. F8 adds no backend for it.

**`branchFromCheckpoint(id, checkpointId, { branch })`** (light SECURITY) returns `{ ok: true, threadId, workspaceId, worktreePath }` or `{ ok: false, refusal: { code, params } }`.

Checks come first, and any refusal creates nothing:
- the branch name passes F4's `isSafeBranchName` and does not exist yet (`thread.branch.exists`);
- the checkpoint exists (`thread.branch.checkpointGone`) and is not failed (`thread.branch.checkpointFailed`);
- the provider can fork, asked before any git write (`thread.branch.unsupported`). Claude forks with `forkClaudeBefore`. Codex is unsupported until it has a fork or rollback (A64's "Not available in Codex").

Then, in order:
1. `git worktree add -b <branch> <sibling path> <the checkpoint's base commit>`;
2. the checkpoint's pre-images (the files as they were when that turn began) are restored into it;
3. it is registered as `ownedWorktree { path, branch, projectRoot, baseSha }`, with its workspace row;
4. the new conversation is created under the project with the forked `nativeSessionId`.

The original conversation and its checkout are never changed.

**`branchNameFor(title, at)`** prefills the dialog: `oxe/<ASCII slug>-from-HHMM`, at most 60 characters, accents folded, `conversation` when the title has no letters, always a safe ref name.

## A31 · The command bar

**`parseCommandLine(text, skillNames?)`** (shared, so the window renders it) returns one of:
- `{ kind: agent, provider: claude | codex, text }` for `@Claude …` and `@Codex …`;
- `{ kind: skill, name, args }` for `/skill <name>` and `/<skill-name>` (from `skillNames`);
- `{ kind: command, id, args }` for pending, deny, steer, stop, new, history, agora, terminal and theme. A known command wins over a skill of the same name;
- `{ kind: open, query }` for `open <query>`;
- `{ kind: help }` for `?`;
- `{ kind: unknown, text }` otherwise.

**There is no /approve.** `/approve`, `/allow` and `/accept`, in any case, are unknown.

**`COMMAND_CATALOG`** entries are `{ id, ipc, fixedArgs?, confirm?, fallback, shortcut }`:
- every `ipc` is an existing `IPC_CHANNELS` path, and every entry has a fallback button and a shortcut field;
- deny is `thread.respond` with `fixedArgs { decision: decline }`;
- stop is `thread.interrupt` with `confirm: true`;
- history is `thread.timeline` (read only);
- skill is `skill.invoke`;
- nothing maps to `thread.approve`, `approvals.alwaysAllow` or `thread.branchFromCheckpoint`. Branch stays a person's dialog.

## Contract

**Channels:** `IPC_CHANNELS.thread` gains `timeline` (`thread:timeline`) and `branchFromCheckpoint` (`thread:branch-from-checkpoint`), both preloaded. Inputs are checked by shape; `branch` is a string of at most 200 characters.

**MCP coverage:** `thread.branchFromCheckpoint` is forbidden (a person's action); `thread.timeline` is excluded (the window's read model).

**C3 codes:** `thread.branch.unsupported`, `thread.branch.checkpointGone`, `thread.branch.checkpointFailed`, `thread.branch.exists`.

## SECURITY (TECH LEAD, light)

The review surface:
- Branch creates nothing on any refusal, and the fork is asked before any git write;
- the branch name is checked by `isSafeBranchName` (no option-like names, no `..`, no spaces) and must not exist (`main` is refused);
- the original conversation and checkout are never changed;
- branching is forbidden to agents over MCP;
- the command bar has no approving command and no new power: every command is an existing channel.

## Out of F8

Approving from the bar, editing the past, merging branches.
