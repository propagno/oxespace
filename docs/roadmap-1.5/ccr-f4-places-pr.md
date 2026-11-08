# CCR: F4 backend — places per conversation, drift, the path resolver, panes, collisions, the PR provider and the worktrees panel (1.5.0)

Owner: BACKEND. Status: frozen tests for review (M5: HML tests, DESIGN shapes, FE renderer; SECURITY: TECH LEAD).

- **Criteria:** A13, A14, A15, A16, A17, A18, A54, A60, A62, A63 (`.oxe/SPEC.md`, lines 149–199).
- **Builds on:**
  - `docs/roadmap-1.5/ccr-t71-task-places.md` (the T71 design, approved for lite B). That document's model, sources, base, drift, resolver, IPC and tests stand. This CCR pins what it left open and adds §6's items.
  - DESIGN's `.claude/roadmap-1.4/team/plans/1.5.0-f4-design.md`, section "Data each screen needs from main".
- **Frozen tests:** `tests/acceptance/f4/` (141 tests in 14 files, plus `fixtures/thread-fixture.ts`). Per TECH LEAD's rigor rule (08/11), each test exercises real code, and every "nothing happens" case first shows that something does, so a stub fails. The one source assertion is marked: no file-system write input takes a place id.
- **Tasks:** `.claude/roadmap-1.4/team/plans/f4-tasks-BACKEND.json`, 12 tasks with the IMPLEMENTATION-PACK fields.

No live provider, no user home and no user data: every test runs on temp-dir repositories, a fake provider adapter and fake `gh`/`az` CLIs.

## What changed from T71

| Point | T71 | Here | Why |
|---|---|---|---|
| Migration | 093 | **095** (`095_thread_places.sql`) | 093 is the workspace colour and H1 holds 094. Re-check main's highest + 1 before execute. |
| Caps | 32 places, plus 16 outside | 32 non-outside places (the root included) **plus** 16 outside: 48 at most, then `capped: true` | SPEC A13 says "até 32 lugares + 16 pastas de fora". |
| `places()` result | `ThreadPlace[]` | `ThreadPlaces = { places, capped, refused }` | DESIGN asked for the `capped` flag. `refused` counts paths refused by the link, UNC, `..` and missing checks. |
| `ThreadPlace` | id, kind, path, firstSeenAt, base, current, drift, writes | the same, plus `files: string[]` (written paths, relative) | DESIGN's `files[]`. |
| Drift | from, to, seenAt, by, certain, answer | the same, plus `dirty` and `detached` | DESIGN's drift card disables Switch back on these. |
| Kinds | root, worktree, checkout, outside | unchanged | DESIGN's `main` is the window's label for `root` when the root is the main checkout. |
| Resolver | `missing.looked[{ step, path }]` | unchanged, plus `found.line` from a `:<line>` suffix | DESIGN's `lookedIn` is `looked.map(entry => entry.path)`. |
| §6 Terminal tab | `thread:panes` with `via` | plus `placeId` and `group: agent \| yours`; the newest cwd decides | DESIGN U4.4 groups the panes. A pane whose shell left the places leaves the tab. |
| §6 OSC cwd | 1.5.x option (b), passive scan (a) | (a) is in F4 | SPEC A18 (T79). |
| §6 PR tab | reuses the GitHub review channel | **a provider-neutral `pull-request:state`** | SPEC A60 adds Azure DevOps. |

## A13 · Places from evidence

`ThreadManager.places(id): Promise<ThreadPlaces>`.

- **Evidence:**
  - `location` events;
  - `tool` and `turn-diff` file changes (`path`, `previousPath`);
  - request paths.

  Message text never creates a place.
