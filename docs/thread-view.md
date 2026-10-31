# Thread Desktop

> **Prévia visual:** [abrir o protótipo interativo do modo Thread](plans/thread-desktop-preview.html) no navegador. A prévia é demonstrativa e não altera a aplicação.

Thread has its own navigation, independent of Code workspace and pane selection.
Use **New thread**, select a registered project/directory and Claude Code or Codex,
then **Create thread**. Project contexts resolve by canonical repository identity:
worktrees share a project; separate repositories with the same name remain separate.
**Pinned** and search belong to Thread. Sidebar width/collapse, footer geometry
and Desktop navigation chrome follow the shared mode contract. Mounted Code
terminal sessions are preserved when switching modes.

The conversation has a single 48 px header, a scrollable history and a composer
inside the viewport. Messages support Markdown; tools and errors have expandable
details. Scroll above the last 64 px to pause following streamed output. **Latest
messages** resumes following. Scroll positions and drafts are separate per thread
and survive mode switches during the current application session. Enter sends,
Shift+Enter inserts a line, and IME composition does not send prematurely.

### Exemplo visual da conversa

```text
┌ Thread ───────────── Projeto: OXESpace ────────────┐
│ Você: Revise o fluxo de autenticação.              │
│ OXE: Vou mapear os pontos de entrada e validações.  │
│   Ferramenta  Ler src/auth.ts               [abrir]│
│ OXE: Encontrei três verificações relevantes:       │
│   • sessão nativa                                    │
│   • estado da conta                                  │
│   • preservação do rascunho                          │
│ ┌ Escreva uma mensagem… ─────────────── [Enviar] ┐ │
└───────────────────────────────────────────────────┘
```
## Subscription accounts

Open **Accounts** at the bottom of the sidebar. **Connect** / **Reconnect** uses
native Claude Code or Codex, with credentials stored by those clients. Codex uses
a dedicated App Server login session and opens the official login URL in your
default browser. Claude uses `auth login --claudeai`; complete the browser flow,
or paste its callback code in the temporary masked input when requested. Attempts
can be cancelled or reopened in the browser and expire after five minutes.
Closing the dialog does not cancel a pending attempt; **Cancel sign-in** does.

Connection is confirmed by a native account status check. A ChatGPT or Claude
subscription method is required. API keys, API helpers and alternative providers
are not classified as subscriptions. Provider policy, plan eligibility and usage
limits still apply. Account reconnection shares the native credential store used
by CLI/Code sessions and is blocked during that provider's active Thread turn or CLI.
Use **Agent Settings** to configure an installed native executable.

Before sending, the backend checks the account in the exact executable/directory
context used by the conversation. Failed checks preserve the draft without
recording a user message or starting inference. Successful login does not send
anything automatically. For authentication failures during an existing turn,
connect first and click **Retry** explicitly. Idle conversation adapters refresh
after login so Codex does not keep using an old account process.

## Persistence and capabilities

History, pins and native resume IDs are stored in SQLite. In-flight work becomes
interrupted after restart and resumes only on explicit Send. Deleting a workspace
currently deletes its associated conversation history through the database FK.
Drafts and scroll positions do not survive application restart.

- Claude: persistent print/stream-json, native resume after disconnection, planning mode,
  Read/Glob/Grep and Skill tools, without interactive approvals. Hooks and skill
  shell preprocessing are disabled; enabling commands does not add write tools.
- Codex: App Server stdio, streamed messages/tools, read-only sandbox and explicit
  command/file approval if requested by the provider. Thread selects the native
  OpenAI model provider explicitly, rather than inheriting a custom API provider.
- Stop interrupts Codex through its protocol; Claude terminates its process tree.
- Markdown disables raw HTML, remote images and clickable links.
- Input is limited to 64 KiB and history/JSONL frames are bounded.

Thread subprocesses omit OXESpace internal credentials and API/OAuth environment
key overrides, while preserving native configuration directories and proxy settings.
The login service sends only sanitized account states through IPC; native URLs,
raw stderr and callback codes are not saved in conversation history.
Native user/admin configuration remains applicable. Codex can load native MCP
configuration; filesystem read-only mode does not constrain external MCP effects.

