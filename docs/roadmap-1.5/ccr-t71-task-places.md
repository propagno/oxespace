# CCR T71: places per task (1.5.0, lite B)

Owner: BACKEND. Status: design for review; no code yet. Asked by TECH LEAD on 03/11 from DESIGN's findings on the
user's screenshots. The user works with many terminals that switch branches across worktrees. In their words: "eu
trabalho com varios terminais que mudam de branch por eu usar worktree… tem que analisar se o oxespace consegue se
adequar a ela para ser flexivel suficiente".

The design this serves is lite B in the 1.5.0 playground (PR #577, `playground/README.md`, "Worktree-aware Changes"
and `playground/src/mock/locations.ts`). The redesign review loop, round 1, checks the playground's Changes and Open
in Changes screens against this document.

## 1. What main does today

The facts below were read on main at c43ce4aa.

| Piece | Today | What goes wrong |
|---|---|---|
| `ThreadOrchestrator.projectDiff` (thread-orchestrator.ts:462) | One root: `observedLocation.checkoutRoot` when it is the same repository, else `thread.rootPath`. It runs `git diff HEAD`. | A terminal that switches that checkout's branch moves `HEAD`, so the diff shows the branch switch, not the task's work. A second checkout the task wrote to is not shown at all. |
| `storeLocation` (thread-orchestrator.ts:943) | Keeps the **last** location the provider reported (`thread.observedLocation`). | Earlier places are forgotten. A folder outside the repository makes `checkoutRoot` null and `projectDiff` falls back to the project root. |
| `ThreadCheckpointService.begin` (thread-checkpoints.ts:54) | One checkpoint per turn and checkout, with `base_commit = HEAD` at that moment (migration 056). A move during a turn opens a second checkpoint for that checkout. | Each base is per turn, not the base where the task started. Nothing compares the base with the current `HEAD`. |
| Tool events (`ThreadEvent` `tool`, `turn-diff`; `ThreadFileChange`) | `path` as the provider gave it, with no root. | The renderer resolves it against `thread.rootPath` (F33, `ThreadTimelineEntry.tsx`), so a worktree file or an outside file reports "does not exist". T70 (FRONTEND, 1.4.2) patches the order in the renderer. |
| Pane cwd | Only the launch directory (`pane_root_path`, `launchDirectory`), plus the `SessionLocation` an agent hook reports for the pane. | No shell `cwd` tracking. A plain shell that runs `cd` is not seen. |
| `HEAD` watching | None in main. | Branch drift cannot be seen today. |

## 2. The model

### 2.1 Place

A place is one directory tree where a task (one conversation in lite B) read or wrote:

```ts
// shared/types/thread-places.ts (new)
export type ThreadPlaceKind = 'root' | 'worktree' | 'checkout' | 'outside'
export interface ThreadPlace {
  id: string                      // stable per thread: hash of the canonical path
  kind: ThreadPlaceKind           // root = thread.rootPath; worktree = a worktree of the same repo (ownedWorktree included);
                                  // checkout = a different repository; outside = no .git above it
  path: string                    // the checkout root, or for outside the folder the first write was in
  firstSeenAt: number
  base: ThreadPlaceBase | null    // null for outside
  current: { branch: string | null; commit: string | null } | null   // read on demand, never stored
  drift: ThreadPlaceDrift | null
  writes: number                  // files written there, from tool evidence
}
export interface ThreadPlaceBase { commit: string | null; branch: string | null; capturedAt: number; turnId: string | null }
export interface ThreadPlaceDrift {
  from: { branch: string | null; commit: string | null }
  to: { branch: string | null; commit: string | null }
  seenAt: number
  by: { kind: 'pane'; id: string; title: string }[]   // panes whose launch dir or reported cwd is in this place; may be empty
  certain: boolean                // false: OXESpace saw the change but not who made it
  answer?: 'switched-back' | 'followed' | 'dismissed'
}
```

- **`kind: 'checkout'`:** this covers a write to a different repository, for example a sibling project the agent was
  asked to touch. It gets a git diff like any checkout, but it is never registered as a context of the project.
  Today's `thread_project_contexts` rule stays: same repository only.
- **`by` is a hint, not proof.** Git does not record which process moved `HEAD`. When exactly one pane is in that
  place, it is named and `certain` stays false. The UI wording is "probably your terminal X". The design mock's
  "by your terminal 'report'" must read that way.

### 2.2 Where places come from

