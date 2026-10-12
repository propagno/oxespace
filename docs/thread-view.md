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

OXESpace memory capture, CodeGraph, internal MCP, preview/delegation, attachments,
write mode and visual model/reasoning selectors in ordinary conversation remain
separate follow-up work; the native CLI provides its own tools and selectors.

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

**Building blocks not yet wired to the UI.** `shell-command-rules.ts` (safe
allow/deny for shell approvals: sub-command splitting, no smuggled second command,
narrow rule suggestions), `path-safety.ts` (Windows-aware workspace containment)
and `shared/agentLeadStatusFold.ts` (a finished lead stays "working" while child
work lives) are implemented and tested but nothing consumes them yet.

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

TUI-only commands such as permissions and native session pickers display an
action card. Unknown commands receive the same explicit action rather than an
AI prompt. **Open advanced tools** starts the actual CLI in a separate dialog;
it never replaces or unmounts conversation history and the composer. The header
**Tools** button opens the auxiliary dialog directly. No slash command starts a
terminal automatically. Closing its dialog leaves a running CLI available through
**Show tools**; **Return to conversation** closes its session and imports history.

Complete any native sign-in or project trust prompt, click **Insert command**,
then press Enter inside the CLI. Insertion never submits Enter automatically.
Native selectors, tools, permissions and confirmations use the provider's own
interface. Interactive execution follows native permissions; ordinary
conversation retains its existing planning/read-only mode. Thread CLI processes
and shortcuts are isolated from Code terminals.

Exit with `/quit`, then choose **Return to thread** to import public conversation
text and continue with the selected saved resume ID. If a session change/fork
does not emit a recognized resume footer, use **Saved session → Link session**
with its native UUID, including after exit. The backend validates the exact
project and never selects the newest session. Failed imports block ordinary
sends until recovery. Private thinking, tool payloads, raw terminal output and
child/sidechain sessions are not imported. Claude rewind imports only the active
parent chain. Terminal output stays in a bounded in-memory buffer.

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
Accounts dialog remains available for connecting both providers. An active CLI
owns its thread: return before starting an ordinary turn. Restart marks the CLI
interrupted and requires explicit recovery; commands never resume automatically.

See [implementation and verification](plans/thread-cli-commands-implementation.md),
[Claude interactive commands](https://code.claude.com/docs/en/interactive-mode)
and [Codex CLI commands](https://developers.openai.com/codex/cli/slash-commands).

## Verification (Windows, 2026-09-17)

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