Image attachments, the internal MCP tools (`oxespace_thread_*` and Agent Work),
access and approval modes, and the model and effort selectors are part of Thread;
the composer section of the README and the 0.17.0 release notes list them. Project
memory capture is Beta and has its own limits (see `PROJECT_MEMORY.md`). Outside
those, the native CLI provides its own tools and selectors.

## Delivery, queue, context and rewind

- **Delivery.** Every user message carries a delivery state derived from its
  operation: `sending`, `delivered`, `unconfirmed` (restart or lost transport, never
  resent automatically) and `rejected`. Only the non-delivered states are shown, with
  *Send again* / *Try again*.
- **Default model.** When a project or user setting (`model` in Claude settings,
  `ANTHROPIC_MODEL`, top-level `model` in Codex `config.toml`) can pick the model, the
  catalog does not name a default and the picker says *Provider default*.
- **Queue pause.** A turn that ends `interrupted` or `failed` with queued follow-ups
  pauses the queue (`thread.queuePause`). Nothing is sent until the user chooses
  *Resume*, *Send next now* or *Clear*. The pause survives a restart.
- **Context window.** The ring shows the context fill. Claude is asked with the
  `get_context_usage` control request while idle (validated on Claude Code 2.1.296;
  categories, auto-compact buffer); Codex reports `thread/tokenUsage/updated`
  (validated on 0.155.1; no categories). A failed or unavailable report keeps the
  previous one and the ring falls back to plan usage.
- **Incremental reads.** `thread.readSince` returns only rows written after a
  `{epoch, revision}` cursor. Truncation (rewind, recovery) and imported native pages
  change the epoch, and the client rereads the window. Setting
  `localStorage['oxe.thread.delta'] = 'off'` forces full reads.
- **Rewind.** *Rewind to here* on a user message removes that turn and every later
  one. Codex: `thread/revert`, then the provider's turns are re-read and must equal
  the expected prefix before local history is truncated (`/rewind N` uses the same
  path). Claude: a fork of the JSONL transcript ending before that prompt is written
  next to the original, verified against this conversation's prompts, and the next
  send resumes the fork; the original is never modified. File restore is optional and
  uses the turns' checkpoints. Provider refusal or any mismatch changes nothing.
  Rewinding to the first Claude message is not offered (start a new conversation).

Limits: the Claude fork drops the cursor for older native history that was not yet
imported; prompts rewritten by a skill or `/command` expansion can make the
transcript check refuse the rewind rather than guess.

## Attention, approvals, interrupt and cost

**Attention.** One decision (`src/utils/threadAttention.ts`) drives both the unread
marker and the OS notification. Only a *transition* notifies: a turn that finished
(known to have completed), a request for approval, or a failure. A first sighting,
an unchanged status, a turn you stopped yourself and a turn whose outcome is
unknown say nothing. A thread you are watching in a focused window is not
interrupted. It runs even while Code mode is showing, and clicking the
notification opens the thread (`thread:<id>` on the notification channel).

**Shortcuts** (Thread mode only, always with Ctrl+Alt held so they never compete
with typing): `PageDown` / `PageUp` next / previous conversation (pinned first,
then most recent, archived and hidden projects skipped, wraps around), `N` new
conversation.

**Search.** The sidebar filter matches title, provider and path, and also the
*content* of the conversation through the native transcript index (3+ characters,
debounced). A thread never opened here is still found if its session exists.

**Approvals (Claude).** The card uses what the CLI sends with the request: its
title, description, `decision_reason` and `blocked_path`. When the CLI proposes
permission rules the card also offers *Allow session*; choosing it returns those
rules to the CLI unchanged (`updatedPermissions`) - OXESpace never authors a rule.
A plain *Approve* grants only that call. An `ExitPlanMode` approval shows the plan
as prose and never offers to remember the decision.

**Provider retries.** A `system/api_retry` frame (rate limit, overload) is one
activity line revised per attempt, not a failure; a later retry storm starts a
fresh line.