These are listed in the order they are trusted:

1. `thread.rootPath`. For a conversation started in its own worktree, `ownedWorktree.path` *is* `rootPath`, so the
   `root` place is that worktree. Its base is `ownedWorktree.baseSha` and `ownedWorktree.branch`, already stored, and
   is not re-read at first touch. The repository it was made from (`ownedWorktree.projectRoot`) is not a place
   unless the task touches it.
2. The provider's reported `cwd` (`location` events, which `storeLocation` already validates through
   `resolveSessionLocation`). Each distinct checkout root becomes a place; today only the last one is kept.
3. **Absolute paths in tool evidence:**
   - `ThreadFileChange.path`, `previousPath`;
   - `ThreadRequest.paths`;
   - Claude `Edit`/`Write`/`NotebookEdit` `file_path`;
   - Codex `fileChange` paths.

   Each path is resolved by the path resolver (§3) and checked like a `cwd`:
   - absolute;
   - no NUL;
   - at most 4096 characters;
   - `localPointer` and `staysLocal` (the link walk from #520);
   - the directory exists.

   The path's checkout root (`findCheckoutRoot`) gives the place. With no `.git` above it, the place is `outside`,
   rooted at the nearest existing folder of the written file.
4. **Never:** paths inside the agent's message text. They are resolved for display (§3) but never create a place.
   Model text is not evidence of a write.

Limits: at most 32 places per thread, plus one `outside` place per distinct parent folder, capped at 16. Above the
cap a single "more places" counter is kept and no new place is created. A refused path (link out, network share,
missing) is counted, not stored.

### 2.3 Base per place

- The base is captured **at first touch**: the first time a place appears during a running turn. It is
  `git rev-parse HEAD` plus `git symbolic-ref --short -q HEAD` (null when detached).
- This reuses what `ThreadCheckpointService.begin` already runs for that turn's checkpoint.
  - When a checkpoint for that root opens in the same turn, its `base_commit` is the place's base. No second git
    call is made.
  - A place first seen from tool evidence after the checkpoint opened (a write into a checkout the agent never
    `cd`'d into) opens that place's checkpoint then. `turns.begin(id, turnId, root, 'Another checkout')` is the same
    path `storeLocation` uses for a worktree move today.
- An unborn branch gives `commit: null`. The diff then compares against the empty tree, as `projectDiff` already
  does.
- The base never moves on its own. Two explicit answers move it:
  - "Follow the new branch" (drift answer `followed`) sets the base to the drift's `to`;
  - archiving the conversation drops its places.

### 2.4 Branch drift

A place drifts when its current `HEAD` or branch is not the base and the task did not move it. The task moved it
when, between two reads, the conversation ran a command that was approved or auto-allowed and that names
`git checkout`, `git switch`, `git reset`, `git rebase`, `git merge`, `git pull`, `git commit` or `git am`. That
check is only a hint: a commit made by the task moves `HEAD` forward without drifting.

`HEAD` is read at these points, never on a timer:

1. when a turn begins and ends, for every place of that thread (one `rev-parse` per place, at most 32);
2. when the Changes tab or Open in Changes asks for that thread's changes (§4);
3. when an agent hook reports a pane `SessionLocation` inside a known place. That is the hook the user's terminals
   already send.

A fast `HEAD` file watcher was considered. It is not proposed for 1.5.0:

- one watcher per place per thread costs file handles on Windows;
- a `.git` file in a linked worktree points elsewhere, and walking it needs the #520 checks again;
- the read points above cover every moment the UI shows a diff.

When `HEAD` moved:

- **The task's own commits:** if the base is an ancestor of the new `HEAD` (`git merge-base --is-ancestor base
  head`) and the branch is the same, there is no drift. The diff still uses the base, so the task's commits show as
  its changes.
- **A branch switch or reset:** the branch name changed, or the base is not an ancestor. This is drift. A `drift`
  event is emitted once per change (§4.2), and `ThreadPlace.drift` is set.

Answers:

| Answer | What it does | Guard |
|---|---|---|
| Switch back | `git switch <base.branch>` in that place. It is a write through the existing git service. | Refused when the working tree has uncommitted changes, with the refusal saying so; no stash, no force. Refused when `base.branch` is null (detached): the UI offers "Follow" or "Dismiss" only. |
| Follow the new branch | Sets the base to the drift's `to` and keeps the drift record with `answer: 'followed'`. | None: no repository change. |
| Dismiss | Keeps the base. The diff keeps comparing with it, and the files the branch switch changed show as a separate "changed outside this task" group (§2.6). | None. |

**The copy on the drift card** (round 1) follows the facts:

- the author is named as "probably your terminal X", or left out when no pane is in that place;
- "nothing was lost" is said only when the task's commits are still reachable from `base.branch`, which is checked
  with `git branch --contains`;
- the task's uncommitted files the switch carried along show in the "changed by the branch switch" group, not as the
  task's.

Each place's **Discard…** restores that root's checkpoints of this thread, newest first, using the existing
all-or-nothing restore with its conflict check. An `outside` place has no Discard (§2.5).

Switch back is a write the person makes from the UI, not the agent, so it uses the person's existing git IPC path,
not MCP. No new MCP capability is needed. The `mcp-coverage` entry for the new channels is `excluded` (§4.1).

### 2.5 Outside folders

An `outside` place has no git. Its files come from tool evidence only: the paths the task wrote, with the
`ThreadFileChange` `kind`, `additions` and `deletions` when the provider gave them. The Changes tab lists them as
**written**, with no diff base. When the post image is still on disk and under the 2 MiB preview limit, the existing
file preview opens it. There is no restore for them: checkpoints only cover git checkouts. The UI says so in the
place's header, as the mock does ("no git here").

### 2.6 Diff per place

`projectDiff` becomes per place:

- `git diff <base.commit>` (or the empty tree) in that place, with the same flags and limits as today (2 MiB,
  15 s).
- On drift with `answer` unset or `dismissed`, the files are split by provenance.
  - Files in `git diff --name-only <base> <drift.to.commit>` are "changed by the branch switch".
  - The rest are the task's.
  - This is computed only when there is drift; otherwise it is a single diff.
- `outside` places list the written files (§2.5).

The single-root `projectDiff` stays for one release as a wrapper that returns the first place. The Code-mode review
panel still calls it. It is removed in 1.5.1.

## 3. One path resolver

This replaces the T70 renderer patch in 1.5.0. The resolver lives in main, so the renderer, MCP and the phone use
the same order.

```ts
// electron/main/services/conversation/thread-path-resolver.ts (new)
resolveThreadPath(threadId: string, raw: string, at?: { turnId?: string }): ThreadPathResolution
type ThreadPathResolution =
  | { kind: 'found'; path: string; placeId: string | null; via: ThreadPathStep }
  | { kind: 'ambiguous'; candidates: { path: string; placeId: string | null; via: ThreadPathStep }[] }  // the UI asks
  | { kind: 'missing'; looked: { step: ThreadPathStep; path: string }[] }                                 // the UI says where it looked
type ThreadPathStep = 'absolute' | 'turn-cwd' | 'checkout-root' | 'task-worktree' | 'project-root' | 'task-place' | 'sibling-worktree'
```

The order, as asked:

1. **Absolute:** the path itself, after the same validation as §2.2.3.
2. **The turn's cwd:** the `location` the provider reported last before that turn's events (kept per turn, §5).
3. **checkoutRoot:** of that cwd.
4. **The task worktree:** a `worktree` place of the task, newest first.
5. **The project root:** `thread.rootPath`. For an owned worktree this is the worktree itself, and
   `ownedWorktree.projectRoot` is tried right after it.
6. **The task's other places:** its `checkout` and `outside` places, newest write first. This is how a bare
   `ROTEIRO.md` opens from the outside folder the agent last wrote in. Round 1 added it: the playground's
   `#chat` path chips needed it.
7. **Sibling worktrees:** `git worktree list --porcelain` of the project's repository, at most 16 entries, cached
   for 30 s per repository.

- Steps 2 to 6 stop at the first hit.
- Step 7 runs only when 1 to 6 missed. Steps 6 and 7 are the only ones that can return `ambiguous`: two places, or
  two sibling worktrees, with the same relative path.
- **"Find file…"** in the UI is a bounded name search over the same places and sibling worktrees: file names only, at
  most 2000 entries per root, and depth 12. It never searches "recent folders" or the whole disk.
- A path that walks out of its base (`..`) or through a link out (`staysLocal`) is refused at that step and listed
  in `looked` with that step, so the person can see why.
- No file content is read: only `lstat` and `stat`.

## 4. IPC, events and protocol

### 4.1 Desktop IPC (new channels in `thread.ipc.ts`; preload `oxe.thread.*`)

| Channel | Input | Output | Notes |
|---|---|---|---|
| `thread:places` | `threadId` | `ThreadPlace[]` with `current` read now (§2.4 read point 2) | Read. `excluded` in mcp-coverage: a UI read model. Agents have `oxespace_git` for their own scope. |
| `thread:place-diff` | `threadId, placeId` | `ThreadPlaceDiff = { place: ThreadPlace; groups: { task: GitDiff; branchSwitch?: GitDiff } | { written: ThreadFileChange[] } }` | Read. It replaces `projectDiff` for lite B. |
| `thread:resolve-path` | `threadId, raw, turnId?` | `ThreadPathResolution` | Read. Used by F33 links and Open in Changes. |
| `thread:place-drift-answer` | `threadId, placeId, answer` | `{ ok: true; place } | { ok: false; refusal: MainMessage }` | Write. Switch back runs `git switch` (§2.4). C3 refusals: `thread.place.dirty`, `thread.place.detached`, `thread.place.gone`. |

Inputs are checked like the other thread channels:

- ids by shape;
- `raw` at most 4096 characters with no NUL;
- `answer` from the closed list.

`thread:place-drift-answer` is `forbidden` in mcp-coverage. An agent must not answer a drift about its own place.

**Read-only files outside the repository** (TECH LEAD's decision from FRONTEND-1-14):

- **Today:** main refuses to open a file outside the repository. `fs:read-file` only accepts roots that
  `workspaceRootResolver` knows: a workspace, its worktrees, or the thread project's `thread_project_contexts`. That
  stays as it is: nothing widens it.
- **New in 1.5.0:** the editor can open such a file **read-only** through one more channel:

| Channel | Input | Output | Notes |
|---|---|---|---|
| `thread:place-read` | `threadId, placeId, relativePath` | the same shape as `fs:read-file` (text, size, binary flag), plus `readOnly: true` | Read only. **`forbidden` in mcp-coverage:** no agent can read through it. |

Rules:
- The place must be one of this thread's `outside` or `checkout` places, and it must come **from tool evidence**
  (§2.2 point 3, `thread_place_writes`), never from a path found only in the agent's text. A resolver hit from text
  (§3) can only *point at* a place that evidence already created.
- `relativePath` must stay inside the place:
  - no `..`, no absolute path, no NUL, at most 4096 characters;
  - the target is re-checked with `staysLocal`, `localPointer` and the link walk, so a link inside the folder cannot
    lead out of it;
  - a file that is not a regular file is refused.
- Limits: the same as `fs:read-file` (2 MiB text, binary previews per the existing rules).
- **There is no write channel for it.** Save, rename, delete and "open in terminal" stay refused for these files, and
  the editor tab shows "Read only · outside the repository".
- C3 refusals:
  - `thread.place.notEvidence` (the place came from text only);
  - `thread.place.outside` (the path escapes the place);
  - `thread.place.gone`.
- This goes in T72 PR 4, under the same SECURITY review as the rest of T72.

### 4.2 Events

- **A new `ThreadEvent`:** `{ type: 'place-drift'; placeId; from; to; by; certain; seenAt }`. It is saved in the
  conversation, so the timeline shows "the branch changed under this task" at the moment it was seen.
- **`thread:places-changed`:** pushed to the renderer when a place is added, or a drift is seen or answered.
- `thread-portable.ts` (export and import) learns the event type. On import, places are rebuilt from the events and
  the bases are not imported: an imported conversation has no bases.

### 4.3 Phone (`shared/remote/protocol.ts`)

**No change is proposed.** The phone never gets file paths. `RemoteThreadItem` leaves out location, cwd and
turn-diff paths on purpose (`protocol.ts` around line 448), and a `tool` item carries only `filesChanged`. The phone
has no Changes tab in 1.5.0. `RemoteThreadItem` is a closed union, so a new `place-drift` event is not forwarded and
no `android:generate` is needed.

If the redesign loop decides the phone must show the drift warning, it becomes a separate C5 CCR:

- a `drift` field on the conversation row, as a literal-word union per the #531 pattern;
- `android:generate`;
- SECURITY review.

## 5. Data and migration

Migration number: the next free one on main **at the time of the PR**. Main's highest today is 091. #514 (S7.1,
1.4.2) holds 092 and lands first, so this is **093** if nothing else lands before it. The gap guard will say if
that changed. The migration only adds tables, so a database opened by 1.5.0 is refused by 1.4.x with the usual
"newer version" message. The pre-migration backup applies, as for every migration.

```sql
-- 093_thread_places.sql (number to be checked at the time)
CREATE TABLE IF NOT EXISTS thread_places (
  thread_id TEXT NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('root', 'worktree', 'checkout', 'outside')),
  path TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  base_commit TEXT,
  base_branch TEXT,
  base_captured_at INTEGER,
  base_turn_id TEXT,
  writes INTEGER NOT NULL DEFAULT 0,
  drift_json TEXT,              -- ThreadPlaceDrift, or null; the history lives in the place-drift events
  PRIMARY KEY (thread_id, id)
);
CREATE TABLE IF NOT EXISTS thread_place_writes (
  thread_id TEXT NOT NULL,
  place_id TEXT NOT NULL,
  path TEXT NOT NULL,           -- relative to the place
  kind TEXT NOT NULL CHECK (kind IN ('add', 'update', 'delete', 'rename')),
  turn_id TEXT,
  at INTEGER NOT NULL,
  PRIMARY KEY (thread_id, place_id, path),
  FOREIGN KEY (thread_id, place_id) REFERENCES thread_places(thread_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS thread_turn_cwd (
  thread_id TEXT NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL,
  cwd TEXT NOT NULL,
  PRIMARY KEY (thread_id, turn_id)
);
PRAGMA user_version = 93;
```

- **The `root` place** of every existing thread is created lazily, the first time `thread:places` is asked. The
  migration does not create it, so it does not walk every conversation.
- **Writes are kept per place and path**, the newest only: at most 2000 per thread, oldest dropped. They are
  needed for `outside` places, which have no git, and for the `writes` count.
- **`thread.observedLocation` stays** as it is. Code mode's review panels and the agent-hook pane location read it.
  The places are additive.

## 6. The other lite-B gaps (from DESIGN)

| Gap | Proposal | Data exists? | Migration | IPC |
|---|---|---|---|---|
| **Terminal tab:** a task's terminals are those whose cwd is the task's worktree | A pane belongs to a task when its launch directory (`pane_root_path`), or the `SessionLocation` its agent hook last reported, is inside one of the task's `worktree`/`root` places. This is computed in main, not stored.

- **Plain shells that `cd` later**, round 1:
  - **(a)** A passive scan of the PTY stream in main for the cwd reports shells already send: OSC 7 `file://`, VS Code's
    OSC 633 `P;Cwd=`, Windows Terminal's OSC 9;9 and iTerm2's OSC 1337 `CurrentDir=`.
    - Each value is validated like a reported `cwd`, giving `via: 'shell-osc'`.
    - Cost: one `indexOf` per chunk.
    - Size S, and it can ride with this work.
  - **(b)** Fish and configured Starship or oh-my-posh send these sequences today. Plain bash, PowerShell, cmd and Git
    Bash do not. For those, an opt-in integration (Settings › Terminal, default off) wraps the prompt of the shells
    OXESpace launches, never replacing the user's own prompt. That is 1.5.x, size M.
  - The tab's empty state says which applies. | Yes: launch dir plus hook location. | No | `thread:panes` → `{ paneId, title, workspaceId, via: 'launch' \| 'agent-location' \| 'shell-osc' }[]`. Read, `excluded`. |
| **The U12 containers source carries the thread id** | Most containers an agent starts come from a shell `docker compose up`, not from the MCP tool, so they are in no audit table. They are matched by Compose's own working directory: OxePod already reads `workingDir`, from the `com.docker.compose.project.working_dir` label. A container whose working directory is inside one of the task's places belongs to that task (`via: 'compose-dir'`), which lets OxePod say who started each. In addition, container actions and logs are audited in `oxequery_audit` (`agent-gateway.ts` `containerAction`). `actor` is the execution label (`thread:<id>`, `pane:<id>`), or `agent` when unverified. U12-be derives `ownerKind` and `ownerId` from that label in its read model, so no migration is needed. Only verified callers have one, and unverified rows show "agent". If U12-be prefers a column, an `owner_kind`/`owner_id` ADD COLUMN on `oxequery_audit` and `agent_action_audit` goes in U12-be's own migration, not here. | Yes, in the label. | No (or U12-be's) | Through U12-be's single query with `source: 'containers'` and an `ownerId` filter. |
| **The PR tab reads checks and reviewers** | `review.service.ts` already runs `gh pr view --json …statusCheckRollup,reviewDecision` and `pr-status.ts` parses the rollup. Add `reviewRequests,latestReviews` to that field list and return them. The PR is found by the task worktree's branch (`ownedWorktree.branch`) through the same call. The finish flow (`ThreadWorktreeFinishDialog`) is unchanged. | Mostly: checks yes, reviewers one more field. | No | Reuses the GitHub review channel with `rootPath` = the task worktree. No new channel. |

## 7. Tests

Unit tests, all with temp-dir repositories and no live providers:

1. **Places from evidence:**
   - a `location` into a worktree, an `Edit` in a second checkout, and a `Write` outside any repository give three
     places of the right kinds;
   - a path in message text gives none;
   - a link out of the folder, a UNC path and a `..` escape are refused and counted;
   - the caps hold.
2. **Base at first touch:**
   - the base equals the checkpoint's `base_commit` when both open in one turn;
   - a write into a new checkout mid-turn opens its checkpoint and base;
   - an unborn branch gives a null commit and the empty-tree diff.
3. **Drift:**
   - a temp repository where another process runs `git switch other` between two reads gives one `place-drift`
     event, and reading again does not repeat it;
   - a commit by the task on the same branch is not drift;
   - a `git reset --hard HEAD~1` is drift;
   - `by` names the one pane in that place, with `certain: false`.
4. **Drift answers:**
   - Switch back runs on a clean tree;
   - it is refused with `thread.place.dirty` on a dirty tree, with nothing changed;
   - it is refused with `thread.place.detached`;
   - Follow moves the base;
   - Dismiss splits the diff into task and branch-switch groups.
5. **Outside place:** the files are listed as written with no diff, and the preview reads the post image within
   the limit.
6. **Path resolver:**
   - every step is hit in order;
   - the first hit wins;
   - step 7 runs only after 1 to 6 miss;
   - a bare name opens from the outside place the agent last wrote in (step 6);
   - two sibling worktrees, or two places, give `ambiguous`;
   - none gives `missing`, with every step and path listed;
   - a `..` escape is refused at its step.
7. **Contract tests:**
   - the C3 codes are in both catalogs and the PARAMETERS map;
   - mcp-coverage claims the 4 or 5 new channels;
   - thread-portable round-trips `place-drift`;
   - the migration guard covers the new number.
8. **Terminal tab:** a pane launched in the worktree and a pane whose agent reported a cwd in it are listed; a pane
   elsewhere is not.
9. **Read-only outside files:**
   - `thread:place-read` opens a file in an `outside` place created from a `Write` tool event;
   - it refuses with `thread.place.notEvidence` a folder named only in the agent's text;
   - it refuses with `thread.place.outside` a `..` escape, an absolute `relativePath`, and a link inside the folder
     pointing out of it;
   - it refuses a directory or a FIFO;
   - it never reads above the 2 MiB limit;
   - `fs:read-file` still refuses the same path;
   - mcp-coverage marks the channel `forbidden`;
   - no write channel accepts a `placeId`.

E2E, mock IPC (B1.2 style): the playground's Changes tab with one worktree that drifted, one outside folder and one
F33 link that resolves to a sibling worktree. Each place is grouped, the drift banner shows its three answers, and
the outside folder says "no git here".

SECURITY review is required. The case for it:

- paths from tool evidence and model text, and the link and UNC checks;
- `git switch` from the UI;
- a new write channel, forbidden to MCP.

## 8. Out of scope for 1.5.0

- A `HEAD` file watcher (§2.4).
- Shell cwd tracking for plain terminals.
- Restore for outside folders.
- Places for Code-mode panes without a conversation. In lite B a task is a conversation.
- The phone (§4.3).

## 9. Size and order

BACKEND, about M–L, in four PRs:

1. **Model, migration and places from evidence,** with tests 1, 2 and 7.
2. **Diff per place and outside folders,** with tests 5 and 7, plus `thread:places` and `thread:place-diff`.
3. **Drift and its answers,** with tests 3 and 4, plus SECURITY.
4. **Path resolver,** with test 6, plus `thread:resolve-path` and the read-only `thread:place-read` (§4.1, with test 9). This replaces T70.

The section 6 items are separate S items: Terminal tab, PR reviewers, and the containers owner, which needs U12-be
first. FRONTEND consumes them after PR 2 for the Changes tab and after PR 4 for links.
