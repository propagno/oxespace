# CCR: F8 backend — Agora, time travel (timeline, Restore, Branch) and the command bar (1.5.0)

Owner: BACKEND. Status: frozen tests, with the review changes of 08/11 in (SECURITY S1–S3 from TECH LEAD; HML 717-1..6; FRONTEND's three adds; DESIGN approved).

**Criteria:** A29, A30 and A31.

**Contract:** DESIGN's `1.5.0-f8-design.md` "Data each screen needs", plus FRONTEND's adds.

**Frozen tests:** `tests/acceptance/f8/`: 30 tests in 4 files.

| File | Tests | Runs on |
|---|---|---|
| `a29-agora-requests.native.test.ts` | 2 | Electron's Node, the real AgentsReadModel |
| `a30-time-travel.native.test.ts` | 12 | Electron's Node, a real ThreadManager on a temp git repo |
| `a31-command-bar.test.ts` | 11 | Node |
| `f8-contract.test.ts` | 5 | Node |

**Tasks:** `.claude/roadmap-1.4/team/plans/f8-tasks-BACKEND.json`: 6 tasks with the pack fields (F8-TIMELINE, F8-RESTORE, F8-BRANCH, F8-AGORA, F8-BAR, F8-IPC).

**Blocked by other phases:**
- F7-IMPACT (`request-impact.ts`, the shell classifier);
- H1-3 (`agent_http_audit`);
- F4 (`isSafeBranchName`, `person_action_audit`).

**Rigor:**
- real code only: an in-memory migrated DB, a fake adapter, an injected fork and session check, real temp git repos (including a rewritten, garbage-collected base and a moved `.git`), the real `createOxeApi`, `IPC_CHANNELS`, `MCP_COVERAGE`, `REMOTE_COMMANDS` and `MESSAGE_CODES`;
- no source-text matches;
- every "nothing created" test first proves the success path on the same fixture.

## A29 · Agora

Agora is the window's, over the S7.1 overview (`AGENTS_CHANNELS`), F6-T90's activity and the existing actions (`thread.respond`, `thread.interrupt`, `agents.markSeen`).

**The needs-you card's facts (FRONTEND add 1):** each `AgentRequestSummary` gains:
- `kind`: `approval | question`. Question and elicitation are questions; approval, permissions, tool and a pane's own prompt are approvals.
- `reversible: boolean | null`, from F7's `impact.reversible`;
- `risk`, now filled from F7's impact.

Both are null when nothing assessed the request, never a guess. `ThreadPendingRequestSummary` carries `impact?: { risk, reversible }` for this.

The card shows Deny, then Allow when reversible, See impact when irreversible, or Answer for a question.

## A30 · The timeline

`thread:history` stays the message pages. Time travel is the new `thread:timeline`.

**`ThreadOrchestrator.timeline(id)`** returns:
- `checkpoints: [{ id, n, turnId, at, label, files, checkout, failed? }]`. `turnId` is the turn the checkpoint opened, so Restore calls `rewind(threadId, checkpoint.turnId, …)` (FRONTEND add 3).
- `canBranch` and `branchRefusal?: { code: thread.branch.unsupported, params }`, from main, so the window shows "Not available in Codex" before any click (FRONTEND add 2).
- `cantGoBack: { dbWrites, pushes, containers, commands, httpWrites, scope: 'conversation' }`.

**cantGoBack.** Undercounting is the dangerous side (HML), so every effect is counted once, in one bucket, for actor `thread:<id>` only:

| Bucket | Counts |
|---|---|
| `dbWrites` | `oxequery_audit` rows of `oxespace_db_execute` and `oxespace_mongo_write` with outcome ok. |
| `pushes` | Shell commands that F7 classifies as a push: git push in any form, gh pr create or merge, gh release, npm or cargo publish, twine, docker push. They count completed, **or failed with a non-zero exit**, since a rejected multi-ref push may have pushed some refs. Also MCP `oxespace_git_change` push and `oxespace_github_change` create, merge or auto-merge events. |
| `containers` | Irreversible container effects only: docker rm, compose down -v, volume rm, prune. Start, stop and restart never count. |
| `commands` | Other completed shell commands that F7 marks irreversible: psql -c, mysql -e, mongosh --eval and sqlite3 writes, prisma db push or migrate, terraform apply, redirections, and writes outside the places. |
| `httpWrites` | `agent_http_audit` rows with a method other than GET, HEAD or OPTIONS, to a host that isn't loopback. |

`scope: 'conversation'`: delegated children are not included, and DESIGN's line says "this conversation only".

## A30 · Restore (TECH LEAD S1)

Restore is today's `rewind(id, turnId, { restoreFiles, confirmed? })`, hardened:
- **A safety checkpoint first.** With `restoreFiles`, every file it will write is saved first, so Redo gives back the files as they were, the person's edits included.
- **Only the conversation's files.** It writes only the files of the dropped turns' checkpoints, inside the conversation's places.
  - It never touches `.git` and never runs reset --hard, clean, checkout or stash.
  - HEAD, refs, the index and the person's other dirty or untracked files stay as they are.
- **The person's own edits.** A file that changed after the conversation (it no longer matches the checkpoint's post-image) refuses the whole restore with `foreign-changes`, C3 `thread.restore.foreignChanges`, and nothing is set aside. `confirmed: true` restores over it, and the safety checkpoint keeps the person's version.
- **A person's action only.** `thread.rewind` and `thread.redoRewind` are MCP-forbidden, and never in `REMOTE_COMMANDS`.