**Interrupt (Claude).** Stop sends the CLI's own `interrupt` control request and
waits up to 2 s for the turn to end; the errored result that follows is reported
as *interrupted*. The session and its background tasks stay alive. If the CLI does
not stop in time, or the request cannot be written, the process is ended as
before. The behaviour was validated with a fake transport; confirm it against the
installed CLI version.

**Cost.** Claude's `result` frame carries `total_cost_usd` and token usage. Each
turn is folded into a running `costReport` (metadata only, never in the timeline)
and shown as a small "≈ US$" chip beside the usage ring. For a subscription
account the figure is the API-equivalent estimate, not a charge; the tooltip says
so. Codex reports tokens only and shows no cost.

**Cost.** Codex turns now report their tokens too (summed from each model request,
cached input split out), without a cost. Every finished turn is also written to a
usage ledger; see *Spending* below.

## Permissions, rules and audit

**Rules** answer the provider's approval prompts on your behalf
(`kernel/permission-policy.ts`, stored by `thread-permissions.ts`, migrations 068
and 073). A rule is an *allow* or *deny* for a **command** (`npm run test`, or a
`/regex/`), for **files** (a glob such as `src/**`, relative to the project) or for
an **MCP tool** (`server/tool`, or `server/*` for every tool of a server). Rules
belong to one project or to all projects.

- A command is approved only when every sub-command of the line is allowed;
  chained commands (`;`, `&&`, substitution) are split first. Built-in risky
  commands (`rm -rf`, `git push --force`, `Remove-Item -Recurse`, `curl | sh`...) are
  never declined silently: they ask and are marked *high-risk*.
- An edit is approved only when every path is inside the project (links and
  junctions resolved; Windows device names, 8.3 names and alternate streams
  refused) and covered by an allow rule.
- A denied MCP tool is also removed before the session starts: Claude receives it as
  `--disallowedTools`; Codex receives `disabled_tools` (or `enabled=false`) for the
  servers OXESpace attaches. Servers configured in Codex itself stay under Codex.
- Rules never widen what the CLI allows; they only answer prompts it raised. Rules
  that would allow everything (`**`, `/.*/`, `*/*`) are rejected.

An unruled prompt shows why it is asking and offers **Always allow ...** with the
narrowest rule. `/rules` lists, adds and removes rules and shows the audit trail:
approvals, policy decisions, rule changes, undo/rewind and access changes, by you,
a rule or OXESpace, kept for 180 days.

**Auto-accept edits (Claude).** With workspace write access, a switch in the
configuration bar runs Claude in `acceptEdits` mode: edits inside the project are
approved without asking; commands still ask. Codex has no equivalent and keeps its
sandbox and approval policy.

## Reviewing a turn

Each turn that changed files lists them under the turn. **Review** opens a file's
changes as separate blocks (a line diff against the checkpoint taken before the
turn). A block can be undone on its own, as can the whole file or the whole turn
(rewind with file restore). Undoing a block and then the file still restores the
original. A block can also be sent to the composer as a review comment for the
agent. Files with CRLF line endings under `core.autocrlf` keep them.

**Commit & pull request** (workbench panel) stages, commits and pushes, and drafts
the commit message and pull request from the conversation: its title, the asks of
the turns that changed files and the files they changed. A pull request waits
until local commits are pushed.

Every finished turn also has a **verdict** (`shared/threadTurnVerdict.ts`): status,
files changed, tool calls and failures, duration. A failed turn shows the action
that fits the failure (retry, wait, sign in, compact, review permissions).

## One worktree per conversation

The new-conversation dialog has **Work in an isolated worktree** (off by default, remembered
per project in `localStorage`, key `oxe.thread.worktreeDefault`). Turning it on creates a branch
and a worktree in `<project>-worktrees/` (the folder delegations use, through the same
`GitHubService.createWorktree`), and the agent runs there. The header shows the branch and a
*worktree* badge; the thread records what it owns in `ownedWorktree`.

Refusals say what to do and never fall back silently: not a Git repository, uncommitted
changes in the project (the worktree starts from the base commit without them; the person may
go on), a taken or invalid branch name, an unknown base. The project folder is offered as a
separate button and used only when pressed.