- **Checks on each path:**
  - absolute;
  - no NUL;
  - at most 4096 characters;
  - `localPointer` and `staysLocal` (the #520 link walk);
  - its folder exists.

  A refused path is counted in `refused` and never stored.
- **The root place** is created on the first read.
- **The base** is taken at first touch inside a running turn. It reuses that turn's checkpoint base for the root (`conversation_checkpoints.base_commit`). Otherwise the place's checkpoint opens at that moment.
  - The branch is `symbolic-ref --short -q`, null when detached.
  - An unborn branch has a null commit.
  - The base never moves on its own.
- **`current`** is read on each call and never stored.
- **Storage:** places survive a restart, in `thread_places`, `thread_place_writes` and `thread_turn_cwd`.

Migration 095 only adds those tables, as T71 §5 describes, with `PRAGMA user_version = 95`. a13 checks it on a real database: the tables exist, the kind CHECK holds, and a place goes with its conversation.

## A14 · Changes per place

`placeDiff(id, placeId)` returns one of two shapes:
- `{ place, groups: { task, branchSwitch? } }` for a git place;
- `{ place, groups: { written } }` for an outside place.

**Git places**
- The diff is against the base, so the task's own commits stay its changes.
- With drift (not followed), files changed between the base and `drift.to` that the task did not write go to `branchSwitch`.
- An unborn branch diffs against the empty tree.

**Outside places**
- The written files, with their kind and counts.

An unknown place gives `thread.place.gone`.

## A15 · Drift and its answers (SECURITY)

**When it is read**
- At turn begin and end, and on `places()` and `placeDiff()`.
- Never on a timer or a watcher.

**What is drift**
- Not drift:
  - the same branch, with the base an ancestor of HEAD;
  - a move made while the conversation's own `git checkout|switch|reset|rebase|merge|pull|commit|am` tool was running.
- Drift is anything else: the branch changed, or the base is no longer an ancestor.

**The `place-drift` event**
- One `place-drift` ThreadEvent per change, never per read: `{ type, placeId, from, to, by, certain: false, seenAt }`.
- `by` lists the panes whose newest cwd is in the place. It is a hint, never certain.
- It round-trips through the portable export. Imported places have no bases.

`answerPlaceDrift(id, placeId, answer)` returns `{ ok: true, place } | { ok: false, refusal }`.

| Answer | Effect | Refusal |
|---|---|---|
| `switched-back` | `git switch <base.branch>` through safe git. No stash, no force. | `thread.place.dirty` (uncommitted changes), `thread.place.detached` (base had no branch) |
| `followed` | The base becomes `drift.to`. No repository change. | — |
| `dismissed` | Keeps the base; the diff keeps the two groups apart. | — |
| any answer | — | `thread.place.noDrift`, `thread.place.gone`; a word outside the list throws |

The confirmation with Cancel focused is the window's (FE-A15).

## A16 · One path resolver

`resolvePath(id, raw, { turnId? })` tries `THREAD_PATH_STEPS` in this order:
1. `absolute`
2. `turn-cwd`
3. `checkout-root`
4. `task-worktree`
5. `project-root`
6. `task-place`
7. `sibling-worktree`

**Rules**
- **Stopping:** steps 2–6 stop at the first hit. Step 7 runs only after 1–6 miss: `git worktree list`, at most 16 entries, cached for 30 s.
- **Ambiguity:** only steps 6 and 7 can return `ambiguous`.
- **Escapes:** a `..` escape or a link out of a step's base is refused at that step.
- **No side effects:** it uses lstat/stat only, never reads content, and never creates a place.
- **Input:** `raw` is at most 4096 characters with no NUL. A `:<line>` suffix becomes `line`.

## A17 · Read-only outside files (SECURITY)

`readPlaceFile(id, placeId, relativePath)` returns `fs:read-file`'s shape plus `readOnly: true`.

- **Which places:** only this thread's outside or checkout places with tool-evidence writes. Anything else, including the root and location-only places, gives `thread.place.notEvidence`.
- **Paths:** `..`, an absolute path, a NUL, or a link out (re-checked on the target) gives `thread.place.outside`.
- **Files:** regular files only, within the 2 MiB text limit, and text only.
- **What stays unchanged:**
  - `fs:read-file` and `workspaceRootResolver` are not widened;
  - no write input takes a place id;
  - `thread:place-read` is `forbidden` in MCP coverage, as is `thread:place-drift-answer`.

## A18 · Pane branch and shell cwd

**`ShellCwdScanner`** (`electron/main/services/terminal/shell-cwd.ts`) scans PTY output for these sequences, ended by BEL or ST:

| Sequence | Form |
|---|---|
| OSC 7 | `file://<empty \| localhost \| hostname>/…` |
| OSC 633 | `P;Cwd=` |
| OSC 9;9 | `;"…"` or bare |
| OSC 1337 | `CurrentDir=` |

- A value counts when it is absolute, has no NUL, is at most 4096 characters, and is not UNC.
- The newest cwd in a chunk wins.
- A split sequence completes on the next chunk.
- An unterminated one is dropped above `SHELL_CWD_MAX_PENDING`.

**`PaneBranchTracker`** returns `{ branch, startedOn, switched }`.
- The branch is null outside a repository or on a detached HEAD.
- `refresh(paneId, cwd?)` follows a new cwd.
- IPC: `terminal:branch` and the push `terminal:branch-changed`, both `excluded` from MCP.

**The Terminal tab:** `panes(id)` returns `{ paneId, title, workspaceId, placeId, via, group }[]`.
- The pane's newest cwd decides membership, in this order: shell OSC, then the agent hook location, then the launch folder.
- A pane counts when that cwd is at or under a place. A shared prefix does not count.

## A54 · Collisions

`collisions(id)` returns `{ file, checkoutId, others[{ conversationId, title }] }[]`.

- A collision is a file this conversation wrote that is still dirty, which another non-archived conversation also wrote in the same checkout.
- A worktree of the same repository is a different checkout.
- Committing or undoing the file clears both sides.

## A60 · Pull request provider

**Detection:** `detectPrProvider(url)` returns `github | azure | none`.
- The host must match exactly, so lookalike hosts are `none`.
- GitHub forms: https, ssh, the scp form, and userinfo.
- Azure forms: `dev.azure.com`, `ssh.dev.azure.com:v3`, `*.visualstudio.com`, `vs-ssh.visualstudio.com:v3`.

**`PullRequestProvider.state({ rootPath, branch })`** returns:

```ts
{ provider, cli: 'ok' | 'missing' | 'signed-out',
  pr?: { number, title, state: 'open' | 'merged' | 'closed', draft, head, base, url,
         workItems[{ id, url }], checks[{ name, state: 'pass' | 'running' | 'fail' | 'skipped', duration }],
         reviewers[{ name, vote }] } | null }
```

- **Votes are values;** the window words them:
  - GitHub: `approved`, `changes-requested`, `commented`, `review-requested`;
  - Azure: `approved`, `approved-with-suggestions`, `no-vote`, `waiting-for-author`, `rejected`.
- **Azure calls** carry `--org https://dev.azure.com/<org> --project <p> --repository <r>`, taken from the remote.
  - Policies are the checks.
  - A work item links to `<org>/_workitems/edit/<id>`.
- **Branch names:** a branch that could read as an option, or with a space, is refused before any CLI runs.

**`merged({ rootPath, branch, base })`:**
- When the CLI works, the provider answers first, so a squash merge counts. The provider's "not merged" stands.
- With no CLI, signed out, or another remote, it falls back to git, marked `by: 'git'`.

**The real runner** spawns `gh` through GhExec's environment rules, and `az` with the same rules.

**IPC:** `pull-request:state`, `excluded` from MCP (agents use `oxespace_github`). Merge and Complete stay out of the app.

**Ask for DESIGN:** `skipped` is a fourth check state (GitHub skipped/neutral, Azure notApplicable). U4.6 lists three.

## A62 · What the agent did

- **`AgentActivity.summary({ actors })`** (an addition to F3's A10 read model) returns `{ changes, databases, containers, http, httpProduction, failedSources }`. A failing source is null and listed.
- **`threadAgentSummary(...)`** returns `{ files, databases, http, httpProduction, containers, approvals, failedSources }`.
  - The actors are `thread:<id>` plus the conversation's agent panes.
  - `files` comes from the places.
  - `approvals` counts the `request-resolved` events marked approved.
- **IPC:** `thread:agent-summary`.
- **The window's part:** the words, leaving out zeros, and "Add to description" with undo (FE-A62).

## A63 · Worktrees panel

**`WorktreesPanel.list({ rootPath })`:** one row per non-main worktree.

```ts
{ path, branch, conversation: { id, title, gone } | null, merged: { by, value }, prNumber,
  changed, diskBytes, lastActivity, branchChanged }
```

- `merged` follows A60's rule.
- `diskBytes` never follows links or junctions.
- Sort order: merged first, then the oldest activity.

**`remove({ rootPath, path, deleteBranch, confirmUnmerged? })`:**
- The path must be one of the listed worktrees: else `worktree.remove.notFound`, which also covers the main checkout.
- Uncommitted changes give `worktree.remove.dirty { count }`, and nothing is removed.
- `deleteBranch` on an unmerged branch without `confirmUnmerged` gives `worktree.remove.unmergedBranch { branch }`, and nothing is removed.
- Otherwise it removes without force, and deletes the branch only when asked (`-D` only with `confirmUnmerged`). It returns `{ ok: true, branchDeleted }`.

**IPC:** `worktrees-panel:list` and `:remove`, `excluded` from MCP (agents remove one at a time with `oxespace_remove_worktree`, at the confirm level).

## Contract

**New IPC channels**
- `IPC_CHANNELS.thread`: `places`, `placeDiff`, `resolvePath`, `placeDriftAnswer`, `placeRead`, `placesChanged`, `panes`, `collisions`, `agentSummary`;
- `IPC_CHANNELS.pullRequest`: `state`;
- `IPC_CHANNELS.worktreesPanel`: `list`, `remove`;
- `IPC_CHANNELS.terminal`: `branch`, `branchChanged`.

All go through the preload's `IPC_CHANNELS` and `window.d.ts`. `projectDiff` stays for one release.

**New C3 codes** (en and pt-BR catalog text, PARAMETERS entries):
- `thread.place.dirty`
- `thread.place.detached`
- `thread.place.gone`
- `thread.place.noDrift`
- `thread.place.notEvidence`
- `thread.place.outside`
- `worktree.remove.dirty { count }`
- `worktree.remove.notFound`
- `worktree.remove.unmergedBranch { branch }`

The FE words them in its F4 tasks.

**Phone:** no protocol change, so no `android:generate` (T71 §4.3).

## SECURITY (TECH LEAD)

The surface:
- paths from tool evidence and from model text (A13, A16);
- `git switch` from the UI (A15);
- a read channel outside the workspace roots, forbidden to MCP (A17);
- `gh` and `az` spawned with branch input (A60);
- branch deletion (A63).

Each one has a refusal test in the frozen set.

**TECH LEAD's conditions (SECURITY review of ba183e14), all frozen:**

| | Rule | Where |
|---|---|---|
| S1 | Switch back, the panel's Remove and branch delete, and place-read are reachable only from the window's IPC. They are no MCP tool, internal RPC method or phone command, and no agent-facing module (mcp-internal, remote, agent-hooks, the OxeQuery agent gateway) names or calls them. | `f4-security-reach.native.test.ts` |
| S2 | UNC and `//server`, `\\?\` and `\\.\`, drive-relative `C:foo`, reserved device names in any segment and any case, backslash or mixed-case escapes, and a junction out (even to another place) are refused with `thread.place.outside` (A17), and never resolve (A16), on every platform. | a16, a17 |
| S3 | `isSafeBranchName` (`electron/main/utils/git-ref-name.ts`) follows git's ref rules; an unsafe name throws before any CLI. `gh` gets the branch after `--`, `az` only as an option value, and `git branch -d -- <name>`. No shell anywhere. | a60, a63, reach |
| S4 | A branch is never deleted when it is the default branch, checked out in another worktree, or remote (no push, no `branch -r`), even with `confirmUnmerged`. | a63 |
| S5 | `person_action_audit` (095, append-only) gets one row per place read, Switch back, worktree Remove and branch delete, refusals included: who, thread, place, path or branch, outcome and code. It never holds file content. | a13, a15, a17, a63 |

## HML M5 (704-1 to 704-7), all frozen

- **704-1:** any HEAD move inside this conversation's running shell tool is its own: `gh pr checkout`, `git fetch && git switch -c`, `cd && git checkout -b`, `bash -c`. The same move after the tool completed is drift.
- **704-2:** files the task left uncommitted, carried by a person's switch, stay in `groups.task`, also after Follow.
- **704-3:** Switch back during the conversation's turn gives `thread.place.busy`, and works after the turn ends.
- **704-4:**
  - a rebase or bisect in progress is no drift;
  - a fast-forward is no drift;
  - a deleted base branch gives `thread.place.branchGone { branch }`.
- **704-5:** the main checkout is guarded on its real path (a trailing separator, case, a `..` walk, a link or junction to main or to a worktree).
- **704-6:**
  - a pane inside, or the conversation mid-turn, gives `worktree.remove.busy { reason }`;
  - a git failure such as EBUSY gives `worktree.remove.failed` with the row kept.
- **704-7:**
  - a locked worktree gives `worktree.remove.locked { reason }`;
  - a missing one is listed with `missing: true` and pruned by Remove;
  - a branch checked out elsewhere gives `worktree.remove.branchInUse`.

New C3 codes: `thread.place.busy`, `thread.place.branchGone { branch }`, `worktree.remove.busy { reason }`, `worktree.remove.failed`, `worktree.remove.locked { reason }`, `worktree.remove.defaultBranch { branch }`, `worktree.remove.branchInUse { branch }`.

## Tasks

| Task | Criteria | Depends on | Size |
|---|---|---|---|
| F4-P1 places, migration 095 | A13 | — | L |
| F4-P2 diff per place | A14 | P1 | M |
| F4-P3 drift and answers | A15 | P2 | L |
| F4-P4 resolver | A16 | P1 | M |
| F4-P5 place-read | A17 | P1 | M |
| F4-P6 shell cwd and pane branch | A18 | — | M |
| F4-P7 Terminal tab membership | A18 | P1, P6 | S |
| F4-P8 collisions | A54 | P1 | S |
| F4-P9 PR provider | A60 | — | L |
| F4-P10 agent summary | A62 | F3 A10, P1, P7 | S |
| F4-P11 worktrees panel | A63 | P9 | M |
| F4-IPC channels, preload, coverage | all | P2–P5, P7–P11 | M |

**What runs in parallel:** P6 and P9 are independent of the places chain, and P4, P5 and P8 run in parallel after P1.

**What waits for F3:** P10 needs F3's `read-model.ts`, so it waits for F3's A10 task.

## The agent tool `oxespace_remove_worktree` (TECH LEAD, 08/11)

The tool stays: creating and removing a worktree with the person's confirmation is a real agent flow. It goes through the same guarded removal as the panel.
- **The handler** calls `worktreesPanel.removeForAgent({ rootPath, path })`, never `github.removeWorktree` directly.
- **Refusals:** dirty, busy, locked, the main checkout on its real path, and a path that is not a worktree, all exactly like the panel.
- **No branch delete,** whatever the arguments.
- **No `force`:** it is dropped from the schema and from the approval text.
- **Audit:** each call writes one `agent_action_audit` row through AgentActions, refusals included, and no `person_action_audit` row.
- **Frozen in** a63 ("the agent tool…"), through the real registered tool and its approval door.

## A14 Undo, Restore and Discard per place (TECH LEAD on HML-705-1, 08/11)

| Call | Result |
|---|---|
| `placeUndo(threadId, placeId, { path, hunk?, seenMtime })` | `{ ok: true, restoreToken } \| { ok: false, refusal }` |
| `placeRestore(threadId, restoreToken)` | `{ ok: true } \| { ok: false, refusal }` |
| `placeDiscard(threadId, placeId, { confirmed? })` | `{ ok: true } \| { ok: false, refusal }` |

`hunk` is the hunk's `header` from `placeDiff`, and `seenMtime` is that file's `mtime` from the same read.

SECURITY conditions:
1. **Git places inside the workspace roots only.** An outside place gives `thread.place.outside`.
2. **Safe git only.** The reverse patch is applied with `git apply --reverse`, through an argument array with no shell. There is never a `reset --hard` or a `clean`. Only files the task wrote are touched; any other file gives `thread.place.notTask`. Discard removes a file the task created by unlinking that path only.
3. **The restore data stays in memory.** The token is single use, bound to its thread and place, and dropped at the next turn and after 10 minutes (`thread.place.restoreGone`). The data is never in the database or the audit.
4. **Stale reads change nothing.** A file whose mtime changed since the diff, or whose hunk is gone, gives `thread.place.stale`.
5. **Person-only.** The three channels are forbidden in MCP coverage and are in the S1 reach table. Each call writes one `person_action_audit` row (`place-undo`, `place-restore`, `place-discard`), with no content.
6. **Discard needs `confirmed: true`.** Without it, the answer is `thread.place.confirm`.

These are frozen in `a14-place-undo.native.test.ts` and `f4-security-reach`, as task F4-P12.
