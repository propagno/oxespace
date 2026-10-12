# Code + Thread

Status: initial Code/Thread slice implemented; advanced integrations remain pending.

## Verified anchors

- TerminalManager uses node-pty; preserve its lifecycle and Code view.
- SessionService lists native sessions; Claude transcript forks exist, not a chat controller.
- AgentLaunchService supplies MCP CLI arguments, currently for terminal delegation.
- Claude local CLI help confirms print/input-format/output-format stream-json and resume.
- Codex local help confirms app-server stdio. Official protocol:
  https://learn.chatgpt.com/docs/app-server
  initialize/initialized, thread/start or resume, turn/start, interrupt, item events,
  server-initiated command/file approvals. Validate installed schemas before adapters.

## Scope and acceptance

1. Contract and bounded JSONL framing: shared/types/thread.ts,
   electron/main/services/conversation/json-lines.ts. Test fragmented UTF-8,
   malformed/oversized frames; never expose raw protocol secrets in errors.
2. Provider adapters in services/conversation: native authentication, no API key
   collection, no permission bypass. Verify Claude control/approval protocol first.
   Codex initialize handshake, request timeouts, reject unsupported host requests,
   graceful shutdown and process-tree cleanup on Windows/Linux.
3. ThreadManager and SQLite migration: thread/project/worktree identity, events,
   ordered turns, ownership locking, bounded persistence, interrupted recovery.
   Never automatically adopt an active terminal's native session.
4. Typed IPC/preload: validate IDs, inputs, workspace/root association, sender;
   events scoped to thread; shutdown disposes adapters before database close.
5. Lazy Thread UI in App: Code/Thread switch, grouped/pinned conversation sidebar,
   project/worktree header, timeline/tool details, composer/cancel/approvals.
   Existing terminal surfaces remain mounted and unchanged across view switches.
   Existing theme tokens; keyboard navigation; narrow-screen layouts.
6. Optional context integration: bounded CodeGraph/memory retrieval and handoff;
   memory outage never blocks chat. No indiscriminate transcript consolidation.
7. Integration/E2E: concurrent threads, cross-project isolation, cancel/restart,
   approvals, unavailable CLI/auth errors, Code retention; Windows/Linux checks.

## Deferred controls

Voice, advanced Agent dashboard and model/reasoning pickers are not displayed
until adapter capabilities actually support them. Do not fabricate thinking.
Attachments require explicit bounded file selection and consent to provider upload.

## Execution evidence

2026-09-16: inspected current services and CLI help; fetched official App Server
documentation. Added provider-neutral types and a bounded JSONL decoder plus tests.
No CLI inference request, terminal adoption, release or credentials change performed.
Added request correlation with deadlines, connection-loss cleanup and explicit
host-request routing (never automatic approval). Framing tests: 5 passed;
initial typecheck passed. Added Codex protocol adapter with initialization,
explicit native resume, turn ownership, streaming, scoped notifications,
interruption and command/file approvals. Starts read-only; unsupported host
requests are rejected. Transport is injected; real process integration remains.
2026-09-16 continuation: added migration 053 and ThreadManager with persisted
identity/history, startup interruption, ownership reservation, bounded history
and explicit native resume. Added process transport without shell interpolation,
Windows npm-shim resolution and bounded process-tree termination. Codex native
initialize handshake passed without inference. First smoke exposed selection of
the Unix extensionless npm launcher on Windows; prefer .exe/.cmd fixed it.

Added Claude print/stream-json adapter using a separate process per turn and
official resume. Initial Claude capability is planning/read tools, no host
approvals; hooks disabled where policy permits, MCP config explicitly empty.
No thinking text, provider error payloads or remote images rendered.

Typed IPC/preload and lazy Thread runtime/UI added. Code/Thread switch keeps
terminal surfaces mounted; Thread component retains drafts across view switches.
Thread UI includes native-provider selection, registered pane directory selection,
project/branch header, history, Markdown, tool details, pinning, send and stop.
Initial UI groups only the current workspace; existing sidebar selects projects.

Validation: 31 focused tests passed; native Codex handshake passed; typecheck,
targeted lint and build passed. Electron renderer E2E with fixture responses passed
at 1280 and 900 widths; screenshots inspected. This is not authenticated inference
validation, not a Linux runtime test, and not a full completion of the seven phases.

Remaining: authenticated Claude/Codex pilot, Linux process smoke, full write-mode
approval capabilities, @file/attachments, optional CodeGraph/memory/context,
execution-bound MCP/preview/delegation, unified grouped thread sidebar, rename/archive,
tests for sender auth and deletion during execution, and a broader regression run.
Three-terminal resize regression passed (both axes, terminal DOM preserved).
Thread E2E also confirms unsent draft retention across Code/Thread switches.
Added a workspace-deletion-during-output guard and passing regression test.
No commit/push/release performed.