Archiving or deleting the conversation (sidebar menu, `/archive`, `/delete`) reads the
worktree first (`thread:worktree-inspect`):

| State | What happens |
| --- | --- |
| No edits, no new files, no unpushed commits | Removed with the conversation after one confirmation. |
| Edits, new files or unpushed commits | The person chooses: keep the worktree, **Open in Code**, or discard (a second confirmation; commits stay on the branch). |
| Git unreadable | Treated as "has work": keep is offered, nothing is removed on its own. |
| Folder already gone | Only the conversation is archived or deleted. |

`thread:worktree-finish` ends the conversation first (stopping its agent), reads the state again
and removes only what the choice allows, through the Worktrees panel's guarded removal. The
folder to remove always comes from the stored record and must be a direct child of the project's
worktree folder; another conversation still working in it blocks removal. Implementation:
`shared/threadWorktree.ts` (decisions), `thread-worktree-lifecycle.ts` (Git and removal).

## Context

- **Project brief.** The first message of a conversation carries a short brief
  (at most 3 KB): branch and uncommitted changes, stack, build and test scripts,
  instruction files and which OXESpace tools to use. It is shown on the message.
  Turn it off per project with `thread: { brief: false }` in `oxe.yaml`.
- **@-mentions** attach the mentioned files' content to the prompt.
- **`/instructions`** lists the `CLAUDE.md`, `.claude/rules/*` or `AGENTS.md` files
  the agent reads for this folder.
- **OXESpace tools in a Thread**: semantic search, hybrid explore, memory,
  documentation and the CodeGraph tools (`oxespace_code_search`, `_callers`,
  `_callees`, `_impact`, `_node`, `_status`) work from a conversation and only ever
  query its own project. A read-only conversation keeps the lookups.
- **MCP health.** A chip in the composer appears only when an MCP server failed to
  start or needs sign-in (Claude reports this at session start; for Codex use
  `/mcp`).

## Agent Work

A conversation can split a job into tasks that run in parallel worker
conversations (`services/work/work-service.ts`, migration 072). The agent calls
`oxespace_work_plan` with tasks, their dependencies and an optional budget:

- A task starts when every task it depends on succeeded, and receives their
  results in its prompt. A task whose dependency failed or was cancelled is
  cancelled.
- Workers run in the same project with at most the supervisor's access, never full
  access. Tasks that may edit files take turns in a project because they share the
  working tree. At most 4 workers run per project and 12 overall; a worker can plan
  work of its own, one level deep.
- The supervisor hears back in its own queue when a task fails or waits for an
  answer, and once when the run ends. Notes close together arrive as one message;
  a run wakes its supervisor at most 30 times.
- A USD or turn budget, read from the usage ledger, stops the run and every
  worker. Cancelling a run or a task stops running workers.
- `oxespace_work_status`, `_result`, `_message` (a follow-up; a finished task runs
  again) and `_cancel` complete the tools; `oxespace_thread_read` reads a worker's
  conversation.

`/work` lists the runs a conversation supervises or works for, their tasks, results
and spending, opens a worker and cancels a run. After a restart, tasks whose worker
is no longer running are settled as failed; tasks not yet started start.

Teams and Delegation keep their own tools for now; Agent Work does not migrate their
data.

## Spending

`/spending` sums the usage ledger (migration 071) by day, model and conversation,
for this conversation, the project or everything, over 7, 30 or 90 days. Claude
turns carry the API-equivalent estimate (not a charge on a subscription); Codex
turns carry tokens only. Rows outlive a deleted conversation. Turns are recorded
from 0.17.0 on.

## Finding, editing and accessibility

- **Ctrl+F** finds text anywhere in the conversation, including parts not yet
  scrolled into view, and highlights each match; Enter and Shift+Enter move between
  matches. Editors and terminals keep their own Ctrl+F.
- **Edit** on one of your messages rewinds to it and puts its text back in the
  composer; **Quote in reply** quotes an answer. **Esc** in the composer stops the
  running turn.
- Screen readers hear when a turn starts, needs input, finishes or fails (a polite
  live region, at most once every 2 seconds).

## Commands in the composer