## A30 · Branch (TECH LEAD S2, HML 717-5/6)

`branchFromCheckpoint(id, checkpointId, { branch })` returns `{ ok: true, threadId, workspaceId, worktreePath }` or `{ ok: false, refusal { code, params } }`. Its dependencies are `configureBranching({ fork, sessionAvailable })`.

**Pre-checks, before any git write and before the fork**, each refusing with nothing created:

| Check | Refusal |
|---|---|
| The provider can fork (Codex can't). | `unsupported` |
| `isSafeBranchName`. | refused |
| No branch with the name in any letter case. | `exists` |
| The checkpoint exists. | `checkpointGone` |
| The checkpoint is not failed. | `checkpointFailed` |
| The root is a git work tree. | `notGit` |
| The base commit exists (rewritten, collected or shallow are refused). | `baseGone` |
| The sibling folder `<parent>/<repo>-<branch with / as ->` does not exist; it is never overwritten. | `pathExists` |
| The provider session is available. | `sessionGone` |

**Steps:**
1. worktree: `git worktree add -b`, at the base commit;
2. restore: write the pre-images, each verified against its hash first;
3. register: `ownedWorktree` and the workspace row;
4. fork: last;
5. conversation: created with the forked session.

A failure at any step after the first undoes everything that was made (the conversation, the workspace row, the worktree and the branch) and refuses with `thread.branch.failed { step }`.

**Nothing is inherited.** No Always-allow file (the untracked `.claude/settings.local.json` is not copied), no project permission rules for the new root, and no DB, host or preview grants.

**The audit.** There is one `person_action_audit` row `{ actor: person, action: thread-branch, target: <new thread id>, outcome: ok }`, without names, paths or content.
- Migration `099_person_action_audit_branch.sql` (main's highest + 1 at execute) widens the action CHECK.
- It rebuilds the table in one transaction, keeping the rows and the append-only trigger, as F5's 097 does.

**`branchNameFor(title, at)`** gives `oxe/<ASCII slug>-from-HHMM`, at most 60 characters, always a safe ref.

## A31 · The command bar (TECH LEAD S3)

**`parseCommandLine(text, skillNames?)`** returns `agent | skill | command | open | help | unknown`. Known commands win over a skill of the same name. `/approve`, `/allow` and `/accept` are unknown, in any case.

**`COMMAND_CATALOG`**: every entry is an existing IPC action, with a fallback button and a shortcut.
- deny is `thread.respond` with `{ decision: decline }`;
- stop confirms first;
- history is `thread.timeline`;
- skill is `skill.invoke`;
- nothing maps to `thread.approve`, `approvals.alwaysAllow` or `thread.branchFromCheckpoint`.

**`commandRequest(parsed, context)`** decides what a command may reach. `context` is `{ workspaceId, threadId?, pane?, enabledSkills, requests }`.
- **Skills.** A skill runs only when it's enabled for the focused workspace (`commandBar.skill.notEnabled`), and only into a focused agent pane (`commandBar.skill.noAgent`), as `skill.invoke { skillName, paneId, argument }`.
- **Arguments are data.** They pass verbatim, never through a shell (`;`, `&&`, backticks, `$()`, pipes and redirections stay text). A control character is refused (`commandBar.args.control`), because skill:invoke and steer would submit it as a line.
- **Requests.** `/pending` and `/deny` act only on the focused workspace's requests (`commandBar.request.otherWorkspace`, `commandBar.request.none`).

## Contract

**Channels:** `IPC_CHANNELS.thread` gains `timeline` and `branchFromCheckpoint`, both preloaded. Rewind takes `confirmed` as a boolean.

**MCP:** branchFromCheckpoint, rewind and redoRewind are forbidden; the timeline is excluded.

**C3 codes:**
- `thread.branch.*`: unsupported, checkpointGone, checkpointFailed, exists, pathExists, baseGone, notGit, sessionGone, failed;
- `thread.restore.foreignChanges`;
- `commandBar.*`: skill.notEnabled, skill.noAgent, args.control, request.otherWorkspace, request.none.

## For DESIGN

The always-on note gains two counts, plus the scope:
- "{n} other irreversible commands" / "{n} outros comandos irreversíveis";
- "{n} external writes" / "{n} escritas externas";
- the line ends "(this conversation only)" / "(só esta conversa)".

## Out of F8

Approving from the bar, editing the past, merging branches.
