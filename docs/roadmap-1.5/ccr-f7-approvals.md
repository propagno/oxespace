# CCR: F7 backend — approvals with impact: facts, Always allow, the DB preview, What agents can do, notifications (1.5.0)

Owner: BACKEND. Status: frozen tests for review (M5: HML, DESIGN, FE; SECURITY: TECH LEAD).

**Criteria:** A24, A25, A26, A27, A28, A55 and A56. A24 (card or toast, at most 2 steps) is the window's; its data is the request plus the existing respond paths.

**Contract:** DESIGN's `1.5.0-f7-design.md` "Data each screen needs". FRONTEND's names were agreed on 08/11.

**Frozen tests:** `tests/acceptance/f7/`: 46 tests in 6 files.

**Tasks:** `.claude/roadmap-1.4/team/plans/f7-tasks-BACKEND.json`: 6 tasks with the pack fields.

**Rigor:** pure or injected modules against real code: fake DB drivers recording every statement, temp project folders for Claude's settings, fake notifications and timers, and the real `toPendingRequest`. The person's home and global settings are never touched.

## A25 / A28 · Impact facts (SECURITY)

**`requestImpact(request, context)`** returns `{ why?, where, whereSub?, affects { count, unit }, reversible, undoHow?, risk, kind: db | command | file | container | push, text, lang }`. The result is stored on `ThreadRequest.impact`.

**Rules**
- **Kind** comes from the tool. A push (git push, npm publish, docker push) is its own kind.
- **Reversible:**
  - yes: file edits (undone from the checkpoint), read-only or local commands, container stop and restart;
  - no: destructive commands, pushes, database writes (there's no snapshot) and container removal.
- **Risk** is `critical` exactly when the change isn't reversible; otherwise it follows the shell level (green low, orange medium, red high).
- **Text** is redacted. The result holds values, never sentences.

**The phone:** `toPendingRequest` sends `impact.risk`, so an irreversible request is `critical` (T78's 2 s on the phone). A database write is answered only at the computer: `answerable: false` with no decisions.

## A26 · Always allow (SECURITY)

**`alwaysAllowOffer(request, provider)`**
- It's never offered for destructive, network or push commands, nor for a compound line. The reason kind travels with the refusal.
- The Claude rule is `Bash(<program> <subcommand>:*)`. A Codex rule is that command for this session only.

**`AlwaysAllow.apply`**
- **Claude:** it writes only to `<project>/.claude/settings.local.json` `permissions.allow`, merged and idempotent, keeping every other key. It never touches `settings.json` or the home folder.
- **Codex:** the rule stays in memory per conversation.
- `list` shows only the rules OXESpace added, and `revoke` removes only that rule.
- `apply` refuses whatever isn't offered.

## A27 · The database preview (SECURITY)

`previewDatabaseWrite` returns `{ status: ok | off-production | failed, count, sample { cols, rows (old → new) }, reason? }`.

**SQL**
- UPDATE and DELETE become `SELECT COUNT(*)` plus a sample `SELECT … LIMIT 5` with the same WHERE.
- INSERT counts its values without running a query.
- These are refused as failed, with no query: multiple statements, a write CTE, TRUNCATE, CALL, and a sub-select or function call in SET or WHERE.

**Mongo:** `countDocuments` plus `find(limit 5)` on the same filter, with the update applied to the sample in memory.

**Production:** the preview is off by default, so nothing reaches the driver. The Policy can allow the count only.

**Never:** no write runs, and no snapshot is taken.

## A55 · What agents can do (SECURITY)

**`AgentPermissions.list`** returns the rules (from AlwaysAllow), the databases, the hosts agents called (from H1, with calls today, production and insecure) and the Policy rows.

**Controls**
- `revokeRule`, `setDatabaseAccess` and `setHostAccess` each return an undo token, and `undo` works once.
- A production connection accepts only none and read (`permissions.production.readOnly`).
- Policy rows are read only (`permissions.policy.readOnly`).
- `hostDecision` gives allow, ask or deny, and a Policy deny wins. The shell policy uses it for the hosts that F3's `parseHttpCalls` finds.

**Open question for TECH LEAD:** DESIGN's "Read, ask before writing" (`ask-write`). Is it a new `agent_access` value, or the existing `write`, which already asks?

## A56 · The notification

**`ApprovalNotifier`**
- It shows at once, only when the window isn't focused and the setting is on.
- It has one action, `open`. The title is a C3 code (`notify.agentNeedsYou`), and the body is the request title, at most 80 characters.
- A third request within 10 s replaces the open notifications with `notify.requestsNeedYou { count }`.
- Open focuses the window and opens the first request. An answered request closes its notification.

## Contract (agreed with FRONTEND)

**Channels**
- `IPC_CHANNELS.approvals` gains `preview` and `alwaysAllow`.
- `IPC_CHANNELS.agentPermissions` = `{ list, revokeRule, setDatabaseAccess, setHostAccess, undo, changed }`.
- The request carries `impact` and `alwaysAllow { offered, reasonKind?, rule? }`.

**MCP coverage:** all of these are forbidden.

**C3 codes:** `permissions.production.readOnly`, `permissions.policy.readOnly`, `notify.agentNeedsYou`, `notify.requestsNeedYou`, `approvals.alwaysAllow.notOffered`.

## SECURITY (TECH LEAD)

The review surface:
- the impact rules (critical for anything irreversible);
- Always allow's write target and its refusals;
- the SELECT-only preview, with production off;
- revocation with undo;
- host blocking;
- a notification with no Allow.

## Changes after review (08/11), all frozen

**TECH LEAD's SECURITY conditions**
- **S1:** Always allow is never offered for a prefix that can run arbitrary code. The reason kinds are:
  - `code`: interpreters and launchers (node, python, bash, npx, dlx, make, docker run/exec, env, xargs, `./x`), inline code, and any PowerShell-tool request;
  - `elevation`: sudo and the like;
  - `broad`: a bare tool with no subcommand;
  - `compound` (DESIGN) and `redirect`.

  The rule is exactly the offered prefix. Env, `timeout` and `time` prefixes are looked through. Script runners carry `runsProjectCode` and `definedIn` (HML).
- **S2:** the rule is written only to `<project>/.claude/settings.local.json`:
  - the real path is checked, and a link or junction out of the project is refused;
  - the write is atomic and keeps every other key;
  - invalid JSON is refused and left untouched.
- **S3:** provenance lives in OXESpace's database (migration 098, `always_allow_rules`), so a hand-written identical rule is never removed.
- **S4:** the DB preview runs read-only with a 5 s timeout. A timeout gives `failed: timeout`. Secret-named columns are masked in the sample.
- **S5:** the notification body is only the pane and the risk word (`notify.requestBody`).
- **ask-write:** "Read, ask before writing" is the existing `write`. `agent_access` stays exactly off | read | write.

**HML-F7-1, decided by TECH LEAD**
- `critical` only for production DB writes, any push, destructive commands, writes outside the checkpointed places, and shell redirections.
- A non-production DB write is `high` and irreversible.

**HML's must-fixes**
- **714-2:** the full never-offered lists.
- **714-4/5:** the SQL and Mongo refusals and translations, pure functions allowed, and `;` inside a string or comment treated as text.
- **714-6:** an edit outside the project, or a redirection, is critical.

**FRONTEND**
- New push `approvals.openRequest`.
- `alwaysAllow` only writes the rule; the window then answers accept.