Type `/` at the start of a message, click the slash button, or press `Ctrl+/`
with the composer focused. The menu filters commands and skills for the selected
thread. Arrow keys navigate, Enter/Tab select, Escape closes without deleting the
draft, and Shift+Enter keeps multiline editing. Selecting a skill inserts its
command; add arguments and press Enter or Send to invoke it. Paths or slash
characters inside ordinary messages do not open the menu or focus sidebar search.

The installed CLI's commands and aliases take priority over local fallback actions.
For example, Claude's `/new` dispatches its native clear command. Local fallback
`/new` opens thread creation, `/accounts` opens subscription accounts, `/help`
shows the menu, and `/stop` interrupts a turn only when no native command owns
that name. Use the composer Stop button for an ordinary running turn. `/compact` compacts the native
conversation context; Claude accepts an optional focus, Codex accepts no argument.

Claude discovery uses the SDK `initialize` commands response; Codex uses
`skills/list` in the exact thread directory, excluding disabled skills. Discovery
sends no user prompt and creates no conversation. Known interactive names are
available immediately. Availability varies with installed version, platform,
plan and experimental flags; the actual CLI's `/` menu is authoritative.

`/model` opens a visual model/effort selector in conversation history, using
the installed provider's real model catalog. Choosing a model keeps the draft
and scroll position. Model choices and Codex reasoning effort are persisted per
thread and restored when the conversation adapter reconnects. Claude confirms
its model choice through the native print command's successful completion.

Codex `/status`, `/review` and `/compact` stay in the conversation, using native
App Server operations. Native skills also stay in Thread: Codex receives its
`$name` text and structured skill item; Claude SDK commands/skills use the print
adapter. The ordinary conversation's planning/read-only limits still apply.

TUI-only commands such as native session pickers are listed as unavailable in
Thread, with the reason; unknown commands get the same explicit answer instead of
an AI prompt. The native interactive CLI no longer runs inside a Thread.

Desktop commands handled by OXESpace itself include `/rules` (permission rules and
audit), `/spending`, `/work` (Agent Work), `/instructions`, `/diff` (changes panel),
`/checkpoint`, `/rename`, `/resume` and `/delegations`.

Stable operations still run directly in conversation: Claude `/context`,
`/compact [focus]` and `/model <name>`; Codex `/compact`, `/model <id> [effort]`
and `/review [instructions]`. Bare `/model` uses the visual Thread picker;
Codex bare `/status` and `/review` also remain in conversation. Auxiliary CLI
settings follow that client's own persistence rules.

OXE markdown prompts in `~/.oxe/skills` and `<thread-root>/.oxe/skills` also work,
with project overrides, provider compatibility, and `{{argument}}` expansion.
Resolution happens in the main process; the original slash invocation remains in
history. Skill paths are never accepted from renderer input. Catalog discovery
loads in the background when selecting a thread. Typing `/`, moving the cursor,
and reopening the menu only filter this catalog; they do not start CLI processes.
**Refresh commands** explicitly reloads it without clearing the draft or focus.
Concurrent backend queries share one discovery per provider/executable/native home
and exact working directory, cached for 60 seconds (failed discovery: 5 seconds).
Late results from previously selected threads are ignored. OXE prompt files are
read on every dispatch, so edits apply without spawning another CLI.
OXE prompts execute in ordinary conversation with its existing limits.
Native skills execute through the conversation adapter with its existing limits;
the auxiliary CLI remains available for its full native tools and approvals.

Subscription preflight still applies, except native sign-in/out commands. The
Accounts dialog remains available for connecting both providers.

