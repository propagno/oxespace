# Agent delegation through OXESpace MCP

Agent delegation is optional and disabled by default. It does not require AI Memory.
Enable **Workspace settings → Agent delegation**, then open a fresh Claude or Codex
terminal using an OXESpace agent profile. Node.js, Git and the selected native CLI
must be installed. Profiles must contain an executable name/path, not a shell command
with embedded arguments. Other providers are not yet eligible.

Ask the origin agent, for example:

> Delegate the parallel authentication bug to Codex in a new worktree. Include our
> JWT HttpOnly decision, failed attempts, relevant files and remaining work in the
> handoff. Require regression tests. Keep working here and check the delegation inbox.

The agent calls `oxespace_list_agents`, selects an eligible `agentProfileId`, then
`oxespace_delegate_task` with `key`, `objective`, `handoff`, and `acceptance`.
Reuse the key for the same request; different content requires a new key.

## Lifecycle and ownership

The origin's HEAD is captured at request time. A new `oxe/<task>-<id>` branch and
worktree are created beside the primary checkout in `<project>-worktrees/`.
A new terminal pane appears in the **same OXESpace workspace**. It has its own
process credentials and native conversation; no conversation ID is reused.
Dirty files are listed in the handoff but never copied. Commit necessary shared
changes before delegation, or explicitly explain their absence in the handoff.

`preparing → starting → accepted → review → approved` is the normal path.
`starting` means only that the terminal launched, not that the agent accepted.
Open it to complete native login, trust or permission prompts. OXESpace supplies
no permission-bypass flags. The child retrieves `oxespace_delegation_context`,
acknowledges through `oxespace_delegation_update`, and submits a summary and test
evidence using `review`. Approval records review; it does **not** merge or verify
the agent's claims automatically.

The origin can inspect `oxespace_delegation_status` and use
`oxespace_delegation_control` to approve, cancel or retry. The child may report
accepted/blocked/review but cannot control or recursively delegate tasks.
At most four provisioning/working tasks per project are allowed; provisioning
is serialized per project, while agent processes run concurrently.

Both participants use `oxespace_delegation_message` and poll
`oxespace_delegation_inbox` at checkpoints. Pass the last `cursor` as `after`.
Reading does not consume events. Messages are not typed into occupied terminals
and cannot wake an idle model. Workspace settings show state, the latest report
and message, preserved context, and explicit recovery controls. UI notifications
link to the task without stealing terminal focus.

Cancellation stops the child but preserves its branch, worktree and files.
Failures also preserve resources. Retry reuses them with a fresh execution.
App restart marks active tasks interrupted; no agents relaunch automatically.
When the origin process exits, its credentials are revoked: a new conversation
does not inherit control automatically. The user can still manage tasks in settings.

## Context and security

The explicit handoff and acceptance criteria always work without AI Memory.
When automatic project context is enabled, optional project memory and current
checkout CodeGraph evidence enrich the handoff within size/time limits. Historical
claims must be checked against the destination code. No full terminal transcript,
session snapshot, or uncommitted content is captured by delegation. Native memory
hooks remain a separate opt-in capture facility.

Tasks/events are stored locally in the OXESpace database. MCP requires both the
local transport token and live, workspace-bound execution credentials. Delegation
never falls back to whichever workspace happens to be active. This is local
application scoping, not a sandbox against another process running as the same OS
user (which may read process environments or local storage).

Handoffs and retrieved context are supplied to the selected CLI and may be sent
to its model vendor. Enabling delegation consents to launching that configured
agent; review the handoff for secrets. AI Memory's own remote-provider policy is
documented separately in [Project Memory](PROJECT_MEMORY.md).

## Validation

Automated coverage includes real Git worktree creation, idempotent concurrent
requests, targeted JWT handoff without memory, independent credentials, scope
denial, non-consuming inboxes, preserved retry/cancel resources, restart recovery,
UI opt-in, and bridge credential forwarding. Run `npm run test:electron`.

With installed native CLIs, set `OXESPACE_TEST_AGENT_LAUNCH=1` and run
`npm run test:electron -- tests/integration/agent-launch.native.test.ts` to exercise
PTY startup and MCP argument transport using `--help`, without model calls.
This is not a logged-in end-to-end delegation test. Validate the interactive flow
above with your account on Windows and Linux before treating a release as certified
for both platforms; native trust prompts must not be bypassed by the test.