See [implementation and verification](plans/thread-cli-commands-implementation.md),
[Claude interactive commands](https://code.claude.com/docs/en/interactive-mode)
and [Codex CLI commands](https://developers.openai.com/codex/cli/slash-commands).

## Verification

`npm run verify:providers` (`scripts/probe-providers.cjs`) checks the installed
CLIs without sending a prompt: Claude answers `initialize` and
`interrupt{cancel_queued}` when launched with the flags Thread uses
(`--permission-mode acceptEdits`, `--disallowedTools`); Codex accepts the
`disabled_tools` override, `initialize` and `thread/start`. On 2026-10-13 it
passed with Claude Code 2.1.296 and Codex 0.155.1.

Agent Work, the usage ledger, permission rules and per-change review are covered by
deterministic tests with a fake provider (`tests/integration/agent-work.test.ts`,
`thread-usage`, `thread-permissions`, `thread-restore`). The live suite
(`OXE_LIVE=1 tests/live/thread-live.test.ts`) spends real quota and runs only
when authorized.

### Earlier verification (Windows, 2026-09-17)


Native Codex initialization and the account status protocols of both installed
clients passed, without starting inference or changing accounts. Unit/component,
Electron SQLite and Electron UI tests cover account lifecycle, subscription method,
preflight preservation, repository identity, 100-turn scrolling, reading during
streaming, drafts, sidebar scrolling, mode switching and Code terminal retention.
Visual captures cover midnight/one-dark, 900/1280/1440 widths and Chromium zoom
125/150%; zoom checks are not a Windows DPI certification.

Completing browser login with a real account, authenticated inference/resume and
Linux smoke still require a separate pilot. See the implementation evidence in
[the redesign plan](plans/thread-desktop-redesign.md).


## Command approvals, read-only list and risk

OXESpace answers the approval prompts of Claude Code and Codex for commands it can fully analyse. It only answers
prompts the provider raised, so it can narrow what runs but never widen what the provider allows.

- **Read-only list.** Commands such as `ls`, `cat`, `grep`, `rg`, `find`, `git status`, `git log`, `git diff`,
  `docker ps`, `npm ls` and a few PowerShell cmdlets are approved without asking when they only read files inside the
  project. The switch is **Rules > Read-only commands > Approve read-only commands automatically** (`/rules`), on by
  default. Turning it off leaves your saved rules working and makes every other command ask, as before.
- **Always asks:** any redirect to a file (`echo x>out` too), `rm`, network commands, `sudo`, anything not on the
  list or in a rule, a command whose name the shell computes, and any read **outside the project** (absolute paths,
  `..`, `~`, `$VAR`) or of a file that usually holds a secret (`.env*`, `*.pem`, `id_rsa`, `.npmrc` ...).
- **The card** shows a risk level (changes something / destructive or far-reaching), a warning that web content may
  carry instructions meant for the agent, and the script of `node -e`, `python -c` or `ruby -e` as code. The exact
  command stays available under "Exact command or request".
- **Windows and PowerShell:** `pwsh -Command "..."` is judged by the script inside it. Scripts with blocks `{ }` or
  `-File` keep asking.
- The bash grammar (tree-sitter) reads the line when its files load; if they cannot be loaded the previous text
  analysis applies, which asks whenever it is unsure. The full review is in
  [validation/thread-command-approval-security-review.md](validation/thread-command-approval-security-review.md).

## Inspecting a conversation: `/events`

`/events` opens an inspector of the events saved for the conversation: messages, tool calls with their duration and
exit code, requests, turn cost and completions, oldest first.

- **Filter** with comma-separated terms (`tool, message`), `!term` to exclude and `before:2026-10-14` /
  `after:2026-10-14t09:30` to bound the time. The text of tool output is searched too.
- **Detail:** select a row (or press Enter on it) to see its sequence, event, turn and operation IDs and the saved
  JSON, clipped at 20,000 characters. **Load earlier events** pages further back; one request reads at most 20,000
  events, and the inspector says when the search was limited.
- **Copy as JSON lines** copies the rows that are loaded.
- It shows what OXESpace saved. It does not show what the provider CLI sent or received (no wire log, no prompt).
  Tool output may contain secrets from your project; the copy is yours to handle.

## Skills and instruction files

- Skill headers are read as YAML: block lists (`agents:` with `- claude`), quoted values and multi-line descriptions
  work. A header that is not valid YAML still loads the flat `key: value` way.
- `/instructions` lists user rules (`~/.claude/rules`), project rules including sub-folders, and for each rule the
  `paths:` it is limited to ("only for src/**"). Only the first 4 KiB of a rule file is read, for its header.
